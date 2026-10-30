import type { ManagedDocument } from '@project-board/widget-sdk';

export interface Note {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly pinned: boolean;
  readonly updatedAt: string;
}

export interface NotesContent {
  readonly notes: readonly Note[];
  readonly [key: string]: unknown;
}

export type NotesDocument = Omit<ManagedDocument, 'content'> & {
  readonly moduleId: 'notes';
  readonly documentType: 'notes';
  readonly content: NotesContent;
};

export interface NotesValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class NotesDocumentError extends Error {
  readonly issues: readonly NotesValidationIssue[];

  constructor(message: string, issues: readonly NotesValidationIssue[] = []) {
    super(message);
    this.name = 'NotesDocumentError';
    this.issues = issues;
  }
}

export class NotesFutureVersionError extends NotesDocumentError {
  readonly documentVersion: number;
  readonly supportedVersion: number;

  constructor(documentVersion: number, supportedVersion: number) {
    super(
      `Формат блокнота версии ${documentVersion} новее поддерживаемой версии ${supportedVersion}; запись запрещена.`,
    );
    this.name = 'NotesFutureVersionError';
    this.documentVersion = documentVersion;
    this.supportedVersion = supportedVersion;
  }
}

export class NotesEditConflictError extends NotesDocumentError {
  readonly noteId: string;
  readonly currentNote?: Note;

  constructor(noteId: string, currentNote?: Note) {
    super(`Заметка "${noteId}" была изменена в другом окне.`);
    this.name = 'NotesEditConflictError';
    this.noteId = noteId;
    this.currentNote = currentNote;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function createEmptyNotesContent(): NotesContent {
  return { notes: [] };
}

/** Validate the content without cloning or normalizing user data. */
export function parseNotesContent(value: unknown): NotesContent {
  const issues: NotesValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new NotesDocumentError('Содержимое блокнота должно быть объектом.', [
      { path: 'content', message: 'Ожидался объект.' },
    ]);
  }
  if (!Array.isArray(value.notes)) {
    throw new NotesDocumentError('Содержимое блокнота не содержит список заметок.', [
      { path: 'content.notes', message: 'Ожидался массив.' },
    ]);
  }

  const ids = new Set<string>();
  value.notes.forEach((candidate, index) => {
    const path = `content.notes[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ path, message: 'Ожидался объект заметки.' });
      return;
    }
    if (typeof candidate.id !== 'string' || candidate.id.trim() === '') {
      issues.push({ path: `${path}.id`, message: 'ID должен быть непустой строкой.' });
    } else if (ids.has(candidate.id)) {
      issues.push({ path: `${path}.id`, message: `Повторяющийся ID "${candidate.id}".` });
    } else {
      ids.add(candidate.id);
    }
    if (typeof candidate.title !== 'string' || candidate.title.trim() === '') {
      issues.push({ path: `${path}.title`, message: 'Заголовок должен быть непустой строкой.' });
    }
    if (typeof candidate.body !== 'string') {
      issues.push({ path: `${path}.body`, message: 'Текст должен быть строкой.' });
    }
    if (!Array.isArray(candidate.tags) || candidate.tags.some((tag) => typeof tag !== 'string')) {
      issues.push({ path: `${path}.tags`, message: 'Теги должны быть массивом строк.' });
    }
    if (typeof candidate.pinned !== 'boolean') {
      issues.push({ path: `${path}.pinned`, message: 'Признак закрепления должен быть логическим.' });
    }
    if (!isCanonicalIsoDate(candidate.updatedAt)) {
      issues.push({ path: `${path}.updatedAt`, message: 'Дата должна быть ISO 8601 UTC.' });
    }
  });

  if (issues.length > 0) {
    throw new NotesDocumentError('Содержимое блокнота повреждено.', issues);
  }
  return value as unknown as NotesContent;
}

export function parseNotesDocument(
  document: ManagedDocument,
  supportedSchemaVersion: number,
): NotesDocument {
  if (document.moduleId !== 'notes' || document.documentType !== 'notes') {
    throw new NotesDocumentError('Документ не является блокнотом типа notes.');
  }
  if (document.schemaVersion > supportedSchemaVersion) {
    throw new NotesFutureVersionError(document.schemaVersion, supportedSchemaVersion);
  }
  if (document.schemaVersion !== supportedSchemaVersion) {
    throw new NotesDocumentError(
      `Формат блокнота версии ${document.schemaVersion} требует миграции до версии ${supportedSchemaVersion}.`,
    );
  }
  return {
    ...document,
    moduleId: 'notes',
    documentType: 'notes',
    content: parseNotesContent(document.content),
  };
}
