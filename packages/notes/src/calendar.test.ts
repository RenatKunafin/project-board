// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { watchLocalDay } from './calendar';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('пересчитывает локальный день на полуночи, после скрытия/focus и очищает ресурсы', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 28, 23, 59, 59));
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const listener = vi.fn();
  const stop = watchLocalDay(listener);
  expect(listener).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1020); expect(listener).toHaveBeenCalledTimes(2);
  hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(new Date(2026, 10, 2, 10));
  hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  expect(listener).toHaveBeenLastCalledWith(Date.now());
  window.dispatchEvent(new Event('focus'));
  expect(vi.getTimerCount()).toBe(1);
  const calls = listener.mock.calls.length;
  stop(); expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
  expect(listener).toHaveBeenCalledTimes(calls);
});
