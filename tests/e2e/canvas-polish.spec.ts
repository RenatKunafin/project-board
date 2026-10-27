import { expect, test, type Page } from '@playwright/test';
import { createDocumentWindow } from './document-ui';

/**
 * PBT-093: доводка канваса — нулевой зазор к вкладкам, аутлайн активного
 * жеста, автопрокрутка при ресайзе за нижний край одним движением.
 */

function viewportOf(page: Page) {
  return page.evaluate(() => {
    const active = Array.from(document.querySelectorAll('.cascade-viewport')).find(v => v.clientHeight > 0);
    return active
      ? { scroll: active.scrollTop, scrollHeight: active.scrollHeight, clientHeight: active.clientHeight }
      : null;
  });
}

test('канвас без зазора к вкладкам; окно прижимается к верху', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'План', 'Канвас зазор');
  const restore = pane.getByRole('button', { name: /Вернуть прежний размер/ });
  if (await restore.count()) {
    await restore.click();
    await page.waitForTimeout(400);
  }
  const gap = await page.evaluate(() => {
    const tabs = document.querySelector('.tabs-header')?.getBoundingClientRect();
    const viewport = document.querySelector('.cascade-viewport')?.getBoundingClientRect();
    return viewport && tabs ? Math.round(viewport.top - tabs.bottom) : null;
  });
  expect(gap).toBe(0);

  // Перенос окна к верху: верх окна совпадает с верхом канваса (снап 16).
  const head = pane.locator('.widget-window__head');
  const box = await head.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 120, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 120, 88, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const winTop = await pane.evaluate((node) => Math.round(node.getBoundingClientRect().top));
  const viewportTop = await page.evaluate(() =>
    Math.round(document.querySelector('.cascade-viewport')?.getBoundingClientRect().top ?? -1));
  expect(Math.abs(winTop - viewportTop)).toBeLessThanOrEqual(8);
});

test('аутлайн акцентного цвета при переносе и ресайзе, гаснет при отпускании', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', 'Канвас аутлайн');
  const pane = created.pane;
  const wrap = page.locator('.cascade-layout__window').filter({ hasText: 'Канвас аутлайн' }).last();
  const restore = pane.getByRole('button', { name: /Вернуть прежний размер/ });
  if (await restore.count()) {
    await restore.click();
    await page.waitForTimeout(400);
  }
  const head = pane.locator('.widget-window__head');
  const box = await head.boundingBox();
  await page.mouse.move(box!.x + 120, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 200, box!.y + 80, { steps: 5 });
  const outlineDrag = await pane.evaluate((node) => {
    const wrap = node.closest('.cascade-layout__window');
    return wrap ? getComputedStyle(wrap).outlineWidth + ' ' + getComputedStyle(wrap).outlineColor : null;
  });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterDrag = await pane.evaluate((node) => node.closest('.cascade-layout__window--gesture') !== null);
  expect(outlineDrag).toContain('2px');
  expect(afterDrag).toBe(false);

  // Ресайз: тот же аутлайн.
  const handle = wrap.locator('.cascade-resize').last();
  const h = await handle.boundingBox();
  await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
  await page.mouse.down();
  await page.mouse.move(h!.x - 60, h!.y + 80, { steps: 5 });
  const outlineResize = await pane.evaluate((node) => {
    const wrap = node.closest('.cascade-layout__window');
    return wrap ? getComputedStyle(wrap).outlineWidth : null;
  });
  await page.mouse.up();
  expect(outlineResize).toBe('2px');
});

test('ресайз за нижний край прокрутки одним жестом прокручивает и расширяет канвас', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', 'Канвас ресайз');
  const pane = created.pane;
  const wrap = page.locator('.cascade-layout__window').filter({ hasText: 'Канвас ресайз' }).last();
  const restore = pane.getByRole('button', { name: /Вернуть прежний размер/ });
  if (await restore.count()) {
    await restore.click();
    await page.waitForTimeout(400);
  }
  const handle = wrap.locator('.cascade-resize').last();
  const h = await handle.boundingBox();
  const before = await viewportOf(page);
  const vh = 640;
  await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
  await page.mouse.down();
  await page.mouse.move(h!.x - 40, vh - 8, { steps: 6 });
  // Продолжаем движение вдоль нижнего края: канвас должен поддаваться.
  await page.mouse.move(h!.x + 40, vh - 4, { steps: 10 });
  await page.mouse.move(h!.x + 120, vh - 4, { steps: 10 });
  const during = await viewportOf(page);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await viewportOf(page);
  expect(during!.scroll).toBeGreaterThan(before!.scroll);
  expect(after!.scrollHeight).toBeGreaterThan(before!.scrollHeight);
});
