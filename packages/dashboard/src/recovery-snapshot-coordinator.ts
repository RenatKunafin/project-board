import type { WorkspaceBackupPayload } from './workspace-backup';
import { RecoverySnapshotStore, type RecoveryLookup, type RecoverySnapshot } from './recovery-snapshot-store';

export interface RecoveryProtectionStatus {
  readonly phase: 'unconfigured' | 'unsupported' | 'permission-required' | 'waiting' | 'saving' | 'saved' | 'error';
  readonly folderName?: string;
  readonly lastSnapshot?: RecoverySnapshot;
  readonly error?: string;
}

export interface RecoveryCoordinatorTimers {
  readonly setTimeout: (handler: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly now: () => number;
}

const systemTimers: RecoveryCoordinatorTimers = {
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  now: () => Date.now(),
};

/** Обычный debounce для файловой копии, отдельный от записи основной БД. */
export class RecoverySnapshotCoordinator {
  private status: RecoveryProtectionStatus = { phase: 'unconfigured' };
  private readonly listeners = new Set<(status: RecoveryProtectionStatus) => void>();
  private readonly timers: RecoveryCoordinatorTimers;
  private readonly delayMs: number;
  private enabled = false;
  private timer: number | null = null;
  private dueAt: number | null = null;
  private dirtyVersion = 0;
  private savedVersion = 0;
  private writing = false;
  private blockedCorrupt = false;

  constructor(
    readonly store: RecoverySnapshotStore,
    private readonly capture: () => Promise<WorkspaceBackupPayload>,
    options: { delayMs?: number; timers?: RecoveryCoordinatorTimers } = {},
  ) {
    this.delayMs = options.delayMs ?? 30_000;
    this.timers = options.timers ?? systemTimers;
  }

  getStatus(): RecoveryProtectionStatus { return this.status; }

  subscribe(handler: (status: RecoveryProtectionStatus) => void): () => void {
    this.listeners.add(handler);
    handler(this.status);
    return () => this.listeners.delete(handler);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearTimer();
    else if (this.dirtyVersion > this.savedVersion && this.dueAt !== null) this.schedule();
  }

  async refresh(): Promise<RecoveryLookup> {
    const lookup = await this.store.readLatest();
    this.applyLookup(lookup);
    return lookup;
  }

  async chooseDirectory(): Promise<RecoveryLookup> {
    const lookup = await this.store.chooseDirectory();
    this.applyLookup(lookup);
    if (lookup.status === 'empty' && lookup.writable) this.markPersistedChange();
    return lookup;
  }

  async requestWritePermission(): Promise<RecoveryLookup> {
    const lookup = await this.store.requestWritePermission();
    this.applyLookup(lookup);
    if (lookup.status === 'empty' && lookup.writable) this.markPersistedChange();
    return lookup;
  }

  markPersistedChange(): void {
    if (!this.enabled) return;
    if (this.blockedCorrupt || this.status.phase === 'unconfigured' || this.status.phase === 'unsupported' || this.status.phase === 'permission-required') return;
    this.dirtyVersion += 1;
    this.dueAt = this.timers.now() + this.delayMs;
    this.publish({ ...this.status, phase: 'waiting', error: undefined });
    this.schedule();
  }

  dispose(): void { this.clearTimer(); this.listeners.clear(); }

  private applyLookup(lookup: RecoveryLookup): void {
    this.blockedCorrupt = lookup.status === 'corrupt';
    if (lookup.status === 'ready') {
      this.publish({ phase: lookup.writable ? 'saved' : 'permission-required', folderName: lookup.snapshot.folderName, lastSnapshot: lookup.snapshot });
    } else if (lookup.status === 'empty') {
      this.publish({ phase: lookup.writable ? 'waiting' : 'permission-required', folderName: lookup.folderName });
    } else if (lookup.status === 'corrupt') {
      this.publish({ phase: 'error', folderName: lookup.folderName, error: 'Файлы копий повреждены или неизвестного формата.' });
    } else {
      this.publish({ phase: lookup.status, folderName: lookup.folderName });
    }
  }

  private publish(status: RecoveryProtectionStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.enabled || this.dueAt === null || this.writing) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.write().catch((error: unknown) => {
        console.error('recovery snapshot failed', error);
      });
    }, Math.max(0, this.dueAt - this.timers.now()));
  }

  private async write(): Promise<void> {
    if (!this.enabled || this.writing || this.dueAt === null) return;
    this.writing = true;
    const version = this.dirtyVersion;
    this.dueAt = null;
    this.publish({ ...this.status, phase: 'saving', error: undefined });
    try {
      const payload = await this.capture();
      const snapshot = await this.store.save(payload);
      this.savedVersion = version;
      this.publish({ phase: this.dirtyVersion > version ? 'waiting' : 'saved', folderName: snapshot.folderName, lastSnapshot: snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permission = /доступ к папке|разреш/i.test(message);
      this.blockedCorrupt = /оба файла копий повреждены/i.test(message);
      this.publish({ ...this.status, phase: permission ? 'permission-required' : 'error', error: message });
    } finally {
      this.writing = false;
      if (this.dirtyVersion > version && this.dueAt === null && !this.blockedCorrupt && this.status.phase !== 'permission-required') {
        this.dueAt = this.timers.now() + this.delayMs;
      }
      this.schedule();
    }
  }
}
