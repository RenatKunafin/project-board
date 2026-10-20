import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-051: импорт и экспорт собственного формата в UI. Экспорт скачивает
 * файл pb-plan-YYYY-MM-DD_HH-mm-ss.json; импорт валидирует файл до создания
 * документа, создаёт новый независимый план и переключает окно на него.
 * Отмена выбора файла ничего не меняет; повторный импорт не перезаписывает.
 */
const planContent = {
  title: 'Перенос',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-10-14'],
    workingExceptions: [],
  },
  workTypes: [{ id: 'dev', title: 'Разработка', allowsParallel: false }],
  resources: [{ id: 'r1', title: 'Разработчик R1' }],
  groups: [{ id: 'g-1', title: 'Фаза 1' }],
  tasks: [
    {
      id: 't-a',
      title: 'Задача A',
      groupId: 'g-1',
      start: '2026-10-12',
      end: '2026-10-16',
      assigneeIds: ['r1'],
      workTypeIds: ['dev'],
    },
    {
      id: 't-b',
      title: 'Задача B',
      groupId: 'g-1',
      start: '2026-10-19',
      end: '2026-10-20',
    },
  ],
  dependencies: [{ id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 }],
  unavailability: [
    { id: 'u-1', resourceId: 'r1', start: '2026-10-26', end: '2026-10-27' },
  ],
};

async function createPlan(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'План', exact: true })
    .click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByLabel('Название нового документа').fill(title);
  await choice.getByRole('button', { name: 'Создать' }).click();
  await expect(
    page.getByRole('group', { name: `План · ${title}` }).first(),
  ).toBeVisible();
}

async function loadPlan(page: Page, documentId: string): Promise<void> {
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
}

async function expectTaskCount(
  page: Page,
  title: string,
  expected: string,
): Promise<void> {
  await expect(
    page
      .getByRole('group', { name: `План · ${title}` })
      .first()
      .locator('[data-task-count]'),
  ).toHaveText(expected);
}

async function openCatalog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Каталог документов' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Каталог документов' }),
  ).toBeVisible();
}

test('экспортированный файл переносится в чистый контекст и редактируется', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await createPlan(page, 'Перенос');
  const pane = page
    .getByRole('group', { name: 'План · Перенос' })
    .first();
  const documentId = await pane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  expect(documentId).not.toBeNull();
  await loadPlan(page, documentId as string);
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 2');

  // Экспорт: скачивание с именем по шаблону и содержимым формата.
  const downloadPromise = page.waitForEvent('download');
  await pane.getByRole('button', { name: 'Экспорт плана' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^pb-plan-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/,
  );
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(readFileSync(path as string, 'utf8')) as {
    format: string;
    title: string;
    content: { tasks: unknown[] };
  };
  expect(exported.format).toBe('project-board-plan');
  expect(exported.title).toBe('Перенос');
  expect(exported.content.tasks).toHaveLength(2);

  // Чистый контекст: тот же файл импортируется и план редактируется.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto('/');
  await createPlan(otherPage, 'Чужой план');
  const otherPane = otherPage
    .getByRole('group', { name: 'План · Чужой план' })
    .first();
  await otherPane.getByRole('button', { name: 'Импорт плана' }).click();
  await otherPane
    .locator('[data-import-plan-input]')
    .setInputFiles(path as string);
  // Окно переключается на импортированный план: подпись панели меняется,
  // результат импорта ищется на странице, а не в панели старого названия.
  await expect(otherPage.locator('[data-import-plan-result]')).toContainText(
    'импортирован',
  );
  await expect(
    otherPage.getByRole('group', { name: 'План · Перенос' }).first(),
  ).toBeVisible();
  await expectTaskCount(otherPage, 'Перенос', 'Задач: 2');

  // Продолжение редактирования импортированного плана.
  await otherPage
    .getByRole('group', { name: 'План · Перенос' })
    .first()
    .getByRole('button', { name: 'Задача' })
    .click();
  const dialog = otherPage.getByRole('dialog', { name: 'Новая задача' });
  await dialog.locator('[data-task-field="title"]').fill('После импорта');
  await dialog.locator('[data-task-field="start"]').fill('2026-11-02');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expectTaskCount(otherPage, 'Перенос', 'Задач: 3');

  await openCatalog(otherPage);
  await expect(
    otherPage
      .getByRole('dialog', { name: 'Каталог документов' })
      .getByText('Перенос', { exact: true }),
  ).toBeVisible();
  await otherContext.close();
});

test('битый файл даёт диагностику и не создаёт документ', async ({ page }) => {
  await page.goto('/');
  await createPlan(page, 'Ошибки');
  const pane = page.getByRole('group', { name: 'План · Ошибки' }).first();
  await pane.getByRole('button', { name: 'Импорт плана' }).click();
  await pane.locator('[data-import-plan-input]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format": "project-board-plan"'),
  });
  const result = pane.locator('[data-import-plan-result]');
  await expect(result).toContainText('Файл не импортирован');
  await expect(result).toContainText('invalid-json');

  await openCatalog(page);
  const catalog = page.getByRole('dialog', { name: 'Каталог документов' });
  await expect(catalog.getByText('Ошибки', { exact: true })).toHaveCount(1);
});

test('повторный импорт создаёт независимый план, окно на последнем', async ({
  page,
}) => {
  await page.goto('/');
  await createPlan(page, 'Двойной');
  const pane = page.getByRole('group', { name: 'План · Двойной' }).first();
  const documentId = await pane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  expect(documentId).not.toBeNull();
  await loadPlan(page, documentId as string);

  const file = {
    name: 'plan.json',
    mimeType: 'application/json',
    // Конверт формата (PBT-050): title и content — части оболочки файла.
    buffer: Buffer.from(
      JSON.stringify({
        format: 'project-board-plan',
        formatVersion: 1,
        title: 'Повтор',
        schemaVersion: 1,
        content: planContent,
      }),
      'utf8',
    ),
  };

  // Первый импорт; исходный план переименовывается, чтобы различить.
  await pane.getByRole('button', { name: 'Импорт плана' }).click();
  await pane.locator('[data-import-plan-input]').setInputFiles(file);
  await expect(
    page.getByRole('group', { name: 'План · Повтор' }).first(),
  ).toBeVisible();
  await openCatalog(page);
  const catalog = page.getByRole('dialog', { name: 'Каталог документов' });
  await catalog
    .getByRole('button', { name: 'Переименовать «Повтор»' })
    .click();
  await catalog.getByLabel('Новое название документа').fill('Повтор первый');
  await catalog.getByRole('button', { name: 'Сохранить' }).click();
  await page.getByRole('button', { name: 'Каталог документов' }).click();

  // Повторный импорт того же файла: окно на новом документе, прежний цел.
  const secondPane = page
    .getByRole('group', { name: 'План · Повтор' })
    .first();
  await secondPane.getByRole('button', { name: 'Импорт плана' }).click();
  await secondPane.locator('[data-import-plan-input]').setInputFiles(file);
  await expect(
    page.getByRole('group', { name: 'План · Повтор' }).first(),
  ).toBeVisible();
  await expectTaskCount(page, 'Повтор', 'Задач: 2');

  await openCatalog(page);
  const catalogAfter = page.getByRole('dialog', { name: 'Каталог документов' });
  // Документы: исходный «Двойной», первый импорт «Повтор первый»,
  // второй импорт «Повтор» — перезаписи нет, названия из файла.
  await expect(
    catalogAfter.getByText('Повтор первый', { exact: true }),
  ).toHaveCount(1);
  await expect(
    catalogAfter.getByText('Повтор', { exact: true }),
  ).toHaveCount(1);
  await expect(
    catalogAfter.getByText('Двойной', { exact: true }),
  ).toHaveCount(1);
});

test('отмена выбора файла не меняет данные', async ({ page }) => {
  await page.goto('/');
  await createPlan(page, 'Отмена');
  const pane = page.getByRole('group', { name: 'План · Отмена' }).first();

  const chooserPromise = page.waitForEvent('filechooser');
  await pane.getByRole('button', { name: 'Импорт плана' }).click();
  const chooser = await chooserPromise;
  // Диалог закрыт без выбора файла: change не срабатывает, состояние не меняется.
  await page.keyboard.press('Escape');

  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 0');
  await expect(pane.locator('[data-import-plan-result]')).toHaveCount(0);
  expect(chooser.isMultiple()).toBe(false);
});
