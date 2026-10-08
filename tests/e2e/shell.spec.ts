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

test('добавленный пункт появляется в обоих экземплярах', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  const pane1 = instances.getByLabel('Экземпляр 1');
  const pane2 = instances.getByLabel('Экземпляр 2');

  await pane1.getByPlaceholder('Новый пункт').fill('Купить молоко');
  await pane1.getByRole('button', { name: 'Добавить' }).click();

  await expect(pane1.getByText('Купить молоко')).toBeVisible();
  await expect(pane2.getByText('Купить молоко')).toBeVisible();
});

test('отметка выполнения и удаление работают', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  const pane1 = instances.getByLabel('Экземпляр 1');
  const pane2 = instances.getByLabel('Экземпляр 2');

  await pane1.getByPlaceholder('Новый пункт').fill('Временная задача');
  await pane1.getByRole('button', { name: 'Добавить' }).click();

  await pane1.getByRole('checkbox').check();
  await expect(pane2.locator('.checklist__text.is-done')).toHaveText(
    'Временная задача',
  );

  await pane1.getByRole('button', { name: 'Удалить: Временная задача' }).click();
  await expect(pane1.getByText('Временная задача')).toHaveCount(0);
  await expect(pane2.getByText('Временная задача')).toHaveCount(0);
});

test('неизвестный тип показывает состояние без падения приложения', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  await expect(instances.getByText('Неизвестный тип виджета')).toBeVisible();
  await expect(page.getByText('Каталог типов виджетов: 1')).toBeVisible();
});
