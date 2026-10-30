import { describe, expect, it } from 'vitest';
import {
  NotesDocumentError,
  NotesFutureVersionError,
  createEmptyNotesContent,
  parseNotesContent,
  parseNotesDocument,
} from './model';
import {
  createNote,
  deleteNote,
  setNotePinned,
  setNoteTags,
  updateNote,
} from './operations';
import {
  acceptIncomingVersion,
  createNoteDraft,
  editNoteDraft,
  receiveNotesSnapshot,
  saveDraftAsSeparateNote,
} from './draft';
import { createNotesDocumentService } from './service';
import { DocumentConflictError, type DocumentService, type ManagedDocument } from '@project-board/widget-sdk';

const NOW = '2026-10-28T12:00:00.000Z';

function note(id = 'n1', body = 'original') {
  return { id, title: 'Заметка', body, tags: ['идея'], pinned: false, updatedAt: NOW } as const;
}

function content(...notes: ReturnType<typeof note>[]) {
  return { notes };
}

function managedDocument(
  revision = 1,
  data: unknown = content(note()),
  schemaVersion = 1,
): ManagedDocument {
  return {
    id: 'doc-1', moduleId: 'notes', documentType: 'notes', title: 'Блокнот',
    schemaVersion, revision, createdAt: NOW, updatedAt: NOW, content: data,
  };
}

function fakeDocumentService(initial = managedDocument()): DocumentService {
  let current = initial;
  const handlers = new Set<(document: ManagedDocument) => void>();
  return {
    create: () => current,
    get: () => current,
    update: (id, expectedRevision, nextContent) => {
      if (id !== current.id || expectedRevision !== current.revision) {
        throw new DocumentConflictError(id, current.revision, expectedRevision);
      }
      current = { ...current, revision: current.revision + 1, updatedAt: NOW, content: nextContent };
      for (const handler of [...handlers]) handler(current);
      return current;
    },
    rename: (_id, _revision, title) => ({ ...current, title }),
    delete: async () => { current = undefined as unknown as ManagedDocument; },
    subscribe: (_id, handler) => { handlers.add(handler); return () => handlers.delete(handler); },
    getViewSettings: () => undefined,
    setViewSettings: () => {},
  };
}

describe('notes document model', () => {
  it('recognizes an empty notes document and preserves content fields', () => {
    const empty = createEmptyNotesContent();
    expect(parseNotesContent(empty)).toEqual({ notes: [] });
    expect(parseNotesContent({ notes: [], extension: { value: 1 } })).toEqual({
      notes: [], extension: { value: 1 },
    });
  });

  it('reports malformed values and duplicate ids without replacing them', () => {
    expect(() => parseNotesContent({ notes: [note(), note()] })).toThrow(NotesDocumentError);
    expect(() => parseNotesContent({ notes: [{ ...note(), updatedAt: 'yesterday' }] })).toThrow(/повреждено/i);
    const source = { notes: [{ ...note(), id: '' }] };
    expect(() => parseNotesContent(source)).toThrow(NotesDocumentError);
    expect(source.notes[0].id).toBe('');
  });

  it('rejects future schema versions and wrong document types', () => {
    expect(() => parseNotesDocument(managedDocument(1, content(note()), 2), 1))
      .toThrow(NotesFutureVersionError);
    expect(() => parseNotesDocument({ ...managedDocument(), moduleId: 'other' }, 1))
      .toThrow(/не является блокнотом/i);
  });

  it('creates, edits, tags, pins and deletes immutably while preserving neighboring notes', () => {
    const first = note();
    const second = note('n2', 'other');
    const initial = content(first, second);
    const added = createNote(initial, { id: 'n3', title: 'Новая', body: '', updatedAt: NOW });
    expect(initial.notes).toHaveLength(2);
    expect(added.notes).toHaveLength(3);
    const edited = updateNote(added, 'n1', { body: 'edited' }, '2026-10-28T12:01:00.000Z');
    const tagged = setNoteTags(edited, 'n1', ['работа'], '2026-10-28T12:02:00.000Z');
    const pinned = setNotePinned(tagged, 'n1', true, '2026-10-28T12:03:00.000Z');
    const deleted = deleteNote(pinned, 'n3');
    expect(deleted.notes.find((item) => item.id === 'n1')).toMatchObject({
      body: 'edited', tags: ['работа'], pinned: true, updatedAt: '2026-10-28T12:03:00.000Z',
    });
    expect(deleted.notes.find((item) => item.id === 'n2')).toEqual(second);
    expect(deleted.notes.some((item) => item.id === 'n3')).toBe(false);
  });

  it('returns the same content for no-op updates and missing deletes', () => {
    const initial = content(note());
    expect(updateNote(initial, 'n1', { body: 'original' }, '2026-10-29T00:00:00.000Z')).toBe(initial);
    expect(deleteNote(initial, 'missing')).toBe(initial);
  });

  it('keeps a dirty draft when an external note update arrives and supports explicit resolution', () => {
    const original = note();
    const localDraft = editNoteDraft(createNoteDraft(original), 'local edit');
    const remote = note('n1', 'remote edit');
    const conflict = receiveNotesSnapshot(localDraft, content(remote));
    expect(conflict.body).toBe('local edit');
    expect(conflict.conflict?.incomingNote).toEqual(remote);
    expect(acceptIncomingVersion(conflict)?.body).toBe('remote edit');
    const copy = saveDraftAsSeparateNote(content(remote), conflict, {
      id: 'n2', title: 'Локальный вариант', updatedAt: NOW,
    });
    expect(copy.notes.map((item) => item.body)).toEqual(['remote edit', 'local edit']);
    expect(acceptIncomingVersion(receiveNotesSnapshot(editedDraft(original), { notes: [] }))).toBeNull();
  });

  it('updates a clean draft and marks deletion of its edited note as a conflict', () => {
    const original = note();
    expect(receiveNotesSnapshot(createNoteDraft(original), content(note('n1', 'remote'))).body)
      .toBe('remote');
    const edited = editNoteDraft(createNoteDraft(original), 'draft');
    expect(receiveNotesSnapshot(edited, { notes: [] }).conflict).toBeDefined();
  });

  it('applies operations through DocumentService and detects a same-field conflict', () => {
    const service = createNotesDocumentService(fakeDocumentService(), 'doc-1', 1, () => NOW);
    const original = service.get().content.notes[0];
    service.updateNote('n1', { body: 'remote' }, original);
    expect(() => service.updateNote('n1', { body: 'local' }, original))
      .toThrow(/изменена в другом окне/i);
    const current = service.get();
    expect(current.revision).toBe(2);
    expect(current.content.notes[0].body).toBe('remote');
  });

  it('rebases a different-note operation on the latest document revision', () => {
    const initial = managedDocument(1, content(note(), note('n2', 'before')));
    const service = createNotesDocumentService(fakeDocumentService(initial), 'doc-1', 1, () => NOW);
    const base = service.get().content.notes[1];
    service.updateNote('n1', { body: 'updated first' }, service.get().content.notes[0]);
    service.updateNote('n2', { body: 'updated second' }, base);
    expect(service.get().content.notes.map((item) => item.body)).toEqual(['updated first', 'updated second']);
  });

  it('subscribes to changes and leaves storage to the DocumentService adapter', () => {
    const sdk = fakeDocumentService();
    const service = createNotesDocumentService(sdk, 'doc-1', 1, () => NOW);
    let observed = 0;
    const unsubscribe = service.subscribe(() => { observed += 1; });
    service.updateNote('n1', { body: 'updated' }, service.get().content.notes[0]);
    unsubscribe();
    service.updateNote('n1', { body: 'updated again' }, service.get().content.notes[0]);
    expect(observed).toBe(1);
    expect(service.get().content.notes[0].body).toBe('updated again');
  });

  it('deletes only the confirmed target note and round-trips through ordinary JSON content', () => {
    const sdk = fakeDocumentService(managedDocument(1, content(note(), note('n2', 'Сохранить **Markdown** без потерь'))));
    const service = createNotesDocumentService(sdk, 'doc-1', 1, () => NOW);
    const afterDelete = service.deleteNote('n1');
    expect(afterDelete.content.notes.map((item) => item.id)).toEqual(['n2']);
    const restored = parseNotesContent(JSON.parse(JSON.stringify(afterDelete.content)) as unknown);
    expect(restored).toEqual(afterDelete.content);
    expect(restored.notes[0].body).toBe('Сохранить **Markdown** без потерь');
  });
});

function editedDraft(original: ReturnType<typeof note>) {
  return editNoteDraft(createNoteDraft(original), 'edited');
}
