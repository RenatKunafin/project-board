import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDocumentWindow } from './document-ui';

async function openBackups(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Резервные копии' }).click();
  await expect(page.getByRole('dialog', { name: 'Резервные копии' })).toBeVisible();
}

test('ручная копия сохраняется, скачивается, восстанавливается со страховкой и удаляется', async ({ page }) => {
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'Чек-лист', 'Backup sample', true);
  await pane.getByPlaceholder('Новая задача…').fill('Сохранённый резервной копией');
  await pane.getByRole('button', { name: 'Добавить', exact: true }).click();
  await openBackups(page);
  await expect(page.getByText('Копий пока нет')).toBeVisible();
  await page.getByRole('button', { name: 'Создать копию' }).click();
  await expect(page.getByText('1 / 5 копий')).toBeVisible();
  await expect(page.getByText('Вручную')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать' }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toMatch(/^pb-workspace-.*\.json$/);
  await page.locator('input[type="file"]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Сохранённый резервной копией', { exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(await downloaded.path() ?? '');
  await expect(page.getByRole('heading', { name: 'Заменить текущее пространство?' })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();
  await page.getByRole('button', { name: 'Восстановить' }).click();
  await expect(page.getByRole('heading', { name: 'Заменить текущее пространство?' })).toBeVisible();
  await expect(page.getByLabel('Перед заменой создать страховочную копию текущего пространства')).toBeChecked();
  await page.getByRole('button', { name: 'Заменить пространство' }).click();
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible();
  await expect(page.getByText('Сохранённый резервной копией', { exact: true })).toBeVisible();
  await openBackups(page);
  await expect(page.getByText('2 / 5 копий')).toBeVisible();
  await expect(page.getByText('Перед восстановлением')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить копию' }).first().click();
  await expect(page.getByText('1 / 5 копий')).toBeVisible();
});

test('JSON переносится в чистый browser context и восстанавливается без страховки', async ({ page, browser }) => {
  await page.goto('/');
  await createDocumentWindow(page, 'План', 'План из JSON', true);
  const { pane } = await createDocumentWindow(page, 'Чек-лист', 'Переносимый');
  await pane.getByPlaceholder('Новая задача…').fill('Пункт из JSON');
  await pane.getByRole('button', { name: 'Добавить', exact: true }).click();
  await openBackups(page);
  await page.getByRole('button', { name: 'Создать копию' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать' }).click();
  const file = await download;
  const filePath = await file.path();
  expect(filePath).not.toBeNull();

  const cleanContext = await browser.newContext();
  try {
    const cleanPage = await cleanContext.newPage();
    await cleanPage.goto('/');
    await openBackups(cleanPage);
    await cleanPage.locator('input[type="file"]').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer: await readFile(filePath!) });
    await expect(cleanPage.getByRole('heading', { name: 'Заменить текущее пространство?' })).toBeVisible();
    await expect(cleanPage.getByText('2 документов · 1 вкладок · 2 окон')).toBeVisible();
    const safety = cleanPage.getByLabel('Перед заменой создать страховочную копию текущего пространства');
    await expect(safety).toBeChecked();
    await safety.uncheck();
    await cleanPage.getByRole('button', { name: 'Заменить пространство' }).click();
    await expect(cleanPage.getByText('Пункт из JSON', { exact: true })).toBeVisible();
    await expect(cleanPage.getByRole('group', { name: 'План · План из JSON', exact: true })).toBeVisible();
    await openBackups(cleanPage);
    await expect(cleanPage.getByText('Копий пока нет')).toBeVisible();
  } finally { await cleanContext.close(); }
});

test('старое окно не перезаписывает данные после восстановления в другом окне', async ({ page, context }) => {
  await page.goto('/');
  const { pane, documentId } = await createDocumentWindow(page, 'Чек-лист', 'Защита окна', true);
  await pane.getByPlaceholder('Новая задача…').fill('Версия из копии');
  await pane.getByRole('button', { name: 'Добавить', exact: true }).click();
  await openBackups(page);
  await page.getByRole('button', { name: 'Создать копию' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать' }).click();
  const file = await download;
  const filePath = await file.path();
  expect(filePath).not.toBeNull();

  const stalePage = await context.newPage();
  await stalePage.goto('/');
  await expect(stalePage.getByText('Версия из копии', { exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(filePath!);
  await expect(page.getByRole('heading', { name: 'Заменить текущее пространство?' })).toBeVisible();
  await page.getByRole('button', { name: 'Заменить пространство' }).click();
  await expect(page.getByText('Версия из копии', { exact: true })).toBeVisible();

  await stalePage.evaluate((id) => {
    const document = window.__projectBoard?.readDocument(id);
    if (!document) throw new Error('Документ устаревшего окна не загружен.');
    window.__projectBoard?.writeDocumentContent(id, { ...(document.content as Record<string, unknown>), marker: 'Запись старого окна' });
  }, documentId);
  await stalePage.waitForTimeout(500);
  await stalePage.reload();
  await expect(stalePage.getByText('Версия из копии', { exact: true })).toBeVisible();
  await expect(stalePage.getByText('Запись старого окна')).toHaveCount(0);
  await stalePage.close();
});

test('открытие и перезагрузка не создают автокопии; шесть ручных снимков оставляют пять', async ({ page }) => {
  await page.goto('/');
  await openBackups(page);
  await expect(page.getByText('Копий пока нет')).toBeVisible();
  await page.reload();
  await openBackups(page);
  await expect(page.getByText('Копий пока нет')).toBeVisible();
  for (let index = 1; index <= 6; index += 1) {
    await page.getByRole('button', { name: 'Создать копию' }).click();
    await expect(page.getByText(`${Math.min(index, 5)} / 5 копий`)).toBeVisible();
  }
});

test('ручная копия и восстановление работают офлайн', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const { pane } = await createDocumentWindow(page, 'Чек-лист', 'Офлайн-копия', true);
  await pane.getByPlaceholder('Новая задача…').fill('Сохранено без сети');
  await pane.getByRole('button', { name: 'Добавить', exact: true }).click();
  await context.setOffline(true);
  await openBackups(page);
  await page.getByRole('button', { name: 'Создать копию' }).click();
  await expect(page.getByText('1 / 5 копий')).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить' }).click();
  const safety = page.getByLabel('Перед заменой создать страховочную копию текущего пространства');
  await expect(safety).toBeChecked();
  await safety.uncheck();
  await page.getByRole('button', { name: 'Заменить пространство' }).click();
  await expect(page.getByText('Сохранено без сети', { exact: true })).toBeVisible();
});

for (const viewport of [{ width: 1024, height: 778 }, { width: 1856, height: 1269 }]) {
  test(`модалка копий вмещается во viewport ${viewport.width}×${viewport.height} и возвращает фокус`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await page.goto('/');
    const settings = page.getByRole('button', { name: 'Настройки' });
    await settings.click();
    await page.getByRole('button', { name: 'Резервные копии' }).press('Escape');
    await expect(settings).toBeFocused();
    await openBackups(page);
    const dialog = page.getByRole('dialog', { name: 'Резервные копии' });
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: `test-results/pbt-064-backup-${viewport.width}x${viewport.height}.png` });
    await dialog.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(settings).toBeFocused();
    expect(errors).toEqual([]);
  });
}
