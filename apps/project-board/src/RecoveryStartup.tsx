import { useState } from 'react';
import type { ManagedDocument } from '@project-board/widget-sdk';
import {
  type RecoveryLookup,
  RecoverySnapshotCoordinator,
  WorkspaceBackupStore,
  type WorkspaceBackupCapture,
} from '@project-board/dashboard';

interface Props {
  readonly initialLookup: RecoveryLookup;
  readonly coordinator: RecoverySnapshotCoordinator;
  readonly backupStore: WorkspaceBackupStore;
  readonly emptyCapture: WorkspaceBackupCapture;
  readonly prepareDocuments: (documents: readonly ManagedDocument[]) => ManagedDocument[];
  readonly onContinue: () => void;
}

/** Не даёт первому пустому workspace записаться поверх найденной копии. */
export function RecoveryStartup({ initialLookup, coordinator, backupStore, emptyCapture, prepareDocuments, onContinue }: Props) {
  const [lookup, setLookup] = useState(initialLookup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function chooseDirectory(): Promise<void> {
    setError('');
    try {
      setLookup(await coordinator.chooseDirectory());
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function permit(): Promise<void> {
    setError('');
    try { setLookup(await coordinator.requestWritePermission()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }

  async function restore(): Promise<void> {
    if (lookup.status !== 'ready') return;
    setBusy(true);
    setError('');
    try {
      const backup = lookup.snapshot.backup;
      await backupStore.replace({
        ...backup,
        documents: prepareDocuments(backup.documents),
      }, emptyCapture);
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return <main className="recovery-startup">
    <section className="recovery-startup__card" aria-labelledby="recovery-startup-title">
      <p className="backup-dialog__eyebrow">Project Board</p>
      <h1 id="recovery-startup-title">Восстановить рабочее пространство?</h1>
      <p>Локальная база пуста. Проверьте папку с автоматическими копиями перед созданием нового пространства.</p>
      {lookup.status === 'ready' && <div className="recovery-startup__snapshot">
        <strong>Найдена копия от {new Date(lookup.snapshot.createdAt).toLocaleString()}</strong>
        <p>Возраст копии: {formatAge(lookup.snapshot.createdAt)}</p>
        <p>{lookup.snapshot.backup.documents.length} документов · {lookup.snapshot.backup.workspace.tabs.length} вкладок · {lookup.snapshot.backup.workspace.instances.length} окон</p>
        <p>Папка: {lookup.snapshot.folderName}</p>
        {lookup.damagedSlot && <p role="alert">Один из двух файлов повреждён; доступна предыдущая годная копия.</p>}
        {!lookup.writable && <p role="status">Для новых автоматических копий нужно снова разрешить запись в папку.</p>}
      </div>}
      {lookup.status === 'empty' && <p role="status">В папке «{lookup.folderName}» копий пока нет.</p>}
      {lookup.status === 'corrupt' && <p role="alert">Файлы в папке «{lookup.folderName}» повреждены или имеют неизвестный формат. Они не удалены.</p>}
      {lookup.status === 'permission-required' && <p role="status">Доступ к папке «{lookup.folderName}» нужно разрешить повторно.</p>}
      {lookup.status === 'unsupported' && <p role="alert">Этот браузер не поддерживает доступ к выбранной папке.</p>}
      <div className="recovery-startup__actions">
        {lookup.status === 'ready' && <button type="button" className="backup-primary" disabled={busy} onClick={() => void restore()}>{busy ? 'Восстановление…' : 'Восстановить копию'}</button>}
        {(lookup.status === 'permission-required' || lookup.status === 'ready' && !lookup.writable) && <button type="button" disabled={busy} onClick={() => void permit()}>Разрешить доступ</button>}
        <button type="button" disabled={busy} onClick={() => void chooseDirectory()}>Выбрать папку с копиями</button>
        <button type="button" disabled={busy} onClick={onContinue}>Продолжить без восстановления</button>
      </div>
      {lookup.status === 'ready' && <p>При продолжении файлы останутся в папке. Новые автоматические копии могут со временем вытеснить найденную.</p>}
      {error && <p role="alert" className="backup-dialog__error">{error}</p>}
    </section>
  </main>;
}

function formatAge(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 60_000));
  if (minutes < 1) return 'меньше минуты';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
}
