import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoverySnapshotStore, type RecoveryDirectoryCache } from './recovery-snapshot-store';
import type { WorkspaceBackupPayload } from './workspace-backup';

const compatibility = { widgetTypeIds: [], documentTypes: [] };
const payload: WorkspaceBackupPayload = {
  documents: [],
  workspace: { tabs: [{ id: 'one', title: 'Одна', position: 0, mode: 'grid', cascadeOrder: [], active: 1 }], instances: [], activeTabId: 'one' },
  viewSettings: {},
};

class MemoryDirectory {
  readonly name = 'копии';
  readonly files = new Map<string, string>();
  permission: PermissionState = 'granted';
  failNextWrite = false;

  async queryPermission(): Promise<PermissionState> { return this.permission; }
  async requestPermission(): Promise<PermissionState> { this.permission = 'granted'; return this.permission; }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
    return {
      getFile: async () => ({ text: async () => this.files.get(name) ?? '' }),
      createWritable: async () => {
        let buffer = '';
        return {
          write: async (value: string) => {
            if (this.failNextWrite) { this.failNextWrite = false; throw new Error('disk full'); }
            buffer = value;
          },
          close: async () => { this.files.set(name, buffer); },
          abort: async () => {},
        };
      },
    };
  }
}

class MemoryCache implements RecoveryDirectoryCache {
  handle: FileSystemDirectoryHandle | null = null;
  async load() { return this.handle; }
  async save(handle: FileSystemDirectoryHandle) { this.handle = handle; }
  close() {}
}

let directory: MemoryDirectory;
let cache: MemoryCache;

beforeEach(() => {
  directory = new MemoryDirectory();
  cache = new MemoryCache();
  vi.stubGlobal('window', { showDirectoryPicker: async () => directory });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, callback: () => Promise<unknown>) => callback() } });
});
afterEach(() => vi.unstubAllGlobals());

function createStore() { return new RecoverySnapshotStore(compatibility, cache); }
function snapshot(id: string): WorkspaceBackupPayload {
  return { ...payload, workspace: { ...payload.workspace, tabs: [{ ...payload.workspace.tabs[0], id }], activeTabId: id } };
}

describe('файловые аварийные копии', () => {
  it('сохраняет два полных файла, выбирает новейший и откатывается к прежнему при порче', async () => {
    const store = createStore();
    await store.chooseDirectory();
    await store.save(snapshot('one'));
    await store.save(snapshot('two'));
    const third = await store.save(snapshot('three'));
    expect(third.generation).toBe(3);
    expect(directory.files.size).toBe(2);
    expect((await store.readLatest()).status).toBe('ready');
    directory.files.set('project-board-recovery-a.json', '{broken');
    const recovered = await store.readLatest();
    expect(recovered.status).toBe('ready');
    if (recovered.status === 'ready') {
      expect(recovered.snapshot.backup.workspace.activeTabId).toBe('two');
      expect(recovered.damagedSlot).toBe(true);
    }
    await store.save(snapshot('four'));
    const latest = await store.readLatest();
    expect(latest.status === 'ready' && latest.snapshot.backup.workspace.activeTabId).toBe('four');
    store.close();
  });

  it('сохраняет прежний файл при отказе записи и не считает новый подтверждённым', async () => {
    const store = createStore();
    await store.chooseDirectory();
    await store.save(snapshot('safe'));
    directory.failNextWrite = true;
    await expect(store.save(snapshot('lost'))).rejects.toThrow('disk full');
    const latest = await store.readLatest();
    expect(latest.status === 'ready' && latest.snapshot.backup.workspace.activeTabId).toBe('safe');
    store.close();
  });

  it('после потери указателя читает внешний файл при повторном выборе папки', async () => {
    const store = createStore();
    await store.chooseDirectory();
    await store.save(snapshot('survives'));
    store.close();
    cache = new MemoryCache(); // аналог очистки данных сайта
    const fresh = createStore();
    expect((await fresh.readLatest()).status).toBe('unconfigured');
    const found = await fresh.chooseDirectory();
    expect(found.status === 'ready' && found.snapshot.backup.workspace.activeTabId).toBe('survives');
    fresh.close();
  });

  it('после отзыва разрешения не выдаёт папку за защищённую и позволяет разрешить снова', async () => {
    const store = createStore();
    await store.chooseDirectory();
    await store.save(payload);
    directory.permission = 'prompt';
    expect((await store.readLatest()).status).toBe('permission-required');
    expect((await store.requestWritePermission()).status).toBe('ready');
    store.close();
  });

  it('не перезаписывает два повреждённых файла', async () => {
    directory.files.set('project-board-recovery-a.json', 'broken');
    directory.files.set('project-board-recovery-b.json', 'broken');
    const store = createStore();
    expect((await store.chooseDirectory()).status).toBe('corrupt');
    await expect(store.save(payload)).rejects.toThrow('повреждены');
    expect([...directory.files.values()]).toEqual(['broken', 'broken']);
    store.close();
  });

  it('сериализует записи из двух вкладок и повторно читает поколение под lock', async () => {
    let tail = Promise.resolve();
    vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => Promise<unknown>) => {
      const operation = tail.then(callback);
      tail = operation.then(() => {}, () => {});
      return operation;
    } } });
    const first = createStore();
    const second = createStore();
    await first.chooseDirectory();
    expect((await second.readLatest()).status).toBe('empty');
    const result = await Promise.all([first.save(snapshot('first')), second.save(snapshot('second'))]);
    expect(result.map((item) => item.generation)).toEqual([1, 2]);
    expect(directory.files.size).toBe(2);
    first.close(); second.close();
  });

  it('отклоняет снимок будущей версии даже при совпадающем digest', async () => {
    const store = createStore();
    await store.chooseDirectory();
    await store.save(payload);
    const name = 'project-board-recovery-a.json';
    const envelope = JSON.parse(directory.files.get(name)!) as { backupJson: string; length: number; sha256: string };
    envelope.backupJson = JSON.stringify({ ...JSON.parse(envelope.backupJson), formatVersion: 99 });
    const bytes = new TextEncoder().encode(envelope.backupJson);
    envelope.length = bytes.length;
    envelope.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    directory.files.set(name, JSON.stringify(envelope));
    expect((await store.readLatest()).status).toBe('corrupt');
    store.close();
  });
});
