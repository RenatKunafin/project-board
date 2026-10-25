import { expect, test } from '@playwright/test';
import { persistedDocument, storedWorkspace } from './workspace-helper';

test('план создаётся через каталог, переживает перезагрузку и открывается по документу', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();

  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await expect(catalog.getByRole('button', { name: 'План', exact: true }).locator('svg.lucide-calendar-range')).toBeVisible();
  await catalog.getByRole('button', { name: /План/ }).click();

  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await expect(choice.getByRole('heading', { name: 'План' })).toBeVisible();
  await choice.getByLabel('Название нового документа').fill('ОКАД');
  await choice.getByRole('button', { name: 'Создать' }).click();

  const pane = page.getByRole('group', { name: 'План · ОКАД' });
  await expect(pane).toBeVisible();
  // План открывается в представлении Гантта (PBT-037).
  await expect(pane.locator('.plan-gantt__chart')).toBeVisible();
  await expect(pane.locator('[data-plan-title]')).toHaveAttribute(
    'data-plan-title',
    'ОКАД',
  );

  await expect(page.getByText('Сохраняется…')).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });
  await persistedDocument(page, 'ОКАД', { tasks: [] });
  const instanceId = await pane.locator('.plan-gantt').getAttribute('data-widget-instance');
  await expect.poll(async () => (await storedWorkspace(page)).widgetInstances.find(instance => instance.id === instanceId)?.documentId).toBeTruthy();
  const documentId = (await storedWorkspace(page)).widgetInstances.find(instance => instance.id === instanceId)!.documentId!;

  // Сохранённое окно восстанавливается; повторное открытие добавляет второй вид.
  await page.reload();
  await expect(pane).toHaveCount(1);
  await expect(pane.locator('.plan-gantt')).toHaveAttribute('data-widget-instance', instanceId!);
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  const reopened = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await reopened.getByRole('button', { name: 'ОКАД' }).click();

  const restored = page.getByRole('group', { name: 'План · ОКАД' });
  // Перезагрузка восстанавливает сохранённое окно плана (PBT-024),
  // открытие из каталога добавляет второе представление того же документа.
  await expect(restored).toHaveCount(2);
  for (const view of await restored.all()) {
    await expect(view.locator('.plan-gantt__chart')).toBeVisible();
  }
  await expect.poll(async () => (await storedWorkspace(page)).widgetInstances
    .filter(instance => instance.documentId === documentId).length).toBe(2);
});
