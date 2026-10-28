import { expect, test } from '@playwright/test';

test('журнал выпусков открывается из настроек и содержит архивные версии', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Что нового', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Что нового' });
  await expect(dialog.getByRole('heading', { name: 'v1.0.2' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'v1.0.0', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/release-notes.png' });
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
