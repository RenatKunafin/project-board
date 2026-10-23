import { expect, test } from '@playwright/test';

// Спека PBT-072: каркас дашборда — топ-бар с индикатором сохранения,
// карточки каталога виджетов с описаниями, счётчик открытых окон в каталоге
// документов, пустое состояние с действием (delta specs workspace-tabs,
// widget-registry, document-management).

test('топ-бар показывает название и индикатор сохранения', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const topbar = page.locator('.app-topbar');

  await expect(topbar).toBeVisible();
  await expect(topbar.getByRole('heading', { level: 1 })).toHaveText(
    'Project Board',
  );

  // Сводный индикатор (design D9): после старта всё восстановлено — «Сохранено».
  const indicator = topbar.getByRole('status', { name: 'Состояние сохранения' });
  await expect(indicator).toHaveText('Сохранено');

  // Правка документа, отличного от «Список 1» (прежде индикатор следил
  // только за ним): дебаунс записи 250 мс — «Сохраняется…» наблюдаемо.
  const pane = page.getByRole('group', { name: 'Экземпляр 3 · Список 2' });
  await pane.getByPlaceholder('Новая задача…').fill('Топ-бар виден');
  await pane.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(indicator).toHaveText('Сохраняется…');
  await expect(indicator).toHaveText('Сохранено', { timeout: 5000 });

  // Индикатор не врёт: после reload правка на месте.
  await page.reload();
  await expect(
    page
      .getByRole('group', { name: 'Экземпляр 3 · Список 2' })
      .getByText('Топ-бар виден'),
  ).toBeVisible();
});

test('каталог виджетов показывает карточки с описаниями', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();

  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await expect(catalog).toBeVisible();

  await expect(
    catalog.getByText('Диаграмма Ганта: задачи, сроки, зависимости'),
  ).toBeVisible();

  // Поиск находит тип и по тексту описания.
  await catalog.getByLabel('Поиск виджета').fill('загрузк');
  await expect(catalog.getByText('Загрузка и отсутствия команды')).toBeVisible();
  await expect(catalog.getByText('Диаграмма Ганта: задачи, сроки, зависимости')).toBeHidden();
});

test('каталог документов показывает счётчик открытых окон', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();

  await page.getByRole('button', { name: 'Каталог документов' }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог документов' });

  // Список 1 открыт в двух экземплярах дефолтного среза.
  await expect(catalog.getByText('Чек-лист · открыт в 2 окнах')).toBeVisible();
});

test('пустая вкладка показывает состояние с кнопкой каталога', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();

  await expect(page.getByText('Пустой дашборд')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить виджет на вкладку' }).click();

  await expect(
    page.getByRole('dialog', { name: 'Каталог виджетов' }),
  ).toBeVisible();
});
