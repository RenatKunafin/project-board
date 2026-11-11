import Dexie, { type Table } from 'dexie';
import {
  deserializeWorkspaceBackup,
  serializeWorkspaceBackup,
  type WorkspaceBackup,
  type WorkspaceBackupCompatibility,
  type WorkspaceBackupPayload,
} from './workspace-backup';

const FILES = ['project-board-recovery-a.json', 'project-board-recovery-b.json'] as const;
const FORMAT = 'project-board-recovery';
const LOCK = 'project-board-recovery-files';

type PermissionMode = 'read' | 'readwrite';
type Directory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: PermissionMode }): Promise<PermissionState>;
  requestPermission(options: { mode: PermissionMode }): Promise<PermissionState>;
};
type ConfigRow = { key: string; handle: Directory };

export interface RecoveryDirectoryCache {
  load(): Promise<FileSystemDirectoryHandle | null>;
  save(handle: FileSystemDirectoryHandle): Promise<void>;
  close(): void;
}

class IndexedDbDirectoryCache implements RecoveryDirectoryCache {
  private readonly db = new Dexie('project-board-recovery-config');
  private readonly config: Table<ConfigRow, string>;

  constructor() {
    this.db.version(1).stores({ config: 'key' });
    this.config = this.db.table('config');
  }

  async load(): Promise<FileSystemDirectoryHandle | null> {
    await this.db.open();
    return (await this.config.get('directory'))?.handle ?? null;
  }

  async save(handle: FileSystemDirectoryHandle): Promise<void> {
    await this.db.open();
    await this.config.put({ key: 'directory', handle: handle as Directory });
  }

  close(): void { this.db.close(); }
}

interface Envelope {
  readonly format: typeof FORMAT;
  readonly version: 1;
  readonly createdAt: string;
  readonly generation: number;
  readonly length: number;
  readonly sha256: string;
  readonly backupJson: string;
}

export interface RecoverySnapshot {
  readonly backup: WorkspaceBackup;
  readonly createdAt: string;
  readonly generation: number;
  readonly folderName: string;
}

export type RecoveryLookup =
  | { readonly status: 'unsupported' | 'unconfigured' | 'permission-required'; readonly folderName?: string }
  | { readonly status: 'empty' | 'corrupt'; readonly folderName: string; readonly writable: boolean }
  | { readonly status: 'ready'; readonly snapshot: RecoverySnapshot; readonly damagedSlot: boolean; readonly writable: boolean };

type Slot =
  | { readonly state: 'missing' | 'invalid' }
  | { readonly state: 'valid'; readonly envelope: Envelope; readonly backup: WorkspaceBackup };

/** Адаптер файловой системы и маленькой БД, хранящей только разрешённую папку. */
export class RecoverySnapshotStore {
  private handle: Directory | null = null;
  private loaded = false;

  constructor(
    private readonly compatibility: WorkspaceBackupCompatibility,
    private readonly cache: RecoveryDirectoryCache = new IndexedDbDirectoryCache(),
  ) {}

  /** Вызывается прямо из обработчика клика: picker требует жест пользователя. */
  async chooseDirectory(): Promise<RecoveryLookup> {
    const picker = (window as Window & {
      showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    if (!picker) return { status: 'unsupported' };
    const handle = await picker.call(window, { mode: 'readwrite' }) as Directory;
    await this.remember(handle);
    return this.readLatest();
  }

  /** Для повторного разрешения уже сохранённой папки, только по клику. */
  async requestWritePermission(): Promise<RecoveryLookup> {
    const handle = await this.directory();
    if (!handle) return { status: 'unconfigured' };
    if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      return { status: 'permission-required', folderName: handle.name };
    }
    return this.readLatest();
  }

  /** Доступный только для чтения дескриптор при запуске никогда не вызывает prompt. */
  async readLatest(): Promise<RecoveryLookup> {
    if (typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') {
      return { status: 'unsupported' };
    }
    const handle = await this.directory();
    if (!handle) return { status: 'unconfigured' };
    if (await handle.queryPermission({ mode: 'read' }) !== 'granted') {
      return { status: 'permission-required', folderName: handle.name };
    }
    const writable = await handle.queryPermission({ mode: 'readwrite' }) === 'granted';
    const slots = await Promise.all(FILES.map((name) => this.readSlot(handle, name)));
    const valid = slots.filter((slot): slot is Extract<Slot, { state: 'valid' }> => slot.state === 'valid');
    if (valid.length === 0) {
      return { status: slots.some((slot) => slot.state === 'invalid') ? 'corrupt' : 'empty', folderName: handle.name, writable };
    }
    const latest = valid.sort((a, b) => b.envelope.generation - a.envelope.generation)[0];
    return {
      status: 'ready',
      snapshot: { backup: latest.backup, createdAt: latest.envelope.createdAt, generation: latest.envelope.generation, folderName: handle.name },
      damagedSlot: slots.some((slot) => slot.state === 'invalid'),
      writable,
    };
  }

  /** Публикует новый файл в старшем свободном или устаревшем слоте. */
  async save(payload: WorkspaceBackupPayload): Promise<RecoverySnapshot> {
    const handle = await this.directory();
    if (!handle) throw new Error('Папка для автоматических копий не выбрана.');
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new Error('Доступ к папке для записи утрачен. Разрешите его в настройках.');
    }
    if (!navigator.locks?.request) throw new Error('Браузер не поддерживает безопасную запись копий между вкладками.');
    return navigator.locks.request(LOCK, async () => {
      const slots = await Promise.all(FILES.map((name) => this.readSlot(handle, name)));
      const valid = slots.filter((slot): slot is Extract<Slot, { state: 'valid' }> => slot.state === 'valid');
      if (valid.length === 0 && slots.some((slot) => slot.state === 'invalid')) {
        throw new Error('Оба файла копий повреждены или неизвестного формата. Выберите другую папку; файлы не изменены.');
      }
      const generation = Math.max(0, ...valid.map((slot) => slot.envelope.generation)) + 1;
      const target = slots.findIndex((slot) => slot.state !== 'valid');
      const index = target >= 0 ? target : slots[0].state === 'valid' && slots[1].state === 'valid' && slots[0].envelope.generation <= slots[1].envelope.generation ? 0 : 1;
      const createdAt = new Date().toISOString();
      const serialized = serializeWorkspaceBackup(payload, createdAt);
      if (!serialized.ok) throw new Error(serialized.issues.map((issue) => issue.message).join(' '));
      const checked = deserializeWorkspaceBackup(serialized.json, this.compatibility);
      if (!checked.ok) throw new Error(checked.issues.map((issue) => issue.message).join(' '));
      const bytes = new TextEncoder().encode(serialized.json);
      const envelope: Envelope = { format: FORMAT, version: 1, createdAt, generation, length: bytes.length, sha256: await digest(bytes), backupJson: serialized.json };
      const file = await handle.getFileHandle(FILES[index], { create: true });
      const writer = await file.createWritable();
      try {
        await writer.write(JSON.stringify(envelope));
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => {});
        throw error;
      }
      const verified = await this.readSlot(handle, FILES[index]);
      if (verified.state !== 'valid' || verified.envelope.generation !== generation || verified.envelope.sha256 !== envelope.sha256) {
        throw new Error('Новая копия не прошла проверку после записи.');
      }
      return { backup: verified.backup, createdAt, generation, folderName: handle.name };
    });
  }

  async hasWritePermission(): Promise<boolean> {
    const handle = await this.directory();
    return !!handle && await handle.queryPermission({ mode: 'readwrite' }) === 'granted';
  }

  close(): void { this.cache.close(); }

  private async remember(handle: Directory): Promise<void> {
    await this.cache.save(handle);
    this.handle = handle;
    this.loaded = true;
  }

  private async directory(): Promise<Directory | null> {
    if (!this.loaded) {
      this.handle = await this.cache.load() as Directory | null;
      this.loaded = true;
    }
    return this.handle;
  }

  private async readSlot(directory: Directory, name: string): Promise<Slot> {
    let file: FileSystemFileHandle;
    try {
      file = await directory.getFileHandle(name);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return { state: 'missing' };
      throw error;
    }
    try {
      const value: unknown = JSON.parse(await (await file.getFile()).text());
      if (!isEnvelope(value)) return { state: 'invalid' };
      const bytes = new TextEncoder().encode(value.backupJson);
      if (bytes.length !== value.length || await digest(bytes) !== value.sha256) return { state: 'invalid' };
      const decoded = deserializeWorkspaceBackup(value.backupJson, this.compatibility);
      if (!decoded.ok || decoded.value.createdAt !== value.createdAt) return { state: 'invalid' };
      return { state: 'valid', envelope: value, backup: decoded.value };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw error;
      return { state: 'invalid' };
    }
  }
}

function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join(',') === 'backupJson,createdAt,format,generation,length,sha256,version' &&
    item.format === FORMAT && item.version === 1 &&
    typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) &&
    Number.isSafeInteger(item.generation) && (item.generation as number) > 0 &&
    Number.isSafeInteger(item.length) && (item.length as number) >= 0 &&
    typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.sha256) &&
    typeof item.backupJson === 'string';
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
