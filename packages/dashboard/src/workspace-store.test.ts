import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { WorkspaceStore, type WorkspaceSnapshot } from './workspace-store';

const DB_NAME = 'workspace-store-test';

const snapshot: WorkspaceSnapshot = {
  tabs: [
    {
      id: 'tab-1',
      title: 'Чек-листы',
      position: 0,
      mode: 'grid',
      cascadeOrder: [],
      active: 1,
    },
    {
      id: 'tab-2',
      title: 'План ОКАД',
      position: 1,
      mode: 'cascade',
      cascadeOrder: ['w-3', 'w-2'],
      active: 0,
    },
  ],
  instances: [
    {
      id: 'w-1',
      tabId: 'tab-1',
      typeId: 'checklist',
      documentId: 'doc-1',
      label: 'Экземпляр 1 · Список 1',
      collapsed: 0,
      gridArea: { x: 0, y: 0, w: 6, h: 4 },
      cascadeArea: null,
    },
    {
      id: 'w-3',
      tabId: 'tab-2',
      typeId: 'plan',
      documentId: 'doc-plan',
      label: 'План · ОКАД',
      collapsed: 1,
      gridArea: null,
      cascadeArea: { x: 52, y: 52, width: 600, height: 44 },
    },
  ],
  activeTabId: 'tab-1',
};

describe('WorkspaceStore', () => {
  it('удаление настроек закрытых окон следует за прежними записями и переживает flush', async () => {
    const store = new WorkspaceStore(`${DB_NAME}-delete-views`);
    const remaining = { tabs: [snapshot.tabs[1]], instances: [snapshot.instances[1]], activeTabId: 'tab-2' };
    await Promise.all([
      store.save(snapshot),
      store.saveViewSetting('w-1', { hideDone: true }),
      store.saveViewSetting('w-3', { zoom: 'days' }),
      store.deleteViewSettings(['w-1', 'missing']),
      store.flush(remaining, { 'w-3': { zoom: 'days' } }),
    ]);
    expect(await store.loadViewSettings()).toEqual({ 'w-3': { zoom: 'days' } });
    expect(await store.load()).toEqual(remaining);
  });

  it('финальный flush сохраняет последнюю раскладку и настройки после прежних записей', async () => {
    const store = new WorkspaceStore(`${DB_NAME}-flush-order`);
    const latest = { ...snapshot, activeTabId: 'tab-2' };
    await Promise.all([
      store.save(snapshot),
      store.saveViewSetting('w-1', { hideDone: false }),
      store.flush(latest, { 'w-1': { hideDone: true } }),
    ]);
    expect(await store.load()).toEqual(latest);
    expect(await store.loadViewSettings()).toEqual({ 'w-1': { hideDone: true } });
  });

  it('сбой финальной транзакции виден вызывающему, следующая попытка работает', async () => {
    const store = new WorkspaceStore(`${DB_NAME}-flush-retry`);
    await store.save(snapshot);
    const transaction = vi.spyOn(Dexie.prototype, 'transaction').mockRejectedValueOnce(new Error('write failed'));
    try {
      await expect(store.flush(snapshot, { 'w-1': { hideDone: true } })).rejects.toThrow('write failed');
    } finally { transaction.mockRestore(); }
    expect(await store.loadViewSettings()).toEqual({});
    await store.flush(snapshot, { 'w-1': { hideDone: true } });
    expect(await store.loadViewSettings()).toEqual({ 'w-1': { hideDone: true } });
  });

  it('сохраняет и загружает полный снапшот', async () => {
    const store = new WorkspaceStore(`${DB_NAME}-roundtrip`);
    await store.save(snapshot);
    const loaded = await store.load();
    expect(loaded).toEqual(snapshot);
  });

  it('снапшот заменяет прежнее состояние целиком', async () => {
    const store = new WorkspaceStore(`${DB_NAME}-replace`);
    await store.save(snapshot);
    await store.save({
      tabs: [snapshot.tabs[0]],
      instances: [snapshot.instances[0]],
      activeTabId: 'tab-1',
    });
    const loaded = await store.load();
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.instances).toHaveLength(1);
    expect(loaded.tabs[0].id).toBe('tab-1');
  });

  it('пустой снапшот очищает хранилище', async () => {
    const store = new WorkspaceStore(`${DB_NAME}-empty`);
    await store.save(snapshot);
    await store.save({ tabs: [], instances: [], activeTabId: null });
    const loaded = await store.load();
    expect(loaded.tabs).toEqual([]);
    expect(loaded.instances).toEqual([]);
    expect(loaded.activeTabId).toBeNull();
  });

  it('обновление схемы v1→v2 сохраняет существующие документы', async () => {
    // БД «старого» приложения: версия 1, только документы.
    const legacy = new Dexie(`${DB_NAME}-upgrade`);
    legacy.version(1).stores({ documents: 'id, moduleId, documentType' });
    await legacy.open();
    await legacy
      .table('documents')
      .add({
        id: 'doc-legacy',
        moduleId: 'checklist',
        documentType: 'list',
        schemaVersion: 1,
        revision: 2,
        createdAt: '2026-10-12T00:00:00.000Z',
        updatedAt: '2026-10-12T00:00:00.000Z',
        content: { items: [] },
      });
    legacy.close();

    // «Новое» приложение открывает БД со схемой v2 и пишет рабочее пространство.
    const store = new WorkspaceStore(`${DB_NAME}-upgrade`);
    await store.save(snapshot);
    const loaded = await store.load();
    expect(loaded.tabs).toHaveLength(2);

    // Документ, записанный до появления хранилищ, доступен и не изменён.
    const reopened = new Dexie(`${DB_NAME}-upgrade`);
    reopened.version(1).stores({ documents: 'id, moduleId, documentType' });
    await reopened.open();
    const legacyDoc = await reopened.table('documents').get('doc-legacy');
    expect(legacyDoc?.revision).toBe(2);
    reopened.close();
  });

  it('будущая версия БД фиксируется при чтении нативной версии', async () => {
    // Открываем БД «более новым приложением» (схема v3).
    const future = new Dexie(`${DB_NAME}-future`);
    future.version(1).stores({ documents: 'id' });
    future.version(2).stores({ tabs: 'id' });
    future.version(3).stores({ extra: 'id' });
    await future.open();
    const nativeVersion = future.backendDB()?.version ?? 0;
    future.close();
    expect(nativeVersion).toBeGreaterThan(20);
  });
});
