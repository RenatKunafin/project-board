import { useEffect, useRef, useState } from 'react';
import { activateUpdate, requestReleaseNotes, requestUpdate, withUpdateTimeout } from './pwa-update';
import { isReleaseNotes, type ReleaseNote } from './release-notes';

type OfflineState = 'preparing' | 'ready' | 'unavailable';

const LABELS: Record<OfflineState, string> = {
  preparing: 'Подготовка офлайн…',
  ready: 'Готово к работе офлайн',
  unavailable: 'Офлайн-режим недоступен',
};

/** Регистрация принадлежит приложению; SDK и модули не знают о SW. */
export function PwaStatus({ prepareForUpdate }: { readonly prepareForUpdate: () => Promise<void> }) {
  const [state, setState] = useState<OfflineState>('preparing');
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [candidateRelease, setCandidateRelease] = useState<ReleaseNote | null>(null);
  const [postponed, setPostponed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'saving' | 'activating' | 'error'>('idle');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const applying = useRef(false);
  const busy = phase === 'saving' || phase === 'activating';

  useEffect(() => {
    let cancelled = false;
    setCandidateRelease(null);
    if (waiting?.state === 'installed') {
      void requestReleaseNotes(waiting).then((value) => {
        if (cancelled || !isReleaseNotes(value)) return;
        setCandidateRelease(value.releases[0] ?? null);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [waiting]);

  useEffect(() => {
    if (phase === 'idle') dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [phase]);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      setState('unavailable');
      return;
    }

    let disposed = false;
    const cleanups: (() => void)[] = [];
    const publish = (next: OfflineState) => {
      if (!disposed) setState(next);
    };
    const scope = new URL(import.meta.env.BASE_URL, location.href);
    // Нативная регистрация: никаких reload/skipWaiting до PBT-029.
    void navigator.serviceWorker.register(new URL('sw.js', scope), {
      scope: scope.pathname,
      updateViaCache: 'none',
    }).then((registration) => {
      if (disposed) return;
      const updateState = () => {
        if (registration.active?.state === 'activated') publish('ready');
        if (!disposed) setWaiting(registration.waiting);
      };
      const watch = (worker: ServiceWorker | null) => {
        if (!worker) return;
        const changed = () => {
          updateState();
          // Ошибка новой версии не отменяет готовность уже активной.
          if (worker.state === 'redundant' && !registration.active) {
            publish('unavailable');
          }
        };
        worker.addEventListener('statechange', changed);
        cleanups.push(() => worker.removeEventListener('statechange', changed));
        changed();
      };
      const installing = () => watch(registration.installing);
      registration.addEventListener('updatefound', installing);
      cleanups.push(() => registration.removeEventListener('updatefound', installing));
      watch(registration.installing);
      watch(registration.waiting);
      watch(registration.active);
      updateState();
      if (!registration.active && !registration.installing && !registration.waiting) {
        publish('unavailable');
      }
      let lastCheck = 0;
      let checking = false;
      const check = () => {
        if (document.visibilityState !== 'visible' || !navigator.onLine || checking || Date.now() - lastCheck < 60_000) return;
        lastCheck = Date.now();
        checking = true;
        void registration.update().catch(() => {}).finally(() => { checking = false; });
      };
      window.addEventListener('focus', check);
      window.addEventListener('online', check);
      document.addEventListener('visibilitychange', check);
      const timer = window.setInterval(check, 60 * 60 * 1000);
      cleanups.push(() => {
        window.removeEventListener('focus', check);
        window.removeEventListener('online', check);
        document.removeEventListener('visibilitychange', check);
        window.clearInterval(timer);
      });
    }).catch(() => publish('unavailable'));

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  const apply = async () => {
    if (applying.current) return;
    applying.current = true;
    setError('');
    setPhase('saving');
    try {
      if (!waiting || waiting.state !== 'installed') throw new Error('Новая версия больше не ожидает обновления. Повторите проверку.');
      await requestUpdate(waiting, 'PB_UPDATE_CHECK');
      await withUpdateTimeout(prepareForUpdate(), 'Сохранение занимает слишком много времени. Обновление отложено; повторите попытку.');
      setPhase('activating');
      await activateUpdate(waiting);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить данные. Обновление отложено.');
      setPhase('error');
    } finally {
      applying.current = false;
    }
  };

  if (!import.meta.env.PROD) return null;
  return (
    <>
      <p className={`pwa-state is-${state}`} role="status" aria-label="Готовность к офлайн-работе">
        {LABELS[state]}
      </p>
      {waiting && (
        <span className="pwa-update" role="status" aria-label="Обновление приложения">
          {!postponed && <span>Доступна новая версия</span>}
          <button type="button" onClick={() => setPhase('confirm')}>{postponed ? 'Есть обновление' : 'Обновить'}</button>
          {!postponed && <button type="button" onClick={() => setPostponed(true)}>Позже</button>}
        </span>
      )}
      <dialog className="pwa-update-dialog" ref={dialog} aria-labelledby="pwa-update-title"
        onCancel={(event) => { if (busy) event.preventDefault(); else setPhase('idle'); }}>
        <h2 id="pwa-update-title">Обновление Project Board</h2>
        {candidateRelease && <section className="pwa-update-release" aria-label={`Изменения ${candidateRelease.version}`}>
          <h3>{candidateRelease.version} · {candidateRelease.summary}</h3>
          <ul>{candidateRelease.changes.map((change) => <li key={change}>{change}</li>)}</ul>
        </section>}
        <p>Приложение перезапустится. Сначала сохраните изменения в открытых формах. Документы и расположение окон будут сохранены перед обновлением.</p>
        {busy && <p role="status">{phase === 'saving' ? 'Сохранение…' : 'Обновление…'}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="pwa-update-dialog__actions">
          <button type="button" disabled={busy} onClick={() => setPhase('idle')}>{phase === 'error' ? 'Закрыть' : 'Отмена'}</button>
          <button type="button" disabled={busy} onClick={() => { void apply(); }}>{phase === 'error' ? 'Повторить' : 'Обновить'}</button>
        </div>
      </dialog>
    </>
  );
}
