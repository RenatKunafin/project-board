import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-056: экспорт PlantUML из интерфейса. Предпросмотр показывает
 * полный текст диаграммы и ограничения генератора; скачивание даёт
 * файл по шаблону имени; фильтры представления не влияют на экспорт
 * и не меняются; отмена ничего не трогает.
 */
const planContent = {
  title: 'Публикация',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-10-14'],
    workingExceptions: [],
  },
  workTypes: [],
  resources: [{ id: 'r1', title: 'Разработчик R1' }],
  groups: [{ id: 'g-1', title: 'Фаза 1' }],
  tasks: [
    {
      id: 't-a',
      title: 'АНЛ-Этап',
      groupId: 'g-1',
      start: '2026-10-12',
      end: '2026-10-13',
      assigneeIds: ['r1'],
    },
    {
      id: 't-b',
      title: 'DEV-Этап',
      groupId: 'g-1',
      start: '2026-10-14',
      end: '2026-10-20',
    },
    {
      id: 't-hidden',
      title: 'ТРЖ-Скрытая-фильтром',
      groupId: 'g-1',
      start: '2026-10-21',
      end: '2026-10-22',
    },
  ],
  dependencies: [
    { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 2 },
  ],
  unavailability: [],
};

async function prepare(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Новая вкладка' }).click();
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'План', exact: true })
    .click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByLabel('Название нового документа').fill('Публикация');
  await choice.getByRole('button', { name: 'Создать' }).click();
  const pane = page.getByRole('group', { name: 'План · Публикация' }).first();
  await expect(pane).toBeVisible();
  const documentId = await pane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 3');
}

test('предпросмотр: текст диаграммы и ограничения; скачивание совпадает', async ({
  page,
}) => {
  await prepare(page);
  const pane = page.getByRole('group', { name: 'План · Публикация' }).first();

  await pane.getByRole('button', { name: 'Экспорт PlantUML' }).click();
  const dialog = page.getByRole('dialog', { name: 'Экспорт PlantUML' });
  await expect(dialog).toBeVisible();

  const text = dialog.locator('[data-plantuml-text]');
  const content = (await text.textContent()) ?? '';
  expect(content.trimStart().startsWith('@startgantt')).toBe(true);
  expect(content.trimEnd().endsWith('@endgantt')).toBe(true);
  expect(content).toContain('title Публикация');
  expect(content).toContain('[АНЛ-Этап] as [T1] requires 2 days');
  expect(content).toContain('-- Фаза 1 --');
  expect(content).toContain('2026/10/14 is closed');
  // Ограничения: лаг связи и сводная полоса групп — в отчёте.
  await expect(dialog.locator('[data-plantuml-report]')).toContainText('лаг');
  await expect(dialog.locator('[data-plantuml-report]')).toContainText('Сводная полоса');

  // Скачивание: шаблон имени и совпадение содержимого.
  const downloadPromise = page.waitForEvent('download');
  await dialog.locator('[data-plantuml-download]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^pb-plantuml-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.puml$/,
  );
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const saved = readFileSync(path as string, 'utf8');
  expect(saved).toBe(content);
});

test('фильтр не влияет на экспорт и не меняется', async ({ page }) => {
  await prepare(page);
  const pane = page.getByRole('group', { name: 'План · Публикация' }).first();

  // Скрываем часть задач фильтром.
  await pane.locator('[data-gantt-filter-query]').fill('АНЛ');
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 3');

  await pane.getByRole('button', { name: 'Экспорт PlantUML' }).click();
  const dialog = page.getByRole('dialog', { name: 'Экспорт PlantUML' });
  await expect(dialog).toBeVisible();

  // Полный состав: скрытая фильтром задача в тексте.
  const content = (await dialog.locator('[data-plantuml-text]').textContent()) ?? '';
  expect(content).toContain('ТРЖ-Скрытая-фильтром');
  expect(content).toContain('DEV-Этап');

  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  // Фильтр не изменился, документ цел.
  await expect(pane.locator('[data-gantt-filter-query]')).toHaveValue('АНЛ');
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 3');
});

test('отмена не меняет документ; повторный экспорт идентичен', async ({
  page,
}) => {
  await prepare(page);
  const pane = page.getByRole('group', { name: 'План · Публикация' }).first();

  await pane.getByRole('button', { name: 'Экспорт PlantUML' }).click();
  const dialog = page.getByRole('dialog', { name: 'Экспорт PlantUML' });
  await expect(dialog).toBeVisible();
  const first = await dialog.locator('[data-plantuml-text]').textContent();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await pane.getByRole('button', { name: 'Экспорт PlantUML' }).click();
  const second = await dialog.locator('[data-plantuml-text]').textContent();
  expect(second).toBe(first);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 3');
});
