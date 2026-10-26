import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocumentWindow, openDocumentWindow } from './document-ui';
import { storedPlan } from '../planning/helpers';

const content = {
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    workingExceptions: [],
  },
  resources: [
    { id: 'r1', title: 'QA' },
    { id: 'r2', title: 'QA2' },
  ],
  workTypes: [
    { id: 'w1', title: 'Разработка', allowsParallel: false },
    { id: 'w2', title: 'ПСИ', allowsParallel: true },
  ],
  groups: [{ id: 'g', title: 'Группа' }],
  tasks: [
    {
      id: 't',
      title: 'Задача',
      start: '2026-10-12',
      end: '2026-10-16',
      groupId: 'g',
      assigneeIds: ['r1', 'r2'],
      workTypeIds: ['w1', 'w2'],
      notes: 'Примечание импорта',
    },
  ],
  dependencies: [],
  unavailability: [
    { id: 'u', resourceId: 'r1', start: '2026-10-20', end: '2026-10-21' },
  ],
};
const snapshot = (page: Page, id: string) =>
  page.evaluate((id) => window.__projectBoard!.readDocument(id), id);
async function setup(page: Page, title = 'Настройки') {
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', title);
  await page.evaluate(
    ({ id, content }) =>
      window.__projectBoard!.writeDocumentContent(id, content),
    { id: created.documentId, content },
  );
  await expect(created.pane.locator('[data-task-count]')).toHaveText(
    'Задач: 1',
  );
  return created;
}
async function settings(pane: Locator) {
  await pane.locator('[data-catalogs]').click();
  const dialog = pane.getByRole('dialog', {
    name: 'Настройки плана',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}
const section = (dialog: Locator, name: string) =>
  dialog.locator(`[data-settings-section="${name}"]`).click();

test('четыре раздела сохраняются одной редакцией в общем плане и обоих видах', async ({
  page,
}) => {
  const { pane, documentId } = await setup(page);
  const resources = (await openDocumentWindow(page, 'Ресурсы', 'Настройки'))
    .pane;
  const before = await snapshot(page, documentId);
  const dialog = await settings(pane);
  await dialog.locator('[data-resource-title="r1"]').fill('QA новое имя');
  await section(dialog, 'workTypes');
  await dialog.locator('[data-catalog-parallel="w1"]').check();
  await section(dialog, 'calendar');
  await dialog.locator('[data-calendar-holiday-from]').fill('2026-10-14');
  await dialog.locator('[data-calendar-add-holiday]').click();
  await section(dialog, 'absences');
  await dialog.locator('[data-absence-new="resource"]').selectOption('r2');
  await dialog.locator('[data-absence-new="start"]').fill('2026-10-15');
  await dialog.locator('[data-absence-new="end"]').fill('2026-10-16');
  await dialog.locator('[data-absence-add]').click();
  expect(await snapshot(page, documentId)).toEqual(before);
  await dialog.locator('[data-catalog-save]').click();
  await expect(dialog).toHaveCount(0);
  const saved = await snapshot(page, documentId);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.content.resources[0]).toEqual({
    id: 'r1',
    title: 'QA новое имя',
  });
  expect(saved.content.workTypes[0].allowsParallel).toBe(true);
  expect(saved.content.calendar.holidays).toEqual(['2026-10-14']);
  expect(saved.content.unavailability).toHaveLength(2);
  expect(saved.content.tasks).toEqual(content.tasks);
  await expect(
    resources
      .locator('.resource-timeline__group-name')
      .filter({ hasText: 'QA новое имя' }),
  ).toBeVisible();
  await expect(
    pane.locator('.wx-row').filter({ hasText: 'Задача' }).first(),
  ).toContainText('QA новое имя');
  await expect
    .poll(async () => (await storedPlan(page, documentId))?.revision)
    .toBe(saved.revision);
  await page.reload();
  const reopened = await settings(
    page.getByRole('group', { name: 'План · Настройки', exact: true }),
  );
  await expect(reopened.locator('[data-resource-title="r1"]')).toHaveValue(
    'QA новое имя',
  );
  await section(reopened, 'calendar');
  await expect(
    reopened.locator('[data-calendar-remove-holiday="2026-10-14"]'),
  ).toBeVisible();
});

test('ввод между разделами сохраняется; отказ от закрытия и отмена не пишут документ', async ({
  page,
}) => {
  const { pane, documentId } = await setup(page);
  const before = await snapshot(page, documentId);
  const dialog = await settings(pane);
  await dialog.locator('[data-resource-title="r1"]').fill('Черновое имя');
  await dialog
    .locator('[data-catalog-new="resource"]')
    .fill('Незавершённый исполнитель');
  await section(dialog, 'calendar');
  await dialog.locator('[data-calendar-holiday-from]').fill('2026-11-04');
  await section(dialog, 'resources');
  await expect(dialog.locator('[data-catalog-new="resource"]')).toHaveValue(
    'Незавершённый исполнитель',
  );
  page.once('dialog', (event) => void event.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveJSProperty('open', true);
  page.once('dialog', (event) => void event.dismiss());
  await dialog.locator('.plan-dialog__close').click();
  await expect(dialog).toHaveJSProperty('open', true);
  await section(dialog, 'calendar');
  await expect(dialog.locator('[data-calendar-holiday-from]')).toHaveValue(
    '2026-11-04',
  );
  page.once('dialog', (event) => void event.accept());
  await dialog.locator('[data-catalog-close]').click();
  await expect(dialog).toHaveCount(0);
  expect(await snapshot(page, documentId)).toEqual(before);
  const reopened = await settings(pane);
  await expect(reopened.locator('[data-resource-title="r1"]')).toHaveValue(
    'QA',
  );
  await expect(reopened.locator('[data-catalog-new="resource"]')).toHaveValue(
    '',
  );
});

test('ошибка скрытого раздела и незавершённое добавление не дают частичной записи', async ({
  page,
}) => {
  const { pane, documentId } = await setup(page);
  const before = await snapshot(page, documentId);
  const dialog = await settings(pane);
  await dialog.locator('[data-resource-title="r1"]').fill('QA исправлено');
  await section(dialog, 'workTypes');
  await dialog.locator('[data-work-type-title="w1"]').fill('   ');
  await section(dialog, 'calendar');
  await dialog.locator('[data-catalog-save]').click();
  await expect(
    dialog.locator('[data-settings-section="workTypes"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('[data-work-type-title="w1"]')).toBeFocused();
  await expect(dialog.getByRole('alert')).toContainText(
    'Название не может быть пустым',
  );
  expect(await snapshot(page, documentId)).toEqual(before);
  await dialog
    .locator('[data-work-type-title="w1"]')
    .fill('Разработка исправлено');
  await dialog
    .locator('[data-catalog-new="workType"]')
    .fill('Новый неподтверждённый');
  await section(dialog, 'resources');
  await dialog.locator('[data-catalog-save]').click();
  await expect(dialog.getByRole('alert')).toContainText('Завершите добавление');
  await expect(dialog.locator('[data-catalog-new="workType"]')).toBeFocused();
  expect(await snapshot(page, documentId)).toEqual(before);
  await dialog.locator('[data-catalog-new="workType"]').fill('');
  await dialog.locator('[data-catalog-save]').click();
  const saved = await snapshot(page, documentId);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.content.resources[0].id).toBe('r1');
  expect(saved.content.workTypes[0]).toMatchObject({
    id: 'w1',
    title: 'Разработка исправлено',
  });
});

test('внешняя редакция не перезаписывается; перечитывание требует явного отказа от черновика', async ({
  page,
}) => {
  const { pane, documentId } = await setup(page);
  await openDocumentWindow(page, 'План', 'Настройки');
  const dialog = await settings(pane);
  await dialog.locator('[data-resource-title="r1"]').fill('Локальный черновик');
  const external = {
    ...content,
    tasks: content.tasks.map((task) => ({
      ...task,
      title: 'Правка другого представления',
    })),
  };
  // Команда другого владельца не зависит от inert фона текущей модалки.
  await page.evaluate(
    ({ id, external }) =>
      window.__projectBoard!.writeDocumentContent(id, external),
    { id: documentId, external },
  );
  const changed = await snapshot(page, documentId);
  await expect(dialog.getByRole('alert')).toContainText(
    'План изменён в другом окне',
  );
  await expect(dialog.locator('[data-catalog-save]')).toBeDisabled();
  await expect(dialog.locator('[data-resource-title="r1"]')).toHaveValue(
    'Локальный черновик',
  );
  page.once('dialog', (event) => void event.dismiss());
  await dialog.locator('[data-settings-reload]').click();
  await expect(dialog.locator('[data-resource-title="r1"]')).toHaveValue(
    'Локальный черновик',
  );
  expect(await snapshot(page, documentId)).toEqual(changed);
  page.once('dialog', (event) => void event.accept());
  await dialog.locator('[data-settings-reload]').click();
  await expect(dialog.locator('[data-resource-title="r1"]')).toHaveValue('QA');
  await dialog
    .locator('[data-resource-title="r1"]')
    .fill('Новое имя после перечитывания');
  await dialog.locator('[data-catalog-save]').click();
  const saved = await snapshot(page, documentId);
  expect(saved.revision).toBe(changed.revision + 1);
  expect(saved.content.tasks[0].title).toBe('Правка другого представления');
});

test('удаление используемых записей сохраняет группу, поля задачи и остальные назначения', async ({
  page,
}) => {
  const { pane, documentId } = await setup(page);
  const before = await snapshot(page, documentId);
  const dialog = await settings(pane);
  page.once('dialog', async (event) => {
    expect(event.message()).toContain('периоды недоступности');
    await event.accept();
  });
  await dialog.getByRole('button', { name: 'Удалить QA', exact: true }).click();
  await section(dialog, 'workTypes');
  page.once('dialog', (event) => void event.accept());
  await dialog
    .getByRole('button', { name: 'Удалить Разработка', exact: true })
    .click();
  expect(await snapshot(page, documentId)).toEqual(before);
  await dialog.locator('[data-catalog-save]').click();
  const saved = await snapshot(page, documentId);
  expect(saved.content.tasks).toEqual([
    { ...content.tasks[0], assigneeIds: ['r2'], workTypeIds: ['w2'] },
  ]);
  expect(saved.content.unavailability).toEqual([]);
  expect(saved.revision).toBe(before.revision + 1);
});

for (const viewport of [
  { width: 1024, height: 778 },
  { width: 1856, height: 1269 },
  { width: 640, height: 778 },
]) {
  test(`каталоги50/30, навигация и неподвижные действия ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const { pane, documentId } = await setup(page);
    const large = {
      ...content,
      resources: Array.from({ length: 50 }, (_, i) => ({
        id: `r${i + 1}`,
        title: `Исполнитель ${i + 1}`,
      })),
      workTypes: Array.from({ length: 30 }, (_, i) => ({
        id: `w${i + 1}`,
        title: `Тип ${i + 1}`,
        allowsParallel: false,
      })),
    };
    await page.evaluate(
      ({ id, large }) => window.__projectBoard!.writeDocumentContent(id, large),
      { id: documentId, large },
    );
    const before = await snapshot(page, documentId);
    const scroll = () =>
      page
        .locator('.instances, .cascade-viewport, .wx-chart')
        .evaluateAll((nodes) =>
          nodes.map((el) => [el.scrollLeft, el.scrollTop]),
        );
    const scrollBefore = await scroll();
    const dialog = await settings(pane);
    const nav = dialog.getByRole('navigation', {
      name: 'Разделы настроек плана',
    });
    expect(await nav.evaluate((el) => getComputedStyle(el).flexDirection)).toBe(
      viewport.width < 720 ? 'row' : 'column',
    );
    const footer = await dialog.locator('footer').boundingBox();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(15);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 15);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await expect(
      dialog.locator('[data-settings-section="resources"]'),
    ).toContainText('50');
    await expect(
      dialog.locator('[data-settings-section="workTypes"]'),
    ).toContainText('30');
    const panel = dialog.locator('.plan-settings__panel:visible');
    const body = (await panel.boundingBox())!;
    await page.mouse.move(body.x + 3, body.y + 10);
    await page.mouse.wheel(0, 1600);
    await expect
      .poll(() => panel.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await dialog
      .locator('[data-catalog-add="resource"]')
      .scrollIntoViewIfNeeded();
    await expect(dialog.locator('[data-resource-title]').last()).toBeVisible();
    await expect(dialog.locator('[data-catalog-add="resource"]')).toBeVisible();
    await section(dialog, 'workTypes');
    await dialog
      .locator('[data-catalog-add="workType"]')
      .scrollIntoViewIfNeeded();
    await expect(dialog.locator('[data-work-type-title]').last()).toBeVisible();
    await expect(dialog.locator('[data-catalog-add="workType"]')).toBeVisible();
    expect(await dialog.locator('footer').boundingBox()).toEqual(footer);
    expect(await scroll()).toEqual(scrollBefore);
    await dialog.locator('[data-catalog-close]').click();
    expect(await snapshot(page, documentId)).toEqual(before);
  });
}

test('черновик и фокус переживают hidden; закрытие владельца освобождает фон', async ({
  page,
}) => {
  const { pane, documentId } = await setup(page);
  const before = await snapshot(page, documentId);
  await settings(pane);
  const dialog = pane.locator('dialog.plan-dialog');
  const field = dialog.locator('[data-resource-title="r1"]');
  await field.fill('Не терять при сворачивании');
  // Скрытие владельца из хоста, пока фон текущей модалки inert.
  await pane
    .locator('.widget-window__actions button')
    .first()
    .evaluate((el) => (el as HTMLButtonElement).click());
  await expect(dialog).toHaveJSProperty('open', false);
  await pane.locator('.widget-window__actions button').first().click();
  await expect(dialog).toHaveJSProperty('open', true);
  await expect(field).toHaveValue('Не терять при сворачивании');
  await expect(field).toBeFocused();
  await pane
    .locator('.widget-window__actions button')
    .last()
    .evaluate((el) => (el as HTMLButtonElement).click());
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(await snapshot(page, documentId)).toEqual(before);
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Каталог виджетов' }),
  ).toBeVisible();
});

test('удаление документа из хоста снимает модальность и не воскрешает черновик', async ({
  page,
}) => {
  const { pane, documentId } = await setup(page);
  const dialog = await settings(pane);
  await dialog
    .locator('[data-resource-title="r1"]')
    .fill('Не записать после удаления');
  // Настоящий обработчик каталога моделирует удаление другим владельцем.
  await page
    .getByRole('button', { name: 'Каталог документов', includeHidden: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  const documents = page.getByRole('dialog', {
    name: 'Каталог документов',
    includeHidden: true,
  });
  await documents
    .getByRole('button', { name: /Удалить «Настройки»/, includeHidden: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  await documents
    .getByRole('button', { name: 'Удалить', exact: true, includeHidden: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect.poll(() => snapshot(page, documentId)).toBeUndefined();
  await expect.poll(() => storedPlan(page, documentId)).toBeNull();
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Каталог виджетов' }),
  ).toBeVisible();
});
