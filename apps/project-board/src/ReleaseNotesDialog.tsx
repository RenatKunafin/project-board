import { useEffect, useRef } from 'react';
import { RELEASE_NOTES } from './release-notes';

export function ReleaseNotesDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal?.();
    else if (!open && ref.current?.open) ref.current?.close?.();
  }, [open]);

  return <dialog ref={ref} className="release-notes-dialog" aria-labelledby="release-notes-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === ref.current) onClose(); }}>
    <div className="release-notes-dialog__content">
      <header className="release-notes-dialog__header">
        <div><p className="release-notes-dialog__eyebrow">История выпусков</p><h2 id="release-notes-title">Что нового</h2></div>
        <button type="button" className="release-notes-dialog__close" aria-label="Закрыть" onClick={onClose}>×</button>
      </header>
      {RELEASE_NOTES.releases.length === 0 ? <p className="release-notes-empty">Пока нет заметок о выпусках.</p> :
        <ol className="release-notes-list">{RELEASE_NOTES.releases.map((release) => <li key={release.version}>
          <article>
            <header><h3>{release.version}</h3><time dateTime={release.date}>{new Date(`${release.date}T00:00:00`).toLocaleDateString('ru-RU')}</time></header>
            <p>{release.summary}</p>
            <ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul>
          </article>
        </li>)}</ol>}
    </div>
  </dialog>;
}
