import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocumentWindow, openDocumentWindow } from './document-ui';
import { storedPlan } from '../planning/helpers';

/**
 * PBT-084: ручной цвет задачи как данные плана — выбор/сброс в форме,
 * быстрая смена правым кликом в обоих видах, конфликт и публикация.
 */

const read = (page: Page, id: string) => page.evaluate(id => window.__projectBoard!.readDocument(id), id);

const content = {
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: ['2026-10-14'], workingExceptions: [] },
  resources: [{ id: 'r0', title: 'QA' }, { id: 'r1', title: 'Dev' }],
  workTypes: [{ id: 'w0', title: 'Разработка', allowsParallel: false }],
  groups: [],
  tasks: [
    { id: 'a', title: 'Задача A', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r0'], workTypeIds: ['w0'] },
    { id: 'b', title: 'Задача B', start: '2026-10-19', end: '2026-10-23', assigneeIds: ['r1'], workTypeIds: ['w0'] },
  ],
  dependencies: [],
  unavailability: [],
};

/** План с конфликтом параллельности: две задачи одного ресурса и типа. */
const conflictingContent = {
  ...content,
  tasks: [
    { id: 'a', title: 'Задача A', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r0'], workTypeIds: ['w0'], color: 'coral' },
    { id: 'b', title: 'Задача B', start: '2026-10-14', end: '2026-10-16', assigneeIds: ['r0'], workTypeIds: ['w0'], color: 'coral' },
  ],
};

async function barBackground(page: Page, scope: Locator, selector: string): Promise<string> {
  return scope.locator(selector).first().evaluate(node => getComputedStyle(node).backgroundColor);
}

test('выбор цвета в форме красит оба вида и переживает reload; сброс возвращает «Авто»', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', 'Цвета задач');
  const { pane, documentId } = created;
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content });
  const resources = (await openDocumentWindow(page, 'Ресурсы', 'Цвета задач')).pane;
  const before = await read(page, documentId);

  await pane.locator('[data-add-task]').click();
  const dialog = pane.getByRole('dialog', { name: 'Новая задача', exact: true });
  await dialog.locator('[data-task-field="title"]').fill('Цветная задача');
  await dialog.locator('[data-task-field="start"]').fill('2026-10-26');
  await dialog.locator('[data-task-field="duration"]').fill('2');
  await dialog.locator('[data-task-field="group"]').selectOption('Без группы');
  // Назначение: без исполнителя задача не отображается в ресурсном виде (D2).
  await dialog.getByLabel('Поиск: исполнители', { exact: true }).fill('Dev');
  await dialog.locator('[data-task-assignee="Dev"]').check();
  await dialog.getByRole('button', { name: 'Сапфир', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Сапфир', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).toHaveCount(0);

  // Данные документа: цвет у новой задачи, остальные без цвета; одна новая редакция.
  const after = await read(page, documentId);
  const colored = after.content.tasks.find((task: { title: string }) => task.title === 'Цветная задача');
  expect(colored.color).toBe('sapphire');
  expect(after.content.tasks.filter((task: { color?: string }) => task.color !== undefined)).toHaveLength(1);
  expect(after.revision).toBe(before.revision + 1);

  // Оба вида перекрасили полосу: вычисленный фон цветной полосы отличается от стандартной.
  // SVAR выводит data-task-id с префиксом «:» (контракт 2.8.0).
  const plainBar = await barBackground(page, pane, '[data-task-id=":b"]');
  const ganttColored = await pane.locator('[data-task-id]').filter({ hasText: 'Цветная задача' }).first().evaluate(node => getComputedStyle(node).backgroundColor);
  expect(ganttColored).not.toBe(plainBar);
  const rtPlain = await barBackground(page, resources, '[data-rt-task="b"]');
  const rtColored = await resources.locator('[data-rt-task]').filter({ hasText: 'Цветная задача' }).first().evaluate(node => getComputedStyle(node).backgroundColor);
  expect(rtColored).not.toBe(rtPlain);

  // Reload: сначала дождаться персиста в IDB (штатный паттерн), затем проверить.
  await expect.poll(async () => (await storedPlan(page, documentId))?.content).toEqual(after.content);
  await page.reload();
  const restored = await read(page, documentId);
  expect(restored.content.tasks.find((task: { title: string }) => task.title === 'Цветная задача').color).toBe('sapphire');

  // Сброс в «Авто»: поле исчезает из документа, полоса возвращается к стандартной.
  const paneAfterReload = pane;
  await paneAfterReload.locator('.plan-gantt__chart').getByText('Цветная задача', { exact: true }).first().dblclick();
  const editDialog = paneAfterReload.getByRole('dialog', { name: 'Редактирование задачи', exact: true });
  await editDialog.getByRole('button', { name: 'Авто', exact: true }).click();
  await editDialog.locator('[data-task-save]').click();
  await expect(editDialog).toHaveCount(0);
  const reset = await read(page, documentId);
  expect(reset.content.tasks.find((task: { title: string }) => task.title === 'Цветная задача').color).toBeUndefined();
  // Консоль живого прогона без ошибок (замена MCP-осмотру в этой сессии).
  expect(consoleErrors).toEqual([]);
});

test('быстрая смена правым кликом в обоих видах; меню в границах экрана, Escape закрывает', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 778 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', 'Цвета задач');
  const { pane, documentId } = created;
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content });
  const resources = (await openDocumentWindow(page, 'Ресурсы', 'Цвета задач')).pane;

  // Проектный вид: правый клик по правому краю полосы открывает меню.
  const startRevision = (await read(page, documentId)).revision;
  const bar = pane.locator('[data-task-id=":b"]');
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  await bar.click({ button: 'right', position: { x: barBox!.width - 4, y: barBox!.height / 2 } });
  const menu = page.getByRole('dialog', { name: 'Быстрая смена цвета' });
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1024);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect((await read(page, documentId)).revision).toBe(startRevision);

  // Выбор цвета меняет задачу в обоих видах одной операцией.
  await bar.click({ button: 'right', position: { x: barBox!.width - 4, y: barBox!.height / 2 } });
  await menu.getByRole('button', { name: 'Нефрит', exact: true }).click();
  await expect(menu).toHaveCount(0);
  const afterGantt = await read(page, documentId);
  expect(afterGantt.content.tasks.find((task: { id: string }) => task.id === 'b').color).toBe('jade');
  expect(afterGantt.revision).toBe(startRevision + 1);

  // Ресурсный вид: правый клик по элементу дорожки той же задачи.
  const rtItem = resources.locator('[data-rt-task="b"]');
  await expect(rtItem).toBeVisible();
  await rtItem.click({ button: 'right', position: { x: 10, y: 5 } });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Сталь', exact: true }).click();
  const afterRt = await read(page, documentId);
  expect(afterRt.content.tasks.find((task: { id: string }) => task.id === 'b').color).toBe('steel');
  expect(afterRt.revision).toBe(startRevision + 2);

  // Правый клик по пустому месту меню не открывает.
  await page.mouse.click(60, 60, { button: 'right' });
  await expect(menu).toHaveCount(0);
});

test('конфликт в ресурсном виде перекрывает ручной цвет задачи', async ({ page }) => {
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'Ресурсы', 'Цвета задач');
  const { pane, documentId } = created;
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: conflictingContent });

  const conflictItems = pane.locator('.rtl-item--conflict');
  await expect(conflictItems.first()).toBeVisible();
  await expect(conflictItems).toHaveCount(2);
  // Конфликтная полоса — подсветка конфликта, а не ручной цвет.
  const conflictBg = await conflictItems.first().evaluate(node => getComputedStyle(node).backgroundColor);
  const manualStyle = 'color-mix(in oklch, #F05653 45%, var(--surface))';
  expect(conflictBg).not.toContain(manualStyle);
});

test('экспорт PlantUML публикует ручной цвет hex-значением палитры', async ({ page }) => {
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', 'Цвета задач');
  const { pane, documentId } = created;
  const withColor = {
    ...content,
    tasks: content.tasks.map((task, index) => (index === 0 ? { ...task, color: 'sapphire' } : task)),
  };
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: withColor });

  await pane.getByRole('button', { name: 'Экспорт PlantUML' }).click();
  const dialog = page.getByRole('dialog', { name: 'Экспорт PlantUML' });
  const text = await dialog.locator('[data-plantuml-text]').textContent();
  expect(text).toContain('[T1] is colored in #3186e9/#3186e9');
  // Задача без ручного цвета — без явного цвета (эвристика этапов удалена).
  expect(text).not.toContain('[T2] is colored in');
});

test('импорт OnlineGantt переносит цвет при совпадении с палитрой, вне палитры — «Авто»', async ({ page }) => {
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', 'Импорт цвета');
  const { pane } = created;
  const ganttFile = JSON.stringify({
    data: [
      { TaskID: 1, TaskName: 'Совпавшая', StartDate: '2026-10-12T05:00:00.000Z', EndDate: '2026-10-14T14:00:00.000Z', Duration: 3, Progress: 0, color: '#3186E9', Predecessor: '', resources: [], DurationUnit: 'day' },
      { TaskID: 2, TaskName: 'Вне палитры', StartDate: '2026-10-15T05:00:00.000Z', EndDate: '2026-10-16T14:00:00.000Z', Duration: 2, Progress: 0, color: '#123456', Predecessor: '', resources: [], DurationUnit: 'day' },
    ],
    resources: [],
    advanced: {},
  });
  await pane.getByRole('button', { name: 'Импорт плана' }).click();
  await pane.locator('[data-import-plan-input]').setInputFiles({
    name: 'colors.gantt',
    mimeType: 'application/json',
    buffer: Buffer.from(ganttFile, 'utf8'),
  });
  const preview = page.getByRole('dialog', { name: 'Импорт плана из OnlineGantt' });
  await expect(preview).toBeVisible();
  await preview.locator('[data-onlinegantt-apply]').click();
  await expect(page.locator('[data-import-plan-result]')).toContainText('импортирован');

  // Импорт создаёт независимый план — проверка в новом окне.
  const importedPane = page.getByRole('group', { name: 'План · colors' });
  await expect(importedPane).toBeVisible();
  const importedDocId = await importedPane.locator('[data-document-id]').getAttribute('data-document-id');
  const after = await read(page, importedDocId!);
  const matched = after.content.tasks.find((task: { title: string }) => task.title === 'Совпавшая');
  const unmatched = after.content.tasks.find((task: { title: string }) => task.title === 'Вне палитры');
  expect(matched.color).toBe('sapphire');
  expect(unmatched.color).toBeUndefined();

  // Живое отображение: полоса совпавшей задачи окрашена, остальная — стандартная.
  const plainBar = await importedPane.locator('[data-task-id]').filter({ hasText: 'Вне палитры' }).first().evaluate(node => getComputedStyle(node).backgroundColor);
  const coloredBar = await importedPane.locator('[data-task-id]').filter({ hasText: 'Совпавшая' }).first().evaluate(node => getComputedStyle(node).backgroundColor);
  expect(coloredBar).not.toBe(plainBar);

  // Скриншоты для отчёта (прототип: два размера), артефакты вне openspec.
  await page.screenshot({ path: 'test-results/task-colors/colors-1856.png', fullPage: false });
  await page.setViewportSize({ width: 1024, height: 778 });
  await page.screenshot({ path: 'test-results/task-colors/colors-1024.png', fullPage: false });
});
