import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createDocumentWindow, openDocumentWindow } from './document-ui';
import { storedWorkspace } from './workspace-helper';

async function backups(page: Page) {
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Резервные копии', exact: true }).click();
  return page.getByRole('dialog', { name: 'Резервные копии', exact: true });
}

test('календарь показывает месяц, выбранный день и годовой вид при maximize', async ({ page }, testInfo) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'Рабочий календарь', true);

  const calendar = page.locator('.calendar-widget');
  await expect(calendar).toHaveAttribute('data-calendar-mode', 'month');
  await expect(calendar.locator('.calendar-widget__day, .calendar-widget__blank')).toHaveCount(42);
  await calendar.screenshot({ path: testInfo.outputPath('calendar-month.png') });

  await calendar.locator('.calendar-widget__day').filter({ hasText: /^1/ }).first().click();
  const dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await expect(dayDialog).toBeVisible();
  await expect(dayDialog.getByRole('button', { name: 'Закрыть день' })).toBeFocused();
  await dayDialog.getByRole('button', { name: 'Закрыть день' }).click();
  await expect(dayDialog).toBeHidden();

  const window = page.getByRole('group', { name: 'Календарь · Рабочий календарь', exact: true });
  await window.getByRole('button', { name: /Развернуть на весь дашборд/ }).click();
  await expect(calendar).toHaveAttribute('data-calendar-mode', 'year');
  await expect(calendar.locator('.calendar-month')).toHaveCount(12);
  await calendar.screenshot({ path: testInfo.outputPath('calendar-year.png') });

  await window.getByRole('button', { name: /Вернуть прежний размер/ }).click();
  await expect(calendar).toHaveAttribute('data-calendar-mode', 'month');
});

test('два окна используют один календарь, а просмотр переживает reload без записи документа', async ({ page }) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'Общий календарь', true);
  await openDocumentWindow(page, 'Календарь', 'Общий календарь');
  const before = (await storedWorkspace(page)).documents;
  await page.getByRole('group', { name: 'Календарь · Общий календарь', exact: true }).first().getByRole('button', { name: 'Следующий период' }).click();
  expect((await storedWorkspace(page)).documents).toEqual(before);
  await page.reload();
  await expect(page.getByRole('group', { name: 'Календарь · Общий календарь', exact: true })).toHaveCount(2);
  const windows = page.getByRole('group', { name: 'Календарь · Общий календарь', exact: true });
  await expect(windows.nth(0).locator('.calendar-widget')).toBeVisible();
  await expect(windows.nth(1).locator('.calendar-widget')).toBeVisible();
});

test('календарь сохраняет тип и одиночное событие, видимое во втором окне', async ({ page }) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'События команды', true);
  const calendar = page.locator('.calendar-widget').last();
  await expect(calendar).toHaveAttribute('data-calendar-mode', 'month');

  await calendar.getByRole('button', { name: /Типы/ }).last().click();
  const types = page.getByRole('dialog', { name: 'Типы событий' });
  await types.getByRole('button', { name: 'Добавить тип', exact: true }).click();
  await types.getByLabel('Название типа').fill('Работа');
  await types.getByRole('button', { name: 'Зелёный', exact: true }).click();
  await types.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(types).toBeHidden();

  const day = calendar.locator('.calendar-widget__day').filter({ hasText: /^1/ }).first();
  await day.click();
  const dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await dayDialog.getByRole('button', { name: 'Добавить событие', exact: true }).click();
  const eventDialog = page.getByRole('dialog', { name: 'Новое событие' });
  await eventDialog.getByLabel('Название события').fill('Командная встреча');
  await eventDialog.getByLabel('Тип события').selectOption({ label: 'Работа' });
  await eventDialog.getByLabel('Описание события').fill('Обсудить релиз');
  await eventDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(eventDialog).toBeHidden();
  await expect.poll(async () => {
    const stored = await storedWorkspace(page);
    return (stored.documents.find((document) => document.title === 'События команды')?.content as { events?: { title: string }[] } | undefined)?.events?.[0]?.title;
  }).toBe('Командная встреча');

  await openDocumentWindow(page, 'Календарь', 'События команды');
  const windows = page.getByRole('group', { name: 'Календарь · События команды', exact: true });
  await expect(windows).toHaveCount(2);
  await windows.nth(1).locator('.calendar-widget__day').filter({ hasText: /^1/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'События дня' })).toContainText('Командная встреча');
});

test('ближайшие события выбирают существующий календарь, фильтруются, редактируются и переживают reload offline', async ({ page, context, browser }, testInfo) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'Общий список событий', true);
  const calendar = page.locator('.calendar-widget').last();
  await calendar.locator('.calendar-widget__day').filter({ hasText: /^2/ }).first().click();
  const dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await dayDialog.getByRole('button', { name: 'Добавить событие', exact: true }).click();
  const eventDialog = page.getByRole('dialog', { name: 'Новое событие' });
  await eventDialog.getByLabel('Название события').fill('Ближайшая встреча');
  await eventDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).documents.find((document) => document.title === 'Общий список событий')?.content)
    .toMatchObject({ events: [{ title: 'Ближайшая встреча' }] });

  const upcomingWindow = await openDocumentWindow(page, 'Ближайшие события', 'Общий список событий');
  const upcoming = upcomingWindow.pane.locator('.calendar-upcoming-widget');
  await expect(upcoming).toBeVisible();
  await expect(upcoming.getByRole('button', { name: /Ближайшая встреча/ })).toBeVisible();
  await expect(upcoming).toContainText('Ближайшие 7 дней');
  await page.setViewportSize({ width: 1024, height: 778 });
  await upcoming.screenshot({ path: testInfo.outputPath('upcoming-1024.png') });
  await page.setViewportSize({ width: 1856, height: 1269 });
  await upcoming.screenshot({ path: testInfo.outputPath('upcoming-wide.png') });
  await upcoming.getByRole('button', { name: /Ближайшая встреча/ }).click();
  const editor = page.getByRole('dialog', { name: 'Изменить событие' });
  await editor.getByLabel('Название события').fill('Изменённая встреча');
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).documents.find((document) => document.title === 'Общий список событий')?.content)
    .toMatchObject({ events: [{ title: 'Изменённая встреча' }] });

  await page.reload();
  const reloaded = page.getByRole('group', { name: 'Ближайшие события · Общий список событий', exact: true });
  await expect(reloaded.locator('.calendar-upcoming__event')).toContainText('Изменённая встреча');
  await context.setOffline(true);
  await expect(reloaded.locator('.calendar-upcoming__event')).toContainText('Изменённая встреча');

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(reloaded.locator('.calendar-upcoming__event')).toContainText('Изменённая встреча');

  await context.setOffline(false);
  const backupDialog = await backups(page);
  await backupDialog.getByRole('button', { name: 'Создать копию', exact: true }).click();
  const download = page.waitForEvent('download');
  await backupDialog.getByRole('button', { name: 'Скачать', exact: true }).click();
  const file = await download;
  const buffer = await readFile((await file.path())!);
  const clean = await browser.newContext();
  try {
    const target = await clean.newPage();
    await target.goto('/');
    const restore = await backups(target);
    await restore.locator('input[type="file"]').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer });
    await restore.getByLabel('Перед заменой создать страховочную копию текущего пространства').uncheck();
    await restore.getByRole('button', { name: 'Заменить пространство', exact: true }).click();
    await expect(target.getByRole('group', { name: 'Ближайшие события · Общий список событий', exact: true }).locator('.calendar-upcoming__event')).toContainText('Изменённая встреча');
  } finally {
    await clean.close();
  }
});

test('календарь вычисляет серию в следующем дне и синхронизирует одну запись между окнами', async ({ page }, testInfo) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'Серия команды', true);
  const calendar = page.locator('.calendar-widget').last();
  await calendar.locator('.calendar-widget__day').filter({ hasText: /^1/ }).first().click();
  const dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await dayDialog.getByRole('button', { name: 'Добавить событие', exact: true }).click();
  const eventDialog = page.getByRole('dialog', { name: 'Новое событие' });
  await eventDialog.getByLabel('Название события').fill('Ежедневная синхронизация');
  await eventDialog.getByLabel('Повторение').selectOption('daily');
  await expect(eventDialog).toContainText('Изменения и удаление применяются ко всей серии.');
  await eventDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(eventDialog).toBeHidden();
  await expect.poll(async () => {
    const stored = await storedWorkspace(page);
    return (stored.documents.find((document) => document.title === 'Серия команды')?.content as { events?: { repeat?: string }[] } | undefined)?.events;
  }).toMatchObject([{ repeat: 'daily' }]);

  await openDocumentWindow(page, 'Календарь', 'Серия команды');
  const windows = page.getByRole('group', { name: 'Календарь · Серия команды', exact: true });
  await expect(windows).toHaveCount(2);
  const secondCalendar = windows.nth(1).locator('.calendar-widget');
  await secondCalendar.locator('.calendar-widget__day').filter({ hasText: /^2/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'События дня' })).toContainText('Ежедневная синхронизация');
  await expect(page.getByRole('dialog', { name: 'События дня' })).toContainText('Каждый день');
  await page.screenshot({ path: testInfo.outputPath('calendar-recurring-day.png') });
});

test('серия календаря переносится общей копией и переживает offline reload', async ({ page, browser }) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'Backup календарь', true);
  const calendar = page.locator('.calendar-widget').last();
  await calendar.locator('.calendar-widget__day').filter({ hasText: /^1/ }).first().click();
  const dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await dayDialog.getByRole('button', { name: 'Добавить событие', exact: true }).click();
  const eventDialog = page.getByRole('dialog', { name: 'Новое событие' });
  await eventDialog.getByLabel('Название события').fill('Backup серия');
  await eventDialog.getByLabel('Повторение').selectOption('monthly');
  await eventDialog.getByLabel('Дата окончания повторения').fill('2030-12-31');
  await eventDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).documents.find((document) => document.title === 'Backup календарь')?.content)
    .toMatchObject({ events: [{ title: 'Backup серия', repeat: 'monthly', until: '2030-12-31' }] });

  const dialog = await backups(page);
  await dialog.getByRole('button', { name: 'Создать копию', exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать', exact: true }).click();
  const file = await download;
  const buffer = await readFile((await file.path())!);
  const clean = await browser.newContext();
  try {
    const target = await clean.newPage();
    await target.goto('/');
    const restore = await backups(target);
    await restore.locator('input[type="file"]').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer });
    await restore.getByLabel('Перед заменой создать страховочную копию текущего пространства').uncheck();
    await restore.getByRole('button', { name: 'Заменить пространство', exact: true }).click();
    await expect.poll(async () => (await storedWorkspace(target)).documents.find((document) => document.title === 'Backup календарь')?.content)
      .toMatchObject({ events: [{ title: 'Backup серия', repeat: 'monthly', until: '2030-12-31' }] });
    await target.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await clean.setOffline(true);
    await target.reload();
    await expect(target.getByRole('group', { name: 'Календарь · Backup календарь', exact: true })).toBeVisible();
  } finally {
    await clean.close();
  }
});

test('нерабочий день сохраняется рядом с событием и показывает countdown', async ({ page }, testInfo) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'Нерабочие дни', true);
  const calendar = page.locator('.calendar-widget').last();
  const monday = calendar.locator('.calendar-widget__day').filter({ hasText: /^2/ }).first();
  await monday.click();
  const dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await expect(dayDialog).toContainText(/Сегодня|Через|Прошло/);
  await dayDialog.getByRole('button', { name: 'Нерабочий день', exact: true }).click();
  const nonWorking = page.getByRole('dialog', { name: 'Нерабочий день' });
  await nonWorking.getByLabel('Вид нерабочего дня').selectOption('holiday');
  await nonWorking.getByLabel('Причина нерабочего дня').fill('Корпоративный выходной');
  await nonWorking.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).documents.find((document) => document.title === 'Нерабочие дни')?.content)
    .toMatchObject({ days: [{ kind: 'holiday', name: 'Корпоративный выходной' }] });
  await expect(monday).toHaveClass(/is-non-working/);
  await expect(monday).toHaveAttribute('title', 'Корпоративный выходной');

  await monday.click();
  const selected = page.getByRole('dialog', { name: 'События дня' });
  await expect(selected).toContainText('Корпоративный выходной');
  await page.screenshot({ path: testInfo.outputPath('calendar-non-working-dialog.png') });
  await selected.getByRole('button', { name: 'Добавить событие', exact: true }).click();
  const eventDialog = page.getByRole('dialog', { name: 'Новое событие' });
  await eventDialog.getByLabel('Название события').fill('Событие в выходной');
  await eventDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).documents.find((document) => document.title === 'Нерабочие дни')?.content)
    .toMatchObject({ events: [{ title: 'Событие в выходной' }], days: [{ name: 'Корпоративный выходной' }] });
  await expect(monday).toHaveAttribute('aria-label', /событий: 1/);
  await page.screenshot({ path: testInfo.outputPath('calendar-non-working-day.png') });
});

test('ручная отметка нерабочего дня переживает reload и offline', async ({ page, context }) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'Offline нерабочий день', true);
  const calendar = page.locator('.calendar-widget').last();
  const monday = calendar.locator('.calendar-widget__day').filter({ hasText: /^2/ }).first();
  await monday.click();
  await page.getByRole('dialog', { name: 'События дня' }).getByRole('button', { name: 'Нерабочий день', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Нерабочий день' });
  await editor.getByLabel('Причина нерабочего дня').fill('Offline выходной');
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).documents.find((document) => document.title === 'Offline нерабочий день')?.content)
    .toMatchObject({ days: [{ name: 'Offline выходной' }] });
  await page.reload();
  const reloaded = page.getByRole('group', { name: 'Календарь · Offline нерабочий день', exact: true });
  await expect(reloaded.locator('.calendar-widget__day').filter({ hasText: /^2/ }).first()).toHaveClass(/is-non-working/);
  await context.setOffline(true);
  await reloaded.locator('.calendar-widget__day').filter({ hasText: /^2/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'События дня' })).toContainText('Offline выходной');
});

test('ручная отметка нерабочего дня переносится backup в чистый контекст', async ({ page, browser }) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'Backup нерабочий день', true);
  const calendar = page.locator('.calendar-widget').last();
  await calendar.locator('.calendar-widget__day').filter({ hasText: /^2/ }).first().click();
  await page.getByRole('dialog', { name: 'События дня' }).getByRole('button', { name: 'Нерабочий день', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Нерабочий день' });
  await editor.getByLabel('Причина нерабочего дня').fill('Backup праздник');
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).documents.find((document) => document.title === 'Backup нерабочий день')?.content)
    .toMatchObject({ days: [{ name: 'Backup праздник' }] });
  const dialog = await backups(page);
  await dialog.getByRole('button', { name: 'Создать копию', exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать', exact: true }).click();
  const file = await download;
  const buffer = await readFile((await file.path())!);
  const clean = await browser.newContext();
  try {
    const target = await clean.newPage();
    await target.goto('/');
    const restore = await backups(target);
    await restore.locator('input[type="file"]').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer });
    await restore.getByLabel('Перед заменой создать страховочную копию текущего пространства').uncheck();
    await restore.getByRole('button', { name: 'Заменить пространство', exact: true }).click();
    await expect.poll(async () => (await storedWorkspace(target)).documents.find((document) => document.title === 'Backup нерабочий день')?.content)
      .toMatchObject({ days: [{ name: 'Backup праздник' }] });
  } finally {
    await clean.close();
  }
});

test('одиночное событие календаря переживает reload в offline', async ({ page, context }) => {
  await page.goto('/');
  await createDocumentWindow(page, 'Календарь', 'Offline календарь', true);
  const calendar = page.locator('.calendar-widget').last();
  await context.setOffline(true);
  await calendar.locator('.calendar-widget__day').filter({ hasText: /^1/ }).first().click();
  const dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await dayDialog.getByRole('button', { name: 'Добавить событие', exact: true }).click();
  const eventDialog = page.getByRole('dialog', { name: 'Новое событие' });
  await eventDialog.getByLabel('Название события').fill('Offline встреча');
  await eventDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).documents.find((document) => document.title === 'Offline календарь')?.content as { events?: { title: string }[] } | undefined).toMatchObject({ events: [{ title: 'Offline встреча' }] });

  await page.reload();
  const reloaded = page.getByRole('group', { name: 'Календарь · Offline календарь', exact: true });
  await expect(reloaded).toBeVisible();
  await reloaded.locator('.calendar-widget__day').filter({ hasText: /^1/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'События дня' })).toContainText('Offline встреча');
});
