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
