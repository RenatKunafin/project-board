import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-041: редакторы справочников (исполнители, типы работ).
 * Создание/переименование/удаление, флажок параллельности, чистка
 * ссылок при удалении, независимость планов.
 */
const basePlan = {
  title: 'Справочники',
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  workTypes: [],
  resources: [],
  groups: [],
  tasks: [],
  dependencies: [],
  unavailability: [],
};

async function createPlan(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: 'Добавить виджет' }).click();
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

test('создание QA и QA2, переименование, удаление — сохраняется после reload', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await createPlan(page, 'Справочники');
  const dialog = await openCatalog(page, 'Справочники');

  await dialog.locator('[data-catalog-new="resource"]').fill('QA');
  await dialog.locator('[data-catalog-add="resource"]').click();
  await dialog.locator('[data-catalog-new="resource"]').fill('QA2');
  await dialog.locator('[data-catalog-add="resource"]').click();
  await expect(
    dialog.getByRole('button', { name: 'Удалить QA2' }),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Изменить QA', exact: true }).click();
  await dialog.locator('[data-catalog-edit="resource"]').fill('QA1');
  await dialog
    .locator('[data-catalog-edit="resource"]')
    .press('Enter');
  await expect(
    dialog.getByRole('button', { name: 'Удалить QA1' }),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Удалить QA2' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Удалить QA2' }),
  ).toHaveCount(0);

  await dialog.locator('[data-catalog-close]').click();
  await page.waitForTimeout(1500);
  await page.reload();
  const dialog2 = await openCatalog(page, 'Справочники');
  await expect(dialog2.getByRole('button', { name: 'Удалить QA1' })).toBeVisible();
  await expect(dialog2.getByRole('button', { name: 'Удалить QA2' })).toHaveCount(0);
});

test('типы работ: создание с параллельностью, переключение флажком', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Типы');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: basePlan },
  );
  const dialog = await openCatalog(page, 'Типы');

  // «Разработка» — нельзя параллельно (умолчание).
  await dialog.locator('[data-catalog-new="workType"]').fill('Разработка');
  await dialog.locator('[data-catalog-add="workType"]').click();

  // «ПСИ» — можно параллельно.
  await dialog.locator('[data-catalog-new="workType"]').fill('ПСИ');
  await dialog.locator('[data-catalog-new-parallel]').check();
  await dialog.locator('[data-catalog-add="workType"]').click();

  // Флажки отражают данные документа.
  const psaFlag = dialog.locator('[data-catalog-parallel]').nth(1);
  await expect(psaFlag).toBeChecked();

  // Переключение флажком «Разработка» → можно параллельно.
  await dialog.locator('[data-catalog-parallel]').first().check();

  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.workTypes,
    documentId,
  );
  expect(content).toEqual([
    { id: expect.any(String), title: 'Разработка', allowsParallel: true },
    { id: expect.any(String), title: 'ПСИ', allowsParallel: true },
  ]);

  await dialog.locator('[data-catalog-close]').click();
  await page.waitForTimeout(1500);
  await page.reload();
  const dialog2 = await openCatalog(page, 'Типы');
  await expect(dialog2.locator('[data-catalog-parallel]').first()).toBeChecked();
  await expect(dialog2.locator('[data-catalog-parallel]').nth(1)).toBeChecked();
});

test('удаление используемого исполнителя чистит назначения, задача сохраняется', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Чистка');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    {
      id: documentId,
      value: {
        ...basePlan,
        title: 'Чистка',
        resources: [{ id: 'r-qa', title: 'QA' }],
        tasks: [
          {
            id: 't-1',
            title: 'Задача 1',
            assigneeIds: ['r-qa'],
            start: '2026-10-12',
            end: '2026-10-16',
          },
        ],
      },
    },
  );
  page.on('dialog', (dialog) => void dialog.accept());
  const dialog = await openCatalog(page, 'Чистка');
  await dialog.getByRole('button', { name: 'Удалить QA' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Удалить QA' }),
  ).toHaveCount(0);

  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content,
    documentId,
  );
  expect(content.resources).toEqual([]);
  expect(content.tasks[0].assigneeIds).toBeUndefined();
  expect(content.tasks[0].start).toBe('2026-10-12');
});

test('независимость планов: переименование QA в одном не трогает другой', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const planA = await createPlan(page, 'План А');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: planA, value: { ...basePlan, title: 'План А' } },
  );
  const planB = await createPlan(page, 'План Б');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: planB, value: { ...basePlan, title: 'План Б' } },
  );

  const dialogA = await openCatalog(page, 'План А');
  await dialogA.locator('[data-catalog-new="resource"]').fill('QA');
  await dialogA.locator('[data-catalog-add="resource"]').click();
  await dialogA.locator('[data-catalog-close]').click();

  const dialogB = await openCatalog(page, 'План Б');
  await dialogB.locator('[data-catalog-new="resource"]').fill('QA');
  await dialogB.locator('[data-catalog-add="resource"]').click();
  await dialogB.locator('[data-catalog-close]').click();

  const dialogA2 = await openCatalog(page, 'План А');
  await dialogA2.getByRole('button', { name: 'Изменить QA', exact: true }).click();
  await dialogA2.locator('[data-catalog-edit="resource"]').fill('QA1');
  await dialogA2.locator('[data-catalog-edit="resource"]').press('Enter');
  await dialogA2.locator('[data-catalog-close]').click();

  const contentA = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.resources,
    planA,
  );
  const contentB = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.resources,
    planB,
  );
  expect(contentA.map((r: { title: string }) => r.title)).toEqual(['QA1']);
  expect(contentB.map((r: { title: string }) => r.title)).toEqual(['QA']);
});

test('пустое название отклоняется с сообщением, документ без изменений', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Ошибки');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: basePlan },
  );
  const dialog = await openCatalog(page, 'Ошибки');
  await dialog.locator('[data-catalog-add="resource"]').click();
  await expect(dialog.locator('[data-catalog-error]')).toHaveText(
    'Название не может быть пустым.',
  );
  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.resources,
    documentId,
  );
  expect(content).toEqual([]);
  // Диалог открыт, ввод после ошибки работает.
  await dialog.locator('[data-catalog-new="resource"]').fill('QA');
  await dialog.locator('[data-catalog-add="resource"]').click();
  await expect(dialog.getByRole('button', { name: 'Удалить QA' })).toBeVisible();
});
