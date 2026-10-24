import { expect, type Locator, type Page } from '@playwright/test';
import { summary } from './instrument';

interface ScrollCapture { intervals: number[]; start: number; last: number; running: boolean }
declare global { interface Window { __scrollPerf: ScrollCapture } }

export async function scrollBenchmark(page: Page, scroll: Locator) {
  const runs: number[] = [], samples = [];
  for (let run = 0; run < 6; run++) {
    await scroll.evaluate(element => { element.scrollLeft = 0; });
    await scroll.scrollIntoViewIfNeeded();
    const box = await scroll.boundingBox();
    expect(box).not.toBeNull();
    const width = await scroll.evaluate(element => element.clientWidth);
    await page.mouse.move(box!.x + Math.min(box!.width / 2, 100), box!.y + Math.min(box!.height / 2, 80));
    const before = await scroll.evaluate(element => element.scrollLeft);
    await page.evaluate(() => {
      const now = performance.now();
      const sample = window.__scrollPerf = { intervals: [], start: now, last: now, running: true };
      const tick = (now: number) => {
        if (!sample.running) return;
        sample.intervals.push(now - sample.last); sample.last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // Пользовательское горизонтальное колесо: три ширины видимой шкалы,
    // распределённые на 120 кадров, без присваивания scrollLeft во время замера.
    for (let frame = 0; frame < 120; frame++) {
      await page.mouse.wheel(width * 3 / 120, 0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    }
    const sample = await page.evaluate(() => {
      const s = window.__scrollPerf; s.running = false;
      const intervals = s.intervals.slice(1);
      return { intervals, visibility: document.visibilityState, focused: document.hasFocus(),
        avgFps: intervals.length * 1000 / intervals.reduce((a, b) => a + b, 0), maxFrameMs: Math.max(...intervals) };
    });
    const after = await scroll.evaluate(element => element.scrollLeft);
    expect(sample.visibility).toBe('visible'); expect(sample.focused).toBe(true);
    expect(after, 'колесо должно действительно двигать таймлайн').toBeGreaterThan(before + width * 2);
    if (run) { runs.push(sample.avgFps); samples.push({ ...sample, before, after, width }); }
  }
  return { ...summary(runs, 30, true), samples };
}
