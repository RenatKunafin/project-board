import { describe, expect, it } from 'vitest';
import { readNotesWindowSettings } from './window-settings';

describe('настройки окна заметок', () => {
  it('задаёт defaults для старых и некорректных настроек', () => {
    expect(readNotesWindowSettings({ mode: 'invalid', narrowPane: 'invalid', query: 7, activeTag: null }))
      .toEqual({ selectedNoteId: undefined, query: '', activeTag: null, mode: 'text', narrowPane: 'list' });
  });

  it('сохраняет допустимые настройки окна', () => {
    expect(readNotesWindowSettings({ selectedNoteId: 'note-1', query: 'план', activeTag: 'работа', mode: 'preview', narrowPane: 'note' }))
      .toEqual({ selectedNoteId: 'note-1', query: 'план', activeTag: 'работа', mode: 'preview', narrowPane: 'note' });
  });
});
