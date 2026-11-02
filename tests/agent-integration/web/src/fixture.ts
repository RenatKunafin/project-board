/** Общие константы стенда: цель, БД, fixtures. Совпадают с сервером осознанно (браузер не импортирует сервер). */

export const PROBE_SCHEMA_VERSION = 1;
export const PROBE_TARGET_DOCUMENT_ID = 'agent-probe/snapshot-v1';
export const PROBE_DOCUMENT_TYPE = 'agent-probe/snapshot';
export const PROBE_MODULE_ID = 'agent-probe';
export const PROBE_DB_NAME = 'project-board-pbt-121-probe-v1';

export interface ProbeSnapshotItem {
  readonly id: string;
  readonly title: string;
  readonly status: 'todo' | 'in-progress' | 'done';
  readonly points: number;
}

export interface ProbeSnapshot {
  readonly kind: 'agent-probe-snapshot';
  readonly schemaVersion: number;
  readonly fixtureId: string;
  readonly sprintName: string;
  readonly asOf: string;
  readonly items: readonly ProbeSnapshotItem[];
}

/** Fixture A — известное начальное содержимое тестового документа. */
export const FIXTURE_A: ProbeSnapshot = {
  kind: 'agent-probe-snapshot',
  schemaVersion: PROBE_SCHEMA_VERSION,
  fixtureId: 'fixture-a',
  sprintName: 'Синтетический спринт A',
  asOf: '2026-11-02T00:00:00.000Z',
  items: [
    { id: 'a-1', title: 'Начальная задача 1', status: 'todo', points: 2 },
    { id: 'a-2', title: 'Начальная задача 2', status: 'todo', points: 3 },
  ],
};
