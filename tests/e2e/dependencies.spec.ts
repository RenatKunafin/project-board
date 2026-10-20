import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-045: редактор FS-зависимостей в форме задачи.
 * Два предшественника с лагами, цикл отклоняется, даты не меняются,
 * стрелка/reload.
 */
const planContent = {
  title: 'Зависимости',
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: ['2026-10-14'], workingExceptions: [] },
  workTypes: [], resources: [], groups: [],
  tasks: [
    { id: 't-a', title: 'Задача A', start: '2026-10-12', end: '2026-10-13' },
    { id: 't-b', title: 'Задача B', start: '2026-10-15', end: '2026-10-16' },
    { id: 't-c', title: 'Задача C', start: '2026-10-19', end: '2026-10-20' },
  ],
  dependencies: [
    { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 },
    { id: 'd-2', fromTaskId: 't-b', toTaskId: 't-c', lagDays: 0 },
  ],
  unavailability: [],
};

async function createPlan(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
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

async function openForm(page: Page, paneTitle: string, taskTitle: string) {
  const pane = page.getByRole('group', { name: `План · ${paneTitle}` });
  await pane
    .locator('.plan-gantt__chart')
    .getByText(taskTitle)
    .first()
    .dblclick();
  const dialog = pane.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('два предшественника с лагами, изменение лага, даты не меняются', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Зависимости');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  // Задача B уже имеет предшественника A (лаг 0). Добавляем C предшественника A:
  // добавляем C предшественника A (два предшественника у C: B и A).
  const dialogC = await openForm(page, 'Зависимости', 'Задача C');
  await dialogC.locator('[data-dep-new-from]').selectOption({ label: 'Задача A' });
  await dialogC.locator('[data-dep-new-lag]').fill('2');
  await dialogC.locator('[data-dep-add]').click();
  await expect(dialogC.locator('[data-dep-list]')).toContainText('Задача A');
  await expect(dialogC.locator('[data-dep-list]')).toContainText('лаг 2');

  // Изменение лага предшественника A: 2 → 4 (сохранение лага; даты задач
  // не меняются — C5).
  const rowA = dialogC.locator('li', { hasText: 'Задача A · лаг 2' });
  await rowA.getByRole('button', { name: 'Изменить лаг' }).click();
  await dialogC.locator('[data-dep-lag-input]').press('Enter');
  await expect(dialogC.locator('[data-dep-list]')).toContainText('лаг 4');

  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.dependencies,
    documentId,
  );
  expect(content).toEqual([
    { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 },
    { id: 'd-2', fromTaskId: 't-b', toTaskId: 't-c', lagDays: 0 },
    { id: expect.any(String), fromTaskId: 't-a', toTaskId: 't-c', lagDays: 4 },
  ]);

  // Даты всех задач не изменились (C5/DoD-4).
  const tasks = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.tasks,
    documentId,
  );
  expect(tasks.map((t: { start: string; end: string }) => `${t.start}..${t.end}`)).toEqual([
    '2026-10-12..2026-10-13',
    '2026-10-15..2026-10-16',
    '2026-10-19..2026-10-20',
  ]);

  await dialogC.locator('[data-catalog-close]')?.count();
  await dialogC.getByRole('button', { name: 'Закрыть форму' }).click();
  await expect(dialogC).not.toBeAttached();
});

test('самоссылка, дубликат и цикл отклоняются с объяснением', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Циклы');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );

  const closeForm = (dialog: ReturnType<Page['getByRole']>) =>
    dialog.getByRole('button', { name: 'Закрыть форму' }).click();

  // Самоссылка: у A предшественник A.
  const dialogA = await openForm(page, 'Циклы', 'Задача A');
  await dialogA.locator('[data-dep-new-from]').selectOption({ label: 'Задача A' });
  await dialogA.locator('[data-dep-add]').click();
  await expect(dialogA.locator('[data-dep-error]')).toContainText(
    'не может зависеть от самой себя',
  );
  await closeForm(dialogA);

  // Дубликат: A → B существует; добавить снова с другим лагом —
  // отклонение с объяснением.
  const dialogB = await openForm(page, 'Циклы', 'Задача B');
  await dialogB.locator('[data-dep-new-from]').selectOption({ label: 'Задача A' });
  await dialogB.locator('[data-dep-new-lag]').fill('3');
  await dialogB.locator('[data-dep-add]').click();
  await expect(dialogB.locator('[data-dep-error]')).toContainText(
    'уже существует с лагом 0',
  );
  await closeForm(dialogB);

  // Цикл: у A предшественник C (A → B → C существует, A ← C замыкает).
  const dialogA2 = await openForm(page, 'Циклы', 'Задача A');
  await dialogA2.locator('[data-dep-new-from]').selectOption({ label: 'Задача C' });
  await dialogA2.locator('[data-dep-add]').click();
  await expect(dialogA2.locator('[data-dep-error]')).toContainText('цикл');

  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.dependencies,
    documentId,
  );
  expect(content).toEqual([
    { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 },
    { id: 'd-2', fromTaskId: 't-b', toTaskId: 't-c', lagDays: 0 },
  ]);
});

test('удаление связи убирает её из документа и после reload; стрелка — DOM', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Удаление связи');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const pane = page.getByRole('group', { name: 'План · Удаление связи' });
  // Стрелка связи A → B рисуется на шкале (SVAR).
  await expect(
    pane.locator('.plan-gantt__chart svg').first(),
  ).toBeVisible();

  const dialog = await openForm(page, 'Удаление связи', 'Задача B');
  await dialog.getByRole('button', { name: 'Удалить связь от Задача A' }).click();
  await expect(dialog.locator('[data-dep-list]')).not.toContainText('Задача A');

  await page.waitForTimeout(1500);
  await page.reload();
  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.dependencies,
    documentId,
  );
  expect(content).toEqual([
    { id: 'd-2', fromTaskId: 't-b', toTaskId: 't-c', lagDays: 0 },
  ]);
});
