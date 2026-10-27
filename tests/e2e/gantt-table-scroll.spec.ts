import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocumentWindow } from './document-ui';

const ids = Array.from({ length: 120 }, (_, index) => `scroll-${index}`);
const content = {
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  groups: [{ id: 'scroll-group', title: 'Прокрутка' }],
  resources: [{ id: 'even', title: 'Чётные' }, { id: 'odd', title: 'Нечётные' }],
  workTypes: [], dependencies: [], unavailability: [],
  tasks: ids.map((id, index) => ({ id, title: `Строка ${index}`, groupId: 'scroll-group',
    start: '2026-10-12', end: '2026-10-16', assigneeIds: [index % 2 ? 'odd' : 'even'] })),
};

interface FrameSample { scroll: number; error: number; rowCount: number }
declare global {
  interface Window { __ganttTableProbe: { running: boolean; samples: FrameSample[] } }
}

async function start(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', 'Прокрутка строк');
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content),
    { id: created.documentId, content });
  await created.pane.getByRole('button', { name: /Развернуть на весь дашборд/ }).click();
  await expect(created.pane.locator('[data-task-count]')).toHaveText('Задач: 120');
  return created;
}

async function checkFrames(page: Page, pane: Locator, order: string[]) {
  const root = pane.locator('.plan-gantt');
  await root.locator('.wx-gantt').evaluate(node => { node.scrollTop = 0; });
  await expect.poll(() => root.locator('.wx-body .wx-row').first().getAttribute('data-id')).toBe(`:${order[0]}`);
  await root.evaluate((root, order) => {
    const positions = new Map(order.map((id, index) => [id, index]));
    const probe = window.__ganttTableProbe = { running: true, samples: [] as FrameSample[] };
    const sample = () => {
      if (!probe.running) return;
      const scroller = root.querySelector<HTMLElement>('.wx-gantt');
      const header = root.querySelector<HTMLElement>('.wx-header-wrapper');
      const rows = root.querySelectorAll<HTMLElement>('.wx-body .wx-row');
      const first = rows[0];
      if (scroller && header && first) {
        const index = positions.get(first.dataset.id!.replace(/^:/, ''));
        if (index === undefined) throw new Error(`Неожиданная строка ${first.dataset.id}`);
        const expected = header.getBoundingClientRect().bottom + index * 36 - scroller.scrollTop;
        probe.samples.push({ scroll: scroller.scrollTop,
          error: first.getBoundingClientRect().top - expected, rowCount: rows.length });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, order);
  const box = await root.locator('.wx-table-container').boundingBox();
  if (!box) throw new Error('Нет таблицы');
  await page.mouse.move(box.x + 160, box.y + 180);
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let step = 0; step < 24; step++) {
      await page.mouse.wheel(0, (sweep % 2 ? -1 : 1) * 35.5);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
  }
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const samples = await page.evaluate(() => {
    window.__ganttTableProbe.running = false;
    return window.__ganttTableProbe.samples;
  });
  expect(samples.length).toBeGreaterThan(40);
  expect(Math.max(...samples.map(row => row.scroll))).toBeGreaterThan(500);
  expect(Math.max(...samples.map(row => row.rowCount))).toBeLessThan(40);
  const bad = samples.filter(row => Math.abs(row.error) > 1);
  expect(bad, `Промежуточный сдвиг строки: ${JSON.stringify(bad.slice(0, 5))}`).toEqual([]);
}

test('таблица не сдвигается на строку между кадрами прокрутки тачпадом', async ({ page }) => {
  const { pane, documentId } = await start(page);
  const before = await page.evaluate(id => window.__projectBoard!.readDocument(id), documentId);
  await checkFrames(page, pane, ['scroll-group', ...ids]);
  expect(await page.evaluate(id => window.__projectBoard!.readDocument(id), documentId)).toEqual(before);
});

test('прокрутка устойчива после масштаба, фильтра, скрытия и пересоздания чарта', async ({ page }) => {
  const { pane, documentId } = await start(page);
  const originalTab = await page.getByRole('tab', { selected: true }).getAttribute('id');
  await pane.getByRole('button', { name: 'Дни', exact: true }).click();
  await pane.getByRole('button', { name: 'Недели', exact: true }).click();
  await pane.getByLabel('Фильтр по ресурсу').selectOption('odd');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await expect(pane).toBeHidden();
  await page.locator(`[id="${originalTab}"]`).click();
  await expect(pane).toBeVisible();
  const order = ['scroll-group', ...ids.filter((_, index) => index % 2)];
  await checkFrames(page, pane, order);
  const before = await page.evaluate(id => window.__projectBoard!.readDocument(id), documentId);
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content),
    { id: documentId, content: { ...content, title: 'Новая ревизия' } });
  await expect.poll(() => page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, documentId)).toBe(before!.revision + 1);
  await checkFrames(page, pane, order);
  expect((await page.evaluate(id => window.__projectBoard!.readDocument(id), documentId))!.revision).toBe(before!.revision + 1);
});
