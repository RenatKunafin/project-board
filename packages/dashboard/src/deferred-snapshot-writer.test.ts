import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredSnapshotWriter } from './deferred-snapshot-writer';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function setup(save = vi.fn<(snapshot: string) => Promise<void>>().mockResolvedValue(undefined)) {
  const onError = vi.fn();
  const writer = createDeferredSnapshotWriter({
    save, onError,
    timers: {
      now: () => Date.now(),
      setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
      clearTimeout: (handle) => clearTimeout(handle),
    },
  });
  return { writer, save, onError };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

describe('отложенное сохранение снапшота', () => {
  it('объединяет изменения в один последний снимок после паузы', async () => {
    const { writer, save } = setup();
    writer.schedule('a');
    await vi.advanceTimersByTimeAsync(200);
    writer.schedule('b');
    await vi.advanceTimersByTimeAsync(299);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save.mock.calls).toEqual([['b']]);
    expect(writer.hasPending()).toBe(false);
  });

  it('при непрерывных изменениях начинает запись точно по потолку, затем открывает новое окно', async () => {
    const { writer, save } = setup();
    for (let i = 0; i < 10; i++) {
      writer.schedule(`v${i}`);
      await vi.advanceTimersByTimeAsync(199);
    }
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(save.mock.calls).toEqual([['v9']]);
    for (let i = 10; i < 20; i++) {
      writer.schedule(`v${i}`);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(save.mock.calls).toEqual([['v9'], ['v19']]);
  });

  it('после долгого покоя сохраняет debounce для первой новой серии', async () => {
    const { writer, save } = setup();
    await vi.advanceTimersByTimeAsync(10000);
    writer.schedule('new');
    await vi.advanceTimersByTimeAsync(299);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledWith('new');
  });

  it('немедленный commit ждёт запись, не оставляет дублирующий таймер', async () => {
    const gate = deferred();
    const { writer, save } = setup(vi.fn().mockReturnValue(gate.promise));
    writer.schedule('structural');
    const committed = vi.fn();
    const flush = writer.commitNow().then(committed);
    expect(save).toHaveBeenCalledWith('structural');
    expect(writer.hasPending()).toBe(true);
    expect(committed).not.toHaveBeenCalled();
    gate.resolve();
    await flush;
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(writer.hasPending()).toBe(false);
  });

  it('сериализует медленные записи и объединяет поступившие во время save изменения', async () => {
    const gate = deferred();
    const save = vi.fn<(snapshot: string) => Promise<void>>()
      .mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const { writer } = setup(save);
    writer.schedule('first');
    const flush = writer.commitNow();
    writer.schedule('second');
    writer.schedule('latest');
    const anotherFlush = writer.commitNow();
    await vi.advanceTimersByTimeAsync(10000);
    expect(save.mock.calls).toEqual([['first']]);
    gate.resolve();
    await Promise.all([flush, anotherFlush]);
    expect(save.mock.calls).toEqual([['first'], ['latest']]);
    expect(writer.hasPending()).toBe(false);
  });

  it('не теряет правку из другого обработчика завершения той же записи', async () => {
    const gate = deferred();
    const save = vi.fn<(snapshot: string) => Promise<void>>()
      .mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const { writer } = setup(save);
    writer.schedule('first');
    const flush = writer.commitNow();
    // Этот обработчик выполняется после выхода drain из цикла, но до
    // освобождения inFlight: commit обязан дождаться и такой правки.
    void gate.promise.then(() => writer.schedule('late'));
    gate.resolve();
    await flush;
    expect(save.mock.calls).toEqual([['first'], ['late']]);
    expect(writer.hasPending()).toBe(false);
  });

  it('сохраняет неудавшийся снимок для явного повтора без новых изменений', async () => {
    const save = vi.fn<(snapshot: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue(undefined);
    const { writer } = setup(save);
    writer.schedule('keep');
    await expect(writer.commitNow()).rejects.toThrow('disk unavailable');
    expect(writer.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledTimes(1); // нет бесконечного retry при отказе БД
    await writer.commitNow();
    expect(save.mock.calls).toEqual([['keep'], ['keep']]);
    expect(writer.hasPending()).toBe(false);
  });

  it('после отказа in-flight повторяет новейший снимок, а не старую редакцию', async () => {
    const gate = deferred();
    const save = vi.fn<(snapshot: string) => Promise<void>>()
      .mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const { writer } = setup(save);
    writer.schedule('old');
    const rejected = expect(writer.commitNow()).rejects.toThrow('failed');
    writer.schedule('latest');
    gate.reject(new Error('failed'));
    await rejected;
    await writer.commitNow();
    expect(save.mock.calls).toEqual([['old'], ['latest']]);
  });

  it('сообщает ошибку таймера и повторяет актуальные данные при следующем schedule', async () => {
    const save = vi.fn<(snapshot: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('failed')).mockResolvedValue(undefined);
    const { writer, onError } = setup(save);
    writer.schedule('old');
    await vi.advanceTimersByTimeAsync(300);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(writer.hasPending()).toBe(true);
    writer.schedule('new');
    await vi.advanceTimersByTimeAsync(300);
    expect(save.mock.calls).toEqual([['old'], ['new']]);
    expect(writer.hasPending()).toBe(false);
  });

  it('синхронная ошибка save тоже сохраняет снимок и отклоняет commit', async () => {
    const { writer } = setup(vi.fn(() => { throw new Error('sync failure'); }));
    writer.schedule('keep');
    await expect(writer.commitNow()).rejects.toThrow('sync failure');
    expect(writer.hasPending()).toBe(true);
  });

  it('dispose снимает таймер; повторное подключение начинает новую серию', async () => {
    const { writer, save } = setup();
    writer.schedule('abandoned');
    writer.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    writer.schedule('remounted');
    await writer.commitNow();
    expect(save.mock.calls).toEqual([['remounted']]);
  });
});
