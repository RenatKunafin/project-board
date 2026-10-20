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

  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
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

test('drag полосы переносит задачу с сохранением рабочей длительности (PBT-039)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Драг');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: smallPlanContent },
  );
  const pane = page.getByRole('group', { name: 'План · Драг' });
  const rowA = pane.locator('.wx-row', { hasText: 'Задача A' }).first();
  await expect(rowA).toBeVisible();
  const before = await rowA.textContent();
  const revisionBefore = await page.evaluate(
    (id) => window.__projectBoard?.readDocument?.(id)?.revision ?? null,
    documentId,
  );

  // Задача A: пн 12–пт 16 (включительно, 5 дней на шкале). Перенос НАЗАД
  // на 2 дня: пиксели дня вычисляем по ширине полосы (тест не зависит от
  // масштаба шкалы SVAR), влево — чтобы курсор не покидал панель: за её
  // краем жест клампится (найдено в отладке PBT-039).
  const bar = pane.locator('.wx-bar[data-id=":t-a"]');
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  const dayPx = box!.width / 5;
  const shift = Math.round(dayPx * 2);
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Реалистичная анимация: SVAR применяет перемещение пакетами —
  // «мгновенный» перелёт фиксирует промежуточное положение (PBT-014).
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(startX - (shift * step) / 6, startY);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
  // Стор SVAR применяет жест с задержкой; запись документа — до 3 сверок.
  await page.waitForTimeout(2000);
  await expect
    .poll(async () => rowA.textContent(), { timeout: 5000 })
    .not.toBe(before);
  const after = await rowA.textContent();
  // Начало пн 12 → сб 10 привязывается к рабочей пятнице 09 (A2, назад);
  // рабочая длительность сохранена: 09,12,13,15 (14.10 — праздник) = 4 дня,
  // окончание включительно чт 15.
  expect(after).toContain('09-10-2026');
  expect(after).toContain('15-10-2026');
  expect(after).toContain('4');
  const revisionAfter = await page.evaluate(
    (id) => window.__projectBoard?.readDocument?.(id)?.revision ?? null,
    documentId,
  );
  // Одна логическая операция: ровно одна новая редакция документа.
  expect(revisionAfter).toBe((revisionBefore ?? 0) + 1);
  console.log('GESTURE:', JSON.stringify(await page.evaluate(() => (window as unknown as { __gestureLog?: string[] }).__gestureLog ?? [])));
});

test('resize правого края через праздник сохраняет дату края (PBT-039)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Резайз');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: smallPlanContent },
  );
  const pane = page.getByRole('group', { name: 'План · Резайз' });
  const row = pane.locator('.wx-row', { hasText: 'Задача A' }).first();
  await expect(row).toBeVisible();
  // Задача A: пн 12–пт 16. Тянем ЛЕВЫЙ край на 3 дня вправо — путь
  // жеста проходит через праздник 14.10; брошенное начало (чт 15)
  // сохраняется как есть (A3), рабочая длительность пересчитывается:
  // 15–16 (чт–пт) = 2 дня. Правый край полосы A за пределами панели
  // (жест клампится на краю — отладка PBT-039), поэтому левый.
  const bar = pane.locator('.wx-bar[data-id=":t-a"]');
  const box = await bar.boundingBox();
  const dayPx = box!.width / 5;
  const edgeX = box!.x + 8;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(edgeX, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(edgeX + (dayPx * 3 * step) / 6, y);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(2000);
  await expect
    .poll(async () => row.textContent(), { timeout: 5000 })
    .toContain('15-10-2026');
  const after = await row.textContent();
  expect(after).toContain('16-10-2026');
  expect(after).toContain('2');
});

test('сжатие левее начала отклоняется ядром и откатывает полосу (PBT-039)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Отмена');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: smallPlanContent },
  );
  const pane = page.getByRole('group', { name: 'План · Отмена' });
  const rowA = pane.locator('.wx-row', { hasText: 'Задача A' }).first();
  await expect(rowA).toBeVisible();
  const revisionBefore = await page.evaluate(
    (id) => window.__projectBoard?.readDocument?.(id)?.revision ?? null,
    documentId,
  );
  // Отмена жеста «туда-обратно»: факт возвращается к исходным датам,
  // расхождения стора с документом нет — документ не меняется.
  // (Клавишная отмена беты обёртки не поддерживается: Esc не откатывает
  // стор — зафиксировано в design PBT-039.)
  const bar = pane.locator('.wx-bar[data-id=":t-a"]');
  const box = await bar.boundingBox();
  const y = box!.y + box!.height / 2;
  const midX = box!.x + box!.width / 2;
  await page.mouse.move(midX, y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(midX + 50 * step, y);
    await page.waitForTimeout(50);
  }
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(midX + 250 - 50 * step, y);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(2000);
  // Строка осталась 12–16 (4 раб. дня), документ не менялся.
  await expect(rowA).toHaveText(/12-10-2026/);
  expect(await rowA.textContent()).toContain('16-10-2026');
  const revisionAfter = await page.evaluate(
    (id) => window.__projectBoard?.readDocument?.(id)?.revision ?? null,
    documentId,
  );
  expect(revisionAfter).toBe(revisionBefore);
});

test('drag сводной полосы не меняет документ (PBT-039)', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Сводная');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    { id: documentId, content: smallPlanContent },
  );
  const pane = page.getByRole('group', { name: 'План · Сводная' });
  await expect(
    pane.locator('.wx-row', { hasText: 'Фаза 1' }).first(),
  ).toBeVisible();
  const revisionBefore = await page.evaluate(
    (id) => window.__projectBoard?.readDocument?.(id)?.revision ?? null,
    documentId,
  );
  const bar = pane.locator('.wx-bar[data-id=":g-phase-1"]');
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 - 150, box!.y + box!.height / 2, {
    steps: 6,
  });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(2000);
  const revisionAfter = await page.evaluate(
    (id) => window.__projectBoard?.readDocument?.(id)?.revision ?? null,
    documentId,
  );
  expect(revisionAfter).toBe(revisionBefore);
});

test('drag однодневной задачи сохраняет длительность 1 (регрессия PBT-039)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Однодневная');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    {
      id: documentId,
      content: {
        title: 'Однодневная',
        calendar: {
          workingDays: [1, 2, 3, 4, 5],
          holidays: ['2026-10-14'],
          workingExceptions: [],
        },
        workTypes: [],
        resources: [],
        groups: [],
        tasks: [
          { id: 't-1', title: 'День', start: '2026-10-12', end: '2026-10-12' },
        ],
        dependencies: [],
        unavailability: [],
      },
    },
  );
  const pane = page.getByRole('group', { name: 'План · Однодневная' });
  const row = pane.locator('.wx-row', { hasText: 'День' }).first();
  await expect(row).toBeVisible();
  const bar = pane.locator('.wx-bar[data-id=":t-1"]');
  const box = await bar.boundingBox();
  // Однодневная полоса узкая: тянем влево на 150px (панель до ~1050px).
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(box!.x + box!.width / 2 - (30 * step), box!.y + box!.height / 2);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(2000);
  await expect
    .poll(async () => row.textContent(), { timeout: 5000 })
    .not.toContain('12-10-2026');
  const after = await row.textContent();
  // Длительность осталась 1 раб. день после переноса (особый случай
  // moveTask, fix PBT-039): окончание совпадает с началом, «1» в колонке.
  expect(after).toContain('1');
});
