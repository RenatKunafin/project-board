/** Debounce завершённых изменений с ограничением времени ожидания (PBT-139). */
export interface DeferredWriterTimers {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  now(): number;
}

const systemTimers: DeferredWriterTimers = {
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
  now: () => Date.now(),
};

export interface DeferredSnapshotWriter<T> {
  schedule(snapshot: T): void;
  /** Ждёт текущую запись и все поступившие во время неё изменения. Отказ виден вызывающему. */
  commitNow(): Promise<void>;
  /** Включает запись в работе и сохранённый для повтора снимок после ошибки. */
  hasPending(): boolean;
  /** Снять таймер при размонтировании; уже начатую транзакцию отменить нельзя. */
  dispose(): void;
}

export interface DeferredSnapshotWriterOptions<T> {
  save(snapshot: T): Promise<void>;
  debounceMs?: number;
  maxWaitMs?: number;
  timers?: Partial<DeferredWriterTimers>;
  /** Ошибка фоновой записи по таймеру; commitNow отклоняет свой Promise. */
  onError?(error: unknown): void;
}

export function createDeferredSnapshotWriter<T>(
  options: DeferredSnapshotWriterOptions<T>,
): DeferredSnapshotWriter<T> {
  const debounceMs = options.debounceMs ?? 300;
  const maxWaitMs = options.maxWaitMs ?? 2000;
  const timers = { ...systemTimers, ...options.timers };
  let pending: { snapshot: T; since: number } | null = null;
  let timer: number | null = null;
  let inFlight: Promise<void> | null = null;

  function clearTimer(): void {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }

  function commitNow(): Promise<void> {
    clearTimer();
    if (inFlight) return inFlight;
    if (!pending) return Promise.resolve();

    const drain = async (): Promise<void> => {
      while (pending) {
        const entry = pending;
        pending = null;
        try {
          await options.save(entry.snapshot);
        } catch (error) {
          // Более свежие изменения имеют приоритет над неудавшимся снимком.
          pending ??= entry;
          throw error;
        }
      }
    };
    inFlight = drain().then(() => {
      inFlight = null;
      // Другой обработчик Promise save мог добавить снимок уже после
      // выхода drain из цикла. Он тоже входит в ожидаемый commit.
      if (pending) return commitNow();
    }, (error: unknown) => {
      inFlight = null;
      throw error;
    });
    return inFlight;
  }

  return {
    schedule(snapshot): void {
      pending = { snapshot, since: pending?.since ?? timers.now() };
      clearTimer();
      // Текущий drain сам запишет последнее состояние после завершения save.
      if (inFlight) return;
      const remaining = Math.max(0, pending.since + maxWaitMs - timers.now());
      timer = timers.setTimeout(() => {
        timer = null;
        void commitNow().catch((error: unknown) => options.onError?.(error));
      }, Math.min(debounceMs, remaining));
    },
    commitNow,
    hasPending: () => pending !== null || inFlight !== null,
    dispose(): void {
      clearTimer();
      pending = null;
    },
  };
}
