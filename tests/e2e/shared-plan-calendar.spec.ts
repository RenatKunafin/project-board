import { expect, test, type Locator, type Page } from '@playwright/test';

const title = 'Обновления общего плана';
const content = {
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  groups: [], dependencies: [], unavailability: [], workTypes: [],
  resources: [{ id: 'r-1', title: 'QA' }, { id: 'r-2', title: 'QA2' }],
  tasks: [{ id: 't-1', title: 'Исходная задача', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-1', 'r-2'] }],
};
async function addView(page: Page, type: string) {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: type, exact: true }).click();
  await catalog.getByRole('button', { name: title, exact: true }).click();
}
async function barGeometry(pane: Locator) {
  return pane.locator('[data-rt-task="t-1"]').first().evaluate(el => {
    const box = el.getBoundingClientRect();
    return { x: box.x, width: box.width };
  });
}

test('назначение и календарь обновляют ресурсные виды с сохранением независимых фильтров и масштаба', async ({ page }) => {
  await page.setViewportSize({ width: 2880, height: 1600 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  while (await page.locator('.widget-window').count()) {
    await page.locator('.widget-window').first().getByRole('button', { name: /^Закрыть/ }).click();
  }
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: 'План', exact: true }).click();
  await catalog.getByLabel('Название нового документа').fill(title);
  await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  const project = page.getByRole('group', { name: `План · ${title}`, exact: true });
  const id = (await project.locator('[data-document-id]').getAttribute('data-document-id'))!;
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id, content });
  await addView(page, 'Ресурсы');
  await addView(page, 'Ресурсы');
  const resources = page.getByRole('group', { name: `Ресурсы · ${title}`, exact: true });
  // Восстановление IDB не обязано сохранять порядок DOM-узлов окон.
  const ids = await resources.locator('.resource-timeline').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-widget-instance')));
  const first = resources.filter({ has: page.locator(`[data-widget-instance="${ids[0]}"]`) });
  const second = resources.filter({ has: page.locator(`[data-widget-instance="${ids[1]}"]`) });
  await second.locator('[data-rt-filter-resource]').selectOption('r-2');
  await second.locator('[data-rt-zoom-in]').click();
  await expect(first.locator('[data-rt-task="t-1"]')).toHaveCount(2);
  await expect(second.locator('[data-rt-task="t-1"]')).toHaveCount(1);
  const before = await Promise.all([barGeometry(first), barGeometry(second)]);
  const revision = await page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, id);

  await project.locator('[data-add-task]').click();
  const form = project.getByRole('dialog', { name: 'Новая задача' });
  await form.locator('[data-task-field="title"]').fill('Новая назначенная');
  await form.locator('[data-task-field="start"]').fill('2026-10-13');
  await form.locator('[data-task-field="duration"]').fill('2');
  await form.locator('[data-task-assignee="QA2"]').check();
  await form.locator('[data-task-save]').click();
  await expect(first.locator('[data-rt-task]')).toHaveCount(3);
  await expect(second.locator('[data-rt-task]')).toHaveCount(2);
  await expect(second.locator('[data-rt-task]').filter({ hasText: 'Новая назначенная' })).toBeVisible();
  expect(await page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, id)).toBe(revision + 1);
  const after = await Promise.all([barGeometry(first), barGeometry(second)]);
  for (let index = 0; index < 2; index++) {
    expect(Math.abs(after[index].x - before[index].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after[index].width - before[index].width)).toBeLessThanOrEqual(1);
  }

  await project.locator('[data-catalogs]').click();
  const settings = project.getByRole('dialog', { name: 'Настройки плана' });
  await settings.locator('[data-calendar-holiday-from]').fill('2026-10-14');
  await settings.locator('[data-calendar-add-holiday]').click();
  for (const pane of [first, second]) {
    await expect(pane.locator('.rt-day-col[data-day="2026-10-14"]')).toHaveClass(/rt-day--holiday/);
  }
  await settings.locator('[data-calendar-exception-from]').fill('2026-10-14');
  await settings.locator('[data-calendar-add-exception]').click();
  for (const pane of [first, second]) await expect(pane.locator('.rt-day-col[data-day="2026-10-14"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await page.getByRole('tab').filter({ hasText: 'Чек-листы' }).locator('.tab__title').click();
  await expect(second.locator('[data-rt-task]')).toHaveCount(2);
  await expect(second.locator('[data-rt-filter-resource]')).toHaveValue('r-2');
  await page.waitForTimeout(1200); // Дебаунсы документа, workspace и настроек перед reload.
  await page.reload();
  await expect(first.locator('[data-rt-task]')).toHaveCount(3);
  await expect(second.locator('[data-rt-task]')).toHaveCount(2);
  await expect(second.locator('[data-rt-filter-resource]')).toHaveValue('r-2');
  await expect(second.locator('.rt-day-col[data-day="2026-10-14"]')).toHaveCount(0);

  // Новый ресурс и сроки за прежними границами: область по умолчанию
  // расширяется, выбранный масштаб другого экземпляра сохраняется.
  const selectedRange = await second.locator('[data-rt-visible-range]').textContent();
  const defaultWidth = (await barGeometry(first)).width;
  await page.evaluate(id => {
    const doc = window.__projectBoard!.readDocument(id) as unknown as { content: typeof content };
    window.__projectBoard!.writeDocumentContent(id, {
      ...doc.content,
      resources: [...doc.content.resources, { id: 'r-3', title: 'Новый ресурс' }],
      tasks: doc.content.tasks.map(task => task.id === 't-1' ? task : {
        ...task, start: '2026-09-01', end: '2026-09-02', assigneeIds: ['r-3'],
      }),
    });
  }, id);
  await expect(first.locator('.resource-timeline__group-name').filter({ hasText: 'Новый ресурс' })).toBeVisible();
  await expect(first.locator('[data-rt-task]').filter({ hasText: 'Новая назначенная' })).toBeVisible();
  await expect(second.locator('[data-rt-task]')).toHaveCount(1);
  await expect.poll(async () => (await barGeometry(first)).width).toBeLessThan(defaultWidth);
  // После reload RGL/ResizeObserver ещё могут менять ширину окна;
  // выбранный диапазон дат сохраняется независимо от числа пикселей.
  await expect(second.locator('[data-rt-visible-range]')).toHaveText(selectedRange!);
  await project.locator('[data-catalogs]').click();
  await settings.locator('[data-calendar-holiday-from]').fill('2026-09-02');
  await settings.locator('[data-calendar-add-holiday]').click();
  await expect(first.locator('.rt-day-col[data-day="2026-09-02"]')).toHaveClass(/rt-day--holiday/);
});
