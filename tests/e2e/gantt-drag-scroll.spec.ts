import { expect, test, type Locator, type Page } from '@playwright/test';

const title = 'PBT-096 — прокрутка Гантта захватом';
const plan = {
  title,
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  workTypes: [{ id: 'dev', title: 'Разработка', allowsParallel: false }],
  resources: [{ id: 'r1', title: 'Разработчик' }],
  groups: [{ id: 'g1', title: 'Этап' }],
  tasks: [
    {
      id: 'near', title: 'Ближняя задача', groupId: 'g1',
      start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r1'], workTypeIds: ['dev'],
    },
    {
      id: 'far', title: 'Дальняя задача', groupId: 'g1',
      start: '2027-06-14', end: '2027-06-18', assigneeIds: ['r1'], workTypeIds: ['dev'],
    },
  ],
  dependencies: [],
  unavailability: [],
};

type Snapshot = { revision: number; content: typeof plan };

async function setup(page: Page): Promise<{ id: string; pane: Locator }> {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: /План/ }).click();
  const picker = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await picker.getByLabel('Название нового документа').fill(title);
  await picker.getByRole('button', { name: 'Создать', exact: true }).click();
  const pane = page.getByRole('group', { name: `План · ${title}` });
  await expect(pane).toBeVisible();
  const id = await pane.locator('[data-document-id]').getAttribute('data-document-id');
  expect(id).not.toBeNull();
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id, value: plan },
  );
  await pane.getByRole('button', { name: /Развернуть на весь дашборд/ }).click();
  await expect(pane.locator('.wx-bar[data-id=":near"]')).toBeVisible();
  // Ждём завершения начального позиционирования PBT-073.
  await page.waitForTimeout(2200);
  return { id: id as string, pane };
}

async function snapshot(page: Page, id: string): Promise<Snapshot> {
  return page.evaluate(
    (documentId) => window.__projectBoard!.readDocument(documentId) as Snapshot,
    id,
  );
}

async function setScrollLeft(chart: Locator, left: number): Promise<void> {
  await chart.evaluate((element, value) => {
    (element as HTMLElement).scrollLeft = value;
  }, left);
}

test('пустой фон панорамируется, отпускание вне чарта завершает жест без записи плана', async ({ page }) => {
  const { id, pane } = await setup(page);
  const chart = pane.locator('.plan-gantt__chart .wx-chart');
  const before = await snapshot(page, id);
  await setScrollLeft(chart, 300);
  const startLeft = await chart.evaluate((element) => (element as HTMLElement).scrollLeft);
  const chartBox = (await chart.boundingBox())!;
  const { x, y } = await page.evaluate(({ left, top, width, height }) => {
    const candidates = [0.04, 0.1, 0.2, 0.3, 0.4].flatMap((xRatio) =>
      [0.1, 0.3, 0.5, 0.7, 0.9].map((yRatio) => ({
        x: left + width * xRatio,
        y: top + height * yRatio,
      })),
    );
    const sampled = candidates.map((point) => {
      const target = document.elementFromPoint(point.x, point.y);
      return {
        ...point,
        tag: target?.tagName,
        className: (target as HTMLElement | null)?.className,
        inChart: target?.closest('.wx-chart') !== null && target !== null,
        excluded: target?.closest('[data-id], button, input, select, textarea, a, [role="button"], [contenteditable="true"]') !== null,
      };
    });
    const point = sampled.find(({ inChart, excluded }) => inChart && !excluded);
    if (!point) {
      throw new Error(`Не найдена пустая область внутри wx-chart: ${JSON.stringify({
        viewport: { width: innerWidth, height: innerHeight }, box: { left, top, width, height }, sampled,
      })}`);
    }
    return point;
  }, { left: chartBox.x, top: chartBox.y, width: chartBox.width, height: chartBox.height });

  expect(await chart.evaluate((element) => getComputedStyle(element).cursor)).toBe('grab');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 5 });
  await expect.poll(() => pane.locator('.plan-gantt').getAttribute('class'))
    .toContain('plan-gantt--panning');
  expect(await chart.evaluate((element) => getComputedStyle(element).cursor)).toBe('grabbing');
  await expect.poll(() => chart.evaluate((element) => (element as HTMLElement).scrollLeft))
    .toBeGreaterThan(startLeft + 70);

  await page.mouse.move(chartBox.x - 20, chartBox.y - 20, { steps: 3 });
  const releasedLeft = await chart.evaluate((element) => (element as HTMLElement).scrollLeft);
  await page.mouse.up();
  await page.mouse.move(chartBox.x + 200, chartBox.y + 10, { steps: 3 });
  await expect.poll(() => chart.evaluate((element) => (element as HTMLElement).scrollLeft))
    .toBe(releasedLeft);
  await expect.poll(() => pane.locator('.plan-gantt').getAttribute('class'))
    .not.toContain('plan-gantt--panning');
  expect(await chart.evaluate((element) => getComputedStyle(element).cursor)).toBe('grab');
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x - 80, y, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => chart.evaluate((element) => (element as HTMLElement).scrollLeft))
    .toBe(releasedLeft);
  await page.setViewportSize({ width: 1800, height: 1000 });
  await expect.poll(() => chart.evaluate((element) => (element as HTMLElement).scrollLeft), {
    timeout: 3000,
  }).toBe(releasedLeft);
  expect(await snapshot(page, id)).toEqual(before);
});

test('перетаскивание задачи и resize не запускают drag-scroll', async ({ page }) => {
  const { id, pane } = await setup(page);
  const chart = pane.locator('.plan-gantt__chart .wx-chart');
  const bar = pane.locator('.wx-bar[data-id=":near"]');
  await setScrollLeft(chart, 300);
  await bar.scrollIntoViewIfNeeded();
  const beforeMoveScroll = await chart.evaluate((element) => (element as HTMLElement).scrollLeft);
  const before = await snapshot(page, id);
  const box = (await bar.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.move(x + 72, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(2400);
  const afterMove = await snapshot(page, id);
  expect(afterMove.content.tasks.find((task) => task.id === 'near')?.start)
    .not.toBe(before.content.tasks.find((task) => task.id === 'near')?.start);
  expect(await chart.evaluate((element) => (element as HTMLElement).scrollLeft))
    .toBe(beforeMoveScroll);

  const resizedBar = pane.locator('.wx-bar[data-id=":near"]');
  await resizedBar.hover();
  const resizedBox = (await resizedBar.boundingBox())!;
  const beforeResizeScroll = await chart.evaluate((element) => (element as HTMLElement).scrollLeft);
  const beforeResize = await snapshot(page, id);
  const edgeX = resizedBox.x + 8;
  const edgeY = resizedBox.y + resizedBox.height / 2;
  await page.mouse.move(edgeX, edgeY);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.move(edgeX + 36, edgeY, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(2400);
  const afterResize = await snapshot(page, id);
  expect(afterResize.content.tasks.find((task) => task.id === 'near')?.start)
    .not.toBe(beforeResize.content.tasks.find((task) => task.id === 'near')?.start);
  expect(await chart.evaluate((element) => (element as HTMLElement).scrollLeft))
    .toBe(beforeResizeScroll);
});
