import Dexie, { type Table } from 'dexie';
import {
  DOCUMENTS_TABLE_DECLARATION,
  WORKSPACE_DB_SCHEMA_VERSION,
  WORKSPACE_TABLE_DECLARATIONS,
} from './db-schema';

export interface WorkspaceTabRecord {
  readonly id: string;
  readonly title: string;
  readonly position: number;
  readonly mode: 'grid' | 'cascade';
  /** Порядок глубины каскада: идентификаторы снизу вверх. */
  readonly cascadeOrder: readonly string[];
  readonly active: 0 | 1;
}

export interface GridAreaRecord {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CascadeAreaRecord {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WidgetInstanceRecord {
  readonly id: string;
  readonly tabId: string;
  readonly typeId: string;
  readonly documentId?: string;
  readonly label?: string;
  readonly collapsed: 0 | 1;
  readonly gridArea?: GridAreaRecord | null;
  readonly cascadeArea?: CascadeAreaRecord | null;
}

export interface WorkspaceSnapshot {
  readonly tabs: readonly WorkspaceTabRecord[];
  readonly instances: readonly WidgetInstanceRecord[];
  readonly activeTabId: string | null;
}

interface TabRow {
  id: string;
  title: string;
  position: number;
  mode: 'grid' | 'cascade';
  cascadeOrder: string[];
  active: number;
}

interface InstanceRow {
  id: string;
  tabId: string;
  typeId: string;
  documentId?: string;
  label?: string;
  collapsed: number;
  gridArea?: GridAreaRecord | null;
  cascadeArea?: CascadeAreaRecord | null;
}

interface SettingRow {
  key: string;
  value: unknown;
}

export class WorkspaceStore {
  private readonly db: Dexie;
  private readonly tabs: Table<TabRow, string>;
  private readonly instances: Table<InstanceRow, string>;
  private readonly settings: Table<SettingRow, string>;
  private opened = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(name: string) {
    this.db = new Dexie(name);
    this.db
      .version(WORKSPACE_DB_SCHEMA_VERSION - 1)
      .stores({ documents: DOCUMENTS_TABLE_DECLARATION });
    this.db
      .version(WORKSPACE_DB_SCHEMA_VERSION)
      .stores(WORKSPACE_TABLE_DECLARATIONS);
    this.tabs = this.db.table('tabs');
    this.instances = this.db.table('widgetInstances');
    this.settings = this.db.table('settings');
  }

  async load(): Promise<WorkspaceSnapshot> {
    await this.openOnce();
    const tabs = await this.tabs.toArray();
    const instances = await this.instances.toArray();
    const setting = await this.settings.get('workspace');
    const activeTabId =
      setting && typeof setting.value === 'object' && setting.value !== null
        ? ((setting.value as { activeTabId?: unknown }).activeTabId ?? null)
        : null;
    return {
      tabs: tabs
        .map((row): WorkspaceTabRecord => ({
          id: row.id,
          title: row.title,
          position: row.position,
          mode: row.mode === 'grid' ? 'grid' : 'cascade',
          cascadeOrder: Array.isArray(row.cascadeOrder)
            ? row.cascadeOrder.filter((id) => typeof id === 'string')
            : [],
          active: row.active === 1 ? 1 : 0,
        }))
        .sort((a, b) => a.position - b.position),
      instances: instances.map((row) => ({
        id: row.id,
        tabId: row.tabId,
        typeId: row.typeId,
        documentId: row.documentId,
        label: row.label,
        collapsed: row.collapsed === 1 ? 1 : 0,
        gridArea: row.gridArea ?? null,
        cascadeArea: row.cascadeArea ?? null,
      })),
      activeTabId: typeof activeTabId === 'string' ? activeTabId : null,
    };
  }

  save(snapshot: WorkspaceSnapshot): Promise<void> {
    return this.enqueue(() => this.writeSnapshot(snapshot));
  }

  /** Запись актуального workspace и настроек после всех ранее начатых записей. */
  flush(
    snapshot: WorkspaceSnapshot,
    viewSettings: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    return this.enqueue(() => this.writeSnapshot(snapshot, viewSettings));
  }

  private async writeSnapshot(
    snapshot: WorkspaceSnapshot,
    viewSettings?: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    const tabRows: TabRow[] = snapshot.tabs.map((tab, index) => ({
      id: tab.id,
      title: tab.title,
      position: tab.position ?? index,
      mode: tab.mode === 'grid' ? 'grid' : 'cascade',
      cascadeOrder: [...tab.cascadeOrder],
      active: tab.active,
    }));
    const instanceRows: InstanceRow[] = snapshot.instances.map((instance) => ({
      id: instance.id,
      tabId: instance.tabId,
      typeId: instance.typeId,
      documentId: instance.documentId,
      label: instance.label,
      collapsed: instance.collapsed,
      gridArea: instance.gridArea ?? null,
      cascadeArea: instance.cascadeArea ?? null,
    }));
    await this.db.transaction(
      'rw',
      [this.tabs, this.instances, this.settings],
      async () => {
        await this.tabs.clear();
        await this.instances.clear();
        await this.tabs.bulkPut(tabRows);
        await this.instances.bulkPut(instanceRows);
        await this.settings.put({
          key: 'workspace',
          value: { activeTabId: snapshot.activeTabId },
        });
        if (viewSettings) {
          await this.settings.bulkPut(Object.entries(viewSettings).map(([id, value]) => ({ key: `view:${id}`, value })));
        }
      },
    );
  }

  /**
   * Состояние представлений экземпляров (PBT-049, ADR-6.4): ключи
   * `view:<instanceId>` в общей KV-таблице settings — без смены схемы БД.
   */
  async loadViewSettings(): Promise<Record<string, Record<string, unknown>>> {
    await this.openOnce();
    const rows = await this.settings.toArray();
    const result: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      if (!row.key.startsWith('view:')) {
        continue;
      }
      if (
        typeof row.value === 'object' &&
        row.value !== null &&
        !Array.isArray(row.value)
      ) {
        result[row.key.slice('view:'.length)] = {
          ...(row.value as Record<string, unknown>),
        };
      }
    }
    return result;
  }

  saveViewSetting(
    instanceId: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    return this.enqueue(async () => {
      await this.settings.put({ key: `view:${instanceId}`, value });
    });
  }

  /** Удаление настроек закрытых экземпляров после всех прежних записей. */
  deleteViewSettings(instanceIds: readonly string[]): Promise<void> {
    return this.enqueue(async () => {
      await this.settings.bulkDelete(instanceIds.map((id) => `view:${id}`));
    });
  }

  private enqueue(write: () => Promise<void>): Promise<void> {
    const operation = this.writes.then(async () => {
      await this.openOnce();
      await write();
    });
    // Отказ виден вызывающему; следующий save/flush может повторить актуальное состояние.
    this.writes = operation.catch(() => {});
    return operation;
  }

  private async openOnce(): Promise<void> {
    if (!this.opened) {
      await this.db.open();
      this.opened = true;
    }
  }
}
