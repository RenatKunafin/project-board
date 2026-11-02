import type { Clock } from './clock.js';
import { newPairingCode, newSessionToken } from './ids.js';

/** Код сопряжения живёт 5 минут и допускает не более 10 неверных попыток (D4). */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const MAX_PAIRING_ATTEMPTS = 10;
/** Сессия живёт 30 минут; перезапуск процесса обнуляет все сессии (D4). */
export const SESSION_TTL_MS = 30 * 60 * 1000;

export interface PairingIssue {
  readonly code: 'unknown-code' | 'expired-code' | 'attempts-exhausted' | 'unknown-session' | 'expired-session';
  readonly message: string;
}

export class PairingError extends Error {
  constructor(
    message: string,
    readonly issue: PairingIssue,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

export interface ActivePairing {
  readonly code: string;
  readonly expiresAt: number;
}

export interface ActiveSession {
  readonly token: string;
  readonly runId: string;
  readonly expiresAt: number;
}

interface PairingRecord {
  readonly code: string;
  readonly expiresAt: number;
  failedAttempts: number;
}

interface SessionRecord {
  readonly token: string;
  readonly runId: string;
  readonly expiresAt: number;
  revoked: boolean;
}

/**
 * Сопряжение и сессии в памяти одного процесса (D4).
 * Код выдаётся инструментом probe_session, обменивается на bearer в POST /pair;
 * секреты не попадают в URL и логи, после reload нужна новая пара код/сессия.
 */
export class PairingService {
  private readonly pairings = new Map<string, PairingRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private lastIssuedCode: string | null = null;
  private sessionCounter = 0;

  constructor(
    private readonly clock: Clock,
    private readonly runId: string,
  ) {}

  /** Выдать одноразовый код (вызывается MCP-инструментом probe_session). */
  issuePairingCode(): ActivePairing {
    const code = newPairingCode();
    const record: PairingRecord = { code, expiresAt: this.clock.now() + PAIRING_CODE_TTL_MS, failedAttempts: 0 };
    this.pairings.set(code, record);
    this.lastIssuedCode = code;
    return { code, expiresAt: record.expiresAt };
  }

  /** Обменять код на сессионный bearer. */
  pair(code: string): ActiveSession {
    const record = this.pairings.get(code);
    if (!record) {
      // Неверный ввод относится к последней выдаче: считаем попытку и исчерпываем лимит.
      const last = this.lastIssuedCode ? this.pairings.get(this.lastIssuedCode) : undefined;
      if (last) {
        last.failedAttempts += 1;
        if (last.failedAttempts >= MAX_PAIRING_ATTEMPTS) {
          this.pairings.delete(last.code);
        }
      }
      throw new PairingError('Код сопряжения неизвестен', { code: 'unknown-code', message: 'Код сопряжения неизвестен' });
    }
    if (this.clock.now() > record.expiresAt) {
      this.pairings.delete(code);
      throw new PairingError('Код сопряжения истёк', { code: 'expired-code', message: 'Код сопряжения истёк' });
    }
    if (record.failedAttempts >= MAX_PAIRING_ATTEMPTS) {
      this.pairings.delete(code);
      throw new PairingError('Исчерпаны попытки ввода кода', { code: 'attempts-exhausted', message: 'Исчерпаны попытки ввода кода' });
    }
    this.pairings.delete(code);
    const token = newSessionToken();
    const session: SessionRecord = { token, runId: this.runId, expiresAt: this.clock.now() + SESSION_TTL_MS, revoked: false };
    this.sessions.set(token, session);
    this.sessionCounter += 1;
    return { token, runId: this.runId, expiresAt: session.expiresAt };
  }

  /** Проверить bearer; возвращает действующую сессию или диагностику. */
  authenticate(token: string | undefined): ActiveSession {
    if (!token) {
      throw new PairingError('Сессия не сопряжена', { code: 'unknown-session', message: 'Сессия не сопряжена' });
    }
    const record = this.sessions.get(token);
    if (!record || record.revoked || record.runId !== this.runId) {
      throw new PairingError('Сессия недействительна', { code: 'unknown-session', message: 'Сессия недействительна' });
    }
    if (this.clock.now() > record.expiresAt) {
      this.sessions.delete(token);
      throw new PairingError('Сессия истекла', { code: 'expired-session', message: 'Сессия истекла' });
    }
    return { token: record.token, runId: record.runId, expiresAt: record.expiresAt };
  }

  /** Отзыв сессии владельцем (POST /disconnect). */
  revoke(token: string | undefined): void {
    if (!token) return;
    const record = this.sessions.get(token);
    if (record) {
      this.sessions.set(token, { ...record, revoked: true });
      this.sessions.delete(token);
    }
  }

  get issuedSessions(): number {
    return this.sessionCounter;
  }
}
