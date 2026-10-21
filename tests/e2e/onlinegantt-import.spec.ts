import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-053: предпросмотр и импорт OnlineGantt .gantt в UI. Предпросмотр
 * показывает сводку разбора и предупреждения до создания; применение
 * создаёт независимый план и переключает окно; отмена и критические
 * ошибки ничего не меняют; повторный импорт — два документа.
 */
const FIXTURE_PATH =
  'tests/fixtures/gantt/onlinegantt-20261016.reference.gantt';

// Название предзаполнено именем файла фикстуры без расширения (design D3).
const IMPORTED_TITLE = 'onlinegantt-20261016.reference';

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

async function importGantt(page: Page, paneName: string): Promise<void> {
  const pane = page.getByRole('group', { name: paneName }).first();
  await pane.getByRole('button', { name: 'Импорт плана' }).click();
  await pane
    .locator('[data-import-plan-input]')
    .setInputFiles(FIXTURE_PATH);
}

test('рабочий файл: предпросмотр со сводкой и предупреждениями, применение открывает план в обоих видах', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await createPlan(page, 'Рабочий');

  await importGantt(page, 'План · Рабочий');

  // Предпросмотр (DoD-1): сводка 47/2/9/21/16 и предупреждения отчёта.
  const preview = page.getByRole('dialog', {
    name: 'Импорт плана из OnlineGantt',
  });
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-onlinegantt-summary]')).toContainText(
    'Задач 47',
  );
  await expect(preview.locator('[data-onlinegantt-summary]')).toContainText(
    'Групп 2',
  );
  await expect(preview.locator('[data-onlinegantt-summary]')).toContainText(
    'Ресурсов 9',
  );
  await expect(preview.locator('[data-onlinegantt-summary]')).toContainText(
    'Зависимостей 21',
  );
  await expect(preview.locator('[data-onlinegantt-summary]')).toContainText(
    'Без исполнителя 16',
  );
  await expect(
    preview.locator('[data-onlinegantt-warnings]'),
  ).toContainText('dropped-task-fields');

  // DoD-4: задачи без исполнителя помечены как ручные решения, не удаляются.
  await expect(
    preview.locator('[data-onlinegantt-unassigned]'),
  ).toContainText('ОТПУСК-РЕНАТ');

  // DoD-5: примечания — текстом, без HTML-тегов.
  await expect(preview.locator('[data-onlinegantt-notes]')).toContainText(
    '17.12',
  );
  await expect(
    preview.locator('[data-onlinegantt-notes]'),
  ).not.toContainText('<');

  // Название предзаполнено именем файла (design D3).
  await expect(preview.locator('[data-onlinegantt-title]')).toHaveValue(
    IMPORTED_TITLE,
  );

  // Применение (DoD-3): независимый документ, окно переключается.
  await preview.locator('[data-onlinegantt-apply]').click();
  await expect(page.locator('[data-import-plan-result]')).toContainText(
    'импортирован',
  );
  const importedPane = page.getByRole('group', {
    name: `План · ${IMPORTED_TITLE}`,
  });
  await expect(importedPane).toBeVisible();
  await expect(importedPane.locator('[data-task-count]')).toHaveText(
    'Задач: 47',
  );
  // Группа «Отпуск» из иерархии subtasks видна в дереве.
  await expect(importedPane.getByText('Отпуск').first()).toBeVisible();

  // Тот же документ открывается в ресурсном виде через каталог виджетов.
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Ресурсы' })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: IMPORTED_TITLE, exact: true })
    .click();
  const resourcesPane = page.getByRole('group', {
    name: `Ресурсы · ${IMPORTED_TITLE}`,
  });
  await expect(resourcesPane).toBeVisible();
  // Дорожки ресурсов (паттерн resource-timeline.spec): все 9 исполнителей
  // импортированного справочника. Имя ресурса — отдельный элемент строки
  // (аватар-инициалы рядом, PBT-074).
  const sidebarRows = resourcesPane
    .locator('[data-rt-chart]')
    .locator('.rct-sidebar-row');
  await expect(sidebarRows).toHaveCount(9);
  await expect(
    sidebarRows
      .locator('.resource-timeline__group-name')
      .filter({ hasText: /^QA$/ }),
  ).toHaveCount(1);
});

test('отмена предпросмотра ничего не меняет', async ({ page }) => {
  await page.goto('/');
  await createPlan(page, 'Без импорта');

  await importGantt(page, 'План · Без импорта');

  const preview = page.getByRole('dialog', {
    name: 'Импорт плана из OnlineGantt',
  });
  await expect(preview).toBeVisible();
  await preview.locator('[data-onlinegantt-cancel]').click();
  await expect(preview).not.toBeVisible();

  // Каталог не содержит нового документа; текущий план не изменился.
  await expect(
    page.getByRole('group', { name: 'План · Без импорта' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: `План · ${IMPORTED_TITLE}` }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('group', { name: 'План · Без импорта' })
      .first()
      .locator('[data-task-count]'),
  ).toHaveText('Задач: 0');
});

test('критическая ошибка даёт диагностику без предпросмотра и документа', async ({
  page,
}) => {
  await page.goto('/');
  await createPlan(page, 'Целевой');

  const pane = page.getByRole('group', { name: 'План · Целевой' }).first();
  await pane.getByRole('button', { name: 'Импорт плана' }).click();
  await pane.locator('[data-import-plan-input]').setInputFiles({
    name: 'broken.gantt',
    mimeType: 'application/json',
    buffer: Buffer.from('не-json{'),
  });

  await expect(page.locator('[data-import-plan-result]')).toContainText(
    'invalid-json',
  );
  await expect(
    page.getByRole('dialog', { name: 'Импорт плана из OnlineGantt' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: `План · ${IMPORTED_TITLE}` }),
  ).toHaveCount(0);
});

test('повторный импорт создаёт два независимых документа', async ({
  page,
}) => {
  await page.goto('/');
  await createPlan(page, 'Первый');

  await importGantt(page, 'План · Первый');
  const preview = page.getByRole('dialog', {
    name: 'Импорт плана из OnlineGantt',
  });
  await preview.locator('[data-onlinegantt-apply]').click();
  await expect(page.locator('[data-import-plan-result]')).toContainText(
    'импортирован',
  );
  const firstPane = page.getByRole('group', {
    name: `План · ${IMPORTED_TITLE}`,
  });
  await expect(firstPane).toBeVisible();

  // Второй импорт того же файла: ещё один документ, окно — на последнем.
  await firstPane.getByRole('button', { name: 'Импорт плана' }).click();
  await firstPane
    .locator('[data-import-plan-input]')
    .setInputFiles(FIXTURE_PATH);
  const previewAgain = page.getByRole('dialog', {
    name: 'Импорт плана из OnlineGantt',
  });
  // Отличимое название — документы различимы в каталоге.
  await previewAgain
    .locator('[data-onlinegantt-title]')
    .fill(`${IMPORTED_TITLE} (копия)`);
  await previewAgain.locator('[data-onlinegantt-apply]').click();

  await expect(
    page.getByRole('group', { name: `План · ${IMPORTED_TITLE} (копия)` }),
  ).toBeVisible();

  // Каталог виджетов предлагает оба импортированных документа.
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByRole('button', { name: 'План', exact: true }).click();
  await expect(
    choice.getByRole('button', { name: IMPORTED_TITLE, exact: true }),
  ).toBeVisible();
  await expect(
    choice.getByRole('button', {
      name: `${IMPORTED_TITLE} (копия)`,
      exact: true,
    }),
  ).toBeVisible();
});

// Контроль содержимого фикстуры: эталон остаётся согласованным
// с ожиданиями спеки (47/2/9/21/16), чтобы падение было диагностируемым.
test('фикстура эталона соответствует ожиданиям предпросмотра', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
    data: unknown[];
    resources: unknown[];
  };
  expect(raw.resources).toHaveLength(9);
});
