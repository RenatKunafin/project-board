import { useRef, useState } from 'react';
import type { Note } from './model';
import type { NotesEditor } from './editor';
import { normalizedTags } from './organization';
import { Hash } from 'lucide-react';

type TagInput = { raw: string; error?: string };
export function NoteTags({ note, editor }: { readonly note: Note; readonly editor: NotesEditor }) {
  // Pending input belongs to its note even if blur fails just before selection changes.
  const drafts = useRef<Record<string, TagInput>>({});
  const [, render] = useState(0);
  const composing = useRef<string | null>(null);
  const set = (id: string, input: TagInput) => { drafts.current[id] = input; render(value => value + 1); };
  const accept = (id: string, all: boolean) => {
    const raw = drafts.current[id]?.raw ?? '';
    const parts = raw.split(',');
    const remainder = all ? '' : parts.pop()!;
    if (editor.addTags(id, parts)) set(id, { raw: remainder });
    else set(id, { raw, error: editor.getSnapshot().error ?? 'Не удалось добавить тег.' });
  };
  const input = drafts.current[note.id] ?? { raw: '' };
  return <div className="notes-tags">
    <div className="notes-tag-chips" aria-label="Теги заметки">
      {normalizedTags(note.tags).map(tag => <span key={tag} className="notes-tag">#{tag}
        <button type="button" aria-label={`Убрать тег ${tag}`} onClick={() => editor.removeTag(note.id, tag)}>×</button></span>)}
    </div>
    <label className="notes-tag-entry">
      <Hash aria-hidden="true" />
      <input className="notes-tag-input" key={note.id} aria-label="Добавить тег" placeholder="добавить тег" value={input.raw}
        onChange={event => {
          const raw = event.target.value;
          set(note.id, { raw });
          if (composing.current !== note.id && raw.includes(',')) accept(note.id, false);
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current === note.id) return;
          if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); accept(note.id, true); }
        }}
        onBlur={event => {
          if (composing.current === note.id) { composing.current = null; return; }
          if (drafts.current[note.id]?.raw) {
            if (event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.classList.contains('notes-card')) {
              // Let a note-selection click finish before its new timestamp
              // reorders the list under the pointer.
              window.setTimeout(() => accept(note.id, true), 0);
            } else accept(note.id, true);
          }
        }}
        onCompositionStart={() => { composing.current = note.id; }}
        onCompositionEnd={event => {
          composing.current = null;
          set(note.id, { raw: event.currentTarget.value });
          if (event.currentTarget.value.includes(',')) accept(note.id, false);
        }} />
    </label>
    {input.error && <p role="alert" className="notes-error">{input.error}</p>}
  </div>;
}
