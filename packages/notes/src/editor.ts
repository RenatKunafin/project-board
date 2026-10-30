import type { DocumentService } from '@project-board/widget-sdk';
import { NotesEditConflictError, type Note, type NotesDocument } from './model';
import { filterNotes, normalizedTags } from './organization';
import { createNotesDocumentService } from './service';
import type { NotesWindowSettings } from './window-settings';

type EditorWindowSettings = Pick<NotesWindowSettings, 'selectedNoteId' | 'query' | 'activeTag'>;

export interface EditorDraft {
  readonly base: Note;
  readonly body: string;
  readonly title: string;
  readonly conflict?: { readonly incoming?: Note };
}
export interface EditorState {
  readonly query: string;
  readonly activeTag: string | null;
  readonly document?: NotesDocument;
  readonly draft?: EditorDraft;
  readonly composing: boolean;
  readonly renaming: boolean;
  readonly error?: string;
  readonly writeFailed: boolean;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const cleanDraft = (note: Note): EditorDraft => ({ base: note, title: note.title, body: note.body });

/** Синхронный держатель ввода: уведомления SDK не зависят от цикла React render. */
export class NotesEditor {
  private readonly service;
  private listeners = new Set<() => void>();
  private selectedId?: string;
  private state: EditorState;

  constructor(private readonly documents: DocumentService, private readonly documentId: string, settings: EditorWindowSettings,
    private readonly updateSettings: (patch: Partial<EditorWindowSettings>) => void,
    private readonly newId: () => string = () => crypto.randomUUID()) {
    this.service = createNotesDocumentService(documents, documentId, 1);
    this.selectedId = typeof settings.selectedNoteId === 'string' ? settings.selectedNoteId : undefined;
    this.state = { query: settings.query, activeTag: settings.activeTag, composing: false, renaming: false, writeFailed: false };
  }

  getSnapshot = (): EditorState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  reportError(error: unknown) { this.set({ error: messageOf(error) }); }
  start(): () => void {
    try { this.receive(this.service.get()); }
    catch (error) { this.set({ error: messageOf(error) }); }
    // The raw SDK notification is parsed inside the guarded callback so bad data
    // cannot throw through delivery and interrupt other subscribers.
    return this.serviceSubscribe();
  }
  private serviceSubscribe(): () => void {
    return this.documents.subscribe(this.documentId, () => {
      try { this.receive(this.service.get()); }
      catch (error) { this.set({ error: messageOf(error) }); }
    });
  }
  private choose(document: NotesDocument, id?: string) {
    const note = document.content.notes.find(item => item.id === id) ?? filterNotes(document.content.notes, this.state.query, this.state.activeTag)[0];
    const nextId = note?.id;
    if (this.selectedId !== nextId) {
      this.selectedId = nextId;
      this.updateSettings({ selectedNoteId: nextId ?? null });
    }
    this.set({ document, draft: note ? cleanDraft(note) : undefined, composing: false,
      renaming: false, error: undefined, writeFailed: false });
  }
  private receive(document: NotesDocument) {
    if (this.state.activeTag && !document.content.notes.some(note => normalizedTags(note.tags).includes(this.state.activeTag!))) {
      this.state = { ...this.state, activeTag: null };
      this.updateSettings({ activeTag: null });
    }
    const draft = this.state.draft;
    if (!draft) { this.choose(document, this.selectedId); return; }
    const incoming = document.content.notes.find(note => note.id === draft.base.id);
    const bodyDirty = draft.body !== draft.base.body || this.state.composing;
    const titleDirty = draft.title !== draft.base.title;
    if (draft.conflict || (!incoming && (bodyDirty || titleDirty)) || (incoming && (
      (bodyDirty && incoming.body !== draft.base.body && incoming.body !== draft.body) ||
      (titleDirty && incoming.title !== draft.base.title && incoming.title !== draft.title)
    ))) {
      this.set({ document, draft: { ...draft, conflict: { incoming } }, error: undefined });
      return;
    }
    if (!incoming) { this.choose(document); return; }
    this.set({ document, error: undefined, draft: { base: incoming,
      body: bodyDirty ? draft.body : incoming.body, title: titleDirty ? draft.title : incoming.title } });
  }
  select(id: string): boolean {
    if (this.blocked()) return false;
    try { this.choose(this.service.get(), id); return true; }
    catch (error) { this.set({ error: messageOf(error) }); return false; }
  }
  private blocked() {
    return !!this.state.draft?.conflict || this.state.writeFailed || this.state.renaming;
  }
  create() {
    if (this.blocked()) return false;
    try {
      const id = this.newId();
      const document = this.service.createNote({ id, title: 'Новая заметка',
        tags: this.state.activeTag ? [this.state.activeTag] : [], updatedAt: new Date().toISOString() });
      this.choose(document, id);
      if (this.state.query) this.updateSettings({ query: '' });
      this.set({ query: '' });
      return true;
    } catch (error) { this.set({ error: messageOf(error) }); return false; }
  }
  setQuery(query: string) {
    if (query === this.state.query) return;
    this.set({ query }); this.updateSettings({ query });
  }
  setTag(activeTag: string | null) {
    if (activeTag === this.state.activeTag) return;
    this.set({ activeTag }); this.updateSettings({ activeTag });
  }
  resetFilters() {
    if (!this.state.query && this.state.activeTag === null) return;
    this.set({ query: '', activeTag: null }); this.updateSettings({ query: '', activeTag: null });
  }
  addTags(id: string, tags: readonly string[]) { return this.metadata(() => this.service.addTags(id, tags)); }
  removeTag(id: string, tag: string) { return this.metadata(() => this.service.removeTag(id, tag)); }
  setPinned(id: string, pinned: boolean) { return this.metadata(() => this.service.setPinned(id, pinned)); }
  private metadata(operation: () => NotesDocument) {
    if (this.blocked()) return false;
    try { operation(); this.set({ error: undefined }); return true; }
    catch (error) { this.set({ error: messageOf(error) }); return false; }
  }
  remove(id: string) {
    if (this.blocked()) return false;
    try { this.receive(this.service.deleteNote(id)); return true; }
    catch (error) { this.set({ error: messageOf(error) }); return false; }
  }
  beginComposition() { this.set({ composing: true }); }
  endComposition(body: string) {
    this.set({ composing: false });
    this.editBody(body);
  }
  editBody(body: string) {
    if (!this.state.draft) return;
    this.set({ draft: { ...this.state.draft, body } });
    if (!this.state.composing && !this.state.draft?.conflict) this.commitBody();
  }
  private failed(error: unknown) {
    const draft = this.state.draft;
    if (draft && error instanceof NotesEditConflictError) {
      this.set({ draft: { ...draft, conflict: { incoming: error.currentNote } }, writeFailed: false });
    } else {
      this.set({ error: messageOf(error), writeFailed: true });
    }
  }
  private commitBody() {
    const draft = this.state.draft;
    if (!draft || draft.conflict) return;
    try {
      this.service.updateNote(draft.base.id, { body: draft.body }, draft.base);
      this.set({ writeFailed: false, error: undefined });
    } catch (error) { this.failed(error); }
  }
  beginRename() {
    if (!this.blocked() && this.state.draft) this.set({ renaming: true, error: undefined });
  }
  editTitle(title: string) {
    if (this.state.draft) this.set({ draft: { ...this.state.draft, title }, error: undefined });
  }
  saveTitle() {
    const draft = this.state.draft;
    if (!draft || draft.conflict) return;
    if (!draft.title.trim()) { this.set({ error: 'Заголовок заметки не может быть пустым.' }); return; }
    try {
      const document = this.service.updateNote(draft.base.id, { title: draft.title }, draft.base);
      this.choose(document, draft.base.id);
    } catch (error) { this.failed(error); }
  }
  cancelRename() {
    const draft = this.state.draft;
    if (draft && !draft.conflict) this.set({ draft: { ...draft, title: draft.base.title }, renaming: false, error: undefined });
  }
  acceptIncoming() {
    const draft = this.state.draft;
    if (!draft) return;
    try { this.choose(this.service.get(), draft.base.id); }
    catch (error) { this.set({ error: messageOf(error) }); }
  }
  discardInput() {
    try { this.choose(this.service.get(), this.state.draft?.base.id); }
    catch (error) {
      // Explicit discard must also work when the document can no longer be read.
      this.set({ draft: undefined, renaming: false, composing: false,
        writeFailed: false, error: messageOf(error) });
    }
  }
  saveSeparate() {
    const draft = this.state.draft;
    if (!draft) return;
    try {
      const id = this.newId();
      const document = this.service.createNote({ id,
        title: draft.title.trim() || draft.base.title, body: draft.body,
        tags: draft.base.tags, pinned: false, updatedAt: new Date().toISOString() });
      this.choose(document, id);
    } catch (error) { this.set({ error: messageOf(error) }); }
  }
  retry() {
    if (this.state.renaming) this.saveTitle();
    else this.commitBody();
  }
}
