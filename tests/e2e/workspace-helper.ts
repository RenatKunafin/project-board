import { expect, type Page } from '@playwright/test';

type Stored = {
  tabs: { id: string; title: string; position: number; mode: string; cascadeOrder: string[] }[];
  widgetInstances: { id: string; tabId: string; documentId?: string }[];
  settings: { key: string; value: unknown }[];
  documents: { id: string; title: string; content: unknown }[];
};
export async function storedWorkspace(page: Page): Promise<Stored> {
  return page.evaluate(async () => {
    const request = indexedDB.open('project-board');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = ['tabs', 'widgetInstances', 'settings', 'documents'] as const;
      const transaction = db.transaction([...names]);
      const rows = await Promise.all(names.map(name => new Promise<unknown[]>((resolve, reject) => {
        const read = transaction.objectStore(name).getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      })));
      return Object.fromEntries(names.map((name, index) => [name, rows[index]])) as Stored;
    } finally { db.close(); }
  });
}

/** Дожидается содержимого в IndexedDB, а не кратковременной надписи «Сохранено». */
export async function persistedDocument(page: Page, title: string, content: Record<string, unknown>): Promise<void> {
  await expect.poll(async () => (await storedWorkspace(page)).documents.find(document => document.title === title)?.content)
    .toMatchObject(content);
}
