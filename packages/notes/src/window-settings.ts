export type NotesMode = 'text' | 'preview';
export type NotesPane = 'list' | 'note';

export interface NotesWindowSettings {
  readonly selectedNoteId?: string | null;
  readonly query: string;
  readonly activeTag: string | null;
  readonly mode: NotesMode;
  readonly narrowPane: NotesPane;
}

export function readNotesWindowSettings(value: Record<string, unknown>): NotesWindowSettings {
  return {
    selectedNoteId: typeof value.selectedNoteId === 'string' && value.selectedNoteId ? value.selectedNoteId : undefined,
    query: typeof value.query === 'string' ? value.query : '',
    activeTag: typeof value.activeTag === 'string' && value.activeTag ? value.activeTag : null,
    mode: value.mode === 'preview' ? 'preview' : 'text',
    narrowPane: value.narrowPane === 'note' ? 'note' : 'list',
  };
}
