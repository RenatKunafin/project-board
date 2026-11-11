import { expect, test, type Page } from './app-test';
import { createDocumentWindow } from './document-ui';
import { storedWorkspace } from './workspace-helper';

async function savedWindow(page: Page, id: string) {
  const rows = (await storedWorkspace(page)).widgetInstances as {
    id: string; collapsed: number; cascadeArea: unknown; gridArea: unknown;
  }[];
  return rows.find(row => row.id === id);
}

async function delayWorkspaceDebounce(page: Page) {
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) =>
      original(handler, ms === 300 ? 60000 : ms, ...args)) as typeof window.setTimeout;
  });
}

// Управляемая нагрузка на React: mousedown активирует окно каждые 50 мс.
// Счётчик и максимальный разрыв подтверждают, что debounce не получил паузу.
async function startActivity(page: Page) {
  await page.evaluate(() => {
    const head = document.querySelector('.widget-window__head')!;
    let previous = performance.now();
    const stats = { ticks: 0, maxGap: 0, timer: 0 };
    stats.timer = window.setInterval(() => {
      const now = performance.now();
      stats.maxGap = Math.max(stats.maxGap, now - previous);
      previous = now;
      stats.ticks++;
      head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }, 50);
    Object.assign(window, { persistenceActivity: stats });
  });
}
async function stopActivity(page: Page) {
  return page.evaluate(() => {
    const stats = (window as unknown as { persistenceActivity: { ticks: number; maxGap: number; timer: number } }).persistenceActivity;
    clearInterval(stats.timer);
    return stats;
  });
}

test('новая свёрнутость сохраняется до остановки непрерывных изменений workspace', async ({ page }) => {
  await page.goto('/');
  const { pane, instanceId } = await createDocumentWindow(page, 'Чек-лист', 'Нагрузка', true);
  await expect.poll(async () => (await savedWindow(page, instanceId))?.collapsed).toBe(0);
  // Покой только до проверяемой правки: завершить начальные записи создания.
  await page.waitForTimeout(350);
  await startActivity(page);
  try {
    await pane.getByRole('button', { name: 'Свернуть Чек-лист · Нагрузка', exact: true }).click();
    await expect.poll(async () => (await savedWindow(page, instanceId))?.collapsed,
      { timeout: 2800, intervals: [50] }).toBe(1);
  } finally {
    const activity = await stopActivity(page);
    expect(activity.ticks).toBeGreaterThan(10);
    expect(activity.maxGap).toBeLessThan(300);
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'Развернуть Чек-лист · Нагрузка', exact: true })).toBeVisible();
});

test('структурная запись сохраняет актуальные координаты и свёрнутость, закрытие не удаляет документ', async ({ page }) => {
  await page.goto('/');
  await delayWorkspaceDebounce(page);
  const first = await createDocumentWindow(page, 'Чек-лист', 'Первое', true);
  const before = await savedWindow(page, first.instanceId);
  expect(before?.cascadeArea).not.toBeNull();
  await first.pane.getByRole('button', { name: 'Свернуть Чек-лист · Первое', exact: true }).click();
  const second = await createDocumentWindow(page, 'Чек-лист', 'Второе');
  await expect.poll(async () => (await savedWindow(page, first.instanceId))?.collapsed).toBe(1);
  expect((await savedWindow(page, first.instanceId))?.cascadeArea).toEqual(before?.cascadeArea);
  const secondSaved = await savedWindow(page, second.instanceId);
  expect(secondSaved?.cascadeArea).not.toBeNull();
  expect(secondSaved?.gridArea).not.toBeNull();
  await page.reload();
  await delayWorkspaceDebounce(page);
  expect((await savedWindow(page, second.instanceId))?.cascadeArea).toEqual(secondSaved?.cascadeArea);
  await page.getByRole('button', { name: 'Закрыть Чек-лист · Второе', exact: true }).click();
  await expect.poll(() => savedWindow(page, second.instanceId)).toBeUndefined();
  expect((await storedWorkspace(page)).documents.some(row => row.id === second.documentId)).toBe(true);
});

for (const event of ['hidden', 'pagehide'] as const) {
  test(`${event}: lifecycle-обработчик фиксирует отложенную правку без срабатывания таймера`, async ({ page }) => {
    await page.goto('/');
    const { pane, instanceId } = await createDocumentWindow(page, 'Чек-лист', 'Фон', true);
    await page.waitForTimeout(350); // покой до проверяемой правки
    // Изолировать обработчик от debounce: таймер не может случайно сделать тест зелёным.
    await delayWorkspaceDebounce(page);
    await pane.getByRole('button', { name: 'Свернуть Чек-лист · Фон', exact: true }).click();
    expect((await savedWindow(page, instanceId))?.collapsed).toBe(0);
    await page.evaluate(kind => {
      if (kind === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      } else {
        window.dispatchEvent(new PageTransitionEvent('pagehide'));
      }
    }, event);
    await expect.poll(async () => (await savedWindow(page, instanceId))?.collapsed,
      { timeout: 1500 }).toBe(1);
  });
}
