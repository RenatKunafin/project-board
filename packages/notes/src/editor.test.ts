import { describe, expect, it } from 'vitest';
import type { DocumentChangeHandler, DocumentService, ManagedDocument } from '@project-board/widget-sdk';
import { NotesEditor } from './editor';
import { parseNotesContent } from './model';

const NOW = '2026-10-28T12:00:00.000Z';
function setup() {
  const note = (id: string) => ({ id, title: id, body: id, tags: ['идея'], pinned: true, updatedAt: NOW });
  let document: ManagedDocument = { id: 'book', moduleId: 'notes', documentType: 'notes', schemaVersion: 1,
    title: 'Книга', revision: 1, createdAt: NOW, updatedAt: NOW, content: { notes: [note('one'), note('two')] } };
  const handlers = new Set<DocumentChangeHandler>();
  let notifying = false;
  let rejectWrite = false;
  const publish = () => {
    notifying = true;
    try { for (const handler of handlers) handler(document); }
    finally { notifying = false; }
  };
  const documents: DocumentService = {
    create: () => document, get: () => document,
    update: (_id, revision, content) => {
      if (notifying) throw new Error('Запись из уведомления');
      if (rejectWrite) throw new Error('Запись недоступна');
      expect(revision).toBe(document.revision);
      document = { ...document, revision: revision + 1, content };
      publish();
      return document;
    },
    rename: () => document, delete: async () => {},
    subscribe: (_id, handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
    getViewSettings: () => undefined, setViewSettings: () => {},
  };
  const selections: (string | null)[] = [];
  let nextId = 0;
  const editor = new NotesEditor(documents, 'book', 'one', id => selections.push(id), () => `new-${++nextId}`);
  const stop = editor.start();
  return { editor, documents, stop, selections, handlers,
    get: () => parseNotesContent(document.content),
    revision: () => document.revision,
    reject: (value: boolean) => { rejectWrite = value; },
    external: (patch: Partial<ManagedDocument>) => { document = { ...document, ...patch, revision: document.revision + 1 }; publish(); },
  };
}

describe('редактор заметок', () => {
  it('применяет ввод синхронно, не конфликтует со своим уведомлением и не создаёт редакцию для no-op', () => {
    const { editor, get, revision } = setup();
    editor.editBody('Текст  \n\n');
    expect(get().notes[0].body).toBe('Текст  \n\n');
    expect(editor.getSnapshot().draft?.conflict).toBeUndefined();
    expect(get().notes[1].body).toBe('two');
    const before = revision();
    editor.editBody('Текст  \n\n');
    expect(revision()).toBe(before);
  });
  it('сохраняет IME ввод и две версии при внешнем изменении той же заметки', () => {
    const { editor, get, external } = setup();
    editor.beginComposition(); editor.editBody('Мой ввод');
    external({ content: { notes: get().notes.map(note => note.id === 'one' ? { ...note, body: 'Другой ввод' } : note) } });
    editor.endComposition('Мой ввод готов');
    expect(get().notes[0].body).toBe('Другой ввод');
    expect(editor.getSnapshot().draft?.body).toBe('Мой ввод готов');
    expect(editor.getSnapshot().draft?.conflict?.incoming?.body).toBe('Другой ввод');
    editor.select('two');
    expect(editor.getSnapshot().draft?.base.id).toBe('one');
    editor.saveSeparate();
    expect(get().notes.map(note => note.body)).toEqual(['Другой ввод', 'two', 'Мой ввод готов']);
    expect(get().notes[2].tags).toEqual(['идея']);
    expect(get().notes[2].pinned).toBe(false);
  });
  it('принимает актуальную версию после новых входящих изменений', () => {
    const { editor, get, external } = setup();
    editor.beginComposition(); editor.editBody('Локальный');
    for (const body of ['Первый', 'Последний']) external({ content: { notes: get().notes.map(note => ({ ...note, body })) } });
    editor.acceptIncoming();
    expect(editor.getSnapshot().draft?.body).toBe('Последний');
    expect(editor.getSnapshot().draft?.conflict).toBeUndefined();
  });
  it('не конфликтует с соседней заметкой во время композиции', () => {
    const { editor, get, external } = setup();
    editor.beginComposition(); editor.editBody('Мой ввод');
    external({ content: { notes: get().notes.map(note => note.id === 'two' ? { ...note, body: 'Сосед' } : note) } });
    editor.endComposition('Мой ввод');
    expect(get().notes.map(note => note.body)).toEqual(['Мой ввод', 'Сосед']);
    expect(editor.getSnapshot().draft?.conflict).toBeUndefined();
  });
  it('сохраняет черновик удалённой заметки отдельно и удерживает его после ошибки записи', () => {
    const { editor, get, external, reject } = setup();
    editor.beginComposition(); editor.editBody('Не терять');
    external({ content: { notes: [get().notes[1]] } });
    expect(editor.getSnapshot().draft?.conflict).toEqual({ incoming: undefined });
    reject(true); editor.saveSeparate();
    expect(editor.getSnapshot().draft?.body).toBe('Не терять');
    expect(editor.getSnapshot().draft?.conflict).toBeTruthy();
    expect(editor.getSnapshot().error).toContain('недоступна');
    reject(false); editor.saveSeparate();
    expect(get().notes.map(note => note.body)).toEqual(['two', 'Не терять']);
  });
  it('оставляет пустой заголовок для исправления и обнаруживает конфликт переименования', () => {
    const { editor, get, external } = setup();
    editor.beginRename(); editor.editTitle(''); editor.saveTitle();
    expect(editor.getSnapshot().renaming).toBe(true);
    expect(editor.getSnapshot().draft?.title).toBe('');
    expect(get().notes[0].title).toBe('one');
    editor.editTitle('Мой заголовок');
    external({ content: { notes: get().notes.map(note => note.id === 'one' ? { ...note, title: 'Внешний' } : note) } });
    expect(editor.getSnapshot().draft?.conflict?.incoming?.title).toBe('Внешний');
    editor.saveSeparate();
    expect(get().notes.map(note => note.title)).toEqual(['Внешний', 'two', 'Мой заголовок']);
  });
  it('сохраняет независимый выбор и освобождает подписку', () => {
    const { editor, documents, stop, handlers } = setup();
    const other = new NotesEditor(documents, 'book', 'two', () => {});
    const stopOther = other.start();
    editor.editBody('Общий');
    expect(other.getSnapshot().draft?.base.id).toBe('two');
    other.select('one'); expect(other.getSnapshot().draft?.body).toBe('Общий');
    expect(handlers.size).toBe(2);
    stop(); stopOther(); expect(handlers.size).toBe(0);
  });
  it('изолирует повреждённые уведомления и запрещает запись в будущую схему', () => {
    const { editor, external } = setup();
    expect(() => external({ content: { notes: null } })).not.toThrow();
    expect(editor.getSnapshot().error).toBeTruthy();
    editor.editBody('Сохранить ввод');
    expect(editor.getSnapshot().writeFailed).toBe(true);
    external({ schemaVersion: 99 });
    expect(editor.getSnapshot().error).toContain('новее');
    expect(editor.getSnapshot().draft?.body).toBe('Сохранить ввод');
    editor.discardInput();
    expect(editor.getSnapshot().writeFailed).toBe(false);
    expect(editor.getSnapshot().draft).toBeUndefined();
    expect(editor.getSnapshot().error).toContain('новее');
  });
});
