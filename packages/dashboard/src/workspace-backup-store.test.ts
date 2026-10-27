import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { WorkspaceBackupStore } from './workspace-backup-store';
import { WorkspaceStore } from './workspace-store';
import { IndexedDbDocumentStore } from './document-store';
import { SCHEMA_V1_DECLARATIONS, SCHEMA_V2_DECLARATIONS, SCHEMA_V3_DECLARATIONS } from './db-schema';
import type { WorkspaceBackup } from './workspace-backup';

const emptyPayload = {
  documents: [],
  workspace: { tabs: [{ id: 'tab', title: 'План', position: 0, mode: 'grid' as const, cascadeOrder: [], active: 1 as const }], instances: [], activeTabId: 'tab' },
  viewSettings: {},
};
function backup(second: number): WorkspaceBackup { return { format: 'project-board-workspace', formatVersion: 1, workspaceSchemaVersion: 1, createdAt: `2026-01-01T00:00:${String(second).padStart(2, '0')}.000Z`, ...emptyPayload }; }
async function storeCopy(store: WorkspaceBackupStore, value: WorkspaceBackup, kind: 'manual' | 'safety') {
  return store.addCapture(value, await store.readCapture(), kind);
}

describe('WorkspaceBackupStore', () => {
  it('stores at most five manual/safety copies and evicts the oldest', async () => {
    const store = new WorkspaceBackupStore(`backup-limit-${crypto.randomUUID()}`);
    for (let second = 1; second <= 6; second += 1) await storeCopy(store, backup(second), second === 6 ? 'safety' : 'manual');
    const rows = await store.list();
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.createdAt)).toEqual([2, 3, 4, 5, 6].map((n) => backup(n).createdAt));
    store.close();
  });

  it('orders equal timestamps by a stable secondary key', async () => {
    const store = new WorkspaceBackupStore(`backup-ties-${crypto.randomUUID()}`);
    const sameTime = { ...backup(1), createdAt: '2026-01-01T00:00:00.000Z' };
    const first = await storeCopy(store, sameTime, 'manual');
    const second = await storeCopy(store, sameTime, 'safety');
    expect((await store.list()).map((row) => row.id)).toEqual([first.id, second.id].sort());
    store.close();
  });

  it('can replace from the oldest selected copy while safety retention evicts it', async () => {
    const store = new WorkspaceBackupStore(`backup-oldest-${crypto.randomUUID()}`);
    for (let second = 1; second <= 5; second += 1) await storeCopy(store, backup(second), 'manual');
    const selected = await store.get((await store.list())[0]!.id);
    const current = await store.readCapture();
    await store.replace(selected!.backup, current, backup(7));
    expect((await store.list()).map((row) => row.createdAt)).toEqual([2, 3, 4, 5, 7].map((n) => backup(n).createdAt));
    expect((await store.readSnapshot()).workspace.tabs[0]?.id).toBe('tab');
    store.close();
  });

  it('keeps prior history and workspace when the replacement transaction fails', async () => {
    const name = `backup-atomic-${crypto.randomUUID()}`;
    const backups = new WorkspaceBackupStore(name);
    const workspace = new WorkspaceStore(name);
    await workspace.save(emptyPayload.workspace);
    await storeCopy(backups, backup(1), 'manual');
    const capture = await backups.readCapture();
    const transaction = vi.spyOn(Dexie.prototype, 'transaction').mockRejectedValueOnce(new Error('quota exceeded'));
    try { await expect(backups.replace({ ...emptyPayload, workspace: { ...emptyPayload.workspace, activeTabId: null } }, capture, backup(2))).rejects.toThrow('quota exceeded'); }
    finally { transaction.mockRestore(); }
    expect((await backups.list()).map((row) => row.createdAt)).toEqual([backup(1).createdAt]);
    expect((await workspace.load()).activeTabId).toBe('tab');
    backups.close(); workspace.close();
  });

  it('refuses a manual copy when another context changed the captured workspace', async () => {
    const name = `backup-capture-conflict-${crypto.randomUUID()}`;
    const backups = new WorkspaceBackupStore(name);
    const workspace = new WorkspaceStore(name);
    await workspace.save(emptyPayload.workspace);
    const capture = await backups.readCapture();
    await workspace.save({ ...emptyPayload.workspace, activeTabId: null });
    await expect(backups.addCapture(backup(1), capture, 'manual')).rejects.toThrow('изменилось в другом окне');
    expect(await backups.list()).toEqual([]);
    backups.close(); workspace.close();
  });

  it('excludes persisted view settings for already-removed instances from a backup snapshot', async () => {
    const name = `backup-orphan-view-${crypto.randomUUID()}`;
    const backups = new WorkspaceBackupStore(name);
    const legacyContext = new Dexie(name);
    legacyContext.version(1).stores(SCHEMA_V1_DECLARATIONS);
    legacyContext.version(2).stores(SCHEMA_V2_DECLARATIONS);
    legacyContext.version(3).stores(SCHEMA_V3_DECLARATIONS);
    await legacyContext.open();
    await legacyContext.table('settings').put({ key: 'view:removed-window', value: { zoom: 'weeks' } });
    legacyContext.close();

    const snapshot = await backups.readSnapshot();
    expect(snapshot.viewSettings).toEqual({});
    backups.close();
  });

  it('restores all workspace tables atomically and invalidates stale writers', async () => {
    const name = `backup-generation-${crypto.randomUUID()}`;
    const workspace = new WorkspaceStore(name);
    const docs = new IndexedDbDocumentStore(name);
    const backups = new WorkspaceBackupStore(name);
    await workspace.save(emptyPayload.workspace);
    await workspace.load();
    await docs.open();
    await backups.replace({ ...emptyPayload, workspace: { ...emptyPayload.workspace, tabs: [{ ...emptyPayload.workspace.tabs[0], id: 'restored' }], activeTabId: 'restored' } }, await backups.readCapture());
    await expect(workspace.save(emptyPayload.workspace)).rejects.toThrow('восстановлено в другом окне');
    await expect(workspace.saveViewSetting('window', { zoom: 'days' })).rejects.toThrow('восстановлено в другом окне');
    await expect(docs.save({ id: 'x', moduleId: 'unknown', documentType: 'x', title: 'X', schemaVersion: 1, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', content: {} }, 0)).rejects.toThrow('восстановлено в другом окне');
    await expect(docs.delete('x')).rejects.toThrow('восстановлено в другом окне');
    expect((await workspace.load()).tabs[0]?.id).toBe('restored');
    backups.close(); workspace.close(); docs.close();
  });

  it('upgrades a v2 database without changing existing rows or creating a backup', async () => {
    const name = `backup-v2-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores(SCHEMA_V1_DECLARATIONS);
    old.version(2).stores(SCHEMA_V2_DECLARATIONS);
    await old.open();
    await old.table('documents').put({ id: 'doc', moduleId: 'checklist', documentType: 'list', title: 'Список', schemaVersion: 1, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', content: { rows: [] } });
    await old.table('tabs').put({ id: 'tab', title: 'Вкладка', position: 0, mode: 'grid', cascadeOrder: [], active: 1 });
    await old.table('widgetInstances').put({ id: 'window', tabId: 'tab', typeId: 'checklist', collapsed: 0, gridArea: { x: 0, y: 0, w: 6, h: 4 }, cascadeArea: { x: 10, y: 10, width: 500, height: 350 } });
    await old.table('settings').put({ key: 'view:window', value: { zoom: 'days' } });
    old.close();
    const current = new WorkspaceBackupStore(name);
    const docs = new IndexedDbDocumentStore(name);
    const workspace = new WorkspaceStore(name);
    expect(await current.list()).toEqual([]);
    expect((await docs.get('doc'))?.title).toBe('Список');
    expect((await workspace.load()).tabs[0]?.id).toBe('tab');
    expect((await workspace.load()).instances[0]).toMatchObject({ id: 'window', gridArea: { w: 6 }, cascadeArea: { width: 500 } });
    expect(await workspace.loadViewSettings()).toEqual({ window: { zoom: 'days' } });
    expect((await docs.get('doc'))?.title).toBe('Список');

    await storeCopy(current, backup(3), 'manual');
    const previousBundle = new Dexie(name);
    previousBundle.version(1).stores(SCHEMA_V1_DECLARATIONS);
    previousBundle.version(2).stores(SCHEMA_V2_DECLARATIONS);
    await previousBundle.open();
    expect((await previousBundle.table('documents').get('doc'))?.title).toBe('Список');
    previousBundle.close();
    expect((await current.list()).map((row) => row.createdAt)).toEqual([backup(3).createdAt]);
    current.close(); docs.close(); workspace.close();
  });

  it('upgrades a v1 documents database and starts with an empty backup history', async () => {
    const name = `backup-v1-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores(SCHEMA_V1_DECLARATIONS);
    await old.open();
    await old.table('documents').put({ id: 'doc-v1', moduleId: 'old', documentType: 'note', title: 'Legacy', schemaVersion: 1, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', content: { text: 'kept' } });
    old.close();
    const current = new WorkspaceBackupStore(name);
    const docs = new IndexedDbDocumentStore(name);
    const workspace = new WorkspaceStore(name);
    expect((await docs.get('doc-v1'))?.content).toEqual({ text: 'kept' });
    expect(await current.list()).toEqual([]);
    expect(await workspace.load()).toEqual({ tabs: [], instances: [], activeTabId: null });
    current.close(); docs.close(); workspace.close();
  });
});
