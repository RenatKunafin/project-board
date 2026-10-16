import {
  parsePlanContent,
  PLAN_SCHEMA_VERSION,
  type PlanContent,
  type PlanIssue,
} from './plan-document';

export const PLAN_FILE_FORMAT = 'project-board-plan';
export const PLAN_FILE_FORMAT_VERSION = 1;

export type PlanFileIssueCode =
  | 'invalid-json'
  | 'invalid-envelope'
  | 'unknown-format'
  | 'unsupported-future-version'
  | 'plan-invalid';

export interface PlanFileIssue {
  readonly code: PlanFileIssueCode;
  readonly path: string;
  readonly message: string;
  readonly details?: readonly PlanIssue[];
}

export interface PlanFilePayload {
  readonly title: string;
  readonly content: PlanContent;
}

export interface PlanFileEnvelope {
  readonly format: typeof PLAN_FILE_FORMAT;
  readonly formatVersion: number;
  readonly title: string;
  readonly schemaVersion: number;
  readonly content: PlanContent;
}

export function serializePlanFile(payload: PlanFilePayload): {
  readonly ok: true;
  readonly json: string;
} {
  const envelope: PlanFileEnvelope = {
    format: PLAN_FILE_FORMAT,
    formatVersion: PLAN_FILE_FORMAT_VERSION,
    title: payload.title,
    schemaVersion: PLAN_SCHEMA_VERSION,
    content: payload.content,
  };
  return { ok: true, json: JSON.stringify(envelope, null, 2) };
}

export function planFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(
    now.getSeconds(),
  )}`;
  return `pb-plan-${date}_${time}.json`;
}

export type PlanFileDeserialize =
  | { readonly ok: true; readonly payload: PlanFilePayload }
  | { readonly ok: false; readonly issues: readonly PlanFileIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(
  code: PlanFileIssueCode,
  path: string,
  message: string,
): PlanFileIssue {
  return { code, path, message };
}

function reject(issues: readonly PlanFileIssue[]): PlanFileDeserialize {
  return { ok: false, issues };
}

export function deserializePlanFile(text: string): PlanFileDeserialize {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reject([
      issue(
        'invalid-json',
        '',
        `Файл не является корректным JSON: ${message}`,
      ),
    ]);
  }

  if (!isRecord(value)) {
    return reject([
      issue(
        'invalid-envelope',
        '',
        'Содержимое файла должно быть JSON-объектом.',
      ),
    ]);
  }

  const { format, formatVersion, schemaVersion, title, content } = value;

  if (typeof format !== 'string') {
    return reject([
      issue(
        'invalid-envelope',
        'format',
        'Маркер формата должен быть строкой.',
      ),
    ]);
  }
  if (format !== PLAN_FILE_FORMAT) {
    return reject([
      issue(
        'unknown-format',
        'format',
        `Неизвестный формат «${format}»; ожидается «${PLAN_FILE_FORMAT}».`,
      ),
    ]);
  }

  if (
    typeof formatVersion !== 'number' ||
    !Number.isInteger(formatVersion) ||
    formatVersion < 1
  ) {
    return reject([
      issue(
        'invalid-envelope',
        'formatVersion',
        'Версия формата должна быть целым числом не меньше 1.',
      ),
    ]);
  }
  if (formatVersion > PLAN_FILE_FORMAT_VERSION) {
    return reject([
      issue(
        'unsupported-future-version',
        'formatVersion',
        `Версия формата ${formatVersion} создана более новой версией приложения; поддерживается ${PLAN_FILE_FORMAT_VERSION}.`,
      ),
    ]);
  }

  if (schemaVersion !== PLAN_SCHEMA_VERSION) {
    return reject([
      issue(
        'invalid-envelope',
        'schemaVersion',
        `Версия содержимого не поддерживается; ожидается ${PLAN_SCHEMA_VERSION}.`,
      ),
    ]);
  }

  if (typeof title !== 'string' || title === '') {
    return reject([
      issue(
        'invalid-envelope',
        'title',
        'Название плана должно быть непустой строкой.',
      ),
    ]);
  }

  if (content === undefined) {
    return reject([
      issue('invalid-envelope', 'content', 'Раздел content обязателен.'),
    ]);
  }

  const validation = parsePlanContent(content);
  if (!validation.ok) {
    return reject([
      {
        code: 'plan-invalid',
        path: 'content',
        message: 'Содержимое плана не прошло валидацию.',
        details: validation.issues,
      },
    ]);
  }

  return { ok: true, payload: { title, content: validation.plan } };
}
