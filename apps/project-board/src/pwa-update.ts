/** Таймаут не отменяет запись IDB, но её поздний успех не разрешает reload. */
export async function withUpdateTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function requestUpdate(worker: ServiceWorker, type: 'PB_UPDATE_CHECK' | 'PB_UPDATE_ACTIVATE'): Promise<void> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => finish(new Error('Новая версия не отвечает. Повторите обновление.')), 5000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      if (error) reject(error); else resolve();
    };
    channel.port1.onmessage = ({ data }: MessageEvent<{ ok?: boolean; reason?: string }>) => {
      finish(data.ok ? undefined : new Error(data.reason === 'other-windows'
        ? 'Закройте другие окна Project Board и повторите обновление.'
        : 'Не удалось подготовить новую версию. Повторите обновление.'));
    };
    try { worker.postMessage({ type }, [channel.port2]); } catch {
      finish(new Error('Новая версия больше не доступна. Повторите проверку.'));
    }
  });
}

export function requestReleaseNotes(worker: ServiceWorker): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => finish(new Error('Заметки новой версии не получены.')), 5000);
    const finish = (error?: Error, result?: unknown) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      if (error) reject(error); else resolve(result);
    };
    channel.port1.onmessage = ({ data }: MessageEvent<{ ok?: boolean; releaseNotes?: unknown }>) => {
      if (!data || data.ok !== true) finish(new Error('Заметки новой версии недоступны.'));
      else finish(undefined, data.releaseNotes);
    };
    try { worker.postMessage({ type: 'PB_RELEASE_NOTES' }, [channel.port2]); } catch {
      finish(new Error('Новая версия больше не доступна.'));
    }
  });
}

/** Слушатель установлен до запроса активации и всегда снимается при отказе. */
export async function activateUpdate(worker: ServiceWorker): Promise<void> {
  let changed: (() => void) | undefined;
  const controlled = new Promise<void>((resolve) => {
    changed = () => {
      if (navigator.serviceWorker.controller === worker) resolve();
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
  });
  try {
    await withUpdateTimeout((async () => {
      await requestUpdate(worker, 'PB_UPDATE_ACTIVATE');
      await controlled;
    })(), 'Новая версия не активировалась вовремя. Данные сохранены; повторите попытку.');
  } finally {
    if (changed) navigator.serviceWorker.removeEventListener('controllerchange', changed);
  }
}
