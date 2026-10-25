import { expect, test, type Page } from '@playwright/test';
import { storedWorkspace } from '../e2e/workspace-helper';

const type = 'Счётчик (пример)';
const title = 'Общий счётчик';
async function open(page: Page, create = false) {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: type, exact: true }).click();
  if (create) {
    await catalog.getByLabel('Название нового документа').fill(title);
    await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  } else await catalog.getByRole('button', { name: title, exact: true }).click();
}
async function setup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  while (await page.locator('.widget-window').count()) {
    await page.locator('.widget-window').first().getByRole('button', { name: /^Закрыть/ }).click();
  }
  await open(page, true);
  const firstId = (await page.locator('.counter-widget').getAttribute('data-counter-instance'))!;
  const id = (await page.locator('.counter-widget').getAttribute('data-document-id'))!;
  // Статус документов не включает очередь раскладки: ждём запись окна отдельно.
  await expect.poll(async () => {
    const workspace = await storedWorkspace(page);
    return workspace.widgetInstances.length === 1 && workspace.widgetInstances[0]?.id === firstId &&
      workspace.widgetInstances[0]?.documentId === id && workspace.tabs[0]?.mode === 'grid';
  }).toBe(true);
  return { firstId, id };
}

test('пример: общий документ, настройки двух окон, hidden/reload и освобождение подписок', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const { firstId, id } = await setup(page);
  await open(page);
  // Порядок DOM не задаёт порядок создания окон.
  const other = page.locator(`.counter-widget:not([data-counter-instance="${firstId}"])`);
  await expect(other).toHaveCount(1);
  const secondId = (await other.getAttribute('data-counter-instance'))!;
  expect(secondId).not.toBe(firstId);
  const first = page.locator(`.counter-widget[data-counter-instance="${firstId}"]`);
  const second = page.locator(`.counter-widget[data-counter-instance="${secondId}"]`);
  await expect(first.getByLabel('Значение счётчика')).toHaveText('0');
  await expect.poll(() => page.evaluate(() => window.__projectBoard!.activeSubscriptionCount())).toBe(2);
  await first.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect(second.getByLabel('Значение счётчика')).toHaveText('1');
  await first.getByRole('button', { name: 'Компактный вид' }).click();
  await expect(first.getByRole('button', { name: 'Компактный вид' })).toHaveAttribute('aria-pressed', 'true');
  await expect(second.getByRole('button', { name: 'Компактный вид' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await expect(first).toHaveAttribute('data-counter-visible', 'false');
  await page.evaluate(id => window.__projectBoard!.writeDocumentContent(id, { count: 4 }), id);
  await page.getByRole('tab').filter({ hasText: 'Дашборд' }).locator('.tab__title').click();
  await expect(first.getByLabel('Значение счётчика')).toHaveText('4');
  await expect(second.getByLabel('Значение счётчика')).toHaveText('4');
  await expect(page.getByLabel('Состояние сохранения')).toHaveText('Сохранено');
  await expect.poll(async () => {
    const workspace = await storedWorkspace(page);
    return (workspace.settings.find(row => row.key === `view:${firstId}`)?.value as { compact?: boolean })?.compact === true &&
      workspace.widgetInstances.length === 2 && workspace.tabs.length === 2 &&
      (workspace.settings.find(row => row.key === 'workspace')?.value as { activeTabId?: string })?.activeTabId === workspace.tabs.find(tab => tab.title === 'Дашборд')?.id;
  }).toBe(true);
  await page.reload();
  await expect(first.getByLabel('Значение счётчика')).toHaveText('4');
  await expect(second.getByLabel('Значение счётчика')).toHaveText('4');
  await expect(first.getByRole('button', { name: 'Компактный вид' })).toHaveAttribute('aria-pressed', 'true');
  await expect(second.getByRole('button', { name: 'Компактный вид' })).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'test-results/widget-example/two-views.png' });
  const frame = (instance: string) => page.locator('.widget-window').filter({ has: page.locator(`[data-counter-instance="${instance}"]`) });
  await frame(firstId).getByRole('button', { name: /^Закрыть/ }).click();
  await expect.poll(() => page.evaluate(() => window.__projectBoard!.activeSubscriptionCount())).toBe(1);
  await second.getByRole('button', { name: 'Увеличить' }).click();
  await expect(second.getByLabel('Значение счётчика')).toHaveText('5');
  await frame(secondId).getByRole('button', { name: /^Закрыть/ }).click();
  await expect.poll(() => page.evaluate(() => window.__projectBoard!.activeSubscriptionCount())).toBe(0);
  expect(await page.evaluate(id => window.__projectBoard!.readDocument(id), id)).toMatchObject({ content: { count: 5 } });
  expect(errors).toEqual([]);
});

test('зарегистрированная миграция v1 и read-only будущей версии', async ({ page }) => {
  const { id } = await setup(page);
  await expect(page.getByLabel('Состояние сохранения')).toHaveText('Сохранено');
  const replaceStored = (schemaVersion: number, content: unknown) => page.evaluate(async ({ id, schemaVersion, content }) => {
    const request = indexedDB.open('project-board');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction('documents', 'readwrite');
      const row = tx.objectStore('documents').get(id);
      row.onsuccess = () => tx.objectStore('documents').put({ ...row.result, schemaVersion, content });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    } finally { db.close(); }
  }, { id, schemaVersion, content });
  await replaceStored(1, { value: 7 });
  await page.reload();
  await expect(page.getByLabel('Значение счётчика')).toHaveText('7');
  expect(await page.evaluate(id => window.__projectBoard!.readDocument(id), id)).toMatchObject({ schemaVersion: 2, content: { count: 7 } });
  await replaceStored(99, { count: 12 });
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Новая версия документа' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Увеличить', exact: true })).toHaveCount(0);
  expect(await page.evaluate(id => window.__projectBoard!.readDocument(id), id)).toMatchObject({ schemaVersion: 99, content: { count: 12 } });
});
