import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';

const ready = (page: Page) => page.getByRole('status', { name: 'Готовность к офлайн-работе' });

async function prepared(page: Page) {
  await expect(ready(page)).toHaveText('Готово к работе офлайн');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function newPageWithoutHttpCache(context: BrowserContext) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  return page;
}

async function createWidget(page: Page, type: string, title: string) {
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: type, exact: true }).click();
  await catalog.getByLabel('Название нового документа').fill(title);
  await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  return page.getByRole('group', { name: `${type} · ${title}`, exact: true });
}

// Проверяем реальную запись, а не паузу, потенциально меньшую времени IDB.
async function persistedItem(page: Page, title: string, text: string, completed: boolean) {
  await expect.poll(() => page.evaluate(async ({ title, text, completed }) => {
    const open = indexedDB.open('project-board');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const request = db.transaction('documents').objectStore('documents').getAll();
      const docs = await new Promise<{ title: string; content: { items?: { text: string; done: boolean }[] } }[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return docs.some((doc) => doc.title === title && doc.content.items?.some((item) => item.text === text && item.done === completed));
    } finally { db.close(); }
  }, { title, text, completed })).toBe(true);
}

test('манифест, иконки и все production-ресурсы доступны из precache', async ({ page, request }) => {
  await page.goto('/');
  await prepared(page);
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(manifestUrl!)).json();
  expect(manifest).toMatchObject({ name: 'Project Board', short_name: 'Project Board', display: 'standalone', lang: 'ru' });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
  ]));
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    const png = await response.body();
    const [width, height] = icon.sizes.split('x').map(Number);
    expect(response.headers()['content-type']).toContain('image/png');
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
  }
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries = await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((entry) => new URL(entry.url).pathname)));
    return entries.flat();
  });
  // Сопоставление с dist ловит пропущенный новый чанк/шрифт, а не только
  // файлы, которые успела запросить стартовая страница.
  const assets = await readdir('apps/project-board/dist/assets');
  for (const file of assets.filter((file) => /\.(js|css|woff2?)$/.test(file))) {
    expect(cached, file).toContain(`/assets/${file}`);
  }
  expect(cached).toContain('/index.html');
  expect(cached).toContain('/manifest.webmanifest');
  expect(cached.some((path) => /wx-icons.*woff2$/.test(path))).toBe(true);
  const sw = await readFile('apps/project-board/dist/sw.js', 'utf8');
  expect(sw).not.toContain('cdn.');
});

test('холодный запуск, изменение и новый список без сети переживают повторное открытие', async ({ context, page }) => {
  await page.goto('/');
  await prepared(page);
  const original = page.getByRole('group', { name: 'Экземпляр 1 · Список 1', exact: true });
  await original.getByPlaceholder('Новая задача…').fill('Подготовлено онлайн');
  await original.getByRole('button', { name: 'Добавить', exact: true }).click();
  await persistedItem(page, 'Список 1', 'Подготовлено онлайн', false);
  await page.close();
  await context.setOffline(true);

  const offline = await newPageWithoutHttpCache(context);
  await offline.goto('/');
  await prepared(offline);
  const restored = offline.getByRole('group', { name: 'Экземпляр 1 · Список 1', exact: true });
  await expect(restored.getByText('Подготовлено онлайн', { exact: true })).toBeVisible();
  await restored.getByRole('checkbox').check();
  await persistedItem(offline, 'Список 1', 'Подготовлено онлайн', true);
  const created = await createWidget(offline, 'Чек-лист', 'В дороге');
  await created.getByPlaceholder('Новая задача…').fill('Создано без сети');
  await created.getByRole('button', { name: 'Добавить', exact: true }).click();
  await persistedItem(offline, 'В дороге', 'Создано без сети', false);
  // Подтверждаем сохранение окна отдельно от документа.
  await expect.poll(() => offline.evaluate(async () => {
    const request = indexedDB.open('project-board');
    const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); });
    const all = db.transaction('widgetInstances').objectStore('widgetInstances').getAll();
    return new Promise<boolean>((resolve) => {
      all.onsuccess = () => { db.close(); resolve(all.result.length === 4); };
    });
  })).toBe(true);
  await offline.close();

  const reopened = await newPageWithoutHttpCache(context);
  await reopened.goto('/');
  await expect(reopened.getByRole('group', { name: 'Чек-лист · В дороге', exact: true }).getByText('Создано без сети')).toBeVisible();
  await expect(reopened.getByRole('group', { name: 'Экземпляр 1 · Список 1', exact: true }).getByRole('checkbox')).toBeChecked();
  await reopened.screenshot({ path: 'test-results/screenshots/pwa-offline.png' });
});

test('оба представления плана и шрифты загружаются офлайн', async ({ context, page }) => {
  await page.goto('/');
  await prepared(page);
  await page.close();
  await context.setOffline(true);
  const offline = await newPageWithoutHttpCache(context);
  const errors: string[] = [];
  offline.on('pageerror', (error) => errors.push(error.message));
  await offline.goto('/');
  const gantt = await createWidget(offline, 'План', 'Автономный план');
  await expect(gantt.locator('.wx-gantt')).toBeVisible();
  const resources = await createWidget(offline, 'Ресурсы', 'Автономные ресурсы');
  const resourceDocumentId = await resources.locator('[data-document-id]').getAttribute('data-document-id');
  await offline.evaluate((id) => {
    window.__projectBoard?.writeDocumentContent(id!, {
      calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
      resources: [{ id: 'qa', title: 'QA' }], workTypes: [], groups: [],
      tasks: [{ id: 'task', title: 'Офлайн-задача', start: '2026-10-12', end: '2026-10-14', assigneeIds: ['qa'] }],
      dependencies: [], unavailability: [],
    });
  }, resourceDocumentId);
  await expect(resources.locator('.react-calendar-timeline')).toBeVisible();
  await expect(resources.getByText('QA', { exact: true }).last()).toBeVisible();
  await expect(resources.getByText('Офлайн-задача', { exact: true })).toBeVisible();
  const fonts = await offline.evaluate(async () => {
    await document.fonts.load('14px "IBM Plex Sans"', 'План');
    await document.fonts.load('12px "JetBrains Mono"', '12.10');
    return document.fonts.check('14px "IBM Plex Sans"', 'План') && document.fonts.check('12px "JetBrains Mono"', '12.10');
  });
  expect(fonts).toBe(true);
  expect(errors).toEqual([]);
});

test('отказ регистрации не объявляет офлайн-готовность и не блокирует список', async ({ page, context }) => {
  await context.route('**/sw.js', (route) => route.abort());
  await page.goto('/');
  await expect(ready(page)).toHaveText('Офлайн-режим недоступен');
  const list = page.getByRole('group', { name: 'Экземпляр 1 · Список 1', exact: true });
  await list.getByPlaceholder('Новая задача…').fill('Доступно онлайн');
  await list.getByRole('button', { name: 'Добавить', exact: true }).click();
  await persistedItem(page, 'Список 1', 'Доступно онлайн', false);
});

test('первый запуск без сети не использует ресурсы другого контекста', async ({ context, page }) => {
  await context.setOffline(true);
  await expect(page.goto('/')).rejects.toThrow();
  await expect(page.getByRole('heading', { name: 'Project Board', exact: true })).toHaveCount(0);
});

test('ошибка скачивания обязательного шрифта не даёт ложной готовности', async ({ page, context }) => {
  let blocked = 0;
  await context.route('**/assets/*.woff', (route) => {
    if (route.request().serviceWorker()) {
      blocked += 1;
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(ready(page)).toHaveText('Офлайн-режим недоступен');
  expect(blocked).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Project Board', exact: true })).toBeVisible();
});
