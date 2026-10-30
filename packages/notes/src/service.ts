import {
  DocumentConflictError,
  type DocumentService,
  type ManagedDocument,
  type Unsubscribe,
} from '@project-board/widget-sdk';
import { normalizeTag, normalizedTags } from './organization';
import type { Note, NotesContent, NotesDocument } from './model';
import {
  NotesDocumentError,
  NotesEditConflictError,
  parseNotesDocument,
  parseNotesContent,
} from './model';
import {
  createNote,
  deleteNote,
  type NewNoteInput,
  type NotePatch,
  setNotePinned,
  setNoteTags,
  updateNote,
} from './operations';

export interface NotesDocumentService {
  get(): NotesDocument;
  subscribe(handler: (document: NotesDocument) => void): Unsubscribe;
  createNote(input: NewNoteInput): NotesDocument;
  updateNote(noteId: string, patch: NotePatch, baseNote: Note): NotesDocument;
  setTags(noteId: string, tags: readonly string[]): NotesDocument;
  addTags(noteId: string, tags: readonly string[]): NotesDocument;
  removeTag(noteId: string, tag: string): NotesDocument;
  setPinned(noteId: string, pinned: boolean): NotesDocument;
  deleteNote(noteId: string): NotesDocument;
}

export function createNotesDocumentService(
  documents: DocumentService,
  documentId: string,
  schemaVersion: number,
  now: () => string = () => new Date().toISOString(),
): NotesDocumentService {
  function get(): NotesDocument {
    const document = documents.get(documentId);
    if (!document) throw new NotesDocumentError(`Документ "${documentId}" не найден.`);
    return parseNotesDocument(document, schemaVersion);
  }

  function commit(operation: (document: NotesDocument) => NotesContent): NotesDocument {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = get();
      const content = operation(current);
      if (content === current.content) return current;
      parseNotesContent(content);
      try {
        return parseNotesDocument(
          documents.update(documentId, current.revision, content),
          schemaVersion,
        );
      } catch (error) {
        if (!(error instanceof DocumentConflictError) || attempt === 2) throw error;
      }
    }
    throw new NotesDocumentError('Не удалось применить изменение блокнота.');
  }

  function updateWithBaseline(
    noteId: string,
    patch: NotePatch,
    baseNote: Note,
  ): NotesDocument {
    return commit((document) => {
      const currentNote = document.content.notes.find((note) => note.id === noteId);
      if (!currentNote) throw new NotesEditConflictError(noteId);
      const fields = Object.keys(patch) as (keyof NotePatch)[];
      const conflicting = fields.some((field) => {
        const localValue = patch[field];
        if (localValue === undefined) return false;
        const baseValue = field === 'tags' ? baseNote.tags : baseNote[field];
        const remoteValue = field === 'tags' ? currentNote.tags : currentNote[field];
        const localChanged = field === 'tags'
          ? !sameTags(localValue as readonly string[], baseValue as readonly string[])
          : localValue !== baseValue;
        const remoteChanged = field === 'tags'
          ? !sameTags(remoteValue as readonly string[], baseValue as readonly string[])
          : remoteValue !== baseValue;
        const sameResult = field === 'tags'
          ? sameTags(localValue as readonly string[], remoteValue as readonly string[])
          : localValue === remoteValue;
        return localChanged && remoteChanged && !sameResult;
      });
      if (conflicting) throw new NotesEditConflictError(noteId, currentNote);
      return updateNote(document.content, noteId, patch, now());
    });
  }

  return {
    get,
    subscribe(handler) {
      return documents.subscribe(documentId, (document: ManagedDocument) => {
        handler(parseNotesDocument(document, schemaVersion));
      });
    },
    createNote(input) {
      return commit((document) => createNote(document.content, input));
    },
    updateNote: updateWithBaseline,
    setTags(noteId, tags) {
      return commit((document) => setNoteTags(document.content, noteId, tags, now()));
    },
    addTags(noteId, rawTags) {
      return commit(document => {
        const note = document.content.notes.find(item => item.id === noteId);
        if (!note) throw new NotesEditConflictError(noteId);
        const existing = new Set(normalizedTags(note.tags));
        const additions = normalizedTags(rawTags).filter(tag => !existing.has(tag));
        return additions.length ? setNoteTags(document.content, noteId, [...note.tags, ...additions], now()) : document.content;
      });
    },
    removeTag(noteId, rawTag) {
      return commit(document => {
        const note = document.content.notes.find(item => item.id === noteId);
        if (!note) throw new NotesEditConflictError(noteId);
        const tag = normalizeTag(rawTag);
        return setNoteTags(document.content, noteId, note.tags.filter(value => normalizeTag(value) !== tag), now());
      });
    },
    setPinned(noteId, pinned) {
      return commit((document) => setNotePinned(document.content, noteId, pinned, now()));
    },
    deleteNote(noteId) {
      return commit((document) => deleteNote(document.content, noteId));
    },
  };
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}
