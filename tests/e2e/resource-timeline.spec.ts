import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-047: ресурсные дорожки из документа плана (read-only v1).
 * DoD: дорожка на ресурс, укладка пересечений, отпуск у своего ресурса,
 * нерабочие дни по календарю плана, конфликт vs допустимое пересечение,
 * D1/D2, оба вида одного документа обновляются синхронно.
 */
const planContent = {
  title: 'Контрольный план',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-10-14'],
    workingExceptions: ['2026-10-17'],
  },
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
    // Конфликт работ: две непараллелизуемые задачи QA пересекаются.
    {
      id: 't-a',
      title: 'Разработка',
      assigneeIds: ['r-qa'],
      workTypeIds: ['wt-dev'],
      start: '2026-10-12',
      end: '2026-10-16',
    },
    {
      id: 't-b',
      title: 'Инфраструктура',
      assigneeIds: ['r-qa'],
      workTypeIds: ['wt-dev'],
      start: '2026-10-15',
      end: '2026-10-19',
    },
    // ПСИ (параллелизуемая) у двух ресурсов; пересекается с отпуском QA (D6).
    {
      id: 't-c',
      title: 'ПСИ',
      assigneeIds: ['r-qa', 'r-qa2'],
      workTypeIds: ['wt-psi'],
      start: '2026-10-13',
      end: '2026-10-14',
    },
    // Только у QA2; допустимое пересечение с ПСИ QA2.
    {
      id: 't-d',
      title: 'Только у QA2',
      assigneeIds: ['r-qa2'],
      start: '2026-10-20',
      end: '2026-10-21',
    },
    // Без назначений — в дорожках не отображается (D2).
    { id: 't-e', title: 'Без ресурса', start: '2026-10-12', end: '2026-10-13' },
  ],
  dependencies: [],
  unavailability: [
    { id: 'u-1', resourceId: 'r-qa', start: '2026-10-13', end: '2026-10-14' },
  ],
};

async function createResourcesView(
  page: Page,
  title: string,
): Promise<string> {
  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Ресурсы' })
    .click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByLabel('Название нового документа').fill(title);
  await choice.getByRole('button', { name: 'Создать' }).click();
  const pane = page.getByRole('group', { name: `Ресурсы · ${title}` });
  await expect(pane).toBeVisible();
  const documentId = await pane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  expect(documentId).not.toBeNull();
  return documentId as string;
}

test('дорожки, укладка, отпуск у своего ресурса, конфликт против допустимого', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createResourcesView(page, 'Контрольный план');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const pane = page.getByRole('group', { name: 'Ресурсы · Контрольный план' });
  const chart = pane.locator('[data-rt-chart]');

  // Дорожка на каждый ресурс, в порядке документа.
  const sidebar = chart.locator('.rct-sidebar-row');
  await expect(sidebar).toHaveText(['QA', 'QA2']);

  // Элементы: t-a, t-b, t-c (QA), t-c (QA2), t-d (QA2), отпуск QA.
  // Задача без назначений отсутствует (D2).
  const items = chart.locator('.rct-item');
  await expect(items).toHaveCount(6);
  await expect(chart.locator('[data-rt-task="t-e"]')).toHaveCount(0);
  await expect(chart.locator('[data-rt-task="t-c"]')).toHaveCount(2);
  await expect(chart.locator('[data-rt-unavailability="u-1"]')).toHaveCount(1);

  // Конфликт по данным ядра: обе непараллелизуемые работы и ПСИ в отпуске.
  for (const marked of ['t-a', 't-b', 't-c']) {
    for (const item of await chart.locator(`[data-rt-task="${marked}"]`).all()) {
      await expect(item).toHaveClass(/rtl-item--conflict/);
    }
  }
  await expect(
    chart.locator('[data-rt-unavailability="u-1"]'),
  ).toHaveClass(/rtl-item--conflict/);
  // Допустимое пересечение (t-d без конфликтующих работ) не помечено.
  await expect(chart.locator('[data-rt-task="t-d"]')).not.toHaveClass(
    /rtl-item--conflict/,
  );

  // Укладка пересечения: полосы t-a и t-b на разной высоте.
  const topA = await chart
    .locator('[data-rt-task="t-a"]')
    .evaluate((el) => el.getBoundingClientRect().top);
  const topB = await chart
    .locator('[data-rt-task="t-b"]')
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(topA - topB)).toBeGreaterThan(8);

  // Отпуск лежит в дорожке QA: ниже заголовка QA и выше заголовка QA2.
  const qaTop = await sidebar
    .nth(0)
    .evaluate((el) => el.getBoundingClientRect().top);
  const qa2Top = await sidebar
    .nth(1)
    .evaluate((el) => el.getBoundingClientRect().top);
  const topU = await chart
    .locator('[data-rt-unavailability="u-1"]')
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(topU).toBeGreaterThan(qaTop);
  expect(topU).toBeLessThan(qa2Top);
});

test('нерабочие дни по календарю плана: выходные, праздник, рабочее исключение', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createResourcesView(page, 'Контрольный план');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const pane = page.getByRole('group', { name: 'Ресурсы · Контрольный план' });
  const chart = pane.locator('[data-rt-chart]');
  await expect(chart.locator('.rct-item')).toHaveCount(6);

  // Слой нерабочих дней: колонки календаря плана, независимые от
  // единицы шкалы RCT (уточнение владельца 2026-10-15).
  // Праздник 14.10 (среда) подсвечен особо.
  await expect(chart.locator('.rt-day-col.rt-day--holiday')).toHaveCount(1);
  // Рабочее исключение 17.10 (суббота) — без подсветки выходного.
  await expect(chart.locator('.rt-day-col[data-day="2026-10-17"]')).toHaveCount(
    0,
  );
  // Обычная суббота 24.10 подсвечена как выходной.
  await expect(
    chart.locator('.rt-day-col.rt-day--weekend[data-day="2026-10-24"]'),
  ).toHaveCount(1);
  // Рабочий день 15.10 не подсвечивается вовсе.
  await expect(chart.locator('.rt-day-col[data-day="2026-10-15"]')).toHaveCount(
    0,
  );
});

test('оба вида одного документа: изменение в проектном виде смещает полосу в ресурсном', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createResourcesView(page, 'Контрольный план');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  // SVAR пересобирает представление по ревизии (PBT-037): измерения и
  // жесты сразу после записи контрольных данных попадают в переходный DOM.
  await page.waitForTimeout(1500);

  // Второй вид — проектный Гантт на том же документе (без дублирования).
  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'План', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Контрольный план' })
    .click();
  const ganttPane = page.getByRole('group', { name: 'План · Контрольный план' });
  await expect(ganttPane).toBeVisible();
  const ganttDocId = await ganttPane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  expect(ganttDocId).toBe(documentId);

  const rtlPane = page.getByRole('group', { name: 'Ресурсы · Контрольный план' });
  const item = rtlPane.locator('[data-rt-task="t-d"]');
  const before = await item.evaluate((el) => el.getBoundingClientRect().left);

  // Редактирование в проектном виде: форма задачи, сдвиг начала на 2 дня.
  await ganttPane
    .locator('.plan-gantt__chart')
    .locator('.wx-row[data-id=":t-d"]')
    .dblclick();
  const dialog = ganttPane.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-task-field="start"]').fill('2026-10-22');
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).not.toBeAttached();

  // Ресурсный вид обновился без перезагрузки страницы.
  await expect(item).toBeVisible();
  const after = await item.evaluate((el) => el.getBoundingClientRect().left);
  expect(after).toBeGreaterThan(before + 20);
});
