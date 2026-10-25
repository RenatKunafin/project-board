import { createDocumentWindow } from '../e2e/document-ui';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { persistedDocument, storedWorkspace } from '../e2e/workspace-helper';

const base = '/project-board/';
const origin = 'http://localhost:4187';
const first = (page: Page) => page.getByRole('group', { name: 'Чек-лист · Список 1', exact: true });
const offlineStatus = (page: Page) => page.getByRole('status', { name: 'Готовность к офлайн-работе' });
const notification = (page: Page) => page.getByRole('status', { name: 'Обновление приложения', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Обновление Project Board' });
async function publish(request: APIRequestContext, version: string) {
  expect((await request.post(`${origin}/__pages/version?value=${version}`)).ok()).toBe(true);
}
async function ready(page: Page) {
  await expect(offlineStatus(page)).toHaveText('Готово к работе офлайн');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}
async function savedWorkspace(page: Page) {
  await expect.poll(async () => {
    const state = await storedWorkspace(page);
    return state.tabs.length === 1 && state.tabs[0]?.mode === 'grid' && state.widgetInstances.length === 1;
  }).toBe(true);
}
async function allFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...(await allFiles(join(directory, entry.name))).map(file => `${entry.name}/${file}`));
    else files.push(entry.name);
  }
  return files;
}

test('реальный Pages-артефакт: все URL в подпути, manifest/scope, сохранение и offline без HTTP-кэша', async ({ page, context, request }) => {
  await publish(request, 'production');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('./');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await ready(page);
  await expect(page.getByText('Пустой дашборд', { exact: true })).toBeVisible();
  expect((await storedWorkspace(page)).documents).toEqual([]);
  await createDocumentWindow(page, 'Чек-лист', 'Список 1');
  const cdp = await context.newCDPSession(page);
  const manifestData = await cdp.send('Page.getAppManifest');
  const installability = await cdp.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
  expect(manifestData.errors).toEqual([]);
  const manifest = JSON.parse(manifestData.data);
  expect(new URL(manifest.start_url, manifestData.url).pathname).toBe(base);
  expect(new URL(manifest.id, origin).pathname).toBe(base);
  expect(new URL(manifest.scope, manifestData.url).pathname).toBe(base);
  // Проверяем браузерную обработку, не только свою интерпретацию JSON.
  expect(manifestData.manifest?.id).toBe(origin + base);
  expect(manifestData.manifest?.startUrl).toBe(origin + base);
  expect(manifestData.manifest?.scope).toBe(origin + base);
  expect(await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return { scope: registration?.scope, script: registration?.active?.scriptURL };
  })).toEqual({ scope: origin + base, script: `${origin}${base}sw.js` });

  const files = await allFiles('apps/project-board/dist');
  for (const file of files) expect((await request.get(origin + base + file)).status(), file).toBe(200);
  expect((await request.get(origin + '/assets/' + files.find(file => file.startsWith('assets/'))!.slice(7))).status()).toBe(404);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name =>
    (await (await caches.open(name)).keys()).map(entry => new URL(entry.url).pathname),
  ))).flat());
  for (const file of files.filter(file => file !== 'sw.js' && !file.startsWith('workbox-') && /\.(?:html|js|css|woff2?|svg|png|webmanifest)$/.test(file))) {
    expect(cached, file).toContain(base + file);
  }
  await first(page).getByPlaceholder('Новая задача…').fill('Сохранено под подпутём');
  await first(page).getByRole('button', { name: 'Добавить', exact: true }).click();
  await persistedDocument(page, 'Список 1', { items: [{ text: 'Сохранено под подпутём' }] });
  await savedWorkspace(page);
  await page.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  const noCache = await context.newCDPSession(reopened);
  await noCache.send('Network.enable');
  await noCache.send('Network.setCacheDisabled', { cacheDisabled: true });
  await reopened.goto('./');
  await expect(first(reopened).getByText('Сохранено под подпутём')).toBeVisible();
  await expect(offlineStatus(reopened)).toHaveText('Готово к работе офлайн');
  expect(new URL(reopened.url()).pathname).toBe(base);
  expect(errors).toEqual([]);
});

test('Pages A → B → A: старая подготовленная сессия, явное обновление и совместимый возврат без старых файлов на сервере', async ({ page, context, request }) => {
  await publish(request, 'A');
  await page.goto('./');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await ready(page);
  await expect(page.getByText('Пустой дашборд', { exact: true })).toBeVisible();
  expect((await storedWorkspace(page)).documents).toEqual([]);
  await createDocumentWindow(page, 'Чек-лист', 'Список 1');
  await first(page).getByPlaceholder('Новая задача…').fill('Данные между релизами');
  await first(page).getByRole('button', { name: 'Добавить', exact: true }).click();
  await first(page).getByRole('button', { name: 'Скрыть выполненные' }).click();
  await persistedDocument(page, 'Список 1', { items: [{ text: 'Данные между релизами' }] });
  await savedWorkspace(page);
  const instanceId = (await storedWorkspace(page)).widgetInstances[0].id;
  await expect.poll(async () => ((await storedWorkspace(page)).settings.find(row => row.key === `view:${instanceId}`)?.value as { hideDone?: boolean })?.hideDone).toBe(true);
  const id = await first(page).locator('[data-document-id]').getAttribute('data-document-id');
  expect(id).toBeTruthy();
  const before = await page.evaluate(id => window.__projectBoard!.readDocument(id!), id);
  for (const [previous, version] of [['A', 'B'], ['B', 'A']]) {
    await publish(request, version);
    expect((await request.get(`${origin}${base}assets/pages-generation-${previous}.js`)).status()).toBe(404);
    expect(await page.evaluate(async previous => (await fetch(`./assets/pages-generation-${previous}.js`)).status, previous)).toBe(200);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(notification(page)).toContainText('Доступна новая версия');
    await expect(page.locator('meta[name="pbt-pages-version"]')).toHaveAttribute('content', previous);
    await notification(page).getByRole('button', { name: 'Обновить', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.locator('meta[name="pbt-pages-version"]')).toHaveAttribute('content', version);
    await ready(page);
    await expect(first(page).getByText('Данные между релизами')).toBeVisible();
    await expect(first(page).getByRole('button', { name: 'Показать выполненные' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(id => window.__projectBoard!.readDocument(id!), id)).toEqual(before);
    const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name =>
      (await (await caches.open(name)).keys()).map(entry => new URL(entry.url).pathname),
    ))).flat());
    expect(cached).toContain(`${base}assets/pages-generation-${version}.js`);
    expect(cached).not.toContain(`${base}assets/pages-generation-${previous}.js`);
  }
  await page.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto('./');
  await expect(reopened.locator('meta[name="pbt-pages-version"]')).toHaveAttribute('content', 'A');
  await expect(first(reopened).getByText('Данные между релизами')).toBeVisible();
});
