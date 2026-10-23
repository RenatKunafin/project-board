import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { readdir } from 'node:fs/promises';

const notification = (page: Page) => page.getByRole('status', { name: 'Обновление приложения', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Обновление Project Board' });
const list = (page: Page) => page.getByRole('group', { name: 'Экземпляр 1 · Список 1', exact: true });

async function publish(request: APIRequestContext, version: string) {
  expect((await request.post(`/__version?value=${version}`)).ok()).toBe(true);
}

async function ready(page: Page) {
  await expect(page.getByRole('status', { name: 'Готовность к офлайн-работе' })).toHaveText('Готово к работе офлайн');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function detect(page: Page, request: APIRequestContext) {
  await publish(request, 'B');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await expect(notification(page)).toContainText('Доступна новая версия');
}

async function createWidget(page: Page, type: string, title: string) {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: type, exact: true }).click();
  await catalog.getByLabel('Название нового документа').fill(title);
  await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  return page.getByRole('group', { name: `${type} · ${title}`, exact: true });
}

async function apply(page: Page) {
  await notification(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Обновить', exact: true }).click();
}

async function versionB(page: Page) {
  await expect(page.locator('meta[name="pbt-test-version"]')).toHaveAttribute('content', 'B');
  await ready(page);
}

test.beforeEach(async ({ request }) => publish(request, 'A'));

test('A → B сохраняет свежую правку, workspace/settings, мигрирует документ и запускается офлайн', async ({ page, context, request }) => {
  await page.goto('/');
  await ready(page);
  const fixture = await createWidget(page, 'Контроль обновления', 'Документ версии 1');
  await expect(fixture.getByText('Сборка A')).toBeVisible();
  const fixtureId = await fixture.locator('[data-document-id]').getAttribute('data-document-id');
  const plan = await createWidget(page, 'План', 'Сохранённый план');
  const planId = await plan.locator('[data-document-id]').getAttribute('data-document-id');
  await page.evaluate((id) => window.__projectBoard?.writeDocumentContent(id!, {
    calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
    resources: [], workTypes: [], groups: [], dependencies: [], unavailability: [],
    tasks: [{ id: 'preserved', title: 'Задача, пережившая обновление', start: '2026-10-12', end: '2026-10-14' }],
  }), planId);
  await expect(page.getByRole('status', { name: 'Состояние сохранения' })).toHaveText('Сохранено');
  await detect(page, request);
  await list(page).getByPlaceholder('Новая задача…').fill('Последняя правка перед обновлением');
  await list(page).getByRole('button', { name: 'Добавить', exact: true }).click();
  await list(page).getByRole('button', { name: 'Скрыть выполненные', exact: true }).click();
  await page.getByRole('button', { name: 'Каскад', exact: true }).click();
  await apply(page);
  await versionB(page);
  await expect(list(page).getByText('Последняя правка перед обновлением')).toBeVisible();
  await expect(list(page).getByRole('button', { name: 'Показать выполненные', exact: true })).toBeVisible();
  await expect(page.locator('.cascade-layout')).toBeVisible();
  await expect(page.locator('[data-migration-content]')).toContainText('"migrated":true');
  await expect(page.locator('[data-migration-content]')).toContainText('Старый документ');
  await expect(page.getByRole('group', { name: 'План · Сохранённый план', exact: true }).getByText('Задача, пережившая обновление').first()).toBeVisible();
  expect(await page.evaluate((id) => {
    const doc = window.__projectBoard?.readDocument(id!);
    return doc && 'schemaVersion' in doc ? doc.schemaVersion : undefined;
  }, fixtureId)).toBe(2);
  await page.screenshot({ path: 'test-results/screenshots/pwa-updated.png' });

  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  const cdp = await context.newCDPSession(offline);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await offline.goto('/');
  await versionB(offline);
  await expect(list(offline).getByText('Последняя правка перед обновлением')).toBeVisible();
  await expect(offline.locator('[data-migration-content]')).toContainText('"migrated":true');
  const cached = await offline.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) =>
    (await (await caches.open(name)).keys()).map((entry) => new URL(entry.url).pathname),
  ))).flat());
  const current = await readdir('.cache/pwa-updates/B/assets');
  const previous = await readdir('.cache/pwa-updates/A/assets');
  for (const file of current) expect(cached).toContain(`/assets/${file}`);
  for (const file of previous.filter((file) => !current.includes(file))) expect(cached).not.toContain(`/assets/${file}`);
});

test('первая активация, обнаружение, Позже и отмена не перезагружают страницу', async ({ page, request }) => {
  await page.addInitScript(() => sessionStorage.setItem('loads', String(Number(sessionStorage.getItem('loads') ?? 0) + 1)));
  await page.goto('/');
  await ready(page);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('loads'))).toBe('1');
  await list(page).getByPlaceholder('Новая задача…').fill('Черновик формы');
  await detect(page, request);
  await page.screenshot({ path: 'test-results/screenshots/pwa-update-available.png' });
  await notification(page).getByRole('button', { name: 'Позже' }).click();
  await notification(page).getByRole('button', { name: 'Есть обновление' }).click();
  await dialog(page).getByRole('button', { name: 'Отмена' }).click();
  await expect(list(page).getByPlaceholder('Новая задача…')).toHaveValue('Черновик формы');
  expect(await page.evaluate(() => sessionStorage.getItem('loads'))).toBe('1');
  await expect(page.locator('meta[name="pbt-test-version"]')).toHaveAttribute('content', 'A');
});

for (const table of ['documents', 'tabs', 'settings']) {
  test(`сбой ${table} блокирует обновление; повтор сохраняет сессию`, async ({ page, request }) => {
    await page.goto('/');
    await ready(page);
    await expect(page.getByRole('status', { name: 'Состояние сохранения' })).toHaveText('Сохранено');
    await detect(page, request);
    await page.evaluate((table) => {
      const put = IDBObjectStore.prototype.put;
      let fail = true;
      Object.assign(window, { pbtAllowWrites: () => { fail = false; } });
      IDBObjectStore.prototype.put = function (...args) {
        if (fail && this.name === table) throw new DOMException('Тестовый сбой записи', 'QuotaExceededError');
        return put.apply(this, args);
      };
    }, table);
    await list(page).getByPlaceholder('Новая задача…').fill('Правка остаётся в сессии');
    await list(page).getByRole('button', { name: 'Добавить', exact: true }).click();
    await apply(page);
    await expect(dialog(page).getByRole('alert')).toBeVisible();
    await expect(page.locator('meta[name="pbt-test-version"]')).toHaveAttribute('content', 'A');
    await expect(list(page).getByText('Правка остаётся в сессии')).toBeAttached();
    await page.screenshot({ path: `test-results/screenshots/pwa-update-${table}-error.png` });
    await page.evaluate(() => (window as Window & { pbtAllowWrites: () => void }).pbtAllowWrites());
    await dialog(page).getByRole('button', { name: 'Повторить', exact: true }).click();
    await versionB(page);
    await expect(list(page).getByText('Правка остаётся в сессии')).toBeVisible();
  });
}

test('другое окно блокирует активацию, его закрытие позволяет повторить', async ({ page, context, request }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.getByRole('status', { name: 'Состояние сохранения' })).toHaveText('Сохранено');
  const other = await context.newPage();
  await other.goto('/');
  await ready(other);
  await list(other).getByPlaceholder('Новая задача…').fill('Черновик другого окна');
  await detect(page, request);
  await apply(page);
  await expect(dialog(page).getByRole('alert')).toHaveText('Закройте другие окна Project Board и повторите обновление.');
  await expect(list(other).getByPlaceholder('Новая задача…')).toHaveValue('Черновик другого окна');
  await expect(other.locator('meta[name="pbt-test-version"]')).toHaveAttribute('content', 'A');
  await other.close();
  await dialog(page).getByRole('button', { name: 'Повторить', exact: true }).click();
  await versionB(page);
});

test('таймаут in-flight записи не вызывает поздний reload; после её завершения можно повторить', async ({ page, request }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.getByRole('status', { name: 'Состояние сохранения' })).toHaveText('Сохранено');
  await detect(page, request);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let held = true;
    Object.assign(window, { pbtReleaseWrites: () => { held = false; } });
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === 'documents') {
        // Настоящая транзакция не подтверждает commit до отпускания gate.
        const keepAlive = () => {
          if (!held) return;
          this.get('__pbt_hold').onsuccess = keepAlive;
        };
        keepAlive();
      }
      return request;
    };
  });
  await list(page).getByPlaceholder('Новая задача…').fill('Долгая запись');
  await list(page).getByRole('button', { name: 'Добавить', exact: true }).click();
  await apply(page);
  await expect(dialog(page).getByRole('status')).toHaveText('Сохранение…');
  await expect(dialog(page).getByRole('button', { name: 'Обновить', exact: true })).toBeDisabled();
  await expect(dialog(page).getByRole('alert')).toContainText('слишком много времени', { timeout: 20_000 });
  await page.evaluate(() => (window as Window & { pbtReleaseWrites: () => void }).pbtReleaseWrites());
  await expect(page.getByRole('status', { name: 'Состояние сохранения' })).toHaveText('Сохранено');
  await expect(page.locator('meta[name="pbt-test-version"]')).toHaveAttribute('content', 'A');
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Повторить', exact: true }).click();
  await versionB(page);
  await expect(list(page).getByText('Долгая запись')).toBeVisible();
});

test('первый переход с настоящего PBT-028 происходит после закрытия всех окон', async ({ page, context, request }) => {
  await publish(request, 'baseline');
  await page.goto('/');
  await ready(page);
  await list(page).getByPlaceholder('Новая задача…').fill('Сохранено в PBT-028');
  await list(page).getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Состояние сохранения' })).toHaveText('Сохранено');
  const previousWorkers = context.serviceWorkers();
  await publish(request, 'B');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed');
  await expect(notification(page)).toHaveCount(0);
  const nextWorker = context.serviceWorkers().find((worker) => !previousWorkers.includes(worker))!;
  expect(nextWorker).toBeDefined();
  const activation = nextWorker.evaluate('new Promise(resolve => self.addEventListener("activate", () => resolve(true), { once: true }))');
  await page.close();
  await activation;
  await expect.poll(() => nextWorker.evaluate('self.registration.active?.state')).toBe('activated');
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto('/');
  await versionB(reopened);
  await expect(list(reopened).getByText('Сохранено в PBT-028')).toBeVisible();
});
