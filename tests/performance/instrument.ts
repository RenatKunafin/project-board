import type { Page, Locator } from '@playwright/test';

interface WriteSample { documentId: string; revision: number; start: number; end: number; ms: number }
interface Recorder {
  start: number;
  writes: WriteSample[];
  mark: number;
  end: number;
  arm: boolean;
  gestureExpected?: { start: string; end: string };
  gestureTrajectory?: { revision: number; start: string; end: string; at: number }[];
}
declare global {
  interface Window { __releasePerf: Recorder }
}

export async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.__releasePerf = { start: performance.now(), writes: [], mark: 0, end: 0, arm: false };
    const starts = new WeakMap<IDBTransaction, number>();
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
      const result = transaction.apply(this, args);
      starts.set(result, performance.now());
      return result;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'documents') {
        const value = args[0] as { id: string; revision: number };
        const start = starts.get(this.transaction) ?? performance.now();
        this.transaction.addEventListener('complete', () => {
          const end = performance.now();
          window.__releasePerf.writes.push({ documentId: value.id, revision: value.revision, start, end, ms: end - start });
        }, { once: true });
      }
      return put.apply(this, args);
    };
  });
}

// Выражение готовности исполняется в странице; никакого времени RPC в выборке.
export async function measure(page: Page, trigger: Locator, ready: string, event = 'click') {
  await trigger.evaluate((element, { ready, event }) => {
    const recorder = window.__releasePerf;
    recorder.end = 0;
    recorder.arm = true;
    element.addEventListener(event, () => {
      recorder.mark = performance.now();
      const predicate = new Function(`return (${ready})`) as () => boolean;
      const tick = () => {
        if (predicate()) requestAnimationFrame(() => requestAnimationFrame(() => {
          recorder.end = performance.now(); recorder.arm = false;
        }));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { once: true, capture: true });
  }, { ready, event });
  await trigger.click();
  await page.waitForFunction(() => !window.__releasePerf.arm && window.__releasePerf.end > 0);
  return page.evaluate(() => ({ start: window.__releasePerf.mark, end: window.__releasePerf.end,
    ms: window.__releasePerf.end - window.__releasePerf.mark }));
}

export async function frames(page: Page, count = 60) {
  return page.evaluate(async count => {
    const intervals: number[] = [];
    let last = await new Promise<number>(resolve => requestAnimationFrame(resolve));
    for (let index = 0; index < count; index++) {
      const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
      intervals.push(now - last); last = now;
    }
    return { visibility: document.visibilityState, focused: document.hasFocus(), intervals,
      avgFps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length) };
  }, count);
}

export function summary(runs: number[], budget?: number, minimum = false) {
  const sorted = [...runs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { runs, median, p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    ...(budget === undefined ? {} : { budget, passes: minimum ? median >= budget : median <= budget }) };
}
