import type { AutosavingDocumentService } from '@project-board/dashboard';
import type { DocumentStore } from '@project-board/dashboard';
import type { ManagedDocument } from '@project-board/widget-sdk';
import type { ProbeEnvelopeWire, ProbeRequestInfo, ProbeSnapshotWire } from './probe-client.js';
import { PROBE_DB_NAME, PROBE_DOCUMENT_TYPE, PROBE_MODULE_ID, FIXTURE_A } from './fixture.js';

/**
 * Применение результата через реальный сервис документов (D6):
 * update по expectedRevision → flushAll → контрольное чтение store.get → ACK.
 */

export interface ProbeDocumentInit {
  readonly document: ManagedDocument;
  readonly created: boolean;
  readonly restoredRevision: number;
}

interface SnapshotContent {
  readonly kind: 'agent-probe-snapshot';
  readonly schemaVersion: number;
  readonly fixtureId: string;
  readonly sprintName: string;
  readonly asOf: string;
  readonly items: readonly { readonly id: string; readonly title: string; readonly status: string; readonly points: number }[];
  readonly lastAppliedRequestId?: string;
  readonly lastAppliedResultId?: string;
  readonly lastAppliedRevision?: number;
}

export type ApplyOutcome =
  | { readonly kind: 'applied'; readonly revision: number }
  | { readonly kind: 'duplicate'; readonly revision: number }
  | { readonly kind: 'mismatch'; readonly message: string }
  | { readonly kind: 'save-error'; readonly message: string };

function isSnapshotShape(value: unknown): value is ProbeSnapshotWire {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProbeSnapshotWire>;
  return (
    candidate.kind === 'agent-probe-snapshot' &&
    candidate.schemaVersion === 1 &&
    typeof candidate.fixtureId === 'string' && candidate.fixtureId.length > 0 &&
    typeof candidate.sprintName === 'string' && candidate.sprintName.length > 0 &&
    typeof candidate.asOf === 'string' && candidate.asOf.length > 0 &&
    Array.isArray(candidate.items) && candidate.items.length > 0 &&
    candidate.items.every((item) =>
      typeof item?.id === 'string' && item.id.length > 0 &&
      typeof item.title === 'string' && item.title.length > 0 &&
      (item.status === 'todo' || item.status === 'in-progress' || item.status === 'done') &&
      Number.isInteger(item.points) && item.points >= 0,
    )
  );
}

/** Восстановить тестовый документ; создать fixture A только при отсутствии. */
export async function ensureProbeDocument(service: AutosavingDocumentService, store: DocumentStore): Promise<ProbeDocumentInit> {
  const documents = service.listDocuments({ moduleId: PROBE_MODULE_ID, documentType: PROBE_DOCUMENT_TYPE });
  const existing = documents[0];
  if (existing) {
    return { document: existing, created: false, restoredRevision: existing.revision };
  }
  const created = service.create({
    moduleId: PROBE_MODULE_ID,
    documentType: PROBE_DOCUMENT_TYPE,
    schemaVersion: 1,
    title: 'Синтетическая проба агента',
    content: { ...FIXTURE_A },
  });
  // Дождаться фактической записи начального документа до первого запроса (D6.1).
  await service.flushAll();
  const stored = await store.get(created.id);
  if (!stored || stored.revision !== created.revision) {
    throw new Error('Начальный документ не подтверждён чтением из хранилища');
  }
  return { document: created, created: true, restoredRevision: created.revision };
}

/** Независимая браузерная проверка конверта результата перед записью (D6.2). */
export function validateResult(
  envelope: ProbeEnvelopeWire,
  status: ProbeRequestInfo,
  session: { readonly runId: string },
): { readonly ok: true; readonly snapshot: ProbeSnapshotWire } | { readonly ok: false; readonly message: string } {
  if (!status.result) return { ok: false, message: 'В состоянии ready нет результата' };
  const { result } = status;
  if (envelope.runId !== session.runId) return { ok: false, message: 'runId результата не совпадает с сессией' };
  if (result.nonce !== envelope.nonce) return { ok: false, message: 'nonce результата не совпадает с запросом' };
  if (!isSnapshotShape(result.snapshot)) return { ok: false, message: 'Схема снимка не совпадает' };
  if (result.snapshot.fixtureId !== envelope.fixtureId) return { ok: false, message: 'fixtureId снимка не совпадает с запросом' };
  return { ok: true, snapshot: result.snapshot };
}

/** Применить готовый результат: update → flushAll → контрольное чтение. */
export async function applyResult(
  service: AutosavingDocumentService,
  store: DocumentStore,
  documentId: string,
  envelope: ProbeEnvelopeWire,
  snapshot: ProbeSnapshotWire,
  resultId: string,
): Promise<ApplyOutcome> {
  const current = service.get(documentId);
  if (!current) return { kind: 'mismatch', message: 'Тестовый документ отсутствует' };
  const content = current.content as SnapshotContent;
  if (content.lastAppliedRequestId === envelope.requestId) {
    // Повторная доставка уже сохранённого результата: второго update нет (D6.5).
    const stored = await store.get(documentId);
    return { kind: 'duplicate', revision: stored?.revision ?? current.revision };
  }
  if (current.revision !== envelope.baseRevision && content.lastAppliedRequestId !== undefined) {
    return {
      kind: 'mismatch',
      message: `Ревизия документа ${current.revision} отличается от базовой ${envelope.baseRevision} предыдущего запроса`,
    };
  }
  const nextContent: SnapshotContent = {
    ...content,
    ...snapshot,
    lastAppliedRequestId: envelope.requestId,
    lastAppliedResultId: resultId,
  };
  let updated: ManagedDocument;
  try {
    updated = service.update(documentId, current.revision, nextContent);
  } catch (error) {
    return { kind: 'save-error', message: error instanceof Error ? error.message : 'update отклонён' };
  }
  try {
    await service.flushAll();
  } catch (error) {
    return { kind: 'save-error', message: `Запись не завершена: ${error instanceof Error ? error.message : 'ошибка flush'}` };
  }
  const state = service.getSaveState(documentId);
  if (state && (state.status === 'error' || state.status === 'conflict')) {
    return { kind: 'save-error', message: `Состояние записи: ${state.status}` };
  }
  const stored = await store.get(documentId);
  if (!stored) return { kind: 'save-error', message: 'Контрольное чтение: документ не найден в хранилище' };
  const storedContent = stored.content as SnapshotContent;
  if (stored.revision !== updated.revision) {
    return { kind: 'save-error', message: `Сохранена ревизия ${stored.revision}, ожидалась ${updated.revision}` };
  }
  if (storedContent.lastAppliedRequestId !== envelope.requestId || storedContent.fixtureId !== snapshot.fixtureId) {
    return { kind: 'save-error', message: 'Сохранённое содержимое не совпадает с применённым результатом' };
  }
  return { kind: 'applied', revision: stored.revision };
}

export { PROBE_DB_NAME };
