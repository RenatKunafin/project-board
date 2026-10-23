import { expect, type Page } from '@playwright/test';
import { createPlan, documentId, restoreSize, storedPlan, workspace } from '../planning/helpers';
import { benchmarkData } from './data';

export async function renameTab(page: Page, title: string) {
  await page.locator('[role="tab"][aria-selected="true"] .tab__title').dblclick();
  const input = page.getByRole('textbox', { name: 'Название вкладки', exact: true });
  await input.fill(title); await input.press('Enter');
}

export async function addView(page: Page, title: string, type = 'План') {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: type, exact: true }).click();
  await catalog.getByRole('button', { name: title, exact: true }).click();
}

export async function newPlan(page: Page, data: Awaited<ReturnType<typeof benchmarkData>>[number]) {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: 'План', exact: true }).click();
  await catalog.getByLabel('Название нового документа').fill(`Подготовка ${data.title}`);
  await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  const pane = page.getByRole('group', { name: `План · Подготовка ${data.title}`, exact: true });
  return importData(page, pane, data);
}

async function importData(page: Page, pane: ReturnType<Page['locator']>, data: Awaited<ReturnType<typeof benchmarkData>>[number]) {
  await pane.locator('[data-import-plan]').click();
  await pane.locator('[data-import-plan-input]').setInputFiles({ name: 'benchmark.json', mimeType: 'application/json', buffer: Buffer.from(data.json) });
  const imported = page.getByRole('group', { name: `План · ${data.title}`, exact: true });
  await expect(imported.locator('[data-task-count]')).toHaveText(`Задач: ${data.content.tasks.length}`);
  const id = await documentId(imported);
  await expect.poll(async () => (await storedPlan(page, id))?.content.tasks.length).toBe(data.content.tasks.length);
  return id;
}

async function removeInitial(page: Page) {
  await page.getByRole('tab').filter({ hasText: 'Чек-листы' }).locator('.tab__title').click();
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  while (await page.locator('.tab-surface:not([hidden]) .widget-window').count()) {
    await page.locator('.tab-surface:not([hidden]) .widget-window').first().getByRole('button', { name: /^Закрыть/ }).click();
  }
  await page.getByRole('button', { name: 'Закрыть Чек-листы', exact: true }).click();
  // PBT-079: закрытие первой активной вкладки может оставить невалидный activeId.
  // Явный пользовательский выбор оставшейся вкладки вне замеряемой операции.
  await page.getByRole('tab').first().locator('.tab__title').click();
}

export async function setupA(page: Page, data: Awaited<ReturnType<typeof benchmarkData>>) {
  const initial = await createPlan(page, 'Сетка');
  const id = await importData(page, initial, data[0]);
  await restoreSize(page);
  await renameTab(page, 'Нагрузка A');
  await removeInitial(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  for (let index = 1; index < 10; index++) await addView(page, data[0].title, index < 6 ? 'План' : 'Ресурсы');
  await expect(page.locator('.plan-gantt')).toHaveCount(6);
  await expect(page.locator('.resource-timeline')).toHaveCount(4);
  await settledWorkspace(page, 10);
  return id;
}

export async function setupB(page: Page, data: Awaited<ReturnType<typeof benchmarkData>>, tabPerPlan = true) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await removeInitial(page);
  for (let index = 1; index <= 10; index++) {
    if (index > 1 && tabPerPlan) await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
    await renameTab(page, tabPerPlan ? `План B ${index}` : 'Нагрузка B');
    await page.getByRole('button', { name: 'Сетка', exact: true }).click();
    await newPlan(page, data[index]);
  }
  await settledWorkspace(page, 10);
}

export async function settledWorkspace(page: Page, instances: number) {
  await expect.poll(async () => (await workspace(page)).instances.length).toBe(instances);
  // Запись workspace — отдельная очередь. Проверяем одинаковый снимок в двух
  // последовательных чтениях через штатный debounce, не время операции benchmark.
  const expected = await workspace(page);
  await expect.poll(async () => (await workspace(page)).instances.map(instance => instance.id)).toEqual(expected.instances.map(instance => instance.id));
  await expect(page.getByLabel('Состояние сохранения')).toHaveText('Сохранено');
}
