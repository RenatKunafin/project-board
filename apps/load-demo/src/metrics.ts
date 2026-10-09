// Глобальные метрики нагрузочной демонстрации PBT-016.
// Считываются bench-скриптом (window.__loadMetrics).

export interface LoadMetrics {
  mounted: Record<string, number>;
  gestures: Array<{ panel: string; ms: number }>;
  saves: Array<{ key: string; ms: number; bytes: number }>;
  fps: Array<{ panel: string; frames: number; avgFps: number; minFrameMs: number }>;
}

declare global {
  interface Window {
    __loadMetrics?: LoadMetrics;
    __fpsRun?: (durationMs: number, label: string) => Promise<LoadMetrics['fps'][number]>;
  }
}

export function initMetrics(): void {
  window.__loadMetrics = { mounted: {}, gestures: [], saves: [], fps: [] };
  window.__fpsRun = fpsRun;
}

export function metrics(): LoadMetrics {
  if (!window.__loadMetrics) initMetrics();
  return window.__loadMetrics as LoadMetrics;
}

/** Измеряет FPS в течение durationMs через requestAnimationFrame. */
export function fpsRun(durationMs: number, label: string): Promise<LoadMetrics['fps'][number]> {
  return new Promise((resolve) => {
    const frames: number[] = [];
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames.push(now - last);
      last = now;
      if (now - start < durationMs) {
        raf = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(raf);
        const intervals = frames.slice(1);
        const avgFps = intervals.length ? Math.round(1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length)) : 0;
        const minFrameMs = intervals.length ? Math.round(Math.max(...intervals)) : 0;
        const result = { panel: label, frames: intervals.length, avgFps, minFrameMs };
        metrics().fps.push(result);
        resolve(result);
      }
    };
    const start = performance.now();
    raf = requestAnimationFrame(tick);
  });
}
