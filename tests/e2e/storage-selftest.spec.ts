import { expect, test } from '@playwright/test';

test('самопроверка хранилища проходит в браузере', async ({ page }) => {
  await page.goto('/#storage-selftest');
  await expect(page.getByRole('heading', { name: /Самопроверка хранилища/ })).toBeVisible();

  const result = page.locator('.selftest__result');
  await expect(result).toHaveText('OK', { timeout: 15000 });

  const steps = page.locator('.selftest__steps li');
  await expect(steps).toHaveCount(6);
  for (const step of await steps.all()) {
    await expect(step).toContainText('OK');
  }

  await page.screenshot({
    path: 'openspec/changes/archive/2026-10-07-pbt-009-indexeddb-documents/screenshots/storage-selftest.png',
    fullPage: true,
  });
});
