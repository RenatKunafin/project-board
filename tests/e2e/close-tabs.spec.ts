import { expect, test, type Page } from '@playwright/test';

import { storedWorkspace as stored } from './workspace-helper';

const tablist = (page: Page) => page.getByRole('tablist', { name: 'Вкладки рабочего пространства' });
const tab = (page: Page, title: string) => tablist(page).getByRole('tab').filter({ has: page.getByText(title, { exact: true }) });

test('закрытие первой активной вкладки выбирает оставшуюся', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await tab(page, 'Чек-листы').getByText('Чек-листы', { exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть Чек-листы', exact: true }).click();
  await expect(tablist(page).getByRole('tab', { selected: true })).toContainText('Новая вкладка');
  await expect(page.getByText('Пустой дашборд', { exact: true })).toBeVisible();
});

test('закрытие неактивной вкладки удаляет её окна и настройки из БД', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const pane = page.getByRole('group', { name: 'Экземпляр 1 · Список 1', exact: true });
  await pane.getByRole('button', { name: 'Скрыть выполненные', exact: true }).click();
  await expect.poll(async () => (await stored(page)).settings.some(row => row.key === 'view:w-1')).toBe(true);
  await expect.poll(async () => (await stored(page)).documents.length).toBe(2);
  const before = await stored(page);
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть Чек-листы', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tabs.length).toBe(1);
  const after = await stored(page);
  expect(after.widgetInstances).toEqual([]);
  expect(after.settings.filter(row => row.key.startsWith('view:'))).toEqual([]);
  expect(after.documents.map(doc => doc.id).sort()).toEqual(before.documents.map(doc => doc.id).sort());
  await page.reload();
  await expect(tablist(page).getByRole('tab')).toHaveCount(1);
  await expect(page.locator('.widget-window')).toHaveCount(0);
});

async function renameActive(page: Page, title: string) {
  await tablist(page).getByRole('tab', { selected: true }).locator('.tab__title').dblclick();
  await page.getByLabel('Название вкладки', { exact: true }).fill(title);
  await page.getByLabel('Название вкладки', { exact: true }).press('Enter');
}

test('закрытие средней и последней вкладки, запрет единственной и повторное создание', async ({ page }) => {
  await page.goto('/');
  await renameActive(page, 'A');
  for (const name of ['B', 'C']) {
    await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
    await renameActive(page, name);
  }
  await tab(page, 'B').getByText('B', { exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть B', exact: true }).click();
  await expect(tab(page, 'C')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Закрыть C', exact: true }).click();
  await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Закрыть A', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await renameActive(page, 'D');
  await page.getByRole('button', { name: 'Закрыть D', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await stored(page)).tabs.map(tab => tab.title)).toEqual(['A']);
  await page.reload();
  await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true');
  await expect(tablist(page).getByRole('tab')).toHaveCount(1);
});

for (const mode of ['Сетка', 'Каскад']) {
  test(`${mode}: закрытие вкладки с развёрнутым окном сохраняет общий документ и соседний вид`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Сетка', exact: true }).click();
    const oldPane = page.getByRole('group', { name: 'Экземпляр 3 · Список 2', exact: true });
    await oldPane.getByPlaceholder('Новая задача…').fill('Сохранённый общий пункт');
    await oldPane.getByRole('button', { name: 'Добавить', exact: true }).click();
    await oldPane.getByRole('button', { name: 'Скрыть выполненные', exact: true }).click();
    await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
    await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
    const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
    await catalog.getByRole('button', { name: 'Чек-лист', exact: true }).click();
    await catalog.getByRole('button', { name: 'Список 2', exact: true }).click();
    const survivor = page.getByRole('group', { name: 'Чек-лист · Список 2', exact: true });
    await survivor.getByRole('button', { name: 'Скрыть выполненные', exact: true }).click();
    await expect(survivor.getByText('Сохранённый общий пункт', { exact: true })).toBeVisible();
    await expect.poll(async () => (await stored(page)).widgetInstances.length).toBe(4);
    const before = await stored(page);
    const survivingTab = before.tabs.find(tab => tab.title === 'Новая вкладка')!;
    const survivingInstance = before.widgetInstances.find(instance => instance.tabId === survivingTab.id)!;
    await tab(page, 'Чек-листы').getByText('Чек-листы', { exact: true }).click();
    await page.getByRole('button', { name: mode, exact: true }).click();
    await oldPane.getByRole('button', { name: /Развернуть на весь дашборд/ }).click();
    await expect(oldPane).toHaveClass(/widget-window--maximized/);
    await page.getByRole('button', { name: 'Закрыть Чек-листы', exact: true }).click();
    await expect(survivor).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__projectBoard!.activeSubscriptionCount())).toBe(1);
    await expect.poll(async () => (await stored(page)).widgetInstances.map(instance => instance.id)).toEqual([survivingInstance.id]);
    const after = await stored(page);
    expect(after.tabs.map(tab => tab.id)).toEqual([survivingTab.id]);
    expect(after.settings.filter(row => row.key.startsWith('view:')).map(row => row.key)).toEqual([`view:${survivingInstance.id}`]);
    expect(after.documents.map(doc => doc.id).sort()).toEqual(before.documents.map(doc => doc.id).sort());
    await page.waitForTimeout(1000); // Завершить автосохранение общего документа перед reload.
    await page.reload();
    await expect(page.locator('.widget-window')).toHaveCount(1);
    await expect(survivor.getByText('Сохранённый общий пункт', { exact: true })).toBeVisible();
    await expect(survivor.getByRole('button', { name: 'Показать выполненные', exact: true })).toBeVisible();
    expect((await stored(page)).widgetInstances.map(instance => instance.id)).toEqual([survivingInstance.id]);
  });
}
