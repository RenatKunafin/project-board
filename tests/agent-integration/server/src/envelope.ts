import { z } from 'zod';

/** Лимит JSON-тела браузерных endpoints (D4). */
export const MAX_JSON_BYTES = 32 * 1024;

export const PROBE_SCHEMA_VERSION = 1;

/** Единственная тестовая цель стенда (D5): синтетический снимок спринта. */
export const PROBE_TARGET_DOCUMENT_ID = 'agent-probe/snapshot-v1';
export const PROBE_DOCUMENT_TYPE = 'agent-probe/snapshot';
export const PROBE_DB_NAME = 'project-board-pbt-121-probe-v1';

/** Синтетический снимок: фиксированные значения, назначение — сверка переноса. */
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

/** Fixture A — начальное содержимое тестового документа до любого обмена. */
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

/** Fixture B — ожидаемый результат одного синтетического обмена. */
export const FIXTURE_B: ProbeSnapshot = {
  kind: 'agent-probe-snapshot',
  schemaVersion: PROBE_SCHEMA_VERSION,
  fixtureId: 'fixture-b',
  sprintName: 'Синтетический спринт B',
  asOf: '2026-11-02T12:00:00.000Z',
  items: [
    { id: 'a-1', title: 'Начальная задача 1', status: 'done', points: 2 },
    { id: 'a-2', title: 'Начальная задача 2', status: 'in-progress', points: 3 },
    { id: 'b-1', title: 'Добавленная синтетическая задача', status: 'todo', points: 5 },
  ],
};

export const probeSnapshotSchema = z.object({
  kind: z.literal('agent-probe-snapshot'),
  schemaVersion: z.literal(PROBE_SCHEMA_VERSION),
  fixtureId: z.string().min(1),
  sprintName: z.string().min(1),
  asOf: z.string().min(1),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        status: z.enum(['todo', 'in-progress', 'done']),
        points: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

/** Конверт запроса: адресные поля сверяются обеими сторонами (D5). */
export interface ProbeRequestEnvelope {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly requestId: string;
  readonly targetDocumentId: string;
  readonly baseRevision: number;
  readonly fixtureId: string;
  readonly expiresAt: number;
  readonly nonce: string;
}

/** Результат: повторяет адресные поля, добавляет снимок и идентификатор. */
export interface ProbeResultEnvelope {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly requestId: string;
  readonly targetDocumentId: string;
  readonly resultId: string;
  readonly nonce: string;
  readonly snapshot: ProbeSnapshot;
}

export const probeResultEnvelopeSchema = z.object({
  schemaVersion: z.literal(PROBE_SCHEMA_VERSION),
  runId: z.string().min(1),
  requestId: z.string().min(1),
  targetDocumentId: z.string().min(1),
  resultId: z.string().min(1),
  nonce: z.string().min(1),
  snapshot: probeSnapshotSchema,
});

export function isExpectedResult(
  result: ProbeResultEnvelope,
  expected: {
    readonly runId: string;
    readonly requestId: string;
    readonly nonce: string;
    readonly targetDocumentId: string;
    readonly fixtureId: string;
  },
): boolean {
  return (
    result.runId === expected.runId &&
    result.requestId === expected.requestId &&
    result.nonce === expected.nonce &&
    result.targetDocumentId === expected.targetDocumentId &&
    result.snapshot.fixtureId === expected.fixtureId
  );
}

export class EnvelopeError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid-payload' | 'mismatch' | 'too-large',
  ) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

/** Разбор результата исполнителя с лимитом размера и строгой схемой. */
export function parseResultPayload(payload: unknown): ProbeResultEnvelope {
  let raw: string;
  if (typeof payload !== 'string') {
    throw new EnvelopeError('Результат должен быть JSON-строкой', 'invalid-payload');
  }
  if (Buffer.byteLength(payload, 'utf8') > MAX_JSON_BYTES) {
    throw new EnvelopeError('Результат превышает 32 KiB', 'too-large');
  }
  try {
    raw = JSON.stringify(JSON.parse(payload));
  } catch {
    throw new EnvelopeError('Результат не является корректным JSON', 'invalid-payload');
  }
  const parsed = probeResultEnvelopeSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new EnvelopeError(`Схема результата не совпадает: ${parsed.error.issues[0]?.path.join('.') ?? 'root'}`, 'invalid-payload');
  }
  return parsed.data;
}
