import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocumentWindow, openDocumentWindow } from './document-ui';
import { storedPlan } from '../planning/helpers';

const content = {
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: ['2026-10-14'], workingExceptions: [] },
  resources: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, title: `Исполнитель ${i + 1}` })),
  workTypes: Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, title: `Работа ${i + 1}`, allowsParallel: false })),
  groups: [{ id: 'g', title: 'Группа' }],
  tasks: [
    { id: 'a', title: 'Задача A', start: '2026-10-12', end: '2026-10-17', assigneeIds: ['r0'], workTypeIds: ['w0'], notes: 'Импорт' },
    { id: 'b', title: 'Задача B', start: '2026-10-17', end: '2026-10-18', assigneeIds: ['r0'], groupId: 'g' },
    ...Array.from({ length: 40 }, (_, i) => ({ id: `extra${i}`, title: `Предшественник ${i + 1}`, start: '2026-10-19', end: '2026-10-20' })),
  ],
  dependencies: [{ id: 'ab', fromTaskId: 'a', toTaskId: 'b', lagDays: 0 }], unavailability: [],
};
const read = (page: Page, id: string) => page.evaluate(id => window.__projectBoard!.readDocument(id), id);
async function setup(page: Page) {
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', 'Черновик задачи');
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: created.documentId, content });
  return created;
}
async function edit(pane: Locator, name = 'Задача B') {
  await pane.locator('.plan-gantt__chart').getByText(name, { exact: true }).first().dblclick();
  return pane.getByRole('dialog', { name: 'Редактирование задачи', exact: true });
}
async function addPredecessor(dialog: Locator, title: string, lag = '2') {
  await dialog.getByLabel('Поиск предшественников', { exact: true }).fill(title);
  await dialog.locator('[data-dep-new-from]').selectOption({ label: title });
  await dialog.locator('[data-dep-new-lag]').fill(lag);
  await dialog.locator('[data-dep-add]').click();
}

test('создание со связями, поиском и несколькими назначениями — одна редакция и reload', async ({ page }) => {
  const { pane, documentId } = await setup(page);
  const resources = (await openDocumentWindow(page, 'Ресурсы', 'Черновик задачи')).pane;
  const before = await read(page, documentId);
  await pane.locator('[data-add-task]').click();
  const dialog = pane.getByRole('dialog', { name: 'Новая задача', exact: true });
  await dialog.locator('[data-task-field="title"]').fill('Новая общая задача');
  await dialog.locator('[data-task-field="start"]').fill('2026-10-12');
  await dialog.locator('[data-task-field="duration"]').fill('3');
  await dialog.getByLabel('Поиск: исполнители', { exact: true }).fill('Исполнитель 50');
  await dialog.locator('[data-task-assignee="Исполнитель 50"]').check();
  await dialog.getByLabel('Поиск: исполнители', { exact: true }).fill('Исполнитель 1');
  await dialog.locator('[data-task-assignee="Исполнитель 1"]').check();
  await expect(dialog.getByRole('button', { name: 'Снять выбор: Исполнитель 50', exact: true })).toBeVisible();
  await dialog.getByLabel('Поиск: типы работы', { exact: true }).fill('Работа 30');
  await dialog.locator('[data-task-worktype="Работа 30"]').check();
  await dialog.getByLabel('Поиск: типы работы', { exact: true }).fill('ничего');
  await expect(dialog.getByRole('button', { name: 'Снять выбор: Работа 30', exact: true })).toBeVisible();
  await addPredecessor(dialog, 'Предшественник 40');
  await dialog.getByLabel('Поиск предшественников', { exact: true }).fill('Задача A');
  await expect(dialog.locator('[data-dep-list]')).toContainText('Предшественник 40');
  expect(await read(page, documentId)).toEqual(before);
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).toHaveCount(0);
  const after = await read(page, documentId);
  expect(after.revision).toBe(before.revision + 1);
  const created = after.content.tasks.find((task: { title: string }) => task.title === 'Новая общая задача');
  expect(created).toMatchObject({ start: '2026-10-12', end: '2026-10-15', assigneeIds: ['r49', 'r0'], workTypeIds: ['w29'] });
  expect(after.content.dependencies).toContainEqual({ id: expect.any(String), fromTaskId: 'extra39', toTaskId: created.id, lagDays: 2 });
  await expect(resources.locator(`[data-rt-task="${created.id}"]`)).toHaveCount(2);
  await expect.poll(async () => (await storedPlan(page, documentId))?.content).toEqual(after.content);
  await page.reload();
  await expect.poll(() => read(page, documentId)).toEqual(after);
});

test('отмена всех полей и связей; guard крестика/Escape и hidden сохраняют ввод', async ({ page }) => {
  const { pane, documentId } = await setup(page);
  const before = await read(page, documentId);
  const dialog = await edit(pane);
  await dialog.locator('[data-task-field="title"]').fill('Не сохранять');
  await dialog.getByRole('button', { name: 'Удалить связь от Задача A' }).click();
  await addPredecessor(dialog, 'Предшественник 40');
  page.once('dialog', event => void event.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveJSProperty('open', true);
  page.once('dialog', event => void event.dismiss());
  await dialog.locator('.plan-dialog__close').click();
  await expect(dialog.locator('[data-task-field="title"]')).toHaveValue('Не сохранять');
  await pane.locator('.widget-window__actions button').first().evaluate(el => (el as HTMLButtonElement).click());
  await expect(pane.locator('dialog')).toHaveJSProperty('open', false);
  await pane.locator('.widget-window__actions button').first().click();
  await expect(dialog.locator('[data-dep-list]')).toContainText('Предшественник 40');
  page.once('dialog', event => void event.accept());
  await dialog.locator('[data-task-cancel]').click();
  expect(await read(page, documentId)).toEqual(before);
});

test('ошибки и незавершённая связь не пишут; ручные сроки и no-op сохраняются', async ({ page }) => {
  const { pane, documentId } = await setup(page);
  const before = await read(page, documentId);
  const dialog = await edit(pane);
  await expect(dialog.locator('[data-task-field="duration"]')).toHaveValue('0');
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).toHaveCount(0);
  expect(await read(page, documentId)).toEqual(before);
  const again = await edit(pane);
  await again.locator('[data-task-field="title"]').fill('');
  await again.locator('[data-task-save]').click();
  await expect(again.locator('[data-task-field="title"]')).toBeFocused();
  await again.locator('[data-task-field="title"]').fill('B переименована');
  await again.locator('[data-task-field="duration"]').fill('1.5');
  await again.locator('[data-task-save]').click();
  await expect(again.locator('[data-task-field="duration"]')).toBeFocused();
  await again.locator('[data-task-field="duration"]').fill('0');
  await again.locator('[data-dep-new-from]').selectOption('extra39');
  await again.locator('[data-task-save]').click();
  await expect(again.locator('[data-dep-error]')).toContainText('Завершите');
  await expect(again.locator('[data-dep-new-from]')).toBeFocused();
  expect(await read(page, documentId)).toEqual(before);
  await again.getByRole('button', { name: 'Очистить ввод', exact: true }).click();
  await again.locator('[data-task-save]').click();
  const saved = await read(page, documentId);
  expect(saved.content.tasks[1]).toEqual({ ...content.tasks[1], title: 'B переименована' });
  expect(saved.revision).toBe(before.revision + 1);
});

test('редактирование из ресурсов сохраняет поля и лаг одной операцией и ручное окончание', async ({ page }) => {
  const { pane, documentId } = await setup(page);
  const resources = (await openDocumentWindow(page, 'Ресурсы', 'Черновик задачи')).pane;
  const before = await read(page, documentId);
  await resources.locator('[data-rt-task="a"]').first().dblclick();
  const dialog = resources.getByRole('dialog', { name: 'Редактирование задачи', exact: true });
  await dialog.locator('[data-task-field="title"]').fill('A из ресурсов');
  await dialog.locator('[data-task-assignee="Исполнитель 2"]').check();
  await addPredecessor(dialog, 'Предшественник 40');
  expect(await read(page, documentId)).toEqual(before);
  await dialog.locator('[data-task-save]').click();
  const saved = await read(page, documentId);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.content.tasks[0]).toEqual({ ...content.tasks[0], title: 'A из ресурсов', assigneeIds: ['r0', 'r1'] });
  await expect(pane.locator('.plan-gantt__chart').getByText('A из ресурсов', { exact: true }).first()).toBeVisible();
  await expect(resources.locator('[data-rt-task="a"]')).toHaveCount(2);
});

test('чужая revision сохраняет черновик, явное перечитывание; удаление задачи не создаёт копию', async ({ page }) => {
  const { pane, documentId } = await setup(page);
  const dialog = await edit(pane);
  await dialog.locator('[data-task-field="title"]').fill('Мой ввод');
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, { ...content, title: 'Внешний план' }), { id: documentId, content });
  await expect(dialog.locator('[data-task-save]')).toBeDisabled();
  await expect(dialog.locator('[data-task-delete]')).toBeDisabled();
  await expect(dialog.locator('[data-task-field="title"]')).toHaveValue('Мой ввод');
  page.once('dialog', event => void event.dismiss());
  await dialog.getByRole('button', { name: 'Перечитать план' }).click();
  await expect(dialog.locator('[data-task-field="title"]')).toHaveValue('Мой ввод');
  page.once('dialog', event => void event.accept());
  await dialog.getByRole('button', { name: 'Перечитать план' }).click();
  await expect(dialog.locator('[data-task-field="title"]')).toHaveValue('Задача B');
  await expect(dialog.locator('[data-task-save]')).toBeEnabled();
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, { ...content, tasks: content.tasks.filter(task => task.id !== 'b'), dependencies: [] }), { id: documentId, content });
  await expect(dialog.getByRole('alert')).toContainText('Исходная задача удалена');
  await expect(dialog.locator('[data-task-save]')).toBeDisabled();
  await dialog.locator('[data-task-cancel]').click();
  expect((await read(page, documentId)).content.tasks.some((task: { id: string }) => task.id === 'b')).toBe(false);
});

for (const width of [390, 1024, 1856]) {
  test(`геометрия и клавиатура формы при ширине ${width}`, async ({ page }) => {
    const { pane, documentId } = await setup(page);
    await pane.locator('[data-add-task]').click();
    const dialog = pane.getByRole('dialog', { name: 'Новая задача', exact: true });
    await page.setViewportSize({ width, height: width === 1856 ? 1269 : 778 });
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(15);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 15);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog.locator('[data-task-save]').click();
    await expect(dialog.locator('[data-task-field="title"]')).toBeFocused();
    await dialog.getByLabel('Поиск: исполнители', { exact: true }).fill('Исполнитель 50');
    await dialog.getByLabel('Поиск: исполнители', { exact: true }).press('Enter');
    await expect(dialog.locator('[data-task-assignee="Исполнитель 50"]')).toBeVisible();
    await dialog.locator('[data-task-cancel]').click();
    await expect(pane.locator('[data-add-task]')).toBeFocused();
    expect((await read(page, documentId)).content).toEqual(content);
  });
}

test('удаление и преобразование объясняют отказ от черновика, ошибка не закрывает диалоги', async ({ page }) => {
  const { pane, documentId } = await setup(page);
  const before = await read(page, documentId);
  const editor = await edit(pane);
  await editor.locator('[data-task-field="title"]').fill('Черновик');
  page.once('dialog', event => { expect(event.message()).toContain('Несохранённые'); void event.dismiss(); });
  await editor.locator('[data-task-delete]').click();
  expect(await read(page, documentId)).toEqual(before);
  page.once('dialog', event => void event.dismiss());
  await editor.locator('[data-task-to-absence]').click();
  await expect(editor.locator('[data-task-field="title"]')).toHaveValue('Черновик');
  page.once('dialog', event => void event.accept());
  await editor.locator('[data-task-to-absence]').click();
  const convert = pane.getByRole('dialog', { name: 'Преобразование в отпуск', exact: true });
  await expect(convert.locator('[data-absence-resource]')).toHaveValue('');
  await expect(convert.locator('[data-absence-start]')).toHaveValue('2026-10-17');
  await convert.locator('[data-absence-cancel]').click();
  await expect(editor.locator('[data-task-field="title"]')).toHaveValue('Задача B');
  expect(await read(page, documentId)).toEqual(before);
  await editor.locator('[data-task-to-absence]').click();
  await convert.locator('[data-absence-resource]').selectOption('r0');
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, { ...content, title: 'Чужое изменение' }), { id: documentId, content });
  const newer = await read(page, documentId);
  await convert.locator('[data-absence-apply]').click();
  await expect(convert.getByRole('alert')).toContainText('План изменён');
  await expect(convert).toBeVisible();
  expect(await read(page, documentId)).toEqual(newer);
  await convert.locator('[data-absence-cancel]').click();
  await editor.getByRole('button', { name: 'Перечитать план' }).click();
  await editor.locator('[data-task-to-absence]').click();
  await convert.locator('[data-absence-resource]').selectOption('r0');
  await convert.locator('[data-absence-apply]').click();
  await expect(pane.locator('dialog')).toHaveCount(0);
  const after = await read(page, documentId);
  expect(after.revision).toBe(newer.revision + 1);
  expect(after.content.tasks.some((task: { id: string }) => task.id === 'b')).toBe(false);
  expect(after.content.dependencies).toEqual([]);
  expect(after.content.unavailability).toEqual([{ id: expect.any(String), resourceId: 'r0', start: '2026-10-17', end: '2026-10-18' }]);
});

test('удаление документа освобождает форму без записи старого снимка', async ({ page }) => {
  const { pane, documentId } = await setup(page);
  const dialog = await edit(pane);
  await dialog.locator('[data-task-field="title"]').fill('Не восстанавливать');
  await page.getByRole('button', { name: 'Каталог документов', includeHidden: true }).evaluate(el => (el as HTMLButtonElement).click());
  const documents = page.getByRole('dialog', { name: 'Каталог документов', includeHidden: true });
  await documents.getByRole('button', { name: /Удалить «Черновик задачи»/, includeHidden: true }).evaluate(el => (el as HTMLButtonElement).click());
  await documents.getByRole('button', { name: 'Удалить', exact: true, includeHidden: true }).evaluate(el => (el as HTMLButtonElement).click());
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect.poll(() => read(page, documentId)).toBeUndefined();
  await expect.poll(() => storedPlan(page, documentId)).toBeNull();
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Каталог виджетов' })).toBeVisible();
});
