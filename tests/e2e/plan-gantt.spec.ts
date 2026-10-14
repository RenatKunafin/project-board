import { expect, test } from '@playwright/test';

/**
 * Контрольные данные PBT-012 (small-plan): группа «Фаза 1», задачи A–E,
 * FS A→B лаг 0, праздник 2026-10-14. Формат — PlanContent v1.
 */
const smallPlanContent = {
  title: 'Малый контрольный набор',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-10-14'],
    workingExceptions: [],
  },
  workTypes: [
    { id: 'dev', title: 'Разработка', allowsParallel: false },
    { id: 'psi', title: 'ПСИ', allowsParallel: true },
  ],
  resources: [
    { id: 'r1', title: 'Разработчик R1' },
    { id: 'r2', title: 'Разработчик R2' },
  ],
  groups: [{ id: 'g-phase-1', title: 'Фаза 1' }],
  tasks: [
    {
      id: 't-a',
      title: 'Задача A',
      groupId: 'g-phase-1',
      start: '2026-10-12',
      end: '2026-10-16',
      assigneeIds: ['r1'],
      workTypeIds: ['dev'],
    },
    {
      id: 't-b',
      title: 'Задача B (ПСИ)',
      groupId: 'g-phase-1',
      start: '2026-10-19',
      end: '2026-10-20',
      assigneeIds: ['r1'],
      workTypeIds: ['psi'],
    },
    {
      id: 't-c',
      title: 'Задача C',
      groupId: 'g-phase-1',
      start: '2026-10-19',
      end: '2026-10-23',
      assigneeIds: ['r1'],
      workTypeIds: ['dev'],
    },
  ],
  dependencies: [
    { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 },
  ],
  unavailability: [],
};

async function createPlan(page: import('@playwright/test').Page, title: string): Promise<string> {
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

test('проектный Гантт показывает контрольный план: дерево, полосы, подсветку', async ({
  page,
}) => {
  // Широкий вьюпорт: узкая панель скрывает большую часть шкалы,
  // и праздник 14.10.2026 не попадает в видимую зону подсветки.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Контрольный');

  await page.evaluate(
    ({ id, content }) =>
      window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: smallPlanContent },
  );

  const pane = page.getByRole('group', { name: 'План · Контрольный' });
  // Строки документа в таблице представления.
  const chart = pane.locator('.plan-gantt__chart');
  await expect(chart).toBeVisible();
  for (const row of ['Фаза 1', 'Задача A', 'Задача B (ПСИ)', 'Задача C']) {
    // Текст дублируется в строке дерева и подписи полосы — берём первый.
    await expect(chart.getByText(row).first()).toBeVisible();
  }
  // Рабочая длительность задачи A: пн–пт с праздником в среду → 4 раб. дня
  // (своя колонка ядра вместо календарной SVAR).
  const rowA = chart.locator('.wx-row', { hasText: 'Задача A' }).first();
  await expect(rowA.getByText('4', { exact: true })).toBeVisible();
  // Праздник 14.10.2026 подсвечен отдельным классом (DoD-3).
  await expect(chart.locator('.gantt-holiday').first()).toBeVisible();

  await page.waitForTimeout(1500);
  await page.reload();
  const restored = page.getByRole('group', { name: 'План · Контрольный' });
  await expect(restored).toBeVisible();
  const restoredChart = restored.locator('.plan-gantt__chart');
  await expect(restoredChart.getByText('Задача A').first()).toBeVisible();
  await expect(restoredChart.getByText('Фаза 1').first()).toBeVisible();

  await page.screenshot({
    path: 'test-results/screenshots/project-gantt.png',
    fullPage: false,
  });
});

test('два экземпляра плана синхронно показывают один документ', async ({
  page,
}) => {
  await page.goto('/');
  const documentId = await createPlan(page, 'Общий');

  await page.evaluate(
    ({ id, content }) =>
      window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: smallPlanContent },
  );

  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Общий' })
    .click();

  const panes = page.getByRole('group', { name: 'План · Общий' });
  await expect(panes).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    const chart = panes.nth(index).locator('.plan-gantt__chart');
    await expect(chart.getByText('Задача A').first()).toBeVisible();
    await expect(chart.getByText('Задача C').first()).toBeVisible();
  }
});

test('пустой план отображается без ошибки', async ({ page }) => {
  await page.goto('/');
  await createPlan(page, 'Пустой');
  const pane = page.getByRole('group', { name: 'План · Пустой' });
  await expect(pane.locator('.plan-gantt__chart')).toBeVisible();
  await expect(pane.locator('.plan-gantt--error')).toHaveCount(0);
});
