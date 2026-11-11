import { expect, test } from './app-test';

test('обычная production-сборка не отправляет визиты Метрики', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('mc.yandex.ru')) requests.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Project Board', exact: true })).toBeVisible();
  expect(await page.locator('#project-board-yandex-metrika').count()).toBe(0);
  expect(await page.evaluate(() => 'dataLayer' in window)).toBe(false);
  expect(requests).toEqual([]);
});
