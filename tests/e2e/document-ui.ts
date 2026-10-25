import { expect, type Locator, type Page } from '@playwright/test';
import { storedWorkspace } from './workspace-helper';

/** Пользовательское создание документа: без seed API и прямой записи в БД. */
export async function createDocumentWindow(page: Page, type: string, title: string, fromEmpty = false) {
  await page.getByRole('button', { name: fromEmpty ? 'Добавить виджет на вкладку' : 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: type, exact: true }).click();
  await catalog.getByLabel('Название нового документа').fill(title);
  await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  const pane = page.getByRole('group', { name: `${type} · ${title}`, exact: true }).last();
  await expect(pane).toBeVisible();
  const documentId = await pane.locator('[data-document-id]').getAttribute('data-document-id');
  expect(documentId).toBeTruthy();
  await expect.poll(async () => (await storedWorkspace(page)).widgetInstances
    .some(row => row.documentId === documentId)).toBe(true);
  const instanceId = (await storedWorkspace(page)).widgetInstances.find(row => row.documentId === documentId)!.id;
  return { pane: windowForInstance(page, instanceId), documentId: documentId!, instanceId };
}

function windowForInstance(page: Page, id: string): Locator {
  return page.locator('.widget-window').filter({ has: page.locator(`[data-instance="${id}"], [data-widget-instance="${id}"]`) });
}

export async function openDocumentWindow(page: Page, type: string, title: string) {
  const previous = (await storedWorkspace(page)).widgetInstances.map(row => row.id);
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: type, exact: true }).click();
  await catalog.getByRole('button', { name: title, exact: true }).click();
  await expect.poll(async () => (await storedWorkspace(page)).widgetInstances.filter(row => !previous.includes(row.id)).length).toBe(1);
  const instanceId = (await storedWorkspace(page)).widgetInstances.find(row => !previous.includes(row.id))!.id;
  return { pane: windowForInstance(page, instanceId), instanceId };
}
