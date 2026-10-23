import { expect, test } from '@playwright/test';

test('каскад первый и выбран по умолчанию, сохранённая сетка сохраняется после reload', async ({ page }) => {
  await page.goto('/');
  const modes = page.getByRole('group', { name: 'Режим размещения' });
  await expect(modes.getByRole('button')).toHaveText(['Каскад', 'Сетка']);
  await expect(modes.getByRole('button', { name: 'Каскад', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cascade-layout')).toBeVisible();
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await expect(modes.getByRole('button', { name: 'Каскад', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await modes.getByRole('button', { name: 'Сетка', exact: true }).click();
  // Снимок структуры рабочего пространства записывается с дебаунсом 300мс.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(modes.getByRole('button', { name: 'Сетка', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await expect(modes.getByRole('button', { name: 'Каскад', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
