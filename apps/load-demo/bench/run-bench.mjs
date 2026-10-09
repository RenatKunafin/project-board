// Воспроизводимый запуск нагрузочных замеров PBT-016.
// Требует: запущенный load-demo (npm run dev:load-demo, порт 5176)
// и установленный Playwright (в корне: @playwright/test).
// Запуск: node apps/load-demo/bench/run-bench.mjs
// Результат: apps/load-demo/bench/results.json

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = 'http://localhost:5176/';
const results = { url: URL, startedAt: new Date().toISOString(), scenarios: {} };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(URL);
await page.waitForTimeout(1500);

// Калибровка rAF (в фоновом окне троттлится — учитывать при интерпретации FPS).
results.rafCalibration = await page.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    frames.push(now - last);
    last = now;
  }
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  return { avgFrameMs: Math.round(avg * 10) / 10 };
});

// Сценарий A: монтирование 10 панелей на плане-500 (уже смонтированы —
// значения в __loadMetrics.mounted); задержка редактирования add-task ×5.
results.scenarios.A = await page.evaluate(async () => {
  const m = window.__loadMetrics;
  const api = (window.__loadApi ?? {})['A-gantt-1'];
  const latencies = [];
  if (api) {
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      api.exec('add-task', {
        id: `bench-${Date.now()}-${i}`,
        task: { text: `Bench ${i}`, type: 'task', start: new Date(2026, 9, 12), end: new Date(2026, 9, 13), progress: 0 },
      });
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      latencies.push(Math.round(performance.now() - t0));
    }
    latencies.sort((a, b) => a - b);
  }
  return {
    mountedPanels: Object.keys(m.mounted).length,
    mountMaxMs: Math.max(...Object.values(m.mounted)),
    addTaskLatencyMs: { runs: latencies, median: latencies[2] ?? null },
  };
});

// Запись в IndexedDB: план-500, три прогона с паузами.
const saveRuns = [];
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { window.__loadMetrics.saves = []; });
  await page.getByRole('button', { name: 'Сохранить все планы в IDB' }).click();
  await page.waitForTimeout(4000);
  const ms = await page.evaluate(() => {
    const s = (window.__loadMetrics ?? { saves: [] }).saves.filter((x) => x.key === 'plan-500');
    return s.length ? s[s.length - 1].ms : null;
  });
  saveRuns.push(ms);
  await page.waitForTimeout(800);
}
saveRuns.sort((a, b) => a - b);
results.scenarios.idb = { plan500RunsMs: saveRuns, medianMs: saveRuns[1] };

// Восстановление: reload и сверка панелей/элементов.
const before = await page.evaluate(() => document.querySelectorAll('.spike-task-item').length);
await page.reload();
await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({
  panels: document.querySelectorAll('.ld-panel').length,
  taskItems: document.querySelectorAll('.spike-task-item').length,
}));
results.scenarios.recovery = { taskItemsBeforeReload: before, ...after };

await browser.close();
mkdirSync('apps/load-demo/bench', { recursive: true });
writeFileSync('apps/load-demo/bench/results.json', JSON.stringify(results, null, 2));
console.log('Результаты записаны в apps/load-demo/bench/results.json');
