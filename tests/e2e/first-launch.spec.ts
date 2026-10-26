import { expect, test, type Page } from '@playwright/test';
import { createDocumentWindow, openDocumentWindow } from './document-ui';
import { legacyChecklists, restoreSavedWorkspace } from './saved-workspace';
import { persistedDocument, storedWorkspace } from './workspace-helper';

async function empty(page: Page) {
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Дашборд');
  await expect(page.getByText('Пустой дашборд', { exact: true })).toBeVisible();
  await expect(page.locator('.widget-window')).toHaveCount(0);
  await expect.poll(async () => {
    const state = await storedWorkspace(page);
    return { tabs: state.tabs.length, documents: state.documents.length, windows: state.widgetInstances.length };
  }).toEqual({ tabs: 1, documents: 0, windows: 0 });
}

test('чистый первый запуск, reload и холодный offline остаются пустыми без демоданных', async ({ page, context }) => {
  await page.goto('/');
  await empty(page);
  await page.getByRole('button', { name: 'Каталог документов' }).click();
  await expect(page.getByRole('dialog', { name: 'Каталог документов' }).getByText('Документов пока нет')).toBeVisible();
  await page.reload();
  await empty(page);
  await expect(page.getByRole('status', { name: 'Готовность к офлайн-работе' })).toHaveText('Готово к работе офлайн');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  const cdp = await context.newCDPSession(offline);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await offline.goto('/');
  await empty(offline);
});

for (const type of ['Чек-лист', 'План']) {
  test(`первый ${type}: создание из пустого состояния и сохранение после reload`, async ({ page }) => {
    await page.goto('/');
    await empty(page);
    const { pane, documentId, instanceId } = await createDocumentWindow(page, type, 'Первый документ', true);
    if (type === 'Чек-лист') {
      await pane.getByPlaceholder('Новая задача…').fill('Создан пользователем');
      await pane.getByRole('button', { name: 'Добавить', exact: true }).click();
      await persistedDocument(page, 'Первый документ', { items: [{ text: 'Создан пользователем' }] });
    } else {
      await pane.locator('[data-add-task]').click();
      const form = pane.getByRole('dialog');
      await form.locator('[data-task-field="title"]').fill('Создан пользователем');
      await form.locator('[data-task-field="start"]').fill('2026-10-26');
      await form.locator('[data-task-field="duration"]').fill('2');
      await form.locator('[data-task-save]').click();
      await persistedDocument(page, 'Первый документ', { tasks: [{ title: 'Создан пользователем' }] });
    }
    const before = await storedWorkspace(page);
    expect(before.documents).toHaveLength(1);
    expect(before.widgetInstances).toMatchObject([{ id: instanceId, documentId }]);
    await page.reload();
    await expect(pane.getByText('Создан пользователем', { exact: true }).first()).toBeVisible();
    expect((await storedWorkspace(page)).documents).toEqual(before.documents);
    expect((await storedWorkspace(page)).widgetInstances).toEqual(before.widgetInstances);
  });
}

test('созданный пользователем документ общий для двух окон и независим от другого списка', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const first = await createDocumentWindow(page, 'Чек-лист', 'Общий');
  const second = await openDocumentWindow(page, 'Чек-лист', 'Общий');
  const independent = await createDocumentWindow(page, 'Чек-лист', 'Отдельный');
  expect(first.instanceId).not.toBe(second.instanceId);
  await first.pane.getByPlaceholder('Новая задача…').fill('Общий пункт');
  await first.pane.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(second.pane.getByText('Общий пункт')).toBeVisible();
  await expect(independent.pane.getByText('Общий пункт')).toHaveCount(0);
  await first.pane.getByRole('button', { name: 'Скрыть выполненные' }).click();
  await expect.poll(async () => ((await storedWorkspace(page)).settings.find(row => row.key === `view:${first.instanceId}`)?.value as { hideDone?: boolean })?.hideDone).toBe(true);
  await expect(second.pane.getByRole('button', { name: 'Скрыть выполненные' })).toBeVisible();
});

test('удаление последнего документа не возвращает чек-листы при перезапуске', async ({ page }) => {
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'Чек-лист', 'Удаляемый');
  await pane.getByRole('button', { name: /^Закрыть/ }).click();
  await expect.poll(async () => (await storedWorkspace(page)).widgetInstances.length).toBe(0);
  await page.getByRole('button', { name: 'Каталог документов' }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог документов' });
  await catalog.getByRole('button', { name: 'Удалить «Удаляемый»' }).click();
  await catalog.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).documents.length).toBe(0);
  await page.reload();
  await empty(page);
});

test('старый сохранённый срез восстанавливается без удаления или новых документов', async ({ page }) => {
  const snapshot = legacyChecklists();
  snapshot.documents[0] = { ...snapshot.documents[0], content: { items: [{ id: 'existing', text: 'Не удалять', done: false }] } };
  await restoreSavedWorkspace(page, snapshot);
  await expect(page.getByRole('group', { name: 'Экземпляр 1 · Список 1' }).getByText('Не удалять')).toBeVisible();
  await expect(page.locator('.widget-window')).toHaveCount(3);
  expect((await storedWorkspace(page)).documents).toEqual(snapshot.documents);
  await page.reload();
  await expect(page.locator('.widget-window')).toHaveCount(3);
  expect((await storedWorkspace(page)).documents).toEqual(snapshot.documents);
});

test('план без чек-листов восстанавливается без пополнения каталога', async ({ page }) => {
  const snapshot = legacyChecklists();
  snapshot.documents = [{ ...snapshot.documents[0], id: 'saved-plan', title: 'Сохранённый план', moduleId: 'gantt', documentType: 'plan', content: {
    calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
    tasks: [], groups: [], resources: [], workTypes: [], dependencies: [], unavailability: [],
  } }];
  snapshot.instances = [{ ...snapshot.instances[0], documentId: 'saved-plan', typeId: 'plan', label: 'План · Сохранённый план' }];
  await restoreSavedWorkspace(page, snapshot);
  await expect(page.getByRole('group', { name: 'План · Сохранённый план' })).toBeVisible();
  expect((await storedWorkspace(page)).documents).toEqual(snapshot.documents);
  await page.reload();
  await expect(page.locator('.widget-window')).toHaveCount(1);
  expect((await storedWorkspace(page)).documents).toEqual(snapshot.documents);
});

test('сохранённые документы без вкладок доступны в каталоге, новые не создаются', async ({ page }) => {
  const snapshot = legacyChecklists();
  snapshot.tabs = []; snapshot.instances = []; snapshot.settings = [];
  await restoreSavedWorkspace(page, snapshot);
  await expect(page.getByText('Пустой дашборд', { exact: true })).toBeVisible();
  await expect(page.locator('.widget-window')).toHaveCount(0);
  expect((await storedWorkspace(page)).documents).toEqual(snapshot.documents);
  await page.getByRole('button', { name: 'Каталог документов' }).click();
  await expect(page.getByRole('dialog', { name: 'Каталог документов' }).getByRole('button', { name: /^Список / })).toHaveCount(2);
});

test('ошибка чтения документов не маскируется пустым каталогом или созданием примеров', async ({ page }) => {
  await page.addInitScript(() => {
    const openCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = function (...args) {
      if (this.name === 'documents') throw new DOMException('Проверочный отказ чтения', 'UnknownError');
      return openCursor.apply(this, args);
    };
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === 'documents') throw new DOMException('Проверочный отказ чтения', 'UnknownError');
      return getAll.apply(this, args);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Пустой дашборд', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Каталог документов' }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог документов' });
  await expect(catalog.getByText('Не удалось загрузить сохранённые документы.', { exact: false })).toBeVisible();
  await expect(catalog.getByText('Документов пока нет')).toHaveCount(0);
  // count не подменён fault injection: проверяем реальное отсутствие записей.
  expect(await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('project-board');
    open.onsuccess = () => { const db = open.result; const count = db.transaction('documents').objectStore('documents').count(); count.onsuccess = () => { db.close(); resolve(count.result); }; count.onerror = () => reject(count.error); };
    open.onerror = () => reject(open.error);
  }))).toBe(0);
});
