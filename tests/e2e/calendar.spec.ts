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
  // Событие нужно внутри окна «ближайших 7 дней» (сегодня … сегодня+6, upcoming.ts).
  // Дата вычисляется от «сегодня»: +2 дня, а на стыке месяцев — сегодня
  // (событие сегодняшнего дня без времени окном включается). Сетка содержит
  // только дни текущего месяца (monthGrid), поэтому число дня в ней уникально.
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const targetDay = now.getDate() + 2 <= daysInMonth ? now.getDate() + 2 : now.getDate();
  await calendar.locator('.calendar-widget__day').filter({ hasText: new RegExp(`^\\s*${targetDay}\\s*$`) }).first().click();
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

test('PBT-116: календарь и ближайшие события проходят сквозную приёмку прототипа', async ({ page, context }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  const dateOffset = (offset: number) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  await page.goto('/');
  await page.setViewportSize({ width: 1024, height: 778 });
  await createDocumentWindow(page, 'Календарь', 'PBT-116 календарь', true);
  const calendar = page.locator('.calendar-widget').last();
  await expect(calendar).toHaveAttribute('data-calendar-mode', 'month');
  await expect(calendar.locator('.calendar-widget__day, .calendar-widget__blank')).toHaveCount(42);
  await calendar.screenshot({ path: testInfo.outputPath('calendar-month-1024.png') });

  // Проверяем production-режим минимального окна, как в прототипе.
  const cascadeResizeHandle = page.locator('.cascade-layout__window').filter({ has: calendar }).locator('.cascade-resize-se');
  const gridResizeHandle = page.locator('.tiled-grid__cell').filter({ has: calendar }).locator('.react-resizable-handle-se');
  const resizeHandle = (await cascadeResizeHandle.count()) ? cascadeResizeHandle : gridResizeHandle;
  if (await resizeHandle.count()) {
    const box = await resizeHandle.boundingBox();
    if (box) await page.mouse.move(box.x + 4, box.y + 4).then(() => page.mouse.down()).then(async () => {
      await page.mouse.move(box.x - 330, box.y - 150, { steps: 8 });
      await page.mouse.up();
    });
    await expect(calendar).toHaveAttribute('data-calendar-mode', 'small');
    await calendar.screenshot({ path: testInfo.outputPath('calendar-small-1024.png') });
    const restoreBox = await resizeHandle.boundingBox();
    if (restoreBox) await page.mouse.move(restoreBox.x + 4, restoreBox.y + 4).then(() => page.mouse.down()).then(async () => {
      await page.mouse.move(restoreBox.x + 340, restoreBox.y + 180, { steps: 8 });
      await page.mouse.up();
    });
    await expect(calendar).toHaveAttribute('data-calendar-mode', 'month');
  }

  await calendar.getByRole('button', { name: /Типы/ }).click();
  const types = page.getByRole('dialog', { name: 'Типы событий' });
  await types.getByRole('button', { name: 'Добавить тип', exact: true }).click();
  await types.getByLabel('Название типа').fill('Приёмка');
  await types.getByRole('button', { name: 'Зелёный', exact: true }).click();
  await types.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(types).toBeHidden();

  const today = calendar.locator('.calendar-widget__day.is-today');
  await expect(today).toHaveCount(1);
  await today.click();
  let dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await expect(dayDialog.getByRole('button', { name: 'Закрыть день' })).toBeFocused();
  await expect(dayDialog).toContainText(/Сегодня|Через|Прошло/);
  await page.keyboard.press('Escape');
  await expect(dayDialog).toBeHidden();

  await today.click();
  dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await dayDialog.getByRole('button', { name: 'Нерабочий день', exact: true }).click();
  const nonWorking = page.getByRole('dialog', { name: 'Нерабочий день' });
  await nonWorking.getByRole('combobox', { name: 'Вид нерабочего дня' }).selectOption('holiday');
  await nonWorking.getByLabel('Причина нерабочего дня').fill('Приёмочный праздник');
  await nonWorking.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(today).toHaveClass(/is-non-working/);
  await expect(today).toHaveAttribute('title', 'Приёмочный праздник');

  await today.click();
  dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await dayDialog.getByRole('button', { name: 'Добавить событие', exact: true }).click();
  let eventDialog = page.getByRole('dialog', { name: 'Новое событие' });
  await expect(eventDialog.getByLabel('Название события')).toBeVisible();
  await eventDialog.getByLabel('Название события').fill('Приёмка событие');
  await eventDialog.getByLabel('Тип события').selectOption({ label: 'Приёмка' });
  await eventDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(eventDialog).toBeHidden();

  await today.click();
  dayDialog = page.getByRole('dialog', { name: 'События дня' });
  await dayDialog.getByRole('button', { name: 'Добавить событие', exact: true }).click();
  eventDialog = page.getByRole('dialog', { name: 'Новое событие' });
  await eventDialog.getByLabel('Название события').fill('Приёмка серия');
  await eventDialog.getByLabel('Тип события').selectOption({ label: 'Приёмка' });
  await eventDialog.getByLabel('Повторение').selectOption('daily');
  await eventDialog.getByLabel('Дата окончания повторения').fill(dateOffset(3));
  await expect(eventDialog).toContainText('Изменения и удаление применяются ко всей серии.');
  await eventDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(eventDialog).toBeHidden();
  await expect(today).toHaveAttribute('aria-label', /событий: 2/);

  const window = page.getByRole('group', { name: 'Календарь · PBT-116 календарь', exact: true });
  await window.getByRole('button', { name: /Развернуть на весь дашборд/ }).click();
  await expect(calendar).toHaveAttribute('data-calendar-mode', 'year');
  await expect(calendar.locator('.calendar-month')).toHaveCount(12);
  await calendar.screenshot({ path: testInfo.outputPath('calendar-year-1024.png') });
  await page.setViewportSize({ width: 1856, height: 1269 });
  await calendar.screenshot({ path: testInfo.outputPath('calendar-year-wide.png') });
  await window.getByRole('button', { name: /Вернуть прежний размер/ }).click();

  await openDocumentWindow(page, 'Ближайшие события', 'PBT-116 календарь');
  const upcomingWindow = page.getByRole('group', { name: 'Ближайшие события · PBT-116 календарь', exact: true });
  const upcoming = upcomingWindow.locator('.calendar-upcoming-widget');
  await expect(upcoming).toContainText('Ближайшие 7 дней');
  await expect(upcoming.getByRole('button', { name: /Приёмка событие/ })).toBeVisible();
  await expect(upcoming.getByRole('button', { name: /Приёмка серия/ }).first()).toBeVisible();
  await upcoming.getByLabel('Фильтр типа события').selectOption({ label: 'Приёмка' });
  await expect(upcoming.locator('.calendar-upcoming__event')).toHaveCount(5);
  await upcoming.getByRole('button', { name: /Приёмка событие/ }).click();
  eventDialog = page.getByRole('dialog', { name: 'Изменить событие' });
  await eventDialog.getByLabel('Название события').fill('Приёмка событие исправлено');
  await eventDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(upcoming.getByRole('button', { name: /Приёмка событие исправлено/ })).toBeVisible();
  await expect.poll(async () => (await storedWorkspace(page)).documents.find(document => document.title === 'PBT-116 календарь')?.content)
    .toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ title: 'Приёмка событие исправлено' })]) });

  await page.reload();
  await expect(page.getByRole('group', { name: 'Календарь · PBT-116 календарь', exact: true })).toBeVisible();
  const reloadedUpcoming = page.getByRole('group', { name: 'Ближайшие события · PBT-116 календарь', exact: true });
  await expect(reloadedUpcoming.getByRole('button', { name: /Приёмка событие исправлено/ })).toBeVisible();
  await context.setOffline(true);
  await expect(reloadedUpcoming.getByRole('button', { name: /Приёмка серия/ }).first()).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(reloadedUpcoming.getByRole('button', { name: /Приёмка событие исправлено/ })).toBeVisible();
  await context.setOffline(false);

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
