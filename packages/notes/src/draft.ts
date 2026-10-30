import type { Note, NotesContent } from './model';
import { createNote } from './operations';

export interface NoteDraft {
  readonly noteId: string;
  /** Latest committed note used as the comparison baseline. */
  readonly baseNote: Note;
  readonly body: string;
  readonly conflict?: { readonly incomingNote?: Note };
}

export function createNoteDraft(note: Note): NoteDraft {
  return { noteId: note.id, baseNote: note, body: note.body };
}

export function editNoteDraft(draft: NoteDraft, body: string): NoteDraft {
  return { ...draft, body };
}

export function receiveNotesSnapshot(
  draft: NoteDraft,
  content: NotesContent,
): NoteDraft {
  const incoming = content.notes.find((note) => note.id === draft.noteId);
  if (!incoming) {
    return { ...draft, conflict: { incomingNote: undefined } };
  }
  const hasLocalEdits = draft.body !== draft.baseNote.body;
  const bodyChangedRemotely = incoming.body !== draft.baseNote.body;
  if (hasLocalEdits && bodyChangedRemotely && incoming.body !== draft.body) {
    return { ...draft, conflict: { incomingNote: incoming } };
  }
  if (hasLocalEdits) {
    return { ...draft, baseNote: incoming };
  }
  return { noteId: draft.noteId, baseNote: incoming, body: incoming.body };
}

/** Accept the committed version and discard the in-memory local draft. */
export function acceptIncomingVersion(draft: NoteDraft): NoteDraft | null {
  if (!draft.conflict) return draft;
  if (!draft.conflict.incomingNote) return null;
  return createNoteDraft(draft.conflict.incomingNote);
}

/** Preserve the local text as a separate note; caller supplies its title. */
export function saveDraftAsSeparateNote(
  content: NotesContent,
  draft: NoteDraft,
  input: { readonly id: string; readonly title: string; readonly updatedAt: string },
): NotesContent {
  return createNote(content, {
    ...input,
    body: draft.body,
    tags: draft.baseNote.tags,
    pinned: false,
  });
}
