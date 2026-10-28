import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WidgetProps, DocumentService } from '@project-board/widget-sdk';
import { NotesEditor } from './editor';
import { NotesDialog } from './NotesDialog';
import './notes.css';

export default function NotesWidget(props: WidgetProps) {
  if (!props.documentId || !props.documentService) return <p role="alert">Документ блокнота недоступен.</p>;
  return <NotesPanel key={props.documentId} {...props} documentId={props.documentId} documentService={props.documentService} />;
}

function NotesPanel({ widgetInstanceId, documentId, documentService, settings, updateSettings }: WidgetProps & {
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
  const draft = state.draft;
  const conflict = draft?.conflict;
  const renameCancel = () => {
    if (draft && draft.title !== draft.base.title) setDiscardTitle(true);
    else editor.cancelRename();
  };
  return <section className="notes-widget" data-instance={widgetInstanceId} aria-label="Блокнот">
    <div className="notes-toolbar"><button type="button" onClick={() => editor.create()}>Новая заметка</button>
      <span>Заметок: {state.document?.content.notes.length ?? 0}</span></div>
    {state.error && <p role="alert" className="notes-error">{state.error}</p>}
    {state.document && <div className="notes-content">
      <nav className="notes-list" aria-label="Заметки блокнота">
        {state.document.content.notes.map(note => <button key={note.id} type="button"
          aria-pressed={note.id === draft?.base.id} onClick={() => editor.select(note.id)}>{note.title}</button>)}
      </nav>
      {draft ? <div className="notes-editor">
        <div className="notes-heading"><h3>{draft.base.title}</h3>
          <button type="button" onClick={() => { setDiscardTitle(false); editor.beginRename(); }}>Переименовать заметку</button>
          <button type="button" onClick={() => setDeleteTarget({ id: draft.base.id, title: draft.base.title })}>Удалить заметку</button>
        </div>
        <textarea aria-label="Текст заметки" value={draft.body} spellCheck={false}
          onChange={event => editor.editBody(event.target.value)}
          onCompositionStart={() => editor.beginComposition()}
          onCompositionEnd={event => editor.endComposition(event.currentTarget.value)}
          onBlur={event => { if (state.composing) editor.endComposition(event.currentTarget.value); }} />
      </div> : <p className="notes-empty">В блокноте пока нет заметок. Создайте первую заметку.</p>}
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
      <div className="notes-actions"><button type="button" onClick={() => { if (editor.remove(deleteTarget.id)) setDeleteTarget(undefined); }}>Удалить</button>
        <button type="button" onClick={() => setDeleteTarget(undefined)}>Отмена</button></div>
    </NotesDialog> : null}
  </section>;
}
