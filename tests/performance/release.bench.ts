import { writeFile, mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { lifecycle } from './lifecycle';
import { interactions } from './interactions';
import { benchmarkData } from './data';
import { frames, instrument, measure, summary } from './instrument';
import { setupA, setupB, renameTab, newPlan, settledWorkspace } from './setup';
import { storedPlan } from '../planning/helpers';

const change = 'test-results/release-performance';
const readyA = `document.querySelectorAll('.plan-gantt .wx-grid').length === 6 && document.querySelectorAll('.resource-timeline [data-rt-chart]').length === 4 && [...document.querySelectorAll('.plan-gantt')].every(p=>p.querySelector('.wx-row')) && [...document.querySelectorAll('.resource-timeline')].every(p=>p.querySelector('[data-rt-task]'))`;

async function output(name: string, value: unknown) {
  await mkdir(change, { recursive: true });
  await writeFile(`${change}/${name}.json`, JSON.stringify({ runId: process.env.PBT_BENCH_RUN_ID, ...value as object }, null, 2) + '\n');
}
async function calibration(page: Page) {
  await page.bringToFront();
  const sample = await frames(page);
  expect(sample.visibility).toBe('visible');
  expect(sample.focused).toBe(true);
  expect(sample.avgFps, 'rAF троттлится; FPS-замер недостоверен').toBeGreaterThan(45);
  return sample;
}
async function mounted(page: Page, predicate: string) {
  return page.evaluate(async predicate => {
    const ready = new Function(`return (${predicate})`) as () => boolean;
    const deadline = performance.now() + 15000;
    while (!ready()) {
      if (performance.now() > deadline) throw new Error(`Mount not ready: ${document.querySelectorAll('.wx-grid').length} grids, ${document.querySelectorAll('[data-rt-task]').length} resource bars`);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - window.__releasePerf.start;
  }, predicate);
}

// Числа записываются даже при превышении бюджета: превышение — результат
// исследования, не повод потерять артефакты или скрыто повторить прогон.
test('A — общий план 500 в 6 проектных и 4 ресурсных видах', async ({ page, browser }, info) => {
  const data = await benchmarkData();
  await instrument(page);
  page.on('dialog', dialog => dialog.accept());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const id = await setupA(page, data);
  const result: Record<string, unknown> = { date: new Date().toISOString(), browser: browser.version(),
    headless: process.env.PBT_BENCH_HEADLESS === '1', viewport: { width: 1400, height: 1000 },
    fixture: { sha256: data[0].sha256, seed: 42, tasks: 500, groups: data[0].content.groups.length, dependencies: data[0].content.dependencies.length },
    composition: '6 project + 4 resource; one shared plan; grid', calibration: await calibration(page) };
  const mount: number[] = [];
  for (let run = 0; run < 6; run++) {
    await page.reload();
    const elapsed = await mounted(page, readyA);
    if (run) mount.push(elapsed);
  }
  result.mountMs = summary(mount, 1000);
  result.subscriptions = await page.evaluate(() => window.__projectBoard?.activeSubscriptionCount());
  await output('A', result);

  const pane = page.getByRole('group', { name: `План · ${data[0].title}`, exact: true }).first();
  const add: number[] = [], write: number[] = [], persisted: number[] = [], issues: number[] = [];
  for (let run = 0; run < 6; run++) {
    console.log(`A add run ${run}`);
    await pane.locator('[data-add-task]').click();
    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await dialog.locator('[data-task-field="title"]').fill('Benchmark added');
    await dialog.locator('[data-task-field="start"]').fill('2026-10-19');
    await dialog.locator('[data-task-field="duration"]').fill('5');
    const previous = await page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, id);
    console.log('submit prepared');
    const sample = await measure(page, dialog.locator('[data-task-save]'),
      `${readyA} && [...document.querySelectorAll('[data-task-count]')].every(e=>e.textContent==='Задач: 501') && !document.querySelector('[data-task-save]')`);
    await expect.poll(() => page.evaluate(({ id, previous }) => window.__releasePerf.writes.filter(w => w.documentId === id && w.revision > previous).length, { id, previous })).toBeGreaterThan(0);
    console.log(`rendered ${sample.ms}`);
    const saved = await page.evaluate(({ id, previous }) => window.__releasePerf.writes.find(w => w.documentId === id && w.revision > previous)!, { id, previous });
    if (run) { add.push(sample.ms); write.push(saved.ms); persisted.push(saved.end - sample.start); }
    const issueSample = await measure(page, pane.locator('[data-issues]'), `!!document.querySelector('[data-issues-list]')`);
    if (run) issues.push(issueSample.ms);
    await page.locator('[data-issues-close]').click();
    // Удаление контрольной задачи возвращает исходные 500 без прямой записи БД.
    await pane.locator('[data-gantt-filter-query]').fill('Benchmark added');
    await pane.locator('.wx-row').filter({ hasText: 'Benchmark added' }).first().dblclick();
    await page.locator('[data-task-delete]').click();
    await expect(pane.locator('[data-task-count]')).toHaveText('Задач: 500');
    await expect.poll(async () => (await storedPlan(page, id))?.content.tasks.length).toBe(500);
    await pane.locator('[data-gantt-filter-query]').fill('');
  }
  result.addTaskMs = summary(add, 400); result.idbTransactionMs = summary(write, 700);
  result.submitToPersistedMs = summary(persisted); result.openIssuesMs = summary(issues);
  await output('A', result);


  // Две вкладки по 10 окон: A общий план, B независимые планы.
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await renameTab(page, 'Нагрузка B');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  for (let index = 1; index <= 10; index++) await newPlan(page, data[index]);
  await settledWorkspace(page, 20);
  const switching: number[] = [];
  const directions: Record<string, number[]> = {};
  for (let run = 0; run < 6; run++) {
    for (const title of ['Нагрузка A', 'Нагрузка B']) {
      const sample = await measure(page, page.locator('.tab__title').filter({ hasText: new RegExp(`^${title}$`) }),
        `document.querySelector('[role="tab"][aria-selected="true"] .tab__title')?.textContent===${JSON.stringify(title)} && document.querySelectorAll('.tab-surface:not([hidden]) .widget-window').length===10 && [...document.querySelectorAll('.tab-surface:not([hidden]) .plan-gantt')].every(p=>p.querySelector('.wx-row')) && [...document.querySelectorAll('.tab-surface:not([hidden]) .resource-timeline')].every(p=>p.querySelector('[data-rt-task]'))`);
      if (run) { switching.push(sample.ms); (directions[title] ??= []).push(sample.ms); }
    }
  }
  result.switchTenPanelsMs = summary(switching, 500);
  result.switchByDirectionMs = Object.fromEntries(Object.entries(directions).map(([title, runs]) => [title, summary(runs, 500)]));
  result.switchComposition = 'A: 6 project + 4 resource shared500 ↔ B: 10 project independent50; 20 mounted windows total';
  result.errors = errors;
  await output('A', result);
  await page.screenshot({ path: info.outputPath('ten-independent.png') });
});

test('B — 10 независимых планов на 10 вкладках; жизненный цикл', async ({ page, browser, context }, info) => {
  const data = await benchmarkData();
  await instrument(page);
  page.on('dialog', dialog => dialog.accept());
  await setupB(page, data);
  const result: Record<string, unknown> = { date: new Date().toISOString(), browser: browser.version(), calibration: await calibration(page),
    composition: '10 independent plans ×50; 10 tabs, one project per tab',
    fixtures: data.slice(1).map(d => ({ title: d.title, seed: d.seed, sha256: d.sha256 })) };
  const switching: number[] = [];
  for (let run = 0; run < 6; run++) {
    for (const title of ['План B 1', 'План B 10']) {
      const sample = await measure(page, page.locator('.tab__title').filter({ hasText: new RegExp(`^${title}$`) }),
        `document.querySelector('[role="tab"][aria-selected="true"] .tab__title')?.textContent===${JSON.stringify(title)} && !!document.querySelector('.tab-surface:not([hidden]) .wx-row')`);
      if (run) switching.push(sample.ms);
    }
  }
  result.switchOnePanelMs = summary(switching, 500);
  await output('B', result);
  result.lifecycle = await lifecycle(page, context, data[10]);
  await output('B', result);
  await page.reload();
  await expect(page.locator('.plan-gantt')).toHaveCount(10);
  result.recovery = { windows: await page.locator('.plan-gantt').count(), subscriptions: await page.evaluate(() => window.__projectBoard!.activeSubscriptionCount()) };
  await output('B', result);
  await page.screenshot({ path: info.outputPath('independent-recovered.png') });
});


test('A-interactions — прокрутка, редактор, жесты и жизненный цикл плана500', async ({ page, browser, context }) => {
  const data = await benchmarkData();
  await instrument(page);
  page.on('dialog', dialog => dialog.accept());
  const id = await setupA(page, data);
  const result: Record<string, unknown> = { date: new Date().toISOString(), browser: browser.version(), calibration: await calibration(page) };
  const pane = page.getByRole('group', { name: `План · ${data[0].title}`, exact: true }).first();
  result.interactions = await interactions(page, pane, id, async value => { result.interactions = value; await output('A-interactions', result); });
  await output('A-interactions', result);
  result.lifecycle = await lifecycle(page, context, data[0]);
  await output('A-interactions', result);
  expect((result.interactions as Record<string, unknown>).gestureFailure, 'Жест должен сохранять даты; подробности в raw').toBeUndefined();
});
