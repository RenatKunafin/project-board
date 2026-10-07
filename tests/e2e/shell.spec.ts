import { expect, test } from '@playwright/test';

test('оболочка приложения открывается', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Project Board');
  await expect(page.getByRole('heading', { name: 'Project Board' })).toBeVisible();
});
