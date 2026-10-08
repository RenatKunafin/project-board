import { expect, test } from '@playwright/test';

test('оболочка приложения открывается', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Project Board');
  await expect(page.getByRole('heading', { name: 'Project Board' })).toBeVisible();
});

test('каталог содержит модуль чек-листа', async ({ page }) => {
  await page.goto('/');
  const catalog = page.getByRole('region', { name: 'Каталог типов виджетов' });
  await expect(catalog.getByText('checklist')).toBeVisible();
  await expect(catalog.getByText('Чек-лист')).toBeVisible();
});

test('операция синхронизирует экземпляры 1-2 и не задевает список 2', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  const pane1 = instances.getByLabel('Экземпляр 1 · Список 1');
  const pane2 = instances.getByLabel('Экземпляр 2 · Список 1');
  const pane3 = instances.getByLabel('Экземпляр 3 · Список 2');

  await pane1.getByPlaceholder('Новый пункт').fill('Из первого списка');
  await pane1.getByRole('button', { name: 'Добавить' }).click();

  await expect(pane2.getByText('Из первого списка')).toBeVisible();
  await expect(pane3.getByText('Из первого списка')).toHaveCount(0);

  await pane3.getByPlaceholder('Новый пункт').fill('Из второго списка');
  await pane3.getByRole('button', { name: 'Добавить' }).click();
  await expect(pane3.getByText('Из второго списка')).toBeVisible();
  await expect(pane1.getByText('Из второго списка')).toHaveCount(0);
});

test('локальная настройка экземпляра изолирована', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  const pane1 = instances.getByLabel('Экземпляр 1 · Список 1');
  const pane2 = instances.getByLabel('Экземпляр 2 · Список 1');

  await pane1.getByPlaceholder('Новый пункт').fill('Выполненный пункт');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await pane1.getByRole('checkbox', { name: 'Выполненный пункт' }).check();

  // Локальная настройка только у экземпляра 1.
  await pane1.getByRole('checkbox', { name: 'Скрывать выполненные' }).check();
  await expect(pane1.getByText('Выполненный пункт')).toHaveCount(0);
  await expect(pane2.getByText('Выполненный пункт')).toBeVisible();

  // Настройка экземпляра не меняет документ: индикатор остаётся «Сохранено»,
  // а снятие настройки возвращает пункт.
  await pane1
    .getByRole('checkbox', { name: 'Скрывать выполненные' })
    .uncheck();
  await expect(pane1.getByText('Выполненный пункт')).toBeVisible();
});

test('закрытие и перезагрузка сохраняют документ', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  const pane1 = instances.getByLabel('Экземпляр 1 · Список 1');

  await pane1.getByPlaceholder('Новый пункт').fill('Переживает закрытие');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();

  // Закрытие представления (unmount + отписка), документ сохранён.
  await pane1.getByRole('button', { name: 'Закрыть Экземпляр 1 · Список 1' }).click();
  await expect(instances.getByLabel('Экземпляр 1 · Список 1')).toHaveCount(0);

  await page.reload();
  const reloaded = page
    .getByRole('region', { name: 'Экземпляры виджетов' })
    .getByLabel('Экземпляр 1 · Список 1');
  await expect(reloaded.getByText('Переживает закрытие')).toBeVisible();
});
