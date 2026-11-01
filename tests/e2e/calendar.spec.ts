import { expect, test } from '@playwright/test';
import { createDocumentWindow, openDocumentWindow } from './document-ui';
import { storedWorkspace } from './workspace-helper';

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
