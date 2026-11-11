import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoverySnapshotCoordinator } from './recovery-snapshot-coordinator';
import type { RecoverySnapshotStore } from './recovery-snapshot-store';
import type { WorkspaceBackupPayload } from './workspace-backup';

const payload: WorkspaceBackupPayload = {
  documents: [],
  workspace: { tabs: [], instances: [], activeTabId: null },
  viewSettings: {},
};
const snapshot = { backup: { ...payload, format: 'project-board-workspace' as const, formatVersion: 1 as const, workspaceSchemaVersion: 1 as const, createdAt: '2026-01-01T00:00:00.000Z' }, createdAt: '2026-01-01T00:00:00.000Z', generation: 1, folderName: 'копии' };

function setup(save = vi.fn().mockResolvedValue(snapshot)) {
  const store = {
    readLatest: vi.fn().mockResolvedValue({ status: 'ready', snapshot, damagedSlot: false, writable: true }),
    save,
  } as unknown as RecoverySnapshotStore;
  const capture = vi.fn().mockResolvedValue(payload);
  const coordinator = new RecoverySnapshotCoordinator(store, capture, {
    timers: {
      now: () => Date.now(),
      setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id),
    },
  });
  return { store, capture, coordinator, save };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

describe('30-секундный debounce аварийной копии', () => {
  it('пишет через 30 секунд после последней подтверждённой правки без maxWait', async () => {
    const { coordinator, save } = setup();
    await coordinator.refresh();
    coordinator.setEnabled(true);
    for (let i = 0; i < 10; i++) {
      coordinator.markPersistedChange();
      await vi.advanceTimersByTimeAsync(20_000);
    }
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(coordinator.getStatus().phase).toBe('saved');
    coordinator.dispose();
  });

  it('не теряет новую серию, поступившую во время долгой записи', async () => {
    let finish!: (value: typeof snapshot) => void;
    const pending = new Promise<typeof snapshot>((resolve) => { finish = resolve; });
    const save = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(snapshot);
    const { coordinator } = setup(save);
    await coordinator.refresh();
    coordinator.setEnabled(true);
    coordinator.markPersistedChange();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(coordinator.getStatus().phase).toBe('saving');
    coordinator.markPersistedChange();
    await vi.advanceTimersByTimeAsync(20_000);
    finish(snapshot);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it('после ошибки сохраняет дату прежней копии и повторяет запись после следующей правки', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(snapshot);
    const { coordinator } = setup(save);
    await coordinator.refresh();
    coordinator.setEnabled(true);
    coordinator.markPersistedChange();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(coordinator.getStatus()).toMatchObject({ phase: 'error', lastSnapshot: snapshot });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(save).toHaveBeenCalledTimes(1);
    coordinator.markPersistedChange();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(coordinator.getStatus().phase).toBe('saved');
    coordinator.dispose();
  });
});
