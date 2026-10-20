import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-042: назначение исполнителей и типов задачам через форму,
 * отображение в таблице Гантта, второй виджет и reload.
 */
const planContent = {
  title: 'Назначения',
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  workTypes: [
    { id: 'wt-dev', title: 'Разработка', allowsParallel: false },
    { id: 'wt-psi', title: 'ПСИ', allowsParallel: true },
  ],
  resources: [
    { id: 'r-qa', title: 'QA' },
    { id: 'r-qa2', title: 'QA2' },
  ],
  groups: [],
  tasks: [
    { id: 't-1', title: 'Задача 1', start: '2026-10-12', end: '2026-10-16' },
  ],
  dependencies: [],
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

test('назначение, замена и снятие исполнителя — даты не меняются', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Назначения');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const pane = page.getByRole('group', { name: 'План · Назначения' });
  const chart = pane.locator('.plan-gantt__chart');

  // Назначение QA через форму.
  await chart.getByText('Задача 1').first().dblclick();
  let dialog = pane.getByRole('dialog');
  await dialog.locator('[data-task-assignee="QA"]').check();
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).not.toBeAttached();

  // Таблица: исполнитель виден, даты не изменились.
  const row = pane.locator('.wx-row', { hasText: 'Задача 1' }).first();
  await expect(row).toContainText('QA');
  await expect(row).toContainText('12.10');
  await expect(row).toContainText('16.10');

  // Замена QA → QA2.
  await chart.getByText('Задача 1').first().dblclick();
  dialog = pane.getByRole('dialog');
  await dialog.locator('[data-task-assignee="QA"]').uncheck();
  await dialog.locator('[data-task-assignee="QA2"]').check();
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).not.toBeAttached();
  await expect(row).toContainText('QA2');

  // Снятие: пустое множество → «—».
  await chart.getByText('Задача 1').first().dblclick();
  dialog = pane.getByRole('dialog');
  await dialog.locator('[data-task-assignee="QA2"]').uncheck();
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).not.toBeAttached();

  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.tasks?.[0],
    documentId,
  );
  expect(content.start).toBe('2026-10-12');
  expect(content.end).toBe('2026-10-16');
  expect(content.assigneeIds).toBeUndefined();
});

test('несколько исполнителей в одной строке, типы работы сохраняются', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Мульти');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const pane = page.getByRole('group', { name: 'План · Мульти' });
  const chart = pane.locator('.plan-gantt__chart');

  await chart.getByText('Задача 1').first().dblclick();
  const dialog = pane.getByRole('dialog');
  await dialog.locator('[data-task-assignee="QA"]').check();
  await dialog.locator('[data-task-assignee="QA2"]').check();
  await dialog.locator('[data-task-worktype="ПСИ"]').check();
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).not.toBeAttached();

  // Одна строка, оба исполнителя и тип видны, дублирования нет.
  const rows = pane.locator('.wx-row', { hasText: 'Задача 1' });
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText('QA');
  await expect(row).toContainText('QA2');
  await expect(row).toContainText('ПСИ');

  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.tasks?.[0],
    documentId,
  );
  expect(content.assigneeIds).toEqual(['r-qa', 'r-qa2']);
  expect(content.workTypeIds).toEqual(['wt-psi']);
});

test('назначение видно во втором виджете и после reload; неназначенная — «—»', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Второй');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const first = page.getByRole('group', { name: 'План · Второй' });

  // Второй экземпляр документа.
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Второй' })
    .click();
  const second = page.getByRole('group', { name: 'План · Второй' }).nth(1);
  await expect(second.locator('.plan-gantt__chart')).toBeVisible();

  // Неназначенная задача — прочерк в обоих экземплярах.
  await expect(
    first.locator('.wx-row', { hasText: 'Задача 1' }).first(),
  ).toContainText('—');

  // Назначение в первом.
  await first
    .locator('.plan-gantt__chart')
    .getByText('Задача 1')
    .first()
    .dblclick();
  const dialog = first.getByRole('dialog');
  await dialog.locator('[data-task-assignee="QA"]').check();
  await dialog.locator('[data-task-worktype="Разработка"]').check();
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).not.toBeAttached();

  await expect(
    first.locator('.wx-row', { hasText: 'Задача 1' }).first(),
  ).toContainText('QA');
  await expect(
    second.locator('.wx-row', { hasText: 'Задача 1' }).first(),
  ).toContainText('Разработка');

  await page.waitForTimeout(1500);
  await page.reload();
  const restored = page.getByRole('group', { name: 'План · Второй' }).nth(0);
  const row = restored.locator('.wx-row', { hasText: 'Задача 1' }).first();
  await expect(row).toContainText('QA');
  await expect(row).toContainText('Разработка');
});
