import { randomBytes, randomUUID } from 'node:crypto';

/** Идентификатор запуска процесса: переживает restart с новым значением. */
export function newRunId(): string {
  return randomUUID();
}

export function newRequestId(): string {
  return randomUUID();
}

export function newResultId(): string {
  return randomUUID();
}

/** Токен попытки исполнителя: защищает от позднего ответа прошлой обработки. */
export function newAttemptToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Одноразовый код сопряжения: не менее 128 бит энтропии. */
export function newPairingCode(): string {
  return randomBytes(16).toString('base64url');
}

/** Сессионный bearer. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Случайный nonce запроса: связывает запрос и результат. */
export function newNonce(): string {
  return randomBytes(16).toString('base64url');
}
