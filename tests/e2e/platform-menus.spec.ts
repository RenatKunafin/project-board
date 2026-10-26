import { expect, test } from '@playwright/test';
import { createDocumentWindow } from './document-ui';

/**
 * PBT-090: меню платформы — панели каталога документов, каталога виджетов
 * и выбора документа: clamp-размещение, прокрутка, фокус, последствия
 * удаления, блокировка модальным редактором.
 */

test('панели у кнопки: clamp к viewport, прокрутка, фокус и Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'План', 'Платформенные меню');

  // Каталог документов: панель целиком в viewport на малой высоте.
  await page.getByRole('button', { name: 'Каталог документов' }).click();
  const docs = page.getByRole('dialog', { name: 'Каталог документов' });
  await expect(docs).toBeVisible();
  const docsBox = await docs.boundingBox();
  expect(docsBox!.y).toBeGreaterThanOrEqual(0);
  expect(docsBox!.y + docsBox!.height).toBeLessThanOrEqual(500);
  // Фокус при открытии — первому полю панели (фильтр типа).
  await expect(docs.locator('button, input, select').first()).toBeFocused();

  // 30 документов: список прокручивается внутри панели.
  await page.evaluate(() => {
    return Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        window.__projectBoard!.createDocument('checklist', `Чек-лист ${i + 1}`),
      ),
    );
  });
  await page.waitForTimeout(500);
  const scroll = await docs.evaluate(node => {
    node.scrollTop = 200;
    return node.scrollTop;
  });
  expect(scroll).toBeGreaterThan(0);

  // Escape закрывает панель и возвращает фокус на кнопку.
  await page.keyboard.press('Escape');
  await expect(docs).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Каталог документов' })).toBeFocused();

  // Каталог виджетов и выбор документа — панели тоже в viewport.
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const widgets = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await expect(widgets).toBeVisible();
  const widgetsBox = await widgets.boundingBox();
  expect(widgetsBox!.x + widgetsBox!.width).toBeLessThanOrEqual(1024);
  await widgets.getByRole('button', { name: 'План', exact: true }).click();
  const pickerPanel = page.locator('[data-dropdown-panel]').last();
  await expect(pickerPanel).toBeVisible();
  const pickerBox = await pickerPanel.boundingBox();
  expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(500);
  await page.keyboard.press('Escape');
  await expect(pickerPanel).toHaveCount(0);

  // Клик вне закрывает панель с возвратом фокуса на кнопку.
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await expect(widgets).toBeVisible();
  await page.locator('.app-topbar').click({ position: { x: 8, y: 8 } });
  await expect(widgets).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Виджеты', exact: true })).toBeFocused();
  expect(pane).toBeDefined();
});

test('подтверждение удаления объясняет последствия для открытых окон', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const created = await createDocumentWindow(page, 'План', 'Удаляемый план');
  // Второе окно того же документа — счётчик представлений = 2.
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page.getByRole('dialog', { name: 'Каталог виджетов' }).getByRole('button', { name: 'План', exact: true }).click();
  const pickerPanel = page.locator('[data-dropdown-panel]').last();
  await expect(pickerPanel.getByRole('button', { name: 'Удаляемый план' })).toBeVisible();
  await pickerPanel.getByRole('button', { name: 'Удаляемый план' }).click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'Каталог документов' }).click();
  const docs = page.getByRole('dialog', { name: 'Каталог документов' });
  const row = docs.locator('.doc-catalog__row').filter({ hasText: 'Удаляемый план' }).first();
  await row.getByRole('button', { name: /Удалить «Удаляемый план»/ }).click();
  const confirm = row.locator('.doc-catalog__confirm');
  await expect(confirm).toContainText('открыт в 2 окнах');
  await expect(confirm).toContainText('недоступного документа');
  await confirm.getByRole('button', { name: 'Отмена' }).click();
  // Отмена ничего не меняет: документ и окна на месте.
  await expect(row).toBeVisible();
  expect((await page.evaluate(id => window.__projectBoard!.readDocument(id), created.documentId)).title).toBe('Удаляемый план');
});
