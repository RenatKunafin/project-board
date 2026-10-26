import { createDocumentWindow } from './document-ui';
import { expect, test } from '@playwright/test';
import { storedWorkspace } from './workspace-helper';

test('каскад первый и выбран по умолчанию, сохранённая сетка сохраняется после reload', async ({ page }) => {
  await page.goto('/');
  const modes = page.getByRole('group', { name: 'Режим размещения' });
  await expect(modes.getByRole('button')).toHaveText(['Каскад', 'Сетка']);
  await expect(modes.getByRole('button', { name: 'Каскад', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Пустой дашборд', { exact: true })).toBeVisible();
  await createDocumentWindow(page, 'Чек-лист', 'Первое окно');
  await expect(page.locator('.cascade-layout')).toBeVisible();
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await expect(modes.getByRole('button', { name: 'Каскад', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await modes.getByRole('button', { name: 'Сетка', exact: true }).click();
  await expect.poll(async () => {
    const workspace = await storedWorkspace(page);
    const activeId = (workspace.settings.find(row => row.key === 'workspace')?.value as { activeTabId?: string })?.activeTabId;
    return workspace.tabs.find(tab => tab.id === activeId)?.mode;
  }).toBe('grid');
  await page.reload();
  await expect(modes.getByRole('button', { name: 'Сетка', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await expect(modes.getByRole('button', { name: 'Каскад', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
