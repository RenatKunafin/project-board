import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-046: список проблем плана (FS / конфликт работ / отпуск) и переход
 * к задаче, включая свёрнутую группу. Ручной режим: исправления — через UI.
 */
const planContent = {
  title: 'Конфликты',
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  workTypes: [
    { id: 'wt-dev', title: 'Разработка', allowsParallel: false },
    { id: 'wt-psi', title: 'ПСИ', allowsParallel: true },
  ],
  resources: [{ id: 'r-qa', title: 'QA' }],
  groups: [{ id: 'g-1', title: 'Направление' }],
  tasks: [
    // FS-нарушение: B начинается 15.10, при лаге 0 после A (конец 13) —
    // должна была начаться 14.10.
    { id: 't-a', title: 'Задача A', start: '2026-10-12', end: '2026-10-13' },
    { id: 't-b', title: 'Задача B', start: '2026-10-13', end: '2026-10-14' },
    // Конфликт работ: две непараллелизуемые задачи QA пересекаются.
    {
      id: 't-c',
      title: 'Разработка',
      assigneeIds: ['r-qa'],
      workTypeIds: ['wt-dev'],
      start: '2026-10-12',
      end: '2026-10-16',
    },
    {
      id: 't-d',
      title: 'Инфраструктура',
      assigneeIds: ['r-qa'],
      workTypeIds: ['wt-dev'],
      start: '2026-10-15',
      end: '2026-10-19',
    },
    // ПСИ в отпуске ресурса (параллелизуемая — работы-конфликта нет).
    {
      id: 't-e',
      title: 'ПСИ',
      assigneeIds: ['r-qa'],
      workTypeIds: ['wt-psi'],
      start: '2026-10-13',
      end: '2026-10-14',
    },
  ],
  dependencies: [
    { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 },
  ],
  unavailability: [
    { id: 'u-1', resourceId: 'r-qa', start: '2026-10-13', end: '2026-10-14' },
  ],
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

test('три типа проблем в списке: FS, конфликт работ, отпуск', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Конфликты');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const pane = page.getByRole('group', { name: 'План · Конфликты' });
  await expect(pane.locator('[data-issues]')).toContainText('Проблемы (4)');

  await pane.locator('[data-issues]').click();
  const dialog = pane.getByRole('dialog', { name: 'Проблемы плана' });
  await expect(dialog).toBeVisible();
  const list = dialog.locator('[data-issues-list]');
  await expect(list).toContainText('Нарушение FS');
  await expect(list).toContainText('Задача B');
  await expect(list).toContainText('Конфликт работ');
  await expect(list).toContainText('QA');
  await expect(list).toContainText('Разработка');
  await expect(list).toContainText('Инфраструктура');
  await expect(list).toContainText('Отпуск исполнителя');
  await expect(list).toContainText('ПСИ');
  // Ложного конфликта Разработка/ПСИ нет.
  await expect(list).not.toContainText('ПСИ» и «Разработка');

  // Исправление FS: сдвиг B на 14.10 (лаг 0) — проблема исчезает.
  await dialog.locator('[data-issues-close]').click();
  await pane
    .locator('.plan-gantt__chart')
    .locator('.wx-row[data-id=":t-b"]')
    .dblclick();
  const taskDialog = pane.getByRole('dialog');
  await taskDialog.locator('[data-task-field="start"]').fill('2026-10-14');
  await taskDialog.locator('[data-task-save]').click();
  await expect(taskDialog).not.toBeAttached();
  await expect(pane.locator('[data-issues]')).toContainText('Проблемы (3)');
});

test('исправление конфликта работ снимает проблему; ревизия растёт только на исправление', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Конфликты');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const pane = page.getByRole('group', { name: 'План · Конфликты' });
  await expect(pane.locator('[data-issues]')).toContainText('Проблемы (4)');

  const revBefore = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.revision,
    documentId,
  );
  // Открыть список (пересчёт) — ревизия не меняется.
  await pane.locator('[data-issues]').click();
  const dialog = pane.getByRole('dialog', { name: 'Проблемы плана' });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      (id) => window.__projectBoard.readDocument(id)?.revision,
      documentId,
    ),
  ).toBe(revBefore);
  await dialog.locator('[data-issues-close]').click();

  // Исправление: сдвиг «Инфраструктуры» за пределы «Разработки».
  await pane
    .locator('.plan-gantt__chart')
    .locator('.wx-row[data-id=":t-d"]')
    .dblclick();
  const taskDialog = pane.getByRole('dialog');
  await taskDialog.locator('[data-task-field="start"]').fill('2026-10-20');
  await taskDialog.locator('[data-task-field="duration"]').fill('3');
  await taskDialog.locator('[data-task-save]').click();
  await expect(taskDialog).not.toBeAttached();

  const counter = pane.locator('[data-issues]');
  if ((await counter.textContent()) !== 'Проблемы (3)') {
    await pane.locator('[data-issues]').click();
    const issueText = await pane
      .getByRole('dialog', { name: 'Проблемы плана' })
      .locator('[data-issues-list]')
      .textContent();
    console.log('ISSUES-AFTER-FIX', JSON.stringify(issueText));
    await pane.getByRole('dialog', { name: 'Проблемы плана' }).locator('[data-issues-close]').click();
  }
  await expect(pane.locator('[data-issues]')).toContainText('Проблемы (3)');
  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.tasks,
    documentId,
  );
  // Конфликт работ исчез, остальные проблемы на месте.
  expect(content[3].start).toBe('2026-10-20');
});

test('переход к задаче внутри свёрнутой группы раскрывает её', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  page.on('console', (message) => {
    errors.push(`CONSOLE-${message.type()}: ${message.text().slice(0, 120)}`);
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Переход');
  await page.evaluate(
    ({ id, value }) =>
      window.__projectBoard?.writeDocumentContent(id, {
        ...value,
        tasks: value.tasks.map((task: { id: string }) =>
          task.id === 't-c' ? { ...task, groupId: 'g-1' } : task,
        ),
      }),
    { id: documentId, value: planContent },
  );
  const pane = page.getByRole('group', { name: 'План · Переход' });
  const chart = pane.locator('.plan-gantt__chart');

  // Сворачиваем группу «Направление» — строки задач скрыты.
  await chart.locator('.wx-row[data-id=":g-1"] .wx-toggle-icon').first().click();
  await expect(chart.locator('.wx-row[data-id=":t-c"]')).toHaveCount(0);

  // Открываем список проблем, жмём «Показать» у конфликта «Инфраструктуры».
  await pane.locator('[data-issues]').click();
  const dialog = pane.getByRole('dialog', { name: 'Проблемы плана' });
  const infraRow = dialog.locator('li', { hasText: 'Инфраструктура' });
  await infraRow.locator('[data-issue-show]').click();

  if (
    !(await chart.locator('.wx-row[data-id=":t-d"]').isVisible())
  ) {
    const rowIds = await chart.locator('.wx-row[data-id]').evaluateAll(
      (rows) => rows.map((r) => (r as HTMLElement).dataset.id),
    );
    const relevant = errors.filter(
      (line) => line.includes('pbt046') || line.includes('error'),
    );
    console.log('SHOW-DEBUG', JSON.stringify({ rowIds, relevant }, null, 1));
  }
  await expect(chart.locator('.wx-row[data-id=":t-d"]')).toBeVisible();
});
