import { expect, test, type Page } from '@playwright/test';
import type { ManagedDocument } from '@project-board/widget-sdk';
import type { WorkspaceSnapshot } from '@project-board/dashboard';
import { WORKSPACE_DB_SCHEMA_VERSION } from '../../packages/dashboard/src/db-schema';

export interface SavedWorkspace {
  documents: ManagedDocument[];
  tabs: WorkspaceSnapshot['tabs'];
  instances: WorkspaceSnapshot['instances'];
  settings?: { key: string; value: unknown }[];
}

/** Явный снимок старого пространства для регрессий существующего профиля. */
export function legacyChecklists(): SavedWorkspace {
  const timestamp = '2026-10-01T00:00:00.000Z';
  return {
    documents: [1, 2].map(index => ({
      id: `saved-list-${index}`, moduleId: 'checklist', documentType: 'list',
      schemaVersion: 1, revision: 1, title: `Список ${index}`,
      createdAt: timestamp, updatedAt: timestamp, content: { items: [] },
    })),
    tabs: [{ id: 'saved-checklists', title: 'Чек-листы', position: 0, mode: 'cascade', cascadeOrder: [], active: 1 }],
    instances: [1, 2, 3].map(index => ({
      id: `w-${index}`, tabId: 'saved-checklists', typeId: 'checklist',
      documentId: `saved-list-${index === 3 ? 2 : 1}`,
      label: `Экземпляр ${index} · Список ${index === 3 ? 2 : 1}`, collapsed: 0,
    })),
    settings: [{ key: 'workspace', value: { activeTabId: 'saved-checklists' } }],
  };
}

/** До первого запуска приложения в собственном тестовом профиле. */
export async function restoreSavedWorkspace(page: Page, snapshot: SavedWorkspace, entry = '/') {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error('Для fixture требуется baseURL.');
  const destination = new URL(entry, base).href;
  const staging = new URL('__saved-workspace__', destination).href;
  await page.route(staging, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Saved workspace fixture</title>' }));
  await page.goto(staging);
  await page.evaluate(({ snapshot, version }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('project-board', version * 10);
    open.onupgradeneeded = () => {
      const db = open.result;
      const docs = db.createObjectStore('documents', { keyPath: 'id' });
      docs.createIndex('moduleId', 'moduleId'); docs.createIndex('documentType', 'documentType');
      const tabs = db.createObjectStore('tabs', { keyPath: 'id' }); tabs.createIndex('position', 'position');
      const windows = db.createObjectStore('widgetInstances', { keyPath: 'id' }); windows.createIndex('tabId', 'tabId');
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['documents', 'tabs', 'widgetInstances', 'settings'], 'readwrite');
      for (const [table, rows] of Object.entries({ documents: snapshot.documents, tabs: snapshot.tabs, widgetInstances: snapshot.instances, settings: snapshot.settings ?? [] })) {
        const store = tx.objectStore(table);
        store.clear();
        for (const row of rows) store.put(row);
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { snapshot, version: WORKSPACE_DB_SCHEMA_VERSION });
  await page.unroute(staging);
  await page.goto(destination);
  await expect(page.getByRole('heading', { name: 'Project Board', exact: true })).toBeVisible();
}

export async function restoreChecklistWorkspace(page: Page) {
  await restoreSavedWorkspace(page, legacyChecklists());
}
