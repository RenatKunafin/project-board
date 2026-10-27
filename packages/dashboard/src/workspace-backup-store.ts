import Dexie, { type Table } from 'dexie';
import type { ManagedDocument } from '@project-board/widget-sdk';
import { SCHEMA_V1_DECLARATIONS, SCHEMA_V2_DECLARATIONS, SCHEMA_V3_DECLARATIONS } from './db-schema';
import type { WorkspaceBackup, WorkspaceBackupPayload } from './workspace-backup';
import type { WorkspaceSnapshot } from './workspace-store';

export type WorkspaceBackupKind = 'manual' | 'safety';
export const MAX_WORKSPACE_BACKUPS = 5;

export interface StoredWorkspaceBackup {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: WorkspaceBackupKind;
  readonly size: number;
  readonly backup: WorkspaceBackup;
}

export interface WorkspaceBackupCapture {
  readonly payload: WorkspaceBackupPayload;
  readonly generation: number;
}

type BackupRow = StoredWorkspaceBackup;
type DocumentRow = ManagedDocument;
interface TabRow { id: string; title: string; position: number; mode: 'grid' | 'cascade'; cascadeOrder: string[]; active: number; }
interface InstanceRow { id: string; tabId: string; typeId: string; documentId?: string; label?: string; collapsed: number; gridArea?: unknown; cascadeArea?: unknown; }
interface SettingRow { key: string; value: unknown; }

/** IndexedDB boundary for the backup history and atomic workspace replacement. */
export class WorkspaceBackupStore {
  private readonly db: Dexie;
  private readonly documents: Table<DocumentRow, string>;
  private readonly tabs: Table<TabRow, string>;
  private readonly instances: Table<InstanceRow, string>;
  private readonly settings: Table<SettingRow, string>;
  private readonly backups: Table<BackupRow, string>;

  constructor(name: string) {
    this.db = new Dexie(name);
    this.db.version(1).stores(SCHEMA_V1_DECLARATIONS);
    this.db.version(2).stores(SCHEMA_V2_DECLARATIONS);
    this.db.version(3).stores(SCHEMA_V3_DECLARATIONS);
    this.documents = this.db.table('documents');
    this.tabs = this.db.table('tabs');
    this.instances = this.db.table('widgetInstances');
    this.settings = this.db.table('settings');
    this.backups = this.db.table('backups');
  }

  async list(): Promise<StoredWorkspaceBackup[]> {
    await this.db.open();
    return (await this.backups.toArray()).sort(compareBackups);
  }

  async get(id: string): Promise<StoredWorkspaceBackup | undefined> {
    await this.db.open();
    return this.backups.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.open();
    await this.backups.delete(id);
  }

  /** Snapshot all persisted data together after callers have flushed their queues. */
  async readSnapshot(): Promise<WorkspaceBackupPayload> {
    return (await this.readCapture()).payload;
  }

  async readCapture(): Promise<WorkspaceBackupCapture> {
    await this.db.open();
    return this.db.transaction('r', [this.documents, this.tabs, this.instances, this.settings], async () => {
      return this.readSnapshotInTransaction();
    });
  }

  /** Stores a manual backup only if the captured source is still current. */
  async addCapture(backup: WorkspaceBackup, capture: WorkspaceBackupCapture, kind: WorkspaceBackupKind): Promise<StoredWorkspaceBackup> {
    await this.db.open();
    const row: BackupRow = { id: crypto.randomUUID(), createdAt: backup.createdAt, kind, size: new Blob([JSON.stringify(backup, null, 2)]).size, backup };
    await this.db.transaction('rw', [this.documents, this.tabs, this.instances, this.settings, this.backups], async () => {
      const current = await this.readSnapshotInTransaction();
      assertSameCapture(capture, current);
      await this.backups.add(row);
      await this.trimHistory();
    });
    return row;
  }

  /** Replaces documents/workspace/settings and optionally stores a safety copy atomically. */
  async replace(payload: WorkspaceBackupPayload, expectedCurrent: WorkspaceBackupCapture, safetyBackup?: WorkspaceBackup): Promise<void> {
    await this.db.open();
    await this.db.transaction('rw', [this.documents, this.tabs, this.instances, this.settings, this.backups], async () => {
      const current = await this.readSnapshotInTransaction();
      assertSameCapture(expectedCurrent, current);
      if (safetyBackup) await this.insertBackup({ ...safetyBackup, ...current.payload }, 'safety');
      await this.documents.clear();
      await this.documents.bulkPut(payload.documents as DocumentRow[]);
      await this.tabs.clear();
      await this.instances.clear();
      await this.tabs.bulkPut(payload.workspace.tabs.map((tab, position) => ({ ...tab, position, cascadeOrder: [...tab.cascadeOrder] })) as TabRow[]);
      await this.instances.bulkPut(payload.workspace.instances.map((instance) => ({ ...instance })) as InstanceRow[]);
      await this.settings.clear();
      await this.settings.put({ key: 'workspace', value: { activeTabId: payload.workspace.activeTabId } });
      await this.settings.bulkPut(Object.entries(payload.viewSettings).map(([id, value]) => ({ key: `view:${id}`, value })));
      await this.settings.put({ key: '__generation', value: current.generation + 1 });
      await this.trimHistory();
    });
  }

  close(): void { this.db.close(); }

  private async readSnapshotInTransaction(): Promise<WorkspaceBackupCapture> {
    const documents = await this.documents.toArray();
    const tabs = (await this.tabs.toArray()).sort((a, b) => a.position - b.position);
    const instances = await this.instances.toArray();
    const settings = await this.settings.toArray();
    const instanceIds = new Set(instances.map((instance) => instance.id));
    const activeTabId = (settings.find((row) => row.key === 'workspace')?.value as { activeTabId?: unknown } | undefined)?.activeTabId;
    const viewSettings: Record<string, Record<string, unknown>> = {};
    for (const row of settings) {
      if (!row.key.startsWith('view:')) continue;
      const instanceId = row.key.slice(5);
      if (!instanceIds.has(instanceId) || !row.value || typeof row.value !== 'object' || Array.isArray(row.value)) continue;
      Object.defineProperty(viewSettings, instanceId, { value: row.value, enumerable: true, configurable: true, writable: true });
    }
    const generationRow = settings.find((row) => row.key === '__generation');
    return { payload: { documents, workspace: { tabs: tabs.map((tab) => ({ ...tab, active: tab.active === 1 ? 1 : 0 })), instances: instances.map((item) => ({ ...item, collapsed: item.collapsed === 1 ? 1 : 0 })), activeTabId: typeof activeTabId === 'string' ? activeTabId : null } as WorkspaceSnapshot, viewSettings }, generation: typeof generationRow?.value === 'number' ? generationRow.value : 0 };
  }

  private async insertBackup(backup: WorkspaceBackup, kind: WorkspaceBackupKind): Promise<void> {
    const row: BackupRow = { id: crypto.randomUUID(), createdAt: backup.createdAt, kind, size: new Blob([JSON.stringify(backup, null, 2)]).size, backup };
    await this.backups.add(row);
  }

  private async trimHistory(): Promise<void> {
    const rows = (await this.backups.toArray()).sort(compareBackups);
    await this.backups.bulkDelete(rows.slice(0, Math.max(0, rows.length - MAX_WORKSPACE_BACKUPS)).map((row) => row.id));
  }
}

function assertSameCapture(expected: WorkspaceBackupCapture, current: WorkspaceBackupCapture): void {
  if (expected.generation !== current.generation || JSON.stringify(expected.payload) !== JSON.stringify(current.payload)) {
    throw new Error('Рабочее пространство изменилось в другом окне. Перечитайте данные и повторите операцию.');
  }
}

function compareBackups(a: StoredWorkspaceBackup, b: StoredWorkspaceBackup): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
