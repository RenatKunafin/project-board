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
  await expect.poll(async () => (await viewportOf(page))!.scroll).toBeGreaterThan(before!.scroll);
  const during = await viewportOf(page);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await viewportOf(page);
  expect(during!.scroll).toBeGreaterThan(before!.scroll);
  expect(after!.scrollHeight).toBeGreaterThan(before!.scrollHeight);
});

test('тачпад: удержание уголка у края непрерывно растит окно, размер сохраняется после отпускания', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'Чек-лист', 'Тачпад');
  const wrap = page.locator('.cascade-layout__window').filter({ has: pane });
  const viewport = page.locator('.cascade-viewport');
  const handle = await wrap.locator('.cascade-resize-se').boundingBox();
  const view = await viewport.boundingBox();
  if (!handle || !view) throw new Error('Нет уголка или канваса');
  const x = handle.x + handle.width / 2;
  const edgeY = view.y + view.height - 12;
  await page.mouse.move(x, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, edgeY, { steps: 6 });
  // Палец удерживает жест у края: новых pointermove/mousemove нет.
  await page.waitForTimeout(500);
  const first = await wrap.evaluate(node => node.offsetHeight);
  const firstScroll = await viewport.evaluate(node => node.scrollTop);
  await expect.poll(() => wrap.evaluate(node => node.offsetHeight)).toBeGreaterThan(first + 160);
  expect(await viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(firstScroll + 128);
  const corner = await wrap.locator('.cascade-resize-se').boundingBox();
  expect(Math.abs(corner!.y + corner!.height / 2 - edgeY)).toBeLessThanOrEqual(24);

  // Возврат от края уменьшает окно, автопрокрутка останавливается.
  const grown = await wrap.evaluate(node => node.offsetHeight);
  await page.mouse.move(x, edgeY - 144, { steps: 6 });
  await expect.poll(() => wrap.evaluate(node => node.offsetHeight)).toBeLessThan(grown - 96);
  const beforeRelease = await wrap.evaluate(node => ({ width: node.offsetWidth, height: node.offsetHeight }));
  await page.mouse.up();
  await expect(wrap).not.toHaveClass(/--gesture/);
  await page.waitForTimeout(350);
  expect(await wrap.evaluate(node => ({ width: node.offsetWidth, height: node.offsetHeight }))).toEqual(beforeRelease);
  const scrollAfterRelease = await viewport.evaluate(node => node.scrollTop);
  await page.waitForTimeout(150);
  expect(await viewport.evaluate(node => node.scrollTop)).toBe(scrollAfterRelease);

  await pane.getByRole('button', { name: 'Свернуть Чек-лист · Тачпад', exact: true }).click();
  await expect.poll(() => wrap.evaluate(node => node.offsetHeight)).toBe(34);
  await pane.getByRole('button', { name: 'Развернуть Чек-лист · Тачпад', exact: true }).click();
  await expect.poll(() => wrap.evaluate(node => node.offsetHeight)).toBe(beforeRelease.height);
  await page.waitForTimeout(350);
  await page.reload();
  await expect.poll(() => wrap.evaluate(node => ({ width: node.offsetWidth, height: node.offsetHeight }))).toEqual(beforeRelease);
});

test('тачпад: ручная прокрутка учитывается в ресайзе, скрытие вкладки отменяет незавершённый жест', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'Чек-лист', 'Прокрутка и отмена');
  const tab = page.getByRole('tab', { selected: true });
  const tabId = await tab.getAttribute('id');
  const wrap = page.locator('.cascade-layout__window').filter({ has: pane });
  const viewport = page.locator('.cascade-viewport').first();
  const original = await wrap.evaluate(node => node.offsetHeight);
  const handle = await wrap.locator('.cascade-resize-se').boundingBox();
  const view = await viewport.boundingBox();
  if (!handle || !view) throw new Error('Нет уголка или канваса');
  const x = handle.x + handle.width / 2;
  const edgeY = view.y + view.height - 12;
  await page.mouse.move(x, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, edgeY, { steps: 6 });
  await expect.poll(() => wrap.evaluate(node => node.offsetHeight)).toBeGreaterThan(original + 320);
  await page.mouse.move(x, edgeY - 120, { steps: 6 });
  const height = await wrap.evaluate(node => node.offsetHeight);
  const scroll = await viewport.evaluate(node => node.scrollTop);
  await page.mouse.wheel(0, -96);
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeLessThan(scroll - 64);
  await expect.poll(() => wrap.evaluate(node => node.offsetHeight)).toBeLessThan(height - 64);
  const corner = await wrap.locator('.cascade-resize-se').boundingBox();
  expect(Math.abs(corner!.y + corner!.height / 2 - (edgeY - 120))).toBeLessThanOrEqual(24);

  // Клавиатурная навигация остаётся доступной при удерживаемом указателе.
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).press('Enter');
  await expect(pane).toBeHidden();
  await expect(wrap).not.toHaveClass(/--gesture/);
  await page.mouse.up();
  await page.locator(`[id="${tabId}"]`).press('Enter');
  await expect(pane).toBeVisible();
  await expect.poll(() => wrap.evaluate(node => node.offsetHeight)).toBe(original);
  await page.waitForTimeout(350);
  await page.reload();
  await expect.poll(() => wrap.evaluate(node => node.offsetHeight)).toBe(original);
});
