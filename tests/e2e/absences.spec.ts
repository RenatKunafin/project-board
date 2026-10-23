import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-043: редактор отпусков (периодов недоступности).
 * Создание/изменение/удаление периода; задачи не затрагиваются;
 * обратный интервал отклоняется; сохранение после reload.
 */
const planContent = {
  title: 'Отпуска',
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  workTypes: [],
  resources: [{ id: 'r-qa', title: 'QA' }],
  groups: [],
  tasks: [
    {
      id: 't-1',
      title: 'Задача 1',
      assigneeIds: ['r-qa'],
      start: '2026-10-12',
      end: '2026-10-16',
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

async function openCatalog(page: Page, paneTitle: string) {
  const pane = page.getByRole('group', { name: `План · ${paneTitle}` });
  await pane.locator('[data-catalogs]').click();
  const dialog = pane.getByRole('dialog', { name: 'Настройки плана' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function addAbsence(
  dialog: ReturnType<Page['getByRole']>,
  resource: string,
  start: string,
  end: string,
) {
  await dialog.locator('[data-absence-new="resource"]').selectOption({ label: resource });
  await dialog.locator('[data-absence-new="start"]').fill(start);
  await dialog.locator('[data-absence-new="end"]').fill(end);
  await dialog.locator('[data-absence-add]').click();
}

test('отпуск создаётся, изменяется и удаляется; задачи не затрагиваются', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Отпуска');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const dialog = await openCatalog(page, 'Отпуска');

  // Создание отпуска QA 13–15 (внутри задачи 12–16).
  await addAbsence(dialog, 'QA', '2026-10-13', '2026-10-15');
  await expect(dialog.getByText('QA: 2026-10-13 — 2026-10-15')).toBeVisible();

  let content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content,
    documentId,
  );
  expect(content.unavailability).toEqual([
    {
      id: expect.any(String),
      resourceId: 'r-qa',
      start: '2026-10-13',
      end: '2026-10-15',
    },
  ]);
  expect(content.tasks[0].start).toBe('2026-10-12');
  expect(content.tasks[0].end).toBe('2026-10-16');

  // Изменение дат периода.
  await dialog.getByRole('button', { name: 'Изменить период' }).click();
  await dialog.locator('[data-absence-edit="start"]').fill('2026-10-14');
  await dialog.getByRole('button', { name: 'Сохранить период' }).click();
  await expect(
    dialog.getByText('QA: 2026-10-14 — 2026-10-15'),
  ).toBeVisible();

  // Удаление.
  await dialog.getByRole('button', { name: 'Удалить период' }).click();
  await expect(dialog.getByText('QA: 2026-10-14 — 2026-10-15')).toHaveCount(0);

  content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content,
    documentId,
  );
  expect(content.unavailability).toEqual([]);
  expect(content.tasks[0].start).toBe('2026-10-12');
  expect(content.tasks[0].end).toBe('2026-10-16');
});

test('отпуск восстанавливается после reload, задача прежняя', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Релоад');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const dialog = await openCatalog(page, 'Релоад');
  await addAbsence(dialog, 'QA', '2026-10-13', '2026-10-15');
  await expect(dialog.getByText('QA: 2026-10-13 — 2026-10-15')).toBeVisible();

  await page.waitForTimeout(1500);
  await page.reload();
  const dialog2 = await openCatalog(page, 'Релоад');
  await expect(
    dialog2.getByText('QA: 2026-10-13 — 2026-10-15'),
  ).toBeVisible();
  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.tasks?.[0],
    documentId,
  );
  expect(content.start).toBe('2026-10-12');
  expect(content.end).toBe('2026-10-16');
});

test('обратный интервал и пустой ресурс отклоняются с сообщением', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Ошибки отпуска');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const dialog = await openCatalog(page, 'Ошибки отпуска');

  // Пустой ресурс.
  await dialog.locator('[data-absence-new="start"]').fill('2026-10-13');
  await dialog.locator('[data-absence-new="end"]').fill('2026-10-15');
  await dialog.locator('[data-absence-add]').click();
  await expect(dialog.locator('[data-absence-error]')).toHaveText(
    'Выберите ресурс.',
  );

  // Обратный интервал (текст ядра).
  await addAbsence(dialog, 'QA', '2026-10-15', '2026-10-13');
  await expect(dialog.locator('[data-absence-error]')).toHaveText(
    'Окончание «2026-10-13» раньше начала «2026-10-15».',
  );

  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.unavailability,
    documentId,
  );
  expect(content).toEqual([]);
});
