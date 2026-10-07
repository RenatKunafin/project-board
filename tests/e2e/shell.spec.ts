import { expect, test } from '@playwright/test';

test('оболочка приложения открывается', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Project Board');
  await expect(page.getByRole('heading', { name: 'Project Board' })).toBeVisible();
});

test('каталог содержит зарегистрированный тип', async ({ page }) => {
  await page.goto('/');
  const catalog = page.getByRole('region', { name: 'Каталог типов виджетов' });
  await expect(catalog.getByText('demo')).toBeVisible();
  await expect(catalog.getByText('Панель-заглушка')).toBeVisible();
});

test('экземпляр демо-виджета получает id и настройки', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  await expect(
    instances.getByRole('heading', { name: 'Демонстрационная панель' }),
  ).toBeVisible();
  await expect(instances.getByText('w-demo-1')).toBeVisible();
});

test('неизвестный тип показывает состояние без падения приложения', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  await expect(instances.getByText('Неизвестный тип виджета')).toBeVisible();
  await expect(instances.getByText(/«checklist» не зарегистрирован/)).toBeVisible();
  // приложение продолжает работу: каталог по-прежнему виден
  await expect(page.getByText('Каталог типов виджетов: 1')).toBeVisible();
});
