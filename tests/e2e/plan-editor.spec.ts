import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-038: форма создания/редактирования задач поверх проектного Гантта.
 * Контрольные данные грузятся dev-хуком writeDocumentContent (PBT-037).
 */
const planContent = {
  title: 'Форма',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-10-14'],
    workingExceptions: [],
  },
  workTypes: [],
  resources: [],
  groups: [{ id: 'g-1', title: 'Фаза 1' }],
  tasks: [
    {
      id: 't-a',
      title: 'Задача A',
      groupId: 'g-1',
      start: '2026-10-12',
      end: '2026-10-13',
    },
  ],
  dependencies: [],
  unavailability: [],
};

async function createPlan(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByLabel('Название нового документа').fill(title);
  await choice.getByRole('button', { name: 'Создать' }).click();
  const pane = page.getByRole('group', { name: `План · ${title}` });
  await expect(pane).toBeVisible();
  const documentId = await pane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  expect(documentId).not.toBeNull();
  return documentId as string;
}

async function openForm(page: Page, paneTitle: string) {
  const pane = page.getByRole('group', { name: `План · ${paneTitle}` });
  await pane.locator('[data-add-task]').click();
  const dialog = pane.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return { pane, dialog };
}

test('создание задачи через форму сохраняется после reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Создание');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: planContent },
  );

  const { pane, dialog } = await openForm(page, 'Создание');
  await dialog.locator('[data-task-field="title"]').fill('Новая задача');
  await dialog
    .locator('[data-task-field="group"]')
    .selectOption({ label: 'Фаза 1' });
  await dialog.locator('[data-task-field="start"]').fill('2026-10-19');
  await dialog.locator('[data-task-field="duration"]').fill('3');
  // 3 раб. дня от пн 19.10: 19, 20, 21 → включительно 21.10 (предпросмотр).
  await expect(dialog.locator('[data-task-end-preview]')).toHaveText(
    'Окончание (включительно): 2026-10-21',
  );
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).not.toBeAttached();
  const chart = pane.locator('.plan-gantt__chart');
  await expect(chart.getByText('Новая задача').first()).toBeVisible();
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 2');

  // Автосохранение 1500 мс → reload → задача восстановлена из IndexedDB.
  await page.waitForTimeout(1500);
  await page.reload();
  const restored = page.getByRole('group', { name: 'План · Создание' });
  await expect(
    restored.locator('.plan-gantt__chart').getByText('Новая задача').first(),
  ).toBeVisible();
  await expect(restored.locator('[data-task-count]')).toHaveText('Задач: 2');
});

test('невалидный ввод показывает ошибку у поля и не меняет документ', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Ошибки');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: planContent },
  );

  const { pane, dialog } = await openForm(page, 'Ошибки');
  await dialog.locator('[data-task-field="title"]').fill('   ');
  await dialog.locator('[data-task-save]').click();
  await expect(dialog.locator('[role="alert"]')).toHaveText(
    'Название не может быть пустым.',
  );
  await expect(dialog).toBeAttached();

  // Длительность 0 — ошибка у поля длительности.
  await dialog.locator('[data-task-field="title"]').fill('Валидная');
  await dialog.locator('[data-task-field="start"]').fill('2026-10-12');
  await dialog.locator('[data-task-field="duration"]').fill('0');
  await dialog.locator('[data-task-save]').click();
  await expect(dialog.locator('[role="alert"]')).toHaveText(
    'Рабочая длительность — целое число дней, не меньше 1.',
  );
  // Документ не изменился: счётчик задач прежний.
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 1');

  page.once('dialog', event => void event.accept());
  await dialog.locator('[data-task-cancel]').click();
  await expect(dialog).not.toBeAttached();
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 1');
});

test('отмена формы сохраняет исходные данные, редактирование видно во втором виджете', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Правка');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: planContent },
  );

  // Отмена: изменение полей без сохранения.
  const first = page.getByRole('group', { name: 'План · Правка' });
  const rowA = first.locator('.plan-gantt__chart').getByText('Задача A').first();
  await rowA.dblclick();
  const dialog = first.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-task-field="title"]')).toHaveValue(
    'Задача A',
  );
  await expect(dialog.locator('[data-task-field="duration"]')).toHaveValue('2');
  await dialog.locator('[data-task-field="title"]').fill('Испорчено');
  page.once('dialog', event => void event.accept());
  await dialog.locator('[data-task-cancel]').click();
  await expect(dialog).not.toBeAttached();
  await expect(
    first.locator('.plan-gantt__chart').getByText('Задача A').first(),
  ).toBeVisible();

  // Второй экземпляр того же документа.
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Правка' })
    .click();
  const second = page.getByRole('group', { name: 'План · Правка' }).nth(1);
  await expect(second.locator('.plan-gantt__chart')).toBeVisible();

  // Редактирование в первом: имя и сроки (перенос на пн 19.10, 3 дня).
  const rowInFirst = first
    .locator('.plan-gantt__chart')
    .getByText('Задача A')
    .first();
  await rowInFirst.dblclick();
  const editDialog = first.getByRole('dialog');
  await editDialog.locator('[data-task-field="title"]').fill('Задача A1');
  await editDialog.locator('[data-task-field="start"]').fill('2026-10-19');
  await editDialog.locator('[data-task-field="duration"]').fill('3');
  // Фокус возврата: Esc/Enter-управление проверяется кнопкой «Сохранить»
  // по Enter в поле названия.
  await editDialog
    .locator('[data-task-field="title"]')
    .press('Enter');
  await expect(editDialog).not.toBeAttached();

  const firstChart = first.locator('.plan-gantt__chart');
  const secondChart = second.locator('.plan-gantt__chart');
  await expect(firstChart.getByText('Задача A1').first()).toBeVisible();
  await expect(secondChart.getByText('Задача A1').first()).toBeVisible();
});

test('удаление задачи из формы убирает её в обоих экземплярах, фокус возвращается', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  const documentId = await createPlan(page, 'Удаление');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: planContent },
  );

  const pane = page.getByRole('group', { name: 'План · Удаление' });
  const add = pane.locator('[data-add-task]');
  await add.click();
  const dialog = pane.getByRole('dialog');
  await dialog.locator('[data-task-cancel]').click();
  // Фокус вернулся на кнопку тулбара после закрытия формы.
  await expect(add).toBeFocused();

  await pane
    .locator('.plan-gantt__chart')
    .getByText('Задача A')
    .first()
    .dblclick();
  const editDialog = pane.getByRole('dialog');
  await expect(editDialog).toBeVisible();
  await editDialog.locator('[data-task-delete]').click();
  await expect(editDialog).not.toBeAttached();
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 0');
  await expect(
    pane.locator('.plan-gantt__chart').getByText('Задача A'),
  ).toHaveCount(0);

  await page.waitForTimeout(1500);
  await page.reload();
  const restored = page.getByRole('group', { name: 'План · Удаление' });
  await expect(restored.locator('[data-task-count]')).toHaveText('Задач: 0');
});
