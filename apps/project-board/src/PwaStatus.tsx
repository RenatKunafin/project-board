import { useEffect, useState } from 'react';

type OfflineState = 'preparing' | 'ready' | 'unavailable';

const LABELS: Record<OfflineState, string> = {
  preparing: 'Подготовка офлайн…',
  ready: 'Готово к работе офлайн',
  unavailable: 'Офлайн-режим недоступен',
};

/** Регистрация принадлежит приложению; SDK и модули не знают о SW. */
export function PwaStatus() {
  const [state, setState] = useState<OfflineState>('preparing');

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
    }).catch(() => publish('unavailable'));

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  if (!import.meta.env.PROD) return null;
  return (
    <p className={`pwa-state is-${state}`} role="status" aria-label="Готовность к офлайн-работе">
      {LABELS[state]}
    </p>
  );
}
