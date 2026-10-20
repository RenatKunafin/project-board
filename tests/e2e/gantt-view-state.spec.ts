import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-049: фильтры и настройки представлений. Минимальный набор фильтров —
 * текст задачи и ресурс; состояние экземпляра (фильтры, масштаб, раскрытие
 * групп) сохраняется и восстанавливается после перезапуска. Фильтр —
 * производное: ревизия документа не меняется, скрытые участвуют в проверках.
 * Экземпляры различаются по data-widget-instance (заголовки окон одинаковы).
 */
const planContent = {
  title: 'Состояния',
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  workTypes: [
    { id: 'wt-dev', title: 'Разработка', allowsParallel: false },
    { id: 'wt-psi', title: 'ПСИ', allowsParallel: true },
  ],
  resources: [
    { id: 'r-qa', title: 'QA' },
    { id: 'r-qa2', title: 'QA2' },
  ],
  groups: [{ id: 'g-1', title: 'Направление' }],
  tasks: [
    // Конфликт работ QA: t-a × t-d (обе непараллелизуемые, пересечение).
    {
      id: 't-a',
      title: 'Разработка',
      groupId: 'g-1',
      assigneeIds: ['r-qa'],
      workTypeIds: ['wt-dev'],
      start: '2026-10-12',
      end: '2026-10-16',
    },
    {
      id: 't-b',
      title: 'ПСИ',
      groupId: 'g-1',
      assigneeIds: ['r-qa2'],
      workTypeIds: ['wt-psi'],
      start: '2026-10-19',
      end: '2026-10-20',
    },
    {
      id: 't-d',
      title: 'Инфраструктура',
      assigneeIds: ['r-qa'],
      workTypeIds: ['wt-dev'],
      start: '2026-10-14',
      end: '2026-10-18',
    },
    {
      id: 't-c',
      title: 'Свободная',
      assigneeIds: ['r-qa2'],
      start: '2026-10-22',
      end: '2026-10-23',
    },
  ],
  dependencies: [],
  unavailability: [],
};

async function createPlan(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'План', exact: true })
    .click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByLabel('Название нового документа').fill(title);
  await choice.getByRole('button', { name: 'Создать' }).click();
  const pane = page
    .getByRole('group', { name: `План · ${title}` })
    .first();
  await expect(pane).toBeVisible();
  const documentId = await pane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  expect(documentId).not.toBeNull();
  return documentId as string;
}

async function loadPlan(page: Page, documentId: string): Promise<void> {
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
}

async function revisionOf(page: Page, documentId: string): Promise<number> {
  return page.evaluate(
    (id) => window.__projectBoard?.readDocument(id)?.revision ?? 0,
    documentId,
  );
}

/** id экземпляров план-панелей (в порядке DOM); ожидает монтирования. */
async function planPaneIds(page: Page, expected: number): Promise<string[]> {
  await expect(page.locator('[data-gantt-filter-query]')).toHaveCount(
    expected,
    { timeout: 5000 },
  );
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-widget-instance]')]
      .filter((el) => el.querySelector('[data-gantt-filter-query]'))
      .map((el) => el.getAttribute('data-widget-instance')),
  );
}

/** id экземпляров ресурсных панелей (в порядке DOM); ожидает монтирования. */
async function rtPaneIds(page: Page, expected: number): Promise<string[]> {
  await expect(page.locator('[data-rt-filter-query]')).toHaveCount(
    expected,
    { timeout: 5000 },
  );
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-widget-instance]')]
      .filter((el) => el.querySelector('[data-rt-filter-query]'))
      .map((el) => el.getAttribute('data-widget-instance')),
  );
}

const pane = (page: Page, instanceId: string) =>
  page.locator(`[data-widget-instance="${instanceId}"]`);

test('проектный вид: фильтры и раскрытие групп экземпляров независимы, переживают перезапуск, ревизия не меняется', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Состояния');
  await loadPlan(page, documentId);

  // Второй экземпляр того же документа.
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'План', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Состояния' })
    .click();
  const ids = await planPaneIds(page, 2);
  expect(ids).toHaveLength(2);
  const first = pane(page, ids[0]);
  const second = pane(page, ids[1]);

  // Ревизия до фильтров.
  const revisionBefore = await revisionOf(page, documentId);

  // Первый экземпляр: фильтр «ПСИ» + сворачивание группы «Направление».
  await first.locator('[data-gantt-filter-query]').fill('ПСИ');
  const rowA = first.locator('.wx-row[data-id=":t-a"]');
  const rowB = first.locator('.wx-row[data-id=":t-b"]');
  await expect(rowA).toHaveCount(0);
  await expect(rowB).toBeVisible();
  await first.locator('.wx-row[data-id=":g-1"] .wx-toggle-icon').click();

  // Второй экземпляр: без фильтра — обе задачи видны.
  await expect(second.locator('.wx-row[data-id=":t-a"]')).toBeVisible();
  await expect(second.locator('.wx-row[data-id=":t-b"]')).toBeVisible();

  // Фильтр — производное: ревизия документа не изменилась.
  expect(await revisionOf(page, documentId)).toBe(revisionBefore);

  // Перезапуск: пауза > таймера снапшота (300 мс) — записи успевают
  // в IndexedDB до выгрузки (прецедент PBT-024).
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForTimeout(900);
  const idsAfter = await planPaneIds(page, 2);
  expect(idsAfter.sort()).toEqual([...ids].sort());
  const firstAfter = pane(page, ids[0]);
  const secondAfter = pane(page, ids[1]);
  await expect(firstAfter.locator('[data-gantt-filter-query]')).toHaveValue(
    'ПСИ',
  );
  await expect(firstAfter.locator('.wx-row[data-id=":t-a"]')).toHaveCount(0);
  // Группа «Направление» свёрнута: задача ПСИ внутри группы не видна.
  await expect(firstAfter.locator('.wx-row[data-id=":t-b"]')).toHaveCount(0);
  await expect(secondAfter.locator('[data-gantt-filter-query]')).toHaveValue('');
  await expect(secondAfter.locator('.wx-row[data-id=":t-a"]')).toBeVisible();
});

test('проектный вид: пустое состояние фильтра; скрытые задачи продолжают участвовать в проверках', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Состояния');
  await loadPlan(page, documentId);
  const ids = await planPaneIds(page, 1);
  const paneUnderTest = pane(page, ids[0]);

  // Мусорный фильтр: подсказка, задачи документа целы.
  await paneUnderTest.locator('[data-gantt-filter-query]').fill('нет-такой');
  await expect(paneUnderTest.locator('[data-gantt-filter-empty]')).toBeVisible();
  await expect(paneUnderTest.locator('[data-task-count]')).toContainText(
    'Задач: 4',
  );
  expect(await revisionOf(page, documentId)).toBe(2);

  // Скрытые задачи участвуют в проверках: фильтр по «Инфраструктуре»
  // скрывает «Разработку», но их конфликт работ остаётся в списке проблем.
  await paneUnderTest.locator('[data-gantt-filter-query]').fill('Инфраструктура');
  await expect(
    paneUnderTest.locator('.wx-row[data-id=":t-a"]'),
  ).toHaveCount(0);
  await expect(paneUnderTest.locator('[data-issues]')).toContainText(
    'Проблемы (1)',
  );
});

test('ресурсный вид: масштаб и фильтры экземпляров независимы, восстанавливаются; пустое состояние', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  // Документ создаётся проектным видом, ресурсный открывается как
  // дополнительное представление через каталог (DoD-5).
  const documentId = await createPlan(page, 'Состояния');
  await loadPlan(page, documentId);
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Ресурсы' })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Состояния' })
    .click();
  const rtIds = await rtPaneIds(page, 1);
  expect(rtIds).toHaveLength(1);
  const rt1 = pane(page, rtIds[0]);
  await expect(rt1.locator('.rct-item')).toHaveCount(4); // 4 задачных элемента (t-a, t-b, t-d, t-c)

  // Масштаб меряем по t-c (назначена QA2): в конце теста у rt1 фильтр QA2.
  const barWidth = (instanceId: string) =>
    page
      .locator(`[data-widget-instance="${instanceId}"] [data-rt-task="t-c"]`)
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));

  // Увеличиваем масштаб в первом: полосы шире.
  const width1Before = await barWidth(rtIds[0]);
  await rt1.locator('[data-rt-zoom-in]').click();
  await page.waitForTimeout(300);
  const width1After = await barWidth(rtIds[0]);
  expect(width1After).toBeGreaterThan(width1Before * 1.4);

  // Фильтр ресурса в первом: только дорожка QA2.
  await rt1.locator('[data-rt-filter-resource]').selectOption({
    label: 'QA2',
  });
  const sidebar1 = await rt1
    .locator('.rct-sidebar-row')
    .evaluateAll((nodes) => nodes.map((el) => el.textContent?.trim()));
  expect(sidebar1).toEqual(['QA2']);

  // Пустое состояние текстового фильтра во втором (новом) экземпляре.
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Ресурсы' })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Состояния' })
    .click();
  const rtIds2 = await rtPaneIds(page, 2);
  expect(rtIds2).toHaveLength(2);
  const rt2 = pane(page, rtIds2.find((id) => id !== rtIds[0]) as string);
  await rt2.locator('[data-rt-filter-query]').fill('нет-такой');
  await expect(rt2.locator('[data-rt-filter-empty]')).toBeVisible();
  expect(await revisionOf(page, documentId)).toBe(2);

  // Перезапуск: масштаб и фильтры восстанавливаются у каждого.
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForTimeout(900);
  const rtIdsAfter = await rtPaneIds(page, 2);
  expect(rtIdsAfter.sort()).toEqual([...rtIds2].sort());
  const rt1After = pane(page, rtIds[0]);
  const rt2After = pane(page, rtIds2.find((id) => id !== rtIds[0]) as string);
  await expect(rt1After.locator('.rct-sidebar-row')).toHaveText(['QA2']);
  await expect(rt2After.locator('[data-rt-filter-query]')).toHaveValue(
    'нет-такой',
  );
  await expect(rt2After.locator('[data-rt-filter-empty]')).toBeVisible();
  const width1Restored = await barWidth(rtIds[0]);
  expect(Math.abs(width1Restored - width1After)).toBeLessThanOrEqual(3);
});
