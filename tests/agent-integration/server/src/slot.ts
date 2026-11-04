import type { Clock } from './clock.js';
import { newAttemptToken, newNonce, newRequestId } from './ids.js';
import {
  PROBE_TARGET_DOCUMENT_ID,
  type ProbeRequestEnvelope,
  type ProbeResultEnvelope,
} from './envelope.js';

/** TTL слота: поздние submit/ACK после истечения отклоняются (D5). */
export const SLOT_TTL_MS = 10 * 60 * 1000;

export type SlotPhase =
  | 'idle'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'applied'
  | 'failed';

export interface SlotClaim {
  readonly requestId: string;
  readonly attemptToken: string;
  readonly envelope: ProbeRequestEnvelope;
}

export interface SlotFailure {
  readonly code: 'expired' | 'agent-failed' | 'slot-busy' | 'attempt-stale';
  readonly message: string;
}

interface SlotState {
  readonly phase: SlotPhase;
  readonly runId: string;
  readonly envelope: ProbeRequestEnvelope | null;
  readonly attemptToken: string | null;
  readonly result: ProbeResultEnvelope | null;
  readonly failure: SlotFailure | null;
}

/**
 * Один слот в памяти процесса (D5): единственный активный обмен.
 * Пока слот активен, повторный запрос возвращает тот же конверт;
 * второй независимый запрос отклоняется. Перезапуск процесса теряет слот.
 */
export class ProbeSlot {
  private state: SlotState = { phase: 'idle', runId: '', envelope: null, attemptToken: null, result: null, failure: null };

  constructor(
    private readonly clock: Clock,
    private readonly runId: string,
  ) {}

  get phase(): SlotPhase {
    this.expireIfNeeded();
    return this.state.phase;
  }

  get failure(): SlotFailure | null {
    this.expireIfNeeded();
    return this.state.failure;
  }

  get activeRequest(): ProbeRequestEnvelope | null {
    this.expireIfNeeded();
    return this.state.envelope;
  }

  /** Создать запрос либо вернуть существующий активный (дедупликация нажатий). */
  request(baseRevision: number, fixtureId: string): ProbeRequestEnvelope {
    this.expireIfNeeded();
    const active = this.state.envelope;
    if (active && (this.state.phase === 'queued' || this.state.phase === 'processing' || this.state.phase === 'ready')) {
      if (active.baseRevision !== baseRevision || active.fixtureId !== fixtureId) {
        throw new Error('Слот занят другим активным запросом');
      }
      return active;
    }
    const envelope: ProbeRequestEnvelope = {
      schemaVersion: 1,
      runId: this.runId,
      requestId: newRequestId(),
      targetDocumentId: PROBE_TARGET_DOCUMENT_ID,
      baseRevision,
      fixtureId,
      expiresAt: this.clock.now() + SLOT_TTL_MS,
      nonce: newNonce(),
    };
    this.state = { phase: 'queued', runId: this.runId, envelope, attemptToken: null, result: null, failure: null };
    return envelope;
  }

  /** Атомарно взять ожидающий запрос; пустой ответ — очередь пуста. */
  claim(): SlotClaim | null {
    this.expireIfNeeded();
    const envelope = this.state.envelope;
    if (this.state.phase !== 'queued' || !envelope) return null;
    const attemptToken = newAttemptToken();
    this.state = { ...this.state, phase: 'processing', attemptToken };
    return { requestId: envelope.requestId, attemptToken, envelope };
  }

  /** Вернуть результат по attemptToken; повтор того же resultId идемпотентен. */
  submit(attemptToken: string, result: ProbeResultEnvelope): 'ready' | 'duplicate' {
    this.expireIfNeeded();
    const envelope = this.state.envelope;
    if (!envelope || this.state.phase === 'idle' || this.state.phase === 'queued' || this.state.phase === 'failed') {
      throw new Error('Нет активной обработки, к которой относится результат');
    }
    if (this.state.attemptToken !== attemptToken) {
      throw new Error('Попытка не совпадает с текущей обработкой');
    }
    if (this.state.phase === 'ready' || this.state.phase === 'applied') {
      if (this.state.result?.resultId === result.resultId) return 'duplicate';
      throw new Error('Для завершённой попытки уже есть другой результат');
    }
    if (this.state.phase !== 'processing') {
      throw new Error('Обработка уже завершена');
    }
    this.state = { ...this.state, phase: 'ready', result };
    return 'ready';
  }

  /** Зафиксировать ошибку исполнителя. */
  fail(attemptToken: string, message: string): void {
    this.expireIfNeeded();
    if (this.state.attemptToken !== attemptToken || this.state.phase !== 'processing') {
      throw new Error('Попытка не совпадает с текущей обработкой');
    }
    this.state = {
      ...this.state,
      phase: 'failed',
      failure: { code: 'agent-failed', message },
    };
  }

  /** Подтверждение браузера: только ready → applied. */
  ack(requestId: string): 'applied' | 'already-applied' {
    this.expireIfNeeded();
    const envelope = this.state.envelope;
    if (!envelope || envelope.requestId !== requestId) {
      throw new Error('Запрос не найден');
    }
    if (this.state.phase === 'applied') return 'already-applied';
    if (this.state.phase !== 'ready') {
      throw new Error(`Подтверждение невозможно в состоянии ${this.state.phase}`);
    }
    this.state = { ...this.state, phase: 'applied' };
    return 'applied';
  }

  /** Результат для браузера: только из ready/applied. */
  resultOf(requestId: string): ProbeResultEnvelope | null {
    this.expireIfNeeded();
    const envelope = this.state.envelope;
    if (!envelope || envelope.requestId !== requestId) return null;
    if (this.state.phase !== 'ready' && this.state.phase !== 'applied') return null;
    return this.state.result;
  }

  private expireIfNeeded(): void {
    const envelope = this.state.envelope;
    if (!envelope) return;
    const active = this.state.phase === 'queued' || this.state.phase === 'processing' || this.state.phase === 'ready';
    if (active && this.clock.now() > envelope.expiresAt) {
      this.state = {
        ...this.state,
        phase: 'failed',
        failure: { code: 'expired', message: 'Срок запроса истёк (TTL 10 минут)' },
      };
    }
  }
}
