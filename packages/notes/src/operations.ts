import type { Note, NotesContent } from './model';
import { NotesDocumentError, parseNotesContent } from './model';

export interface NewNoteInput {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly tags?: readonly string[];
  readonly pinned?: boolean;
  readonly updatedAt: string;
}

export interface NotePatch {
  readonly title?: string;
  readonly body?: string;
  readonly tags?: readonly string[];
  readonly pinned?: boolean;
}

export type NotesOperation = (content: NotesContent) => NotesContent;

function assertTitle(title: string): string {
  if (title.trim() === '') {
    throw new NotesDocumentError('Заголовок заметки не может быть пустым.');
  }
  return title.trim();
}

export function createNote(content: NotesContent, input: NewNoteInput): NotesContent {
  if (input.id.trim() === '') throw new NotesDocumentError('ID заметки не может быть пустым.');
  if (content.notes.some((note) => note.id === input.id)) {
    throw new NotesDocumentError(`Заметка с ID "${input.id}" уже существует.`);
  }
  const note: Note = {
    id: input.id,
    title: assertTitle(input.title),
    body: input.body ?? '',
    tags: input.tags ? [...input.tags] : [],
    pinned: input.pinned ?? false,
    updatedAt: input.updatedAt,
  };
  return parseNotesContent({ ...content, notes: [...content.notes, note] });
}

export function updateNote(
  content: NotesContent,
  noteId: string,
  patch: NotePatch,
  updatedAt: string,
): NotesContent {
  const index = content.notes.findIndex((note) => note.id === noteId);
  if (index < 0) throw new NotesDocumentError(`Заметка "${noteId}" не найдена.`);
  const current = content.notes[index];
  const next = {
    ...current,
    ...(patch.body === undefined ? {} : { body: patch.body }),
    ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
    ...(patch.title === undefined ? {} : { title: assertTitle(patch.title) }),
    ...(patch.tags === undefined ? {} : { tags: [...patch.tags] }),
  };
  if (
    next.title === current.title && next.body === current.body &&
    next.pinned === current.pinned && sameStrings(next.tags, current.tags)
  ) {
    return content;
  }
  const notes = [...content.notes];
  notes[index] = { ...next, updatedAt };
  return parseNotesContent({ ...content, notes });
}

export function deleteNote(content: NotesContent, noteId: string): NotesContent {
  const notes = content.notes.filter((note) => note.id !== noteId);
  return notes.length === content.notes.length ? content : { ...content, notes };
}

export function setNoteTags(
  content: NotesContent,
  noteId: string,
  tags: readonly string[],
  updatedAt: string,
): NotesContent {
  return updateNote(content, noteId, { tags }, updatedAt);
}

export function setNotePinned(
  content: NotesContent,
  noteId: string,
  pinned: boolean,
  updatedAt: string,
): NotesContent {
  return updateNote(content, noteId, { pinned }, updatedAt);
}

export function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
