import { expect, test, type Locator, type Page } from '@playwright/test';

const title = 'Навигация конфликтов';
function fixture(nested = false) {
  return {
    calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
    resources: [{ id: 'qa', title: 'QA' }, { id: 'other', title: 'Другой' }],
    workTypes: [{ id: 'parallel', title: 'Параллельные', allowsParallel: true }], dependencies: [],
    groups: nested ? [{ id: 'parent', title: 'Родитель' }, { id: 'child', title: 'Вложенная', parentId: 'parent' }] : [],
    tasks: [
      ...Array.from({ length: 60 }, (_, n) => ({
        id: `task-${n}`, title: `Обычная задача ${n}`, start: '2026-10-12', end: '2026-10-13', assigneeIds: ['other'], workTypeIds: ['parallel'],
      })),
      { id: 'target', title: 'Конфликтная задача', start: '2037-01-12', end: '2037-04-01', assigneeIds: ['qa'], ...(nested ? { groupId: 'child' } : {}) },
    ],
    unavailability: [{ id: 'absence', resourceId: 'qa', start: '2037-01-12', end: '2037-01-16' }],
  };
}
async function addView(page: Page, create = false) {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: 'План', exact: true }).click();
  if (create) {
    await catalog.getByLabel('Название нового документа').fill(title);
    await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  } else await catalog.getByRole('button', { name: title, exact: true }).click();
}
async function setup(page: Page, nested = false) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  while (await page.locator('.widget-window').count()) {
    await page.locator('.widget-window').first().getByRole('button', { name: /^Закрыть/ }).click();
  }
  await addView(page, true);
  const pane = page.getByRole('group', { name: `План · ${title}`, exact: true }).first();
  const id = (await pane.locator('[data-document-id]').getAttribute('data-document-id'))!;
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id, content: fixture(nested) });
  await expect(pane.locator('[data-issues]')).toContainText('(1)');
  return { pane, id };
}
async function expectTarget(pane: Locator) {
  await expect(pane.getByRole('dialog', { name: 'Проблемы плана' })).toHaveCount(0);
  const row = pane.locator('.wx-row[data-id=":target"]');
  const bar = pane.locator('.wx-bar[data-id=":target"]');
  await expect(row).toBeVisible();
  await expect(row.getByText('Конфликтная задача', { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(bar).toBeVisible();
  // Проверяем начало длинной полосы и строку внутри viewport, а не просто DOM.
  await expect.poll(() => pane.evaluate(root => {
    const chart = root.querySelector('.wx-chart')!.getBoundingClientRect();
    const grid = root.querySelector('.wx-table-container')!.getBoundingClientRect();
    const header = root.querySelector('.wx-header-wrapper')!.getBoundingClientRect();
    const headerHit = document.elementFromPoint(header.left + 30, header.top + header.height / 2)?.closest('.wx-header-wrapper');
    const row = root.querySelector('.wx-row[data-id=":target"]')?.getBoundingClientRect();
    const bar = root.querySelector('.wx-bar[data-id=":target"]')?.getBoundingClientRect();
    return !!headerHit && !!row && !!bar && bar.left >= chart.left && bar.left < chart.right - 8 &&
      bar.top >= chart.top && bar.bottom <= chart.bottom && row.top >= grid.top && row.bottom <= grid.bottom;
  })).toBe(true);
  await expect(row).toHaveClass(/wx-selected/);
}

for (const zoom of ['days', 'weeks']) {
  test(`переход закрывает модалку и показывает далёкую строку и начало полосы (${zoom})`, async ({ page }) => {
    const { pane, id } = await setup(page);
    await pane.getByRole('button', { name: /^Развернуть на весь дашборд/ }).click();
    await pane.locator(`[data-zoom-${zoom}]`).click();
    const before = await page.evaluate(id => window.__projectBoard!.readDocument(id), id);
    await pane.locator('[data-issues]').click();
    const action = pane.locator('[data-issue-show]');
    if (zoom === 'days') await action.locator('.catalog__title').click();
    else { await action.focus(); await page.keyboard.press('Enter'); }
    await expectTarget(pane);
    // Resize/zoom имеют ограниченное окно восстановления до 2 секунд.
    await page.waitForTimeout(2300);
    await expectTarget(pane);
    expect(await page.evaluate(id => window.__projectBoard!.readDocument(id), id)).toEqual(before);
  });
}

for (const key of ['Enter', 'Space']) {
  test(`переход ${key} раскрывает вложенные группы и снимает фильтры только своего окна`, async ({ page }) => {
    const { pane, id } = await setup(page, true);
    await addView(page);
    const second = page.getByRole('group', { name: `План · ${title}`, exact: true }).nth(1);
    await second.locator('[data-gantt-filter-query]').fill('Обычная');
    await second.locator('[data-gantt-filter-resource]').selectOption('other');
    const neighbour = await second.locator('.wx-chart').evaluate(chart => ({ left: chart.scrollLeft, top: chart.scrollTop }));
    await pane.locator('.wx-row[data-id=":parent"] .wx-toggle-icon').click();
    await expect(pane.locator('.wx-row[data-id=":target"]')).toHaveCount(0);
    await pane.locator('[data-gantt-filter-query]').fill('Обычная');
    await pane.locator('[data-gantt-filter-resource]').selectOption('other');
    const before = await page.evaluate(id => window.__projectBoard!.readDocument(id), id);
    await pane.locator('[data-issues]').click();
    await pane.locator('[data-issue-show]').focus();
    await page.keyboard.press(key);
    await expectTarget(pane);
    await expect(pane.locator('[data-gantt-filter-query]')).toHaveValue('');
    await expect(pane.locator('[data-gantt-filter-resource]')).toHaveValue('');
    await expect(second.locator('[data-gantt-filter-query]')).toHaveValue('Обычная');
    await expect(second.locator('[data-gantt-filter-resource]')).toHaveValue('other');
    expect(await second.locator('.wx-chart').evaluate(chart => ({ left: chart.scrollLeft, top: chart.scrollTop }))).toEqual(neighbour);
    expect(await page.evaluate(id => window.__projectBoard!.readDocument(id), id)).toEqual(before);
  });
}

test('переход снимает фильтр после собственной записи drag без отката сроков', async ({ page }) => {
  const { pane, id } = await setup(page);
  await pane.getByRole('button', { name: /^Развернуть на весь дашборд/ }).click();
  await pane.locator('[data-zoom-days]').click();
  await pane.locator('[data-gantt-filter-query]').fill('Обычная задача 0');
  const bar = pane.locator('.wx-bar[data-id=":task-0"]');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  const revision = await page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, id);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 96, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, id)).toBe(revision + 1);
  const afterDrag = await page.evaluate(id => window.__projectBoard!.readDocument(id), id);
  await pane.locator('[data-issues]').click();
  await pane.locator('[data-issue-show]').click();
  await expectTarget(pane);
  await expect(pane.locator('[data-gantt-filter-query]')).toHaveValue('');
  await page.waitForTimeout(2300);
  expect(await page.evaluate(id => window.__projectBoard!.readDocument(id), id)).toEqual(afterDrag);
});
