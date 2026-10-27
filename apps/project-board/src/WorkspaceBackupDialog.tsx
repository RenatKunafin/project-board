import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deserializeWorkspaceBackup,
  serializeWorkspaceBackup,
  WorkspaceBackupStore,
  type StoredWorkspaceBackup,
  type WorkspaceBackup,
  type WorkspaceBackupCompatibility,
  type WorkspaceBackupCapture,
} from '@project-board/dashboard';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly backupStore: WorkspaceBackupStore;
  readonly compatibility: WorkspaceBackupCompatibility;
  readonly prepareSnapshot: () => Promise<WorkspaceBackupCapture>;
  readonly prepareForRestore: () => Promise<void>;
  readonly prepareDocuments: (documents: readonly import('@project-board/widget-sdk').ManagedDocument[]) => import('@project-board/widget-sdk').ManagedDocument[];
}

type Candidate = { backup: WorkspaceBackup; issues: readonly { severity: string; message: string }[] };

export function WorkspaceBackupDialog({ open, onClose, backupStore, compatibility, prepareSnapshot, prepareForRestore, prepareDocuments }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<StoredWorkspaceBackup[]>([]);
  const [composition, setComposition] = useState({ documents: 0, tabs: 0, windows: 0 });
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [safety, setSafety] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void Promise.all([backupStore.list(), backupStore.readSnapshot()]).then(([items, snapshot]) => {
      setRows(items);
      setComposition({ documents: snapshot.documents.length, tabs: snapshot.workspace.tabs.length, windows: snapshot.workspace.instances.length });
    }).catch((caught) => setError(String(caught)));
  }, [open, backupStore]);

  const summary = useMemo(() => rows.length ? `${rows.length} / 5 копий` : 'Копий пока нет', [rows.length]);

  async function refresh(): Promise<void> { setRows(await backupStore.list()); }

  async function createManual(): Promise<void> {
    setBusy(true); setError(''); setMessage('');
    try {
      const payload = await prepareSnapshot();
      const result = serializeWorkspaceBackup(payload.payload, new Date().toISOString());
      if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join(' '));
      const decoded = deserializeWorkspaceBackup(result.json, compatibility);
      if (!decoded.ok) throw new Error(decoded.issues.map((issue) => issue.message).join(' '));
      await backupStore.addCapture(decoded.value, payload, 'manual');
      await refresh(); setComposition({ documents: payload.payload.documents.length, tabs: payload.payload.workspace.tabs.length, windows: payload.payload.workspace.instances.length }); setMessage('Копия создана.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  async function chooseFile(file?: File): Promise<void> {
    if (!file) return;
    setError(''); setMessage('');
    try {
      const result = deserializeWorkspaceBackup(await file.text(), compatibility);
      if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join(' '));
      setCandidate({ backup: result.value, issues: result.issues }); setSafety(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  }

  async function restore(backup: WorkspaceBackup): Promise<void> {
    setBusy(true); setError(''); setMessage('');
    try {
      await prepareForRestore();
      const current = await prepareSnapshot();
      let safetyBackup: WorkspaceBackup | undefined;
      if (safety) {
        const result = serializeWorkspaceBackup(current.payload, new Date().toISOString());
        if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join(' '));
        const decoded = deserializeWorkspaceBackup(result.json, compatibility);
        if (!decoded.ok) throw new Error(decoded.issues.map((issue) => issue.message).join(' '));
        safetyBackup = decoded.value;
      }
      await backupStore.replace({ ...backup, documents: prepareDocuments(backup.documents) }, current, safetyBackup);
      window.location.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setBusy(false); }
  }

  async function download(row: StoredWorkspaceBackup): Promise<void> {
    const blob = new Blob([JSON.stringify(row.backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pb-workspace-${row.createdAt.replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('Файл передан браузеру для скачивания.');
  }

  return <dialog ref={dialogRef} className="backup-dialog" aria-labelledby="backup-title" onCancel={(event) => { if (busy) event.preventDefault(); else { setCandidate(null); onClose(); } }} onClick={(event) => { if (event.target === dialogRef.current && !busy) { setCandidate(null); onClose(); } }}>
    <div className="backup-dialog__content">
      <header className="backup-dialog__header">
        <div><p className="backup-dialog__eyebrow">Рабочее пространство</p><h2 id="backup-title">Резервные копии</h2><p>Сохраняйте и переносите документы, вкладки и расположение окон.</p></div>
        <button type="button" className="backup-dialog__close" aria-label="Закрыть" disabled={busy} onClick={() => { setCandidate(null); onClose(); }}>×</button>
      </header>
      {candidate ? <section className="backup-restore" aria-label="Подтверждение восстановления">
        <h3>Заменить текущее пространство?</h3>
        <p>Будут заменены все документы, вкладки, окна и настройки представлений.</p>
        <p>{candidate.backup.documents.length} документов · {candidate.backup.workspace.tabs.length} вкладок · {candidate.backup.workspace.instances.length} окон</p>
        {candidate.issues.filter((issue) => issue.severity === 'warning').map((issue, index) => <p className="backup-dialog__warning" key={index}>{issue.message}</p>)}
        <label className="backup-safety"><input type="checkbox" checked={safety} disabled={busy} onChange={(event) => setSafety(event.target.checked)} /> Перед заменой создать страховочную копию текущего пространства</label>
        <div className="backup-dialog__actions"><button type="button" disabled={busy} onClick={() => setCandidate(null)}>Отмена</button><button type="button" className="backup-primary backup-danger" disabled={busy} onClick={() => void restore(candidate.backup)}>{busy ? 'Восстановление…' : 'Заменить пространство'}</button></div>
      </section> : <>
        <div className="backup-summary"><span>{summary}</span><span>{composition.documents} документов · {composition.tabs} вкладок · {composition.windows} окон</span></div>
        <div className="backup-dialog__actions">
          <button type="button" className="backup-primary" disabled={busy} onClick={() => void createManual()}>{busy ? 'Сохранение…' : 'Создать копию'}</button>
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Из файла</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Выбрать файл резервной копии" onChange={(event) => void chooseFile(event.target.files?.[0])} />
        </div>
        {rows.length === 0 ? <div className="backup-empty">Создавайте копии вручную. История хранит до пяти последних копий.</div> : <ul className="backup-list">{rows.map((row) => <li key={row.id}>
          <div className="backup-list__main"><strong>{new Date(row.createdAt).toLocaleString()}</strong><span>{row.kind === 'manual' ? 'Вручную' : 'Перед восстановлением'} · {row.backup.documents.length} документов · {row.backup.workspace.tabs.length} вкладок · {row.backup.workspace.instances.length} окон</span><small>{formatSize(row.size)}</small></div>
          <div className="backup-list__actions"><button type="button" disabled={busy} onClick={() => setCandidate({ backup: row.backup, issues: [] })}>Восстановить</button><button type="button" disabled={busy} onClick={() => void download(row)}>Скачать</button><button type="button" aria-label="Удалить копию" disabled={busy} onClick={() => void backupStore.delete(row.id).then(refresh).catch((caught) => setError(String(caught)))}>Удалить</button></div>
        </li>)}</ul>}
      </>}
      {message && <p role="status" className="backup-dialog__message">{message}</p>}{error && <p role="alert" className="backup-dialog__error">{error}</p>}
      <footer className="backup-dialog__footer">Копии хранятся в данных сайта на этом устройстве. Очистка данных сайта удалит локальную историю.</footer>
    </div>
  </dialog>;
}

function formatSize(bytes: number): string { return bytes < 1024 ? `${bytes} Б` : `${(bytes / 1024).toFixed(1)} КБ`; }
