import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { WidgetProps, DocumentService } from '@project-board/widget-sdk';
import { NotesEditor } from './editor';
import { NoteTags } from './NoteTags';
import { allTags, groupNotes, noteDate, notePreview } from './organization';
import { watchLocalDay } from './calendar';
import type { Note } from './model';
import { NotesDialog } from './NotesDialog';
import { parseMarkdown, renderMarkdownNodes, countWords, type MarkdownViewModel } from './markdown';
import { downloadNoteMarkdown } from './export';
import { ArrowLeft, Download, Eye, PenLine, Pin, Plus, Search, Trash2 } from 'lucide-react';
import './notes.css';

export default function NotesWidget(props: WidgetProps) {
  if (!props.documentId || !props.documentService) return <p role="alert">Документ блокнота недоступен.</p>;
  return <NotesPanel key={props.documentId} {...props} documentId={props.documentId} documentService={props.documentService} />;
}

const EMPTY_NOTES: readonly Note[] = [];
const MarkdownTree = memo(({ view }: { view: MarkdownViewModel }) => renderMarkdownNodes(view.nodes));

function NotesPanel({ widgetInstanceId, documentId, documentService, settings, updateSettings, visible }: WidgetProps & {
  documentId: string; documentService: DocumentService;
}) {
  const update = useRef(updateSettings);
  update.current = updateSettings;
  const [editor] = useState(() => new NotesEditor(documentService, documentId,
    typeof settings.selectedNoteId === 'string' ? settings.selectedNoteId : undefined,
    selectedNoteId => update.current?.({ selectedNoteId })));
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  useEffect(() => editor.start(), [editor]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string }>();
  const [discardTitle, setDiscardTitle] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [mode, setMode] = useState<'text' | 'preview'>('text');
  const [mobileEditor, setMobileEditor] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const parsedCache = useRef({ body: '', result: parseMarkdown('') });
  useEffect(() => visible ? watchLocalDay(setNow) : undefined, [visible]);
  const notes = state.document?.content.notes ?? EMPTY_NOTES;
  const cached = useRef<{ tags: ReturnType<typeof allTags>; groups: ReturnType<typeof groupNotes> }>({ tags: [], groups: [] });
  const { tags, groups } = useMemo(() => {
    if (visible) cached.current = { tags: allTags(notes), groups: groupNotes(notes, state.query, state.activeTag, now) };
    return cached.current;
  }, [visible, notes, state.query, state.activeTag, now]);
  const draft = state.draft;
  const parsed = useMemo(() => {
    if (!visible) return parsedCache.current.result;
    if (parsedCache.current.body !== (draft?.body ?? '')) {
      const body = draft?.body ?? '';
      parsedCache.current = { body, result: parseMarkdown(body) };
    }
    return parsedCache.current.result;
  }, [visible, draft?.body]);
  const outsideFilter = draft && !groups.some(group => group.notes.some(note => note.id === draft.base.id));
  const conflict = draft?.conflict;
  const renameCancel = () => {
    if (draft && draft.title !== draft.base.title) setDiscardTitle(true);
    else editor.cancelRename();
  };
  const changeMode = (next: 'text' | 'preview') => {
    if (next === mode) return;
    let current = editor.getSnapshot();
    if (next === 'preview' && current.composing && textarea.current) {
      editor.endComposition(textarea.current.value);
      current = editor.getSnapshot();
    }
    if (current.composing || current.writeFailed || current.renaming || current.draft?.conflict) return;
    setMode(next);
    requestAnimationFrame(() => (next === 'text' ? textarea.current : preview.current)?.focus());
  };
  const createNote = () => {
    if (editor.create()) { setMode('text'); setMobileEditor(true); }
  };
  const download = () => {
    let current = editor.getSnapshot();
    if (current.composing && textarea.current) {
      editor.endComposition(textarea.current.value);
      current = editor.getSnapshot();
    }
    if (current.composing || current.writeFailed || current.renaming || current.draft?.conflict || !current.draft) return;
    try {
      const note = current.document?.content.notes.find(item => item.id === current.draft?.base.id);
      if (note) downloadNoteMarkdown({ ...note, body: current.draft.body, title: current.draft.title });
    } catch (error) {
      editor.reportError(error);
    }
  };
  return <section className="notes-widget" data-instance={widgetInstanceId} aria-label="Блокнот">
    {state.error && <p role="alert" className="notes-error">{state.error}</p>}
    {state.document && <div className="notes-content">
      <aside className={`notes-list-pane${mobileEditor ? ' notes-mobile-hidden' : ''}`}>
        <div className="notes-list-toolbar">
          <label className="notes-search-field">
            <Search aria-hidden="true" />
            <input className="notes-search" aria-label="Поиск заметок" placeholder="Поиск"
              value={state.query} onChange={event => editor.setQuery(event.target.value)} />
          </label>
          <button className="notes-new-button" type="button" onClick={createNote} aria-label="Новая заметка" title="Новая заметка"><Plus aria-hidden="true" /></button>
        </div>
        <div className="notes-filters" role="group" aria-label="Фильтр по тегам">
          <button type="button" aria-label="Все теги" aria-pressed={state.activeTag === null} onClick={() => editor.setTag(null)}>Все <span>{notes.length}</span></button>
          {tags.map(({ tag, count }) => <button key={tag} type="button" aria-label={`Фильтр ${tag}`} aria-pressed={state.activeTag === tag}
            onClick={() => editor.setTag(state.activeTag === tag ? null : tag)}>#{tag} <span>{count}</span></button>)}
        </div>
      <nav className="notes-list" aria-label="Заметки блокнота">
        {groups.map(group => <div key={group.title} className="notes-group">
          <h4>{group.title}</h4>
          {group.notes.map(note => <button key={note.id} type="button" className="notes-card" aria-label={note.title}
            aria-describedby={`${widgetInstanceId}-${note.id}-summary`} aria-pressed={note.id === draft?.base.id} onClick={() => { editor.select(note.id); setMobileEditor(true); }}>
            <strong>{note.pinned && <span aria-hidden="true">◆ </span>}{note.title}</strong>
            <span id={`${widgetInstanceId}-${note.id}-summary`} className="notes-card-summary">
              <time dateTime={note.updatedAt}>{noteDate(note.updatedAt)}</time><span>{notePreview(note.body)}</span>
            </span>
          </button>)}
        </div>)}
        {!groups.length && notes.length > 0 && <div className="notes-empty"><p>Ничего не найдено</p>
          <button type="button" onClick={() => editor.resetFilters()}>Сбросить фильтры</button></div>}
      </nav>
      </aside>
      {draft ? <div className={`notes-editor${mobileEditor ? ' notes-mobile-active' : ''}`}>
        {outsideFilter && <p className="notes-filter-hint">Открытая заметка не входит в текущий фильтр.</p>}
        <div className="notes-heading">
          <button className="notes-back-button" type="button" aria-label="Назад к списку" onClick={() => setMobileEditor(false)}>
            <ArrowLeft aria-hidden="true" />
          </button>
          <div className="notes-mode" role="group" aria-label="Режим заметки">
            <button type="button" aria-pressed={mode === 'text'} onClick={() => changeMode('text')}>
              <PenLine aria-hidden="true" />Текст
            </button>
            <button type="button" aria-pressed={mode === 'preview'} onClick={() => changeMode('preview')}>
              <Eye aria-hidden="true" />Просмотр
            </button>
          </div>
          <span className="notes-toolbar-spacer" />
          <button className="notes-icon-button" type="button" aria-label={draft.base.pinned ? 'Открепить' : 'Закрепить'}
            title={draft.base.pinned ? 'Открепить' : 'Закрепить'} aria-pressed={draft.base.pinned}
            onClick={() => editor.setPinned(draft.base.id, !draft.base.pinned)}><Pin aria-hidden="true" /></button>
          <button className="notes-icon-button" type="button" onClick={download} aria-label="Скачать .md" title="Скачать .md"><Download aria-hidden="true" /></button>
          <button className="notes-icon-button" type="button" onClick={() => setDeleteTarget({ id: draft.base.id, title: draft.title })}
            aria-label="Удалить заметку" title="Удалить заметку"><Trash2 aria-hidden="true" /></button>
        </div>
        <div className="notes-note-content">
          <div className="notes-title-row">
            <h3 className="notes-title">{draft.title}</h3>
            <button type="button" className="notes-title-edit" aria-label="Переименовать заметку" title="Переименовать заметку"
              onClick={() => { setDiscardTitle(false); editor.beginRename(); }}>Переименовать</button>
          </div>
          <NoteTags note={draft.base} editor={editor} />
          {mode === 'text' ? <textarea ref={textarea} aria-label="Текст заметки" value={draft.body} spellCheck={false}
          onChange={event => editor.editBody(event.target.value)}
          onCompositionStart={() => editor.beginComposition()}
          onCompositionEnd={event => editor.endComposition(event.currentTarget.value)}
          onBlur={event => { if (editor.getSnapshot().composing) editor.endComposition(event.currentTarget.value); }} /> : <>
          <div ref={preview} className="notes-markdown" tabIndex={-1} aria-label="Просмотр заметки"
            onDoubleClick={event => { if (!(event.target as HTMLElement).closest('a, button, input, textarea')) changeMode('text'); }}>
            <MarkdownTree view={parsed} />
          </div>
        </>}
        </div>
        <footer className="notes-footer"><span>{countWords(parsed.plainText)} слов · Markdown</span>
          <span>Изменено {noteDate(draft.base.updatedAt)}</span></footer>
      </div> : <p className="notes-empty">{notes.length ? "Выберите заметку или сбросьте фильтры." : "В блокноте пока нет заметок. Создайте первую заметку."}</p>}
    </div>}
    {conflict && draft ? <NotesDialog title="Конфликт заметки">
      <p>{state.document?.title} · {draft.base.title}</p>
      <p>Заметка изменилась в другом окне. Выберите, какой вариант сохранить.</p>
      <div className="notes-versions"><label>Сохранённый вариант<textarea aria-label="Сохранённый вариант" readOnly value={conflict.incoming?.body ?? 'Заметка удалена'} /></label>
        <label>Мой вариант<textarea aria-label="Мой вариант" readOnly value={draft.body} /></label></div>
      <p>Сохранённый заголовок: {conflict.incoming?.title ?? 'Заметка удалена'}</p>
      <p>Мой заголовок: {draft.title}</p>
      <p>Принятие сохранённой версии отбросит мой локальный ввод. Мой вариант пока только в памяти: закрытие приложения или перезагрузка может его потерять.</p>
      {state.error && <p role="alert">{state.error}</p>}
      <div className="notes-actions"><button type="button" onClick={() => editor.saveSeparate()}>Сохранить мой вариант отдельной заметкой</button>
        <button type="button" onClick={() => editor.acceptIncoming()}>Принять сохранённую версию</button></div>
    </NotesDialog> : state.writeFailed ? <NotesDialog title="Не удалось применить ввод">
      <p>{state.error}</p><p>Ввод остаётся в памяти до успешного применения или явного отказа.</p>
      <div className="notes-actions"><button type="button" onClick={() => editor.retry()}>Повторить</button>
        <button type="button" onClick={() => editor.discardInput()}>Отбросить мой ввод</button></div>
    </NotesDialog> : state.renaming && draft ? <NotesDialog title="Заголовок заметки" onCancel={renameCancel}>
      <form onSubmit={event => { event.preventDefault(); editor.saveTitle(); }}>
        <label>Новый заголовок<input value={draft.title} onChange={event => { setDiscardTitle(false); editor.editTitle(event.target.value); }} /></label>
        {state.error && <p role="alert">{state.error}</p>}
        <div className="notes-actions"><button type="submit">Применить</button><button type="button" onClick={renameCancel}>Отмена</button></div>
        {discardTitle && <div role="alert"><p>Отбросить введённый заголовок?</p>
          <button type="button" onClick={() => { setDiscardTitle(false); editor.cancelRename(); }}>Отбросить изменения</button>
          <button type="button" onClick={() => setDiscardTitle(false)}>Продолжить редактирование</button></div>}
      </form>
    </NotesDialog> : deleteTarget ? <NotesDialog title="Удалить заметку?" onCancel={() => setDeleteTarget(undefined)}>
      <p>«{deleteTarget.title}» будет удалена без корзины и возможности восстановления.</p>
      <div className="notes-actions"><button type="button" onClick={() => { if (editor.remove(deleteTarget.id)) { setDeleteTarget(undefined); setMobileEditor(false); } }}>Удалить</button>
        <button type="button" onClick={() => setDeleteTarget(undefined)}>Отмена</button></div>
    </NotesDialog> : null}
  </section>;
}
