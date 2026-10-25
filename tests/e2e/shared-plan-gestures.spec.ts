import { expect, test, type Locator, type Page } from '@playwright/test';

const title = 'Общий жест';
const content = {
  title,
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  groups: [], resources: [], workTypes: [], dependencies: [], unavailability: [],
  tasks: [
    { id: 'target', title: 'Целевая задача', start: '2026-10-12', end: '2026-10-16' },
    { id: 'other', title: 'Другая задача', start: '2026-10-19', end: '2026-10-23' },
  ],
};

type Snapshot = { revision: number; content: typeof content };
async function snapshot(page: Page, id: string): Promise<Snapshot> {
  return page.evaluate((id) => window.__projectBoard!.readDocument(id) as Snapshot, id);
}

async function setup(page: Page, count: number, mode = 'Сетка', maximize = true) {
  await page.setViewportSize({ width: maximize ? 1920 : 3000, height: maximize ? 1080 : 1400 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  // Убираем стартовые окна через UI, оставляя только общий план.
  for (const name of ['Экземпляр 1 · Список 1', 'Экземпляр 2 · Список 1', 'Экземпляр 3 · Список 1']) {
    const close = page.getByRole('button', { name: `Закрыть ${name}`, exact: true });
    if (await close.count()) await close.click();
  }
  let id = '';
  for (let index = 0; index < count; index += 1) {
    await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
    const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
    await catalog.getByRole('button', { name: 'План', exact: true }).click();
    if (index === 0) {
      await catalog.getByLabel('Название нового документа').fill(title);
      await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
      id = (await page.locator('.plan-gantt').first().evaluate(el => el.closest('[data-document-id]')!.getAttribute('data-document-id'))) as string;
      await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id, content });
    } else {
      await catalog.getByRole('button', { name: title, exact: true }).click();
    }
  }
  const panes = page.locator('.widget-window').filter({ has: page.locator('.plan-gantt') });
  await expect(panes).toHaveCount(count);
  if (mode !== 'Сетка') await page.getByRole('button', { name: mode, exact: true }).click();
  const instanceId = await panes.last().locator('.plan-gantt').getAttribute('data-widget-instance');
  const pane = panes.filter({ has: page.locator(`.plan-gantt[data-widget-instance="${instanceId}"]`) });
  if (maximize) await pane.getByRole('button', { name: /Развернуть на весь дашборд/ }).click();
  await pane.getByRole('button', { name: 'Дни', exact: true }).click();
  // Дожидаемся окна восстановления прокрутки PBT-073 и старых сверок baseline.
  await page.waitForTimeout(2200);
  return { id, pane, panes };
}

async function gesture(page: Page, pane: Locator, kind: 'drag' | 'left' | 'right', outside = false, taskId = 'target') {
  const bar = pane.locator(`.wx-bar[data-id=":${taskId}"]`);
  await expect(bar).toBeVisible();
  // Полоса после 30-дневного запаса шкалы: прокручиваем реальный чарт.
  await bar.evaluate(el => {
    const chart = el.closest('.wx-chart')!;
    chart.scrollLeft += el.getBoundingClientRect().left - chart.getBoundingClientRect().left - 80;
  });
  const box = (await bar.boundingBox())!;
  const x = kind === 'left' ? box.x + 7 : kind === 'right' ? box.x + box.width - 7 : box.x + box.width / 2;
  const y = box.y + box.height / 2;
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.wx-bar')?.getAttribute('data-id'), { x, y })).toBe(`:${taskId}`);
  await page.mouse.move(x, y);
  // Даём SVAR применить hover-режим края до mousedown.
  await page.waitForTimeout(100);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(x + 96 * step / 6, y);
    await page.waitForTimeout(60);
  }
  if (outside) {
    const bounds = (await pane.locator('.wx-chart').boundingBox())!;
    await page.mouse.move(x + 96, bounds.y - 10, { steps: 4 });
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
}

for (const scenario of [
  { count: 2, kind: 'drag' as const, start: '2026-10-14', end: '2026-10-20', mode: 'Сетка' },
  { count: 6, kind: 'right' as const, start: '2026-10-12', end: '2026-10-18', mode: 'Каскад' },
  { count: 2, kind: 'left' as const, start: '2026-10-14', end: '2026-10-16', mode: 'Сетка' },
]) {
  test(`${scenario.count} общих видов: ${scenario.kind}, одна запись и стабильные даты (${scenario.mode})`, async ({ page }) => {
    const { id, pane, panes } = await setup(page, scenario.count, scenario.mode);
    const before = await snapshot(page, id);
    await gesture(page, pane, scenario.kind);
    await page.waitForTimeout(2400);
    const after = await snapshot(page, id);
    expect(after.content.tasks[0]).toMatchObject({ start: scenario.start, end: scenario.end });
    expect(after.revision).toBe(before.revision + 1);
    expect(after.content.tasks[1]).toEqual(before.content.tasks[1]);
    // Клик до возврата соседей: их скрытые экземпляры ещё держат старые API.
    await pane.getByRole('searchbox', { name: 'Поиск задач' }).click();
    await page.waitForTimeout(2200);
    expect(await snapshot(page, id)).toEqual(after);
    // После возврата соседей все виды должны отображать результат.
    await pane.getByRole('button', { name: /Вернуть прежний размер/ }).click();
    await expect(panes.locator('.wx-row[data-id=":target"]')).toHaveCount(scenario.count);
    await page.waitForTimeout(2200);
    expect(await snapshot(page, id)).toEqual(after);
    await page.reload();
    await expect(page.locator('.plan-gantt')).toHaveCount(scenario.count);
    expect(await snapshot(page, id)).toEqual(after);
  });
}


test('два видимых соседа: отпускание вне чарта сохраняет один результат', async ({ page }) => {
  const { id, pane, panes } = await setup(page, 2, 'Сетка', false);
  for (let i = 0; i < 2; i += 1) await expect(panes.nth(i)).toBeInViewport();
  const before = await snapshot(page, id);
  await gesture(page, pane, 'drag', true);
  await page.waitForTimeout(2300);
  const after = await snapshot(page, id);
  expect(after.content.tasks[0]).toMatchObject({ start: '2026-10-14', end: '2026-10-20' });
  expect(after.revision).toBe(before.revision + 1);
  expect(after.content.tasks[1]).toEqual(before.content.tasks[1]);
  for (let i = 0; i < 2; i += 1) {
    await expect(panes.nth(i).locator('.wx-row[data-id=":target"]')).toContainText('14.10');
  }
});

test('внешняя редакция отменяет ожидающую сверку жеста', async ({ page }) => {
  const { id, pane } = await setup(page, 2);
  const before = await snapshot(page, id);
  await gesture(page, pane, 'right');
  const replacement = { ...content, tasks: content.tasks.map(task => task.id === 'target'
    ? { ...task, start: '2026-10-26', end: '2026-10-30' } : task) };
  await page.evaluate(({ id, replacement }) => window.__projectBoard!.writeDocumentContent(id, replacement), { id, replacement });
  await page.waitForTimeout(2300);
  const after = await snapshot(page, id);
  expect(after.content).toEqual(replacement);
  expect(after.revision).toBe(before.revision + 1);
});

test('закрытие владельца жеста отменяет отложенную запись', async ({ page }) => {
  const { id, pane } = await setup(page, 2);
  const before = await snapshot(page, id);
  await gesture(page, pane, 'right');
  await pane.getByRole('button', { name: `Закрыть План · ${title}`, exact: true }).click();
  await page.waitForTimeout(2300);
  expect(await snapshot(page, id)).toEqual(before);
});

test('смена документа отменяет отложенную запись старого жеста', async ({ page }) => {
  const { id, pane } = await setup(page, 2);
  const before = await snapshot(page, id);
  await gesture(page, pane, 'right');
  const file = { format: 'project-board-plan', formatVersion: 1, title: 'Другой план', schemaVersion: 1, content };
  await pane.locator('input[type="file"]').setInputFiles({
    name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)),
  });
  const importedPane = page.getByRole('group', { name: 'План · Другой план', exact: true });
  await expect(importedPane).toBeVisible();
  const newId = (await importedPane.locator('[data-document-id]').getAttribute('data-document-id'))!;
  const imported = await snapshot(page, newId);
  await page.waitForTimeout(2300);
  expect(await snapshot(page, id)).toEqual(before);
  expect(await snapshot(page, newId)).toEqual(imported);
});

test('новый жест завершает предыдущую операцию и отменяет старые таймеры', async ({ page }) => {
  const { id, pane } = await setup(page, 2);
  const before = await snapshot(page, id);
  await gesture(page, pane, 'drag');
  // Дождаться первой коррекции, но начать второй жест до финальной записи.
  await page.waitForTimeout(350);
  await gesture(page, pane, 'drag');
  await page.waitForTimeout(2300);
  const after = await snapshot(page, id);
  expect(after.content.tasks[0]).toMatchObject({ start: '2026-10-16', end: '2026-10-22' });
  expect(after.content.tasks[1]).toEqual(before.content.tasks[1]);
  expect(after.revision).toBe(before.revision + 2);
  await pane.getByRole('searchbox', { name: 'Поиск задач' }).click();
  await page.waitForTimeout(2100);
  expect(await snapshot(page, id)).toEqual(after);
});


test('быстрые жесты по разным задачам сохраняют обе операции', async ({ page }) => {
  const { id, pane } = await setup(page, 2);
  const before = await snapshot(page, id);
  await gesture(page, pane, 'right');
  await page.waitForTimeout(350);
  await gesture(page, pane, 'left', false, 'other');
  await page.waitForTimeout(2300);
  const after = await snapshot(page, id);
  expect(after.content.tasks[0]).toMatchObject({ start: '2026-10-12', end: '2026-10-18' });
  expect(after.content.tasks[1]).toMatchObject({ start: '2026-10-21', end: '2026-10-23' });
  expect(after.revision).toBe(before.revision + 2);
});


test('скрытие вкладки сохраняет завершённый жест после отложенной сверки', async ({ page }) => {
  const { id, pane } = await setup(page, 2);
  const before = await snapshot(page, id);
  await gesture(page, pane, 'right');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await page.waitForTimeout(2300);
  const after = await snapshot(page, id);
  expect(after.content.tasks[0]).toMatchObject({ start: '2026-10-12', end: '2026-10-18' });
  expect(after.content.tasks[1]).toEqual(before.content.tasks[1]);
  expect(after.revision).toBe(before.revision + 1);
  await page.getByRole('tab', { name: /^Чек-листы/ }).click();
  await expect(pane.locator('.wx-row[data-id=":target"]')).toContainText('18.10');
  await page.waitForTimeout(2100);
  expect(await snapshot(page, id)).toEqual(after);
});
