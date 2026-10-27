import { restoreChecklistWorkspace } from './saved-workspace';
import { expect, test, type Page } from '@playwright/test';

const label = 'Экземпляр 3 · Список 2';
type Area = { x: number; y: number; width: number; height: number };
const pane = (page: Page) => page.getByRole('group', { name: label, exact: true });
const windowOf = (page: Page) => page.locator('.cascade-layout__window').filter({ has: pane(page) });

// PBT-093: допуск — краевой рост добавляет до нескольких узлов между
// живым замером и отпусканием (плавная автопрокрутка у края).
const CASCADE_SNAP_TOLERANCE = 32;

async function geometry(page: Page): Promise<Area> {
  return windowOf(page).evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42, width: element.offsetWidth, height: element.offsetHeight };
  });
}

async function storedArea(page: Page): Promise<Area | null> {
  return page.evaluate(() => new Promise<Area | null>((resolve, reject) => {
    const open = indexedDB.open('project-board');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('widgetInstances').objectStore('widgetInstances').get('w-3');
      request.onsuccess = () => { resolve(request.result?.cascadeArea ?? null); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  }));
}

async function start(page: Page) {
  await page.setViewportSize({ width: 1024, height: 778 });
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Каскад', exact: true }).click();
  await expect(windowOf(page)).toBeVisible();
  await expect.poll(async () => (await geometry(page)).width).toBe(608);
  // Снимок переключения режима записывается с дебаунсом 250мс.
  await page.waitForTimeout(400);
}

function expectGrid(area: Area) {
  for (const value of Object.values(area)) expect(value % 16).toBe(0);
}

async function beginDrag(page: Page) {
  await pane(page).locator('.widget-window__head').scrollIntoViewIfNeeded();
  const head = await pane(page).locator('.widget-window__head').boundingBox();
  const viewport = await page.locator('.cascade-viewport').boundingBox();
  if (!head || !viewport) throw new Error('Нет заголовка или области');
  const x = Math.max(head.x + 40, viewport.x + 40);
  const y = Math.max(head.y + 10, viewport.y + 10);
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
}

test('каскад: дискретный preview совпадает с записью; режимы, разворот и reload сохраняют геометрию', async ({ page }) => {
  await start(page);
  const original = await geometry(page);
  const storedBefore = await storedArea(page);
  const cursor = await beginDrag(page);
  await page.mouse.move(cursor.x + 23, cursor.y + 23);
  const dragLive = await geometry(page);
  expect(dragLive.x).toBe(original.x + 16);
  expect(dragLive.y).toBe(original.y + 16);
  expectGrid(dragLive);
  expect(await storedArea(page)).toEqual(storedBefore);
  await page.mouse.up();
  expect(await geometry(page)).toEqual(dragLive);
  await expect.poll(() => storedArea(page)).toEqual(dragLive);

  await windowOf(page).locator('.cascade-resize-se').scrollIntoViewIfNeeded();
  const handle = await windowOf(page).locator('.cascade-resize-se').boundingBox();
  if (!handle) throw new Error('Нет уголка');
  await page.mouse.move(handle.x + 6, handle.y + 6);
  await page.mouse.down();
  await page.mouse.move(handle.x + 29, handle.y + 29);
  const resizeLive = await geometry(page);
  expect(resizeLive.width).toBe(dragLive.width + 16);
  expect(resizeLive.height).toBe(dragLive.height + 16);
  expectGrid(resizeLive);
  expect(await storedArea(page)).toEqual(dragLive);
  await page.mouse.up();
  expect(await geometry(page)).toEqual(resizeLive);
  await expect.poll(() => storedArea(page)).toEqual(resizeLive);

  await pane(page).getByRole('button', { name: `Развернуть на весь дашборд ${label}`, exact: true }).click();
  await pane(page).getByRole('button', { name: `Вернуть прежний размер ${label}`, exact: true }).click();
  expect(await geometry(page)).toEqual(resizeLive);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await page.getByRole('button', { name: 'Каскад', exact: true }).click();
  expect(await geometry(page)).toEqual(resizeLive);
  await page.waitForTimeout(400);
  await page.reload();
  await expect.poll(() => geometry(page)).toEqual(resizeLive);
});

test('каскад: поле расширяется при drag/resize, свёрнутая высота сохраняется', async ({ page }) => {
  await start(page);
  const cursor = await beginDrag(page);
  await page.mouse.move(cursor.x + 1500, cursor.y + 1500, { steps: 8 });
  const live = await geometry(page);
  expectGrid(live);
  const viewport = await page.locator('.cascade-viewport').evaluate(e => ({ width: e.clientWidth, height: e.clientHeight }));
  expect(live.x + live.width).toBeGreaterThan(viewport.width);
  const canvas = await page.locator('.cascade-layout').evaluate(e => ({ width: e.clientWidth, height: e.clientHeight }));
  expect(live.x + live.width).toBeLessThanOrEqual(canvas.width);
  expect(live.y + live.height).toBeLessThanOrEqual(canvas.height);
  await page.mouse.up();
  // PBT-093: автопрокрутка у края может довести окно на узел сетки
  // между живым замером и отпусканием — сверяем геометрию с допуском.
  const afterDrag = await geometry(page);
  expect(afterDrag.x).toBe(live.x);
  expect(afterDrag.width).toBe(live.width);
  expect(afterDrag.height).toBe(live.height);
  expect(afterDrag.y).toBeGreaterThanOrEqual(live.y);
  expect(afterDrag.y - live.y).toBeLessThanOrEqual(CASCADE_SNAP_TOLERANCE);

  await windowOf(page).locator('.cascade-resize-se').scrollIntoViewIfNeeded();
  const handle = await windowOf(page).locator('.cascade-resize-se').boundingBox();
  if (!handle) throw new Error('Нет уголка');
  await page.mouse.move(handle.x + 6, handle.y + 6);
  await page.mouse.down();
  await page.mouse.move(handle.x + 800, handle.y + 800, { steps: 6 });
  const duringResize = await geometry(page);
  expectGrid(duringResize);
  const expandedCanvas = await page.locator('.cascade-layout').evaluate(e => ({ width: e.clientWidth, height: e.clientHeight }));
  expect(duringResize.x + duringResize.width).toBeLessThanOrEqual(expandedCanvas.width);
  expect(duringResize.y + duringResize.height).toBeLessThanOrEqual(expandedCanvas.height);
  await page.mouse.up();
  // PBT-093: отпускание фиксирует видимую геометрию (краевой рост у
  // нижнего края добавляет узлы между движением и отпусканием).
  const resized = await geometry(page);
  expect(resized.height).toBeGreaterThanOrEqual(duringResize.height);
  expect(resized.height - duringResize.height).toBeLessThanOrEqual(CASCADE_SNAP_TOLERANCE);
  // Фиксация проходит через привязку к сетке (16px) — сверяем снапнутый итог.
  const snapped = {
    ...resized,
    x: Math.floor(resized.x / 16) * 16,
    y: Math.floor(resized.y / 16) * 16,
    width: Math.floor(resized.width / 16) * 16,
    height: Math.floor(resized.height / 16) * 16,
  };
  await expect.poll(() => storedArea(page)).toEqual(snapped);

  await pane(page).getByRole('button', { name: `Свернуть ${label}`, exact: true }).click();
  const collapsedCursor = await beginDrag(page);
  await page.mouse.move(collapsedCursor.x, collapsedCursor.y + 1500, { steps: 6 });
  const collapsed = await geometry(page);
  expect(collapsed.height).toBe(34);
  expect(collapsed.y % 16).toBe(0);
  expect(collapsed.y).toBeGreaterThan(viewport.height);
  await page.mouse.up();
  await expect.poll(async () => (await storedArea(page))?.height).toBe(resized.height);
  await pane(page).getByRole('button', { name: `Развернуть ${label}`, exact: true }).click();
  expect((await geometry(page)).height).toBe(resized.height);
});

test('каскад: старые несеточные координаты нормализуются без перезаписи до жеста', async ({ page }) => {
  await start(page);
  // Сначала дождаться сохранённой записи, затем уйти на пустую страницу
  // того же origin: pagehide приложения иначе перезапишет подложенную
  // старую геометрию своим актуальным снимком при reload.
  const cursorBefore = await beginDrag(page);
  await page.mouse.move(cursorBefore.x + 23, cursorBefore.y + 23);
  await page.mouse.up();
  await expect.poll(() => storedArea(page)).not.toBeNull();
  await page.route('**/legacy-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
  await page.goto('/legacy-fixture');
  const legacy = { x: 47, y: 61, width: 601, height: 419 };
  await page.evaluate((area) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('project-board');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('widgetInstances', 'readwrite');
      const store = transaction.objectStore('widgetInstances');
      const get = store.get('w-3');
      get.onsuccess = () => store.put({ ...get.result, cascadeArea: area });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Транзакция fixture прервана')); };
    };
  }), legacy);
  await page.goto('/');
  await expect.poll(() => geometry(page)).toEqual({ x: 48, y: 64, width: 608, height: 416 });
  await page.waitForTimeout(400);
  expect(await storedArea(page)).toEqual(legacy);
  await page.setViewportSize({ width: 820, height: 650 });
  await expect.poll(async () => (await geometry(page)).height % 16).toBe(0);
  expect(await storedArea(page)).toEqual(legacy);
  const cursor = await beginDrag(page);
  await page.mouse.move(cursor.x + 23, cursor.y + 23);
  await page.mouse.up();
  const updated = await geometry(page);
  expectGrid(updated);
  await expect.poll(() => storedArea(page)).toEqual(updated);
});

test('каскад: новые окна занимают свободные места, доступны через прокрутку и переживают reload', async ({ page }) => {
  await start(page);
  for (let index = 1; index <= 4; index += 1) {
    await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Каталог виджетов' });
    await dialog.getByRole('button', { name: 'Чек-лист', exact: true }).click();
    await dialog.getByLabel('Название нового документа').fill(`Свободное место ${index}`);
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
    const fresh = page.getByRole('group', { name: `Чек-лист · Свободное место ${index}`, exact: true });
    await expect(fresh.locator('.widget-window__head')).toBeInViewport();
  }
  const areas = () => page.locator('.cascade-layout__window').evaluateAll(nodes => nodes.map(element => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42, width: element.offsetWidth, height: element.offsetHeight };
  }).sort((a, b) => a.y - b.y || a.x - b.x));
  const placed = await areas();
  for (let index = 3; index < placed.length; index += 1) {
    const fresh = placed[index];
    expectGrid(fresh);
    for (const other of placed.slice(0, index)) {
      expect(fresh.x + fresh.width <= other.x || other.x + other.width <= fresh.x ||
        fresh.y + fresh.height <= other.y || other.y + other.height <= fresh.y).toBe(true);
    }
  }
  const viewport = page.locator('.cascade-viewport');
  expect(await viewport.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
  const scroll = await viewport.evaluate(e => ({ left: e.scrollLeft, top: e.scrollTop }));
  const last = page.getByRole('group', { name: 'Чек-лист · Свободное место 4', exact: true });
  await last.getByRole('button', { name: 'Развернуть на весь дашборд Чек-лист · Свободное место 4', exact: true }).click();
  const overlay = await page.getByTestId('widget-maximize-layer').boundingBox();
  const view = await viewport.boundingBox();
  expect(overlay!.height).toBeLessThanOrEqual(view!.height + 2);
  await last.getByRole('button', { name: 'Вернуть прежний размер Чек-лист · Свободное место 4', exact: true }).click();
  await expect.poll(() => viewport.evaluate(e => ({ left: e.scrollLeft, top: e.scrollTop }))).toEqual(scroll);
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 820, height: 600 });
  await page.reload();
  await expect.poll(areas).toEqual(placed);
  await last.locator('.widget-window__head').scrollIntoViewIfNeeded();
  await expect(last.locator('.widget-window__head')).toBeInViewport();
});
