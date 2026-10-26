import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-054: преобразование задачи в период недоступности (отпуск).
 * Ресурс выбирается пользователем — без угадывания по имени (D7);
 * замена атомарна: задача с назначениями и зависимостями удаляется,
 * создаётся один период; отмена ничего не меняет; после — дорожка
 * ресурса и конфликт «работа × отпуск» работают штатно.
 */
const FIXTURE_PATH =
  'tests/fixtures/gantt/onlinegantt-20261016.reference.gantt';
const IMPORTED_TITLE = 'onlinegantt-20261016.reference';
// Идентификаторы эталона: t-51 «ОТПУСК-DEV-iOS» (14–15.09, без исполнителя),
// t-50 «ОТПУСК-QA» (21.09–02.10), t-19 «ОКАД-ПСИ-iOS» (24–28.08, QA),
// t-49 «ОТПУСК-РЕНАТ» (27–31.07).

async function createPlan(page: Page, title: string): Promise<void> {
  // Новая вкладка: стартовое пространство с чек-листами сжимает панель
  // в сетке — тулбар плана не влезает; на чистой вкладке панель одна.
  await page.getByRole('button', { name: 'Новая вкладка' }).click();
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
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

async function importFixture(page: Page, sourceTitle: string): Promise<void> {
  const sourcePane = page
    .getByRole('group', { name: `План · ${sourceTitle}` })
    .first();
  await sourcePane.locator('[data-plan-menu]').click();
  await page.getByRole('menu', { name: 'Меню плана' }).getByRole('menuitem', { name: 'Импорт плана' }).click();
  await sourcePane
    .locator('[data-import-plan-input]')
    .setInputFiles(FIXTURE_PATH);
  const preview = page.getByRole('dialog', {
    name: 'Импорт плана из OnlineGantt',
  });
  await preview.locator('[data-onlinegantt-apply]').click();
  // Окно переключается на импортированный план (switchDocument).
  const pane = page
    .getByRole('group', { name: `План · ${IMPORTED_TITLE}` })
    .first();
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 47');
}

// Открытие формы по data-id строки (имена записей дублируются в эталоне,
// текстовые локаторы цепляют полосы чарта — стабилен только id строки).
async function openTaskForm(
  page: Page,
  paneName: string,
  taskId: string,
): Promise<void> {
  const pane = page.getByRole('group', { name: paneName }).first();
  const row = pane
    .locator('.plan-gantt__chart')
    .locator(`[data-id=":${taskId}"]`)
    .first();
  // Глубокие строки виртуализированы (SVAR рендерит только видимое):
  // постранично прокручиваем скроллер чарта до появления строки.
  const scroller = pane.locator('.plan-gantt__chart .wx-gantt');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await row.isVisible()) {
      break;
    }
    await scroller.evaluate((element) => {
      element.scrollTop += Math.round(element.clientHeight * 0.8);
    });
    await page.waitForTimeout(150);
  }
  await expect(row).toBeVisible();
  // Стабилизация после импорта: панель remount-ится по ревизии документа
  // (прецедент PBT-051) — жест в переходный DOM не открывает форму.
  await page.waitForTimeout(1500);
  await row.dblclick();
  await expect(
    page.getByRole('dialog', { name: 'Редактирование задачи' }),
  ).toBeVisible();
  // Возврат скролла наверх, чтобы счётчик и панель были в исходном виде.
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
}

async function convertToAbsence(
  page: Page,
  resourceTitle: string,
  dates?: { start?: string; end?: string },
): Promise<void> {
  await page
    .getByRole('dialog', { name: 'Редактирование задачи' })
    .locator('[data-task-to-absence]')
    .click();
  const convert = page.getByRole('dialog', { name: 'Преобразование в отпуск' });
  await expect(convert).toBeVisible();
  // Выбор ресурса изначально пуст (D7): предвыбора по имени нет.
  await expect(convert.locator('[data-absence-resource]')).toHaveValue('');
  await convert.locator('[data-absence-resource]').selectOption({
    label: resourceTitle,
  });
  if (dates?.start !== undefined) {
    await convert.locator('[data-absence-start]').fill(dates.start);
  }
  if (dates?.end !== undefined) {
    await convert.locator('[data-absence-end]').fill(dates.end);
  }
  await convert.locator('[data-absence-apply]').click();
}

test('преобразование: выбор ресурса, атомарная замена, дорожка и конфликт', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await createPlan(page, 'Под преобразование');
  await importFixture(page, 'Под преобразование');

  const pane = page
    .getByRole('group', { name: `План · ${IMPORTED_TITLE}` })
    .first();

  // 1. Неоднозначное имя: «ОТПУСК-DEV-iOS» при двух iOS-ресурсах —
  //    пользователь выбирает второго; даты исходные.
  await openTaskForm(page, `План · ${IMPORTED_TITLE}`, 't-51');
  await convertToAbsence(page, 'iOS-разработчик 2');
  await expect(
    page.getByRole('dialog', { name: 'Преобразование в отпуск' }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Редактирование задачи' }),
  ).not.toBeVisible();
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 46');

  // 2. Задача без исполнителя с редактированием дат: «ОТПУСК-QA» → QA,
  //    даты 22–25.09 пересекаются с работой QA «ОКАД-ПСИ-ЕФС» (22–28.09).
  await openTaskForm(page, `План · ${IMPORTED_TITLE}`, 't-50');
  await convertToAbsence(page, 'QA', { start: '2026-09-22', end: '2026-09-25' });
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 45');

  // 3. Задача с назначением: «ОКАД-ПСИ-iOS» (QA) → отпуск QA исходными
  //    датами; задача и зависимость t-18 → t-19 удаляются вместе.
  await openTaskForm(page, `План · ${IMPORTED_TITLE}`, 't-19');
  await convertToAbsence(page, 'QA');
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 44');
  await expect(pane.locator('[data-id=\":t-19\"]')).toHaveCount(0);

  // Конфликт «работа × отпуск» (D6): QA работает 22–28.09, отпуск 22–25.09.
  await pane.getByRole('button', { name: /^Проблемы/ }).click();
  const issues = page.getByRole('dialog', { name: 'Проблемы плана' });
  await expect(issues).toBeVisible();
  await expect(issues).toContainText('недоступн');
  await issues.locator('[data-issues-close]').click();

  // Отпуск на дорожке ресурса: виджет «Ресурсы» на тот же документ.
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Ресурсы' })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: IMPORTED_TITLE, exact: true })
    .click();
  const rtPane = page.getByRole('group', {
    name: `Ресурсы · ${IMPORTED_TITLE}`,
  });
  await expect(rtPane).toBeVisible();
  await expect(
    rtPane.locator('[data-rt-chart] [data-rt-unavailability]'),
  ).toHaveCount(3);
});

test('отмена сохраняет исходную строку', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await createPlan(page, 'Отмена');
  await importFixture(page, 'Отмена');

  await openTaskForm(page, `План · ${IMPORTED_TITLE}`, 't-49');
  await page
    .getByRole('dialog', { name: 'Редактирование задачи' })
    .locator('[data-task-to-absence]')
    .click();
  const convert = page.getByRole('dialog', { name: 'Преобразование в отпуск' });
  await expect(convert).toBeVisible();
  await convert.locator('[data-absence-cancel]').click();
  await expect(convert).not.toBeVisible();
  // Форма задачи осталась открыта, задача на месте.
  await expect(
    page.getByRole('dialog', { name: 'Редактирование задачи' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: `План · ${IMPORTED_TITLE}` })
      .first()
      .locator('[data-task-count]'),
  ).toHaveText('Задач: 47');
});

test('перевёрнутые даты отклоняются по месту', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await createPlan(page, 'Инверт');
  await importFixture(page, 'Инверт');

  await openTaskForm(page, `План · ${IMPORTED_TITLE}`, 't-49');
  await page
    .getByRole('dialog', { name: 'Редактирование задачи' })
    .locator('[data-task-to-absence]')
    .click();
  const convert = page.getByRole('dialog', { name: 'Преобразование в отпуск' });
  await convert.locator('[data-absence-resource]').selectOption({ label: 'QA' });
  await convert.locator('[data-absence-start]').fill('2026-09-10');
  await convert.locator('[data-absence-end]').fill('2026-09-01');
  await convert.locator('[data-absence-apply]').click();
  await expect(convert).toBeVisible();
  await expect(convert.locator('[data-absence-error]')).toContainText('раньше');
  await expect(
    page
      .getByRole('group', { name: `План · ${IMPORTED_TITLE}` })
      .first()
      .locator('[data-task-count]'),
  ).toHaveText('Задач: 47');
});

test('пустой справочник ресурсов — применения нет', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await createPlan(page, 'Без ресурсов');

  // Задача в пустом плане (справочник ресурсов пуст).
  const pane = page.getByRole('group', { name: 'План · Без ресурсов' }).first();
  await pane.getByRole('button', { name: 'Задача' }).click();
  const form = page.getByRole('dialog', { name: 'Новая задача' });
  await form.locator('[data-task-field="title"]').fill('Ручной отпуск');
  await form.locator('[data-task-field="start"]').fill('2026-10-12');
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 1');

  await pane
    .locator('.plan-gantt__chart')
    .locator('[data-id]')
    .filter({ hasText: 'Ручной отпуск' })
    .first()
    .dblclick();
  await expect(
    page.getByRole('dialog', { name: 'Редактирование задачи' }),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Редактирование задачи' })
    .locator('[data-task-to-absence]')
    .click();
  const convert = page.getByRole('dialog', { name: 'Преобразование в отпуск' });
  await expect(convert).toBeVisible();
  await expect(convert.locator('[data-absence-empty]')).toBeVisible();
  await expect(convert.locator('[data-absence-apply]')).toHaveCount(0);
});
