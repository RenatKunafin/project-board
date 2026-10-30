import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDocumentWindow, openDocumentWindow } from './document-ui';
import { persistedDocument, storedWorkspace } from './workspace-helper';

async function renameNote(pane: Locator, title: string) {
  const input = pane.getByLabel('Заголовок заметки', { exact: true });
  await input.fill(title); await input.press('Enter');
  await expect(pane.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

async function addTag(pane: Locator, tag: string) {
  const input = pane.getByLabel('Добавить тег', { exact: true });
  await input.fill(tag); await input.press('Enter');
  await expect(pane.getByRole('button', { name: `Убрать тег ${tag}`, exact: true })).toBeVisible();
}

async function resizeWidget(page: Page, pane: Locator, direction: 'narrow' | 'wide') {
  const widget = pane.locator('.notes-widget');
  const current = await widget.evaluate(element => element.getBoundingClientRect().width);
  if ((direction === 'narrow' && current < 540) || (direction === 'wide' && current > 580)) return;
  const handle = page.locator('.react-grid-item').filter({ has: pane }).locator('.react-resizable-handle-se');
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Нет ручки изменения размера сетки');
  const target = direction === 'narrow' ? 470 : 680;
  const delta = target - current;
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + 4 + delta, box.y + 4, { steps: 16 });
  await page.mouse.up();
  if (direction === 'narrow') {
    await expect.poll(() => widget.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(560);
  } else {
    await expect.poll(() => widget.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(560);
  }
}

function paneForInstance(page: Page, instanceId: string) {
  return page.locator('.widget-window').filter({ has: page.locator(`[data-instance="${instanceId}"]`) });
}

async function backups(page: Page) {
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Резервные копии', exact: true }).click();
  return page.getByRole('dialog', { name: 'Резервные копии', exact: true });
}

test('два окна сохраняют независимую навигацию, настройки и переносятся общей копией offline', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const first = await createDocumentWindow(page, 'Заметки', 'Общий блокнот');
  await first.pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await renameNote(first.pane, 'Первая');
  await first.pane.getByLabel('Текст заметки', { exact: true }).fill('Текст первой заметки');
  await addTag(first.pane, 'идея');
  await first.pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await renameNote(first.pane, 'Вторая');
  await first.pane.getByLabel('Текст заметки', { exact: true }).fill('Текст второй заметки');
  await addTag(first.pane, 'личное');

  const second = await openDocumentWindow(page, 'Заметки', 'Общий блокнот');
  await resizeWidget(page, first.pane, 'narrow');
  await first.pane.getByRole('button', { name: 'Назад к списку', exact: true }).click();
  await expect(first.pane.getByRole('navigation', { name: 'Заметки блокнота' })).toBeVisible();
  await first.pane.getByLabel('Поиск заметок', { exact: true }).fill('Первая');
  await first.pane.getByRole('button', { name: 'Фильтр идея', exact: true }).click();
  const firstCard = first.pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true });
  await firstCard.focus(); await page.keyboard.press('Enter');
  await expect(first.pane.getByRole('button', { name: 'Назад к списку', exact: true })).toBeFocused();
  await first.pane.getByRole('button', { name: 'Просмотр', exact: true }).click();
  await expect(first.pane.getByLabel('Просмотр заметки', { exact: true })).toBeVisible();

  await resizeWidget(page, second.pane, 'wide');
  await second.pane.getByLabel('Поиск заметок', { exact: true }).fill('Вторая');
  await second.pane.getByRole('button', { name: 'Фильтр личное', exact: true }).click();
  await second.pane.getByRole('navigation').getByRole('button', { name: 'Вторая', exact: true }).click();
  await second.pane.getByRole('button', { name: 'Просмотр', exact: true }).click();
  await second.pane.getByRole('button', { name: 'Текст', exact: true }).click();
  await resizeWidget(page, second.pane, 'narrow');
  await second.pane.getByRole('button', { name: 'Назад к списку', exact: true }).click();
  await resizeWidget(page, second.pane, 'wide');
  expect(await first.pane.locator('.notes-widget').evaluate(element => element.clientWidth)).toBeLessThan(560);
  expect(await second.pane.locator('.notes-widget').evaluate(element => element.clientWidth)).toBeGreaterThan(560);

  const beforeReload = await storedWorkspace(page);
  const firstSettings = beforeReload.settings.find(row => row.key === `view:${first.instanceId}`)?.value as Record<string, unknown>;
  const secondSettings = beforeReload.settings.find(row => row.key === `view:${second.instanceId}`)?.value as Record<string, unknown>;
  expect(firstSettings).toMatchObject({ query: 'Первая', activeTag: 'идея', mode: 'preview', narrowPane: 'note' });
  expect(secondSettings).toMatchObject({ query: 'Вторая', activeTag: 'личное', mode: 'text', narrowPane: 'list' });
  expect(firstSettings.selectedNoteId).not.toBe(secondSettings.selectedNoteId);
  await page.reload();
  const firstReloaded = paneForInstance(page, first.instanceId);
  const secondReloaded = paneForInstance(page, second.instanceId);
  await expect(firstReloaded.getByLabel('Просмотр заметки', { exact: true })).toContainText('Текст первой заметки');
  await expect(firstReloaded.locator('.notes-list-pane')).toBeHidden();
  await expect(secondReloaded.getByLabel('Поиск заметок', { exact: true })).toHaveValue('Вторая');
  await expect(secondReloaded.getByRole('button', { name: 'Фильтр личное', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(secondReloaded.locator('.notes-list-pane')).toBeVisible();
  const secondWidthAfterReload = await secondReloaded.locator('.notes-widget').evaluate(element => element.clientWidth);
  if (secondWidthAfterReload < 560) {
    await secondReloaded.getByRole('navigation').getByRole('button', { name: 'Вторая', exact: true }).click();
    await expect(secondReloaded.getByRole('button', { name: 'Текст', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await secondReloaded.getByRole('button', { name: 'Назад к списку', exact: true }).click();
  } else {
    await expect(secondReloaded.getByRole('button', { name: 'Текст', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(secondReloaded.locator('.notes-editor')).toBeVisible();
  }
  await firstReloaded.getByRole('button', { name: 'Назад к списку', exact: true }).click();
  await expect(firstReloaded.getByLabel('Поиск заметок', { exact: true })).toHaveValue('Первая');
  await expect(firstReloaded.getByRole('button', { name: 'Фильтр идея', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const firstReloadedCard = firstReloaded.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true });
  await firstReloadedCard.focus(); await page.keyboard.press('Enter');
  await expect(firstReloaded.getByRole('button', { name: 'Назад к списку', exact: true })).toBeFocused();

  const empty = await createDocumentWindow(page, 'Заметки', 'Пустой блокнот');
  await empty.pane.getByRole('button', { name: /^Закрыть/ }).click();
  await expect.poll(async () => (await storedWorkspace(page)).widgetInstances.some(row => row.id === empty.instanceId)).toBe(false);
  await expect.poll(async () => (await storedWorkspace(page)).documents.some(row => row.title === 'Пустой блокнот')).toBe(true);
  const beforeBackup = await storedWorkspace(page);
  const dialog = await backups(page);
  await dialog.getByRole('button', { name: 'Создать копию', exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать', exact: true }).click();
  const file = await download;
  const buffer = await readFile((await file.path())!);

  const clean = await browser.newContext({ viewport: { width: 1856, height: 1269 } });
  try {
    const target = await clean.newPage(); await target.goto('/');
    const restore = await backups(target);
    await restore.locator('input[type="file"]').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer });
    await restore.getByLabel('Перед заменой создать страховочную копию текущего пространства').uncheck();
    await restore.getByRole('button', { name: 'Заменить пространство', exact: true }).click();
    await expect.poll(async () => (await storedWorkspace(target)).documents).toEqual(beforeBackup.documents);
    expect((await storedWorkspace(target)).widgetInstances).toEqual(beforeBackup.widgetInstances);
    const restoredFirst = paneForInstance(target, first.instanceId);
    const restoredSecond = paneForInstance(target, second.instanceId);
    await expect(restoredFirst.getByLabel('Просмотр заметки', { exact: true })).toContainText('Текст первой заметки');
    await expect(restoredFirst.locator('.notes-list-pane')).toBeHidden();
    await expect(restoredSecond.getByLabel('Поиск заметок', { exact: true })).toHaveValue('Вторая');
    await expect(restoredSecond.getByRole('button', { name: 'Фильтр личное', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const restored = await storedWorkspace(target);
    expect(restored.settings.find(row => row.key === `view:${first.instanceId}`)?.value).toEqual(firstSettings);
    expect(restored.settings.find(row => row.key === `view:${second.instanceId}`)?.value).toEqual(secondSettings);
    expect(restored.documents).toHaveLength(2);
    await target.evaluate(async () => { await navigator.serviceWorker.ready; });
    await clean.setOffline(true);
    await target.reload();
    await expect(paneForInstance(target, first.instanceId).getByLabel('Просмотр заметки', { exact: true }))
      .toContainText('Текст первой заметки');
    await expect(paneForInstance(target, second.instanceId).getByLabel('Поиск заметок', { exact: true }))
      .toHaveValue('Вторая');
    await persistedDocument(target, 'Общий блокнот', { notes: [
      { title: 'Первая', body: 'Текст первой заметки', tags: ['идея'] },
      { title: 'Вторая', body: 'Текст второй заметки', tags: ['личное'] },
    ] });
  } finally { await clean.close(); }
});

for (const viewport of [{ width: 1024, height: 778 }, { width: 1856, height: 1269 }]) {
  test(`адаптивная компоновка и клавиатурный возврат при viewport ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/'); await page.getByRole('button', { name: 'Сетка', exact: true }).click();
    const { pane, instanceId } = await createDocumentWindow(page, 'Заметки', `Порог ${viewport.width}`);
    await pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
    await renameNote(pane, 'Адаптация');
    await pane.getByLabel('Текст заметки', { exact: true }).fill('Ввод сохраняется при изменении размера');
    await resizeWidget(page, pane, 'narrow');
    await expect(pane.locator('.notes-list-pane')).toBeHidden();
    await expect(pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Ввод сохраняется при изменении размера');
    await pane.getByRole('button', { name: 'Назад к списку', exact: true }).click();
    const card = pane.getByRole('navigation').getByRole('button', { name: 'Адаптация', exact: true });
    await expect(card).toBeFocused();
    await card.press('Enter');
    await expect(pane.getByRole('button', { name: 'Назад к списку', exact: true })).toBeFocused();
    await resizeWidget(page, pane, 'wide');
    await expect(pane.locator('.notes-list-pane')).toBeVisible();
    await expect(pane.locator('.notes-editor')).toBeVisible();
    await page.screenshot({ path: `test-results/pbt-105-viewport-${viewport.width}.png` });
    const dashboardButton = page.getByRole('button', { name: 'Виджеты', exact: true });
    await dashboardButton.focus();
    await resizeWidget(page, pane, 'narrow');
    expect(await page.evaluate(() => document.activeElement?.closest('.notes-widget') !== null)).toBe(false);
    await page.getByRole('button', { name: 'Каскад', exact: true }).click();
    await page.getByRole('button', { name: 'Сетка', exact: true }).click();
    const state = await storedWorkspace(page);
    const documentId = await pane.locator('[data-document-id]').getAttribute('data-document-id');
    const instance = state.widgetInstances.find(row => row.documentId === documentId);
    expect(instance).toBeTruthy();
    expect(state.settings.find(row => row.key === `view:${instanceId}`)?.value).toMatchObject({ narrowPane: 'note' });
  });
}

test('старые настройки заметок получают defaults, неизвестный модуль остаётся непрозрачным', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const { pane, instanceId } = await createDocumentWindow(page, 'Заметки', 'Старый блокнот', true);
  await pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await renameNote(pane, 'Заметка');
  await pane.getByLabel('Текст заметки', { exact: true }).fill('Содержимое старого backup');
  await addTag(pane, 'идея');
  await pane.getByLabel('Поиск заметок', { exact: true }).fill('фильтр из новой версии');
  await pane.getByRole('button', { name: 'Фильтр идея', exact: true }).click();
  await pane.getByRole('button', { name: 'Просмотр', exact: true }).click();
  const originalSettings = (await storedWorkspace(page)).settings.find(row => row.key === `view:${instanceId}`)?.value as Record<string, unknown>;
  expect(originalSettings).toMatchObject({ mode: 'preview', narrowPane: 'note', activeTag: 'идея' });

  const dialog = await backups(page);
  await dialog.getByRole('button', { name: 'Создать копию', exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать', exact: true }).click();
  const file = await download;
  const legacy = JSON.parse((await readFile((await file.path())!)).toString()) as {
    documents: Record<string, unknown>[];
    viewSettings: Record<string, Record<string, unknown>>;
  };
  legacy.viewSettings[instanceId] = { selectedNoteId: originalSettings.selectedNoteId };
  const opaqueContent = { plugin: 'uninstalled', nested: { value: [1, 'сохранить', false] } };
  legacy.documents.push({ id: 'unknown-module-document', moduleId: 'missing-module', documentType: 'opaque',
    title: 'Неизвестный модуль', schemaVersion: 9, revision: 4,
    createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', content: opaqueContent });
  const clean = await browser.newContext({ viewport: { width: 1856, height: 1269 } });
  try {
    const target = await clean.newPage(); await target.goto('/');
    const restore = await backups(target);
    await restore.locator('input[type="file"]').setInputFiles({ name: 'legacy-notes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
    await restore.getByLabel('Перед заменой создать страховочную копию текущего пространства').uncheck();
    await restore.getByRole('button', { name: 'Заменить пространство', exact: true }).click();
    const legacyPane = paneForInstance(target, instanceId);
    const restoredNote = legacyPane.getByRole('navigation').getByRole('button', { name: 'Заметка', exact: true });
    await expect(restoredNote).toHaveAttribute('aria-pressed', 'true');
    await expect(legacyPane.getByLabel('Поиск заметок', { exact: true })).toHaveValue('');
    await expect(legacyPane.getByRole('button', { name: 'Все теги', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const restored = await storedWorkspace(target);
    expect(restored.documents.find(document => document.id === 'unknown-module-document')?.content).toEqual(opaqueContent);
    const restoredSettings = restored.settings.find(row => row.key === `view:${instanceId}`)?.value as Record<string, unknown>;
    expect(restoredSettings).not.toHaveProperty('query');
    expect(restoredSettings).not.toHaveProperty('activeTag');
    expect(restoredSettings).not.toHaveProperty('mode');
    expect(restoredSettings).not.toHaveProperty('narrowPane');
    await restoredNote.click();
    await expect(legacyPane.getByRole('button', { name: 'Текст', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(legacyPane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Содержимое старого backup');
  } finally { await clean.close(); }
});

test('IME-ввод переживает возврат, смену заметки, сворачивание и разворачивание окна', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/'); await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const { pane } = await createDocumentWindow(page, 'Заметки', 'Переходы');
  await pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await renameNote(pane, 'Первая');
  await pane.getByLabel('Текст заметки', { exact: true }).fill('Начало');
  await pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await renameNote(pane, 'Вторая');
  await pane.getByLabel('Текст заметки', { exact: true }).fill('Текст второй');
  await pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true }).click();
  await resizeWidget(page, pane, 'narrow');

  const input = pane.getByLabel('Текст заметки', { exact: true });
  await input.focus(); await input.dispatchEvent('compositionstart');
  await input.fill('Незавершённая композиция сохраняется');
  await pane.getByRole('button', { name: 'Назад к списку', exact: true }).click();
  await expect(pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true })).toBeFocused();
  await persistedDocument(page, 'Переходы', { notes: [
    { title: 'Первая', body: 'Незавершённая композиция сохраняется' },
    { title: 'Вторая', body: 'Текст второй' },
  ] });
  await pane.getByRole('navigation').getByRole('button', { name: 'Вторая', exact: true }).click();
  await expect(pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Текст второй');
  await pane.getByRole('button', { name: 'Назад к списку', exact: true }).click();
  await pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true }).click();
  await expect(input).toHaveValue('Незавершённая композиция сохраняется');
  await pane.screenshot({ path: 'test-results/pbt-105-notes-narrow.png' });

  await pane.getByRole('button', { name: 'Свернуть Заметки · Переходы', exact: true }).click();
  await pane.getByRole('button', { name: 'Развернуть Заметки · Переходы', exact: true }).click();
  await expect(input).toHaveValue('Незавершённая композиция сохраняется');
  await pane.getByRole('button', { name: 'Развернуть на весь дашборд Заметки · Переходы', exact: true }).click();
  await expect(input).toHaveValue('Незавершённая композиция сохраняется');
  await pane.getByRole('button', { name: 'Вернуть прежний размер Заметки · Переходы', exact: true }).click();
  await expect(input).toHaveValue('Незавершённая композиция сохраняется');
  await resizeWidget(page, pane, 'wide');
  await expect(pane.locator('.notes-list-pane')).toBeVisible();
  await expect(pane.locator('.notes-editor')).toBeVisible();
  await pane.screenshot({ path: 'test-results/pbt-105-notes-wide.png' });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
