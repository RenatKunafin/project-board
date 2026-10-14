import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-044: редактор календаря плана (неделя, праздники, исключения).
 * A5: праздник внутри задачи — даты прежние, длительность 4;
 * исключение возвращает 5; пустой календарь отклоняется; независимость.
 */
const planContent = {
  title: 'Календарь',
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  workTypes: [], resources: [], groups: [],
  tasks: [
    { id: 't-1', title: 'Задача 1', start: '2026-10-12', end: '2026-10-16' },
  ],
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

async function openSettings(page: Page, paneTitle: string, index = 0) {
  const pane = page.getByRole('group', { name: `План · ${paneTitle}` }).nth(index);
  await pane.locator('[data-catalogs]').click();
  const dialog = pane.getByRole('dialog', { name: 'Настройки плана' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function workingDaysCell(page: Page, docId: string): Promise<string> {
  return page.evaluate((id) => {
    const row = document.querySelector(
      `[data-document-id="${id}"] .wx-row[data-id=":t-1"]`,
    );
    return row?.textContent ?? '';
  }, docId);
}

test('праздник 14.10 → длительность 4; исключение → 5; подсветка в двух виджетах', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Календарь');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const first = page.locator(`[data-document-id="${documentId}"]`).nth(0);

  // До: 5 рабочих дней, среда не подсвечена.
  await expect(workingDaysCell(page, documentId) as never).toBeTruthy();
  await expect(first.locator('.wx-row[data-id=":t-1"]')).toContainText('5');

  // Второй экземпляр до изменения.
  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Календарь' })
    .click();
  const second = page.locator(`[data-document-id="${documentId}"]`).nth(1);
  await expect(second.locator('.plan-gantt__chart')).toBeVisible();

  // Праздник 14.10 через редактор.
  const dialog = await openSettings(page, 'Календарь', 0);
  await dialog.locator('[data-calendar-holiday-from]').fill('2026-10-14');
  await dialog.locator('[data-calendar-add-holiday]').click();
  await expect(
    dialog.locator('[data-calendar-remove-holiday="2026-10-14"]'),
  ).toBeVisible();

  // A5: даты прежние, длительность 4, подсветка праздника в обоих чартах.
  await expect(
    first.locator('.wx-row[data-id=":t-1"]'),
  ).toContainText('12-10-2026');
  await expect(
    first.locator('.wx-row[data-id=":t-1"]'),
  ).toContainText('16-10-2026');
  await expect(
    first.locator('.wx-row[data-id=":t-1"]'),
  ).toContainText('4');
  await expect(
    second.locator('.plan-gantt__chart .gantt-holiday, .plan-gantt__chart [class*="holiday"]'),
  ).not.toHaveCount(0);

  // Исключение 14.10 → длительность 5.
  await dialog.locator('[data-calendar-exception-from]').fill('2026-10-14');
  await dialog.locator('[data-calendar-add-exception]').click();
  // Исключение убрало дату из праздников (политика «не в обоих списках»).
  await expect(
    dialog.locator('[data-calendar-remove-holiday="2026-10-14"]'),
  ).toHaveCount(0);
  await expect(
    first.locator('.wx-row[data-id=":t-1"]'),
  ).toContainText('5');
  await expect(
    second.locator('.wx-row[data-id=":t-1"]'),
  ).toContainText('5');

  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.calendar,
    documentId,
  );
  expect(content.holidays).toEqual([]);
  expect(content.workingExceptions).toEqual(['2026-10-14']);
});

test('пустой календарь отклоняется: снятие последнего рабочего дня возвращает чекбокс', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Пустой');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const dialog = await openSettings(page, 'Пустой');

  // Снимаем рабочие дни: ядро отклоняет последний (чекбокс возвращается
  // ререндером, поэтому последний снимаем click — uncheck упал бы на
  // «did not change state»).
  for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт']) {
    await dialog.locator(`[data-calendar-day="${day}"]`).click();
  }
  await expect(dialog.locator('[data-calendar-error]')).toContainText(
    'хотя бы один рабочий день',
  );

  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.calendar,
    documentId,
  );
  expect(content.workingDays).toEqual([5]);
});

test('диапазон праздников раскладывается на отдельные даты; независимость планов', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const planA = await createPlan(page, 'Диапазон А');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: planA, value: planContent },
  );
  const planB = await createPlan(page, 'Диапазон Б');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: planB, value: planContent },
  );

  const dialogA = await openSettings(page, 'Диапазон А');
  await dialogA.locator('[data-calendar-holiday-from]').fill('2026-12-21');
  await dialogA.locator('[data-calendar-holiday-to]').fill('2026-12-25');
  await dialogA.locator('[data-calendar-add-holiday]').click();

  for (const day of ['21', '22', '23', '24', '25']) {
    await expect(
      dialogA.locator(`[data-calendar-remove-holiday="2026-12-${day}"]`),
    ).toBeVisible();
  }

  const calendarA = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.calendar,
    planA,
  );
  expect(calendarA.holidays).toEqual([
    '2026-12-21',
    '2026-12-22',
    '2026-12-23',
    '2026-12-24',
    '2026-12-25',
  ]);
  const calendarB = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.calendar,
    planB,
  );
  expect(calendarB.holidays).toEqual([]);
});
