import { expect, test, type Page } from '@playwright/test';
import { storedWorkspace } from './workspace-helper';

const title = 'PBT-097 — вертикальная прокрутка';

function planWithResources(resourceCount: number, stackedLastResource = false) {
  const resources = Array.from({ length: resourceCount }, (_, index) => ({
    id: `r-${index + 1}`,
    title: `Ресурс ${String(index + 1).padStart(2, '0')}`,
  }));
  const lastResourceId = resources[resources.length - 1]?.id;
  return {
    title,
    calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
    workTypes: [],
    resources,
    groups: [],
    tasks: stackedLastResource && lastResourceId !== undefined
      ? [
          {
            id: 'last-a', title: 'Последняя задача A', assigneeIds: [lastResourceId],
            start: '2026-10-12', end: '2026-10-16',
          },
          {
            id: 'last-b', title: 'Последняя задача B', assigneeIds: [lastResourceId],
            start: '2026-10-13', end: '2026-10-15',
          },
        ]
      : [],
    dependencies: [],
    unavailability: [],
  };
}

async function openResources(page: Page, createDocument: boolean): Promise<string> {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: 'Ресурсы', exact: true }).click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  if (createDocument) {
    await choice.getByLabel('Название нового документа').fill(title);
    await choice.getByRole('button', { name: 'Создать', exact: true }).click();
  } else {
    await choice.getByRole('button', { name: title, exact: true }).click();
  }
  const pane = page.getByRole('group', { name: `Ресурсы · ${title}` }).last();
  await expect(pane).toBeVisible();
  const documentId = await pane.locator('[data-document-id]').getAttribute('data-document-id');
  expect(documentId).not.toBeNull();
  return documentId as string;
}

async function setup(page: Page, resourceCount: number, stackedLastResource = false) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  for (const name of ['Экземпляр 1 · Список 1', 'Экземпляр 2 · Список 1', 'Экземпляр 3 · Список 1']) {
    const close = page.getByRole('button', { name: `Закрыть ${name}`, exact: true });
    if (await close.count()) await close.click();
  }
  const documentId = await openResources(page, true);
  const content = planWithResources(resourceCount, stackedLastResource);
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: content },
  );
  await expect(page.locator('[data-rt-chart] .rct-sidebar-row')).toHaveCount(resourceCount);
  return { documentId, content };
}

async function snapshot(page: Page, documentId: string) {
  return page.evaluate(
    (id) => window.__projectBoard!.readDocument(id),
    documentId,
  );
}

test('длинный список прокручивается внутри каждого экземпляра с закреплённой шапкой', async ({ page }) => {
  const resourceCount = 34;
  const { documentId, content } = await setup(page, resourceCount, true);
  await openResources(page, false);
  const panes = page.getByRole('group', { name: `Ресурсы · ${title}` });
  await expect(panes).toHaveCount(2);
  const charts = panes.locator('[data-rt-chart]');
  const firstChart = charts.nth(0);
  const secondChart = charts.nth(1);
  const before = await snapshot(page, documentId);

  const firstBox = (await firstChart.boundingBox())!;
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => firstChart.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const firstMaxScroll = await firstChart.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(firstMaxScroll).toBeGreaterThan(0);
  await firstChart.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => firstChart.evaluate((el) => el.scrollTop))
    .toBe(firstMaxScroll);
  expect(await secondChart.evaluate((el) => el.scrollTop)).toBe(0);

  const chartBox = (await firstChart.boundingBox())!;
  const headerBox = (await firstChart.locator('.rct-header-root').boundingBox())!;
  expect(Math.abs(headerBox.y - chartBox.y)).toBeLessThanOrEqual(1);
  const lastRow = firstChart.locator('.rct-sidebar-row').last();
  await expect(lastRow).toContainText(content.resources[resourceCount - 1]!.title);
  const lastRowBox = (await lastRow.boundingBox())!;
  expect(lastRowBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
  expect(lastRowBox.y + lastRowBox.height).toBeLessThanOrEqual(chartBox.y + chartBox.height + 1);
  const lastItemBox = (await firstChart.locator('[data-rt-task="last-a"]').boundingBox())!;
  const lastItemCenter = lastItemBox.y + lastItemBox.height / 2;
  expect(lastItemCenter).toBeGreaterThanOrEqual(lastRowBox.y);
  expect(lastItemCenter).toBeLessThanOrEqual(lastRowBox.y + lastRowBox.height);
  expect(await snapshot(page, documentId)).toEqual(before);

  // Второй экземпляр прокручивается независимо до собственной нижней дорожки.
  await secondChart.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => secondChart.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await firstChart.evaluate((el) => el.scrollTop)).toBe(firstMaxScroll);

  // Горизонтальный drag по пустому фону сохраняет навигацию и показывает
  // тот же grab/grabbing affordance, что и проектный Гантт.
  await firstChart.evaluate((el) => { el.scrollTop = 0; });
  const point = await page.evaluate(({ left, top, width, height }) => {
    const points = [0.45, 0.55, 0.65, 0.75].flatMap((xRatio) =>
      [0.25, 0.4, 0.55, 0.7].map((yRatio) => ({
        x: left + width * xRatio,
        y: top + height * yRatio,
      })),
    );
    const point = points.find(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return target?.closest('.rct-scroll') !== null && target !== null &&
        target.closest('.rct-item, .rct-sidebar, .rct-header-root') === null;
    });
    if (!point) throw new Error('Не найдена пустая область канвы ресурсного плана');
    return point;
  }, { left: chartBox.x, top: chartBox.y, width: chartBox.width, height: chartBox.height });
  const instanceId = await panes.nth(0).locator('.resource-timeline').getAttribute('data-widget-instance');
  const readZoom = async () => (await storedWorkspace(page)).settings
    .find(row => row.key === `view:${instanceId}`)?.value as { zoomStart?: number; zoomEnd?: number } | undefined;
  const beforeZoom = await readZoom();
  await page.mouse.move(point.x, point.y);
  expect(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, point))
    .toBe('grab');
  await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y, { steps: 5 });
  await expect(panes.nth(0).locator('.resource-timeline')).toHaveClass(/resource-timeline--panning/);
  expect(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, {
    x: point.x + 80,
    y: point.y,
  })).toBe('grabbing');
  await page.mouse.up();
  await expect(panes.nth(0).locator('.resource-timeline')).not.toHaveClass(/resource-timeline--panning/);
  await expect.poll(readZoom).not.toEqual(beforeZoom);
  await expect.poll(readZoom).toMatchObject({
    zoomStart: expect.any(Number),
    zoomEnd: expect.any(Number),
  });
  expect(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, {
    x: point.x + 80,
    y: point.y,
  })).toBe('grab');
  expect(await snapshot(page, documentId)).toEqual(before);
});

test('короткий список не создаёт вертикальное переполнение', async ({ page }) => {
  await setup(page, 2);
  const chart = page.locator('[data-rt-chart]');
  const dimensions = await chart.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
  expect(await chart.evaluate((el) => el.scrollTop)).toBe(0);
});
