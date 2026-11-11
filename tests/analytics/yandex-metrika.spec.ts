import { expect, test } from '../app-test';

test('release-сборка загружает один счётчик с временным Вебвизором', async ({ page, context }) => {
  const requests: string[] = [];
  await page.route('https://mc.yandex.ru/**', async route => {
    requests.push(route.request().url());
    await route.abort();
  });

  await page.goto('/?private-document=must-not-be-sent#local-view');
  await expect(page.getByRole('heading', { name: 'Project Board', exact: true })).toBeVisible();
  await expect.poll(() => requests.filter(url => url.includes('/metrika/tag.js')).length).toBe(1);
  expect(await page.locator('#project-board-yandex-metrika').count()).toBe(1);

  const queued = await page.evaluate(() => {
    const ym = (window as Window & { ym?: { a?: unknown[][] } }).ym;
    return ym?.a?.[0];
  });
  expect(queued).toEqual([
    113967203,
    'init',
    expect.objectContaining({
      webvisor: true,
      clickmap: true,
      trackLinks: true,
      ecommerce: 'dataLayer',
      url: 'http://127.0.0.1:4174/',
    }),
  ]);
  expect(await page.evaluate(() => 'dataLayer' in window)).toBe(false);

  await page.getByRole('button', { name: 'Каталог документов', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Каталог документов' })).toBeVisible();
  await page.keyboard.press('Escape');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Каталог документов', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Каталог документов' })).toBeVisible();
  expect(requests.filter(url => url.includes('/metrika/tag.js'))).toHaveLength(1);
});
