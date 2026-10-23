import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PlanContent } from '@project-board/gantt';

export interface StoredPlan {
  id: string;
  title: string;
  schemaVersion: number;
  content: PlanContent;
}

export const paneOf = (page: Page, title: string, type = 'План') =>
  page.getByRole('group', { name: `${type} · ${title}`, exact: true });

export async function restoreSize(page: Page) {
  const restore = page.getByRole('button', { name: /^Вернуть прежний размер/ });
  if (await restore.isVisible()) await restore.click();
}

export async function maximize(pane: Locator) {
  // В каскаде сосед может закрывать кнопки: сначала поднимаем окно
  // за видимый фрагмент заголовка, без force и обхода hit testing.
  await pane.locator('.widget-window__head').click({ position: { x: 8, y: 8 } });
  await pane.getByRole('button', { name: /^Развернуть на весь дашборд/ }).click();
}

export async function createPlan(page: Page, initialMode?: string) {
  await page.goto('/');
  if (initialMode) await page.getByRole('button', { name: initialMode, exact: true }).click();
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: 'План', exact: true }).click();
  await catalog.getByLabel('Название нового документа').fill('Подготовка');
  await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  const pane = paneOf(page, 'Подготовка');
  await maximize(pane);
  return pane;
}

export async function importFile(page: Page, pane: Locator, path: string, title: string) {
  const previousId = await documentId(pane);
  await pane.getByRole('button', { name: 'Импорт плана', exact: true }).click();
  await pane.locator('[data-import-plan-input]').setInputFiles(path);
  if (path.endsWith('.gantt')) {
    const preview = page.getByRole('dialog', { name: 'Импорт плана из OnlineGantt' });
    await expect(preview.locator('[data-onlinegantt-summary]')).toContainText('Задач 47');
    await expect(preview.locator('[data-onlinegantt-summary]')).toContainText('Групп 2');
    await expect(preview.locator('[data-onlinegantt-summary]')).toContainText('Без исполнителя 16');
    await expect(preview.locator('[data-onlinegantt-summary]')).toContainText('Ресурсов 9');
    await expect(preview.locator('[data-onlinegantt-summary]')).toContainText('Зависимостей 21');
    await expect(preview.locator('[data-onlinegantt-unassigned]')).toContainText('ОТПУСК');
    await preview.locator('[data-onlinegantt-title]').fill(title);
    await preview.locator('[data-onlinegantt-apply]').click();
  }
  const imported = paneOf(page, title);
  await expect.poll(() => documentId(imported)).not.toBe(previousId);
  await expect(imported.locator('[data-import-plan-result]')).toContainText('импортирован');
  return imported;
}

export async function documentId(pane: Locator) {
  const id = await pane.locator('[data-document-id]').getAttribute('data-document-id');
  expect(id).toBeTruthy();
  return id!;
}

// Только чтение настоящего IndexedDB: подготовка и изменения идут через UI.
export async function storedPlan(page: Page, id: string): Promise<StoredPlan | null> {
  return page.evaluate((key) => new Promise<StoredPlan | null>((resolve, reject) => {
    const open = indexedDB.open('project-board');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('documents').objectStore('documents').get(key);
      request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }), id);
}

export async function editTask(page: Page, pane: Locator, title: string) {
  await pane.locator('[data-gantt-filter-query]').fill(title);
  const row = pane.locator('.wx-row').filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  await row.dblclick();
  const dialog = page.getByRole('dialog', { name: 'Редактирование задачи', exact: true });
  await expect(dialog.locator('[data-task-field="title"]')).toHaveValue(title);
  return dialog;
}

export async function saveTask(dialog: Locator) {
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).not.toBeAttached();
}

export async function existingView(page: Page, title: string, type = 'Ресурсы') {
  await restoreSize(page);
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: type, exact: true }).click();
  await catalog.getByRole('button', { name: title, exact: true }).click();
  const pane = paneOf(page, title, type);
  await expect(pane).toBeVisible();
  return pane;
}

export async function exportNative(page: Page, pane: Locator) {
  const pending = page.waitForEvent('download');
  await pane.getByRole('button', { name: 'Экспорт плана', exact: true }).click();
  const download = await pending;
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { path, value: JSON.parse(await readFile(path, 'utf8')) as {
    title: string; schemaVersion: number; content: PlanContent; format: string;
  } };
}

export async function waitWorkspace(page: Page, expectedInstances: number) {
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('project-board');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('widgetInstances').objectStore('widgetInstances').count();
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }))).toBe(expectedInstances);
}

export async function workspace(page: Page) {
  return page.evaluate(() => new Promise<{
    tabs: { id: string; position: number; mode: string; active: number; cascadeOrder: string[] }[];
    instances: { id: string; cascadeArea?: { x: number; y: number; width: number; height: number } }[];
    settings: { key: string; value: unknown }[];
  }>((resolve, reject) => {
    const open = indexedDB.open('project-board');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(['tabs', 'widgetInstances', 'settings']);
      const tabs = transaction.objectStore('tabs').getAll();
      const instances = transaction.objectStore('widgetInstances').getAll();
      const settings = transaction.objectStore('settings').getAll();
      transaction.oncomplete = () => { db.close(); resolve({
        tabs: tabs.result.sort((a, b) => a.position - b.position),
        instances: instances.result.sort((a, b) => a.id.localeCompare(b.id)),
        settings: settings.result.filter(row => row.key === 'workspace' || row.key.startsWith('view:'))
          .sort((a, b) => a.key.localeCompare(b.key)),
      }); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
}
