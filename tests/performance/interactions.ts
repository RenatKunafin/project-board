import { expect, type Page, type Locator } from '@playwright/test';
import { restoreSize, storedPlan } from '../planning/helpers';
import { measure, summary } from './instrument';
import { scrollBenchmark } from './scroll';

export async function interactions(page: Page, pane: Locator, id: string, progress: (value: Record<string, unknown>) => Promise<void>) {
  // В сетке активация через grip не нужна: клик по нему запускает RGL drag.
  await pane.getByRole('button', { name: /^Развернуть на весь дашборд/ }).click();
  const instance = await pane.locator('[data-widget-instance]').getAttribute('data-widget-instance');
  const root = `document.querySelector('.plan-gantt[data-widget-instance="${instance}"]')`;
  const result: Record<string, unknown> = {
    composition: 'one maximized project view; nine neighbours hidden keep-mounted; shared plan500',
  };
  console.log('A interactions: scroll');
  result.scroll = await scrollBenchmark(page, pane.locator('.wx-chart'));
  console.log('A interactions: zoom');
  await progress(result);
  const zoom: number[] = [];
  for (let run = 0; run < 6; run++) {
    for (const mode of ['weeks', 'days']) {
      const sample = await measure(page, pane.locator(`[data-zoom-${mode}]`),
        `${root}?.querySelector('[data-zoom-${mode}]')?.getAttribute('aria-pressed')==='true' && !!${root}?.querySelector('.wx-row')`);
      if (run) zoom.push(sample.ms);
    }
  }
  result.zoomMs = summary(zoom);
  await progress(result);
  // Форма и жесты на одной задаче; фильтр только этого экземпляра.
  await pane.locator('[data-gantt-filter-query]').fill('Задача 500');
  const first = pane.locator('.wx-row[data-id=":t-500"]');
  await expect(first).toBeVisible();
  console.log('A interactions: edit');
  const editing: number[] = [];
  for (let run = 0; run < 6; run++) {
    await first.dblclick();
    await page.locator('[data-task-field="title"]').fill('Задача 500 контрольная правка');
    const sample = await measure(page, page.locator('[data-task-save]'),
      `!document.querySelector('[data-task-save]') && ${root}?.querySelector('.wx-row[data-id=":t-500"]')?.textContent.includes('Задача 500 контрольная правка')`);
    if (run) editing.push(sample.ms);
    // Поиск «Задача 500» скроет переименованную строку: показать новую для возврата.
    await pane.locator('[data-gantt-filter-query]').fill('Задача 500 контрольная правка');
    await first.dblclick();
    await page.locator('[data-task-field="title"]').fill('Задача 500');
    await page.locator('[data-task-save]').click();
    await pane.locator('[data-gantt-filter-query]').fill('Задача 500');
  }
  result.editTitleMs = summary(editing);
  await progress(result);
  await expect.poll(async () => (await storedPlan(page, id))?.content.tasks.find(t => t.id === 't-500')?.title).toBe('Задача 500');
  const original = (await storedPlan(page, id))!.content;
  await first.dblclick();
  const originalDuration = await page.locator('[data-task-field="duration"]').inputValue();
  await page.locator('[data-task-cancel]').click();
  await pane.locator('[data-zoom-days]').click();
  result.gestureAttempts = [];
  const gesture = async (kind: 'drag' | 'resize') => {
    const runs: number[] = [];
    for (let run = 0; run < 6; run++) {
      console.log(`A gesture ${kind} ${run}`);
      // Следующий жест после окна 80/450/1000 мс сверки SVAR, вне метрики.
      await page.waitForTimeout(2200);
      const bar = pane.locator('.wx-bar[data-id=":t-500"]');
      // Фикстура до 2037 года: прокрутить фактический .wx-chart после
      // 2-секундного окна восстановления, затем проверить попадание мыши.
      await pane.locator('.wx-chart').evaluate(element => {
        const target = element.querySelector('.wx-bar[data-id=":t-500"]')!;
        element.scrollLeft += target.getBoundingClientRect().left - element.getBoundingClientRect().left - 70;
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const bounds = await bar.boundingBox();
      expect(bounds).not.toBeNull();
      const x = kind === 'drag' ? bounds!.x + Math.min(bounds!.width / 2, 220) : bounds!.x + 8;
      const y = bounds!.y + bounds!.height / 2;
      const before = await page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, id);
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.wx-bar')?.getAttribute('data-id'), { x, y });
      expect(hit, 'мышь должна попадать в фактическую полосу задачи').toBe(':t-500');
      await page.mouse.move(x, y);
      // SVAR выбирает resize/move при hover через React state; дать ему
      // примениться до mousedown, чтобы не использовать режим прошлого жеста.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.mouse.down();
      for (let step = 1; step <= 6; step++) {
        await page.mouse.move(x + 96 * step / 6, y);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      // Время применения после отпускания, отдельно от пользовательской длины жеста.
      await page.evaluate(({ id, before, originalTask }) => {
        window.__releasePerf.mark = 0; window.__releasePerf.end = 0;
        window.__releasePerf.gestureExpected = undefined; window.__releasePerf.gestureTrajectory = [];
        document.addEventListener('mouseup', () => {
          window.__releasePerf.mark = performance.now();
          const deadline = performance.now() + 2800;
          let lastRevision = before;
          const tick = () => {
            const document = window.__projectBoard!.readDocument(id) as unknown as { revision: number; content: { tasks: { id: string; start: string; end: string }[] } };
            const task = document.content.tasks.find(task => task.id === 't-500')!;
            if (document.revision !== lastRevision) {
              window.__releasePerf.gestureTrajectory!.push({ revision: document.revision, start: task.start, end: task.end, at: performance.now() - window.__releasePerf.mark });
              lastRevision = document.revision;
            }
            if (!window.__releasePerf.gestureExpected && (task.start !== originalTask.start || task.end !== originalTask.end)) {
              window.__releasePerf.gestureExpected = { start: task.start, end: task.end };
              requestAnimationFrame(() => requestAnimationFrame(() => { window.__releasePerf.end = performance.now(); }));
            }
            if (performance.now() < deadline) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, { once: true, capture: true });
      }, { id, before, originalTask: original.tasks.find(t => t.id === 't-500')! });
      await page.mouse.up();
      await page.waitForFunction(() => window.__releasePerf.end > 0);
      const elapsed = await page.evaluate(() => window.__releasePerf.end - window.__releasePerf.mark);
      // Проверка стабильности после всех сверок, вне интервала отклика.
      await page.waitForTimeout(2800);
      const observed = await page.evaluate(() => ({ expected: window.__releasePerf.gestureExpected, trajectory: window.__releasePerf.gestureTrajectory }));
      const after = (await storedPlan(page, id))!.content;
      const actual = after.tasks.find(task => task.id === 't-500')!;
      (result.gestureAttempts as unknown[]).push({ kind, run, elapsed, hit, ...observed, actual });
      await progress(result);
      expect({ start: actual.start, end: actual.end }, 'применённый жест должен оставаться сохранённым после всех сверок').toEqual(observed.expected);
      expect(after.tasks.filter(t => t.id !== 't-500')).toEqual(original.tasks.filter(t => t.id !== 't-500'));
      if (run) runs.push(elapsed);
      // Восстановление через штатную форму до следующего измерения.
      await first.dblclick();
      await page.locator('[data-task-field="start"]').fill(original.tasks.find(t => t.id === 't-500')!.start);
      await page.locator('[data-task-field="duration"]').fill(originalDuration);
      await page.locator('[data-task-save]').click();
      await expect.poll(async () => (await storedPlan(page, id))?.content.tasks.find(t => t.id === 't-500')).toEqual(original.tasks.find(t => t.id === 't-500')!);
    }
    return summary(runs);
  };
  await pane.locator('[data-gantt-filter-query]').fill('');
  console.log('A interactions: groups');
  const toggle = pane.locator('.wx-row[data-id=":g-root-1"] .wx-toggle-icon');
  const group: number[] = [];
  for (let run = 0; run < 6; run++) {
    const before = await toggle.evaluate(element => element.outerHTML);
    const sample = await measure(page, toggle, `${root}?.querySelector('.wx-row[data-id=":g-root-1"] .wx-toggle-icon')?.outerHTML !== ${JSON.stringify(before)}`);
    if (run) group.push(sample.ms);
    await toggle.click();
  }
  result.collapseGroupMs = summary(group);
  await progress(result);
  await pane.locator('[data-gantt-filter-query]').fill('Задача 500');
  try {
    console.log('A interactions: gestures');
    result.dragAfterMouseupMs = await gesture('drag');
    result.resizeAfterMouseupMs = await gesture('resize');
  } catch (error) {
    result.gestureFailure = { message: String(error), task: (await storedPlan(page, id))?.content.tasks.find(task => task.id === 't-500') };
  }
  await progress(result);
  await restoreSize(page);
  return result;
}
