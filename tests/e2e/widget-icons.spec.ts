import { expect, test } from '@playwright/test';

test('иконка типа согласована между каталогом, пикером, рамкой и выбором представления', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const widgets = page.getByRole('dialog', { name: 'Каталог виджетов' });
  // Все встроенные карточки используют декоративные SVG; доступные имена не меняются.
  await expect(widgets.locator('.widget-catalog__tile svg[aria-hidden="true"]')).toHaveCount(4);
  const planType = widgets.getByRole('button', { name: 'План', exact: true });
  const planGraphic = await planType.locator('svg').innerHTML();
  const resourceGraphic = await widgets.getByRole('button', { name: 'Ресурсы', exact: true }).locator('svg').innerHTML();
  expect(resourceGraphic).not.toBe(planGraphic);
  await planType.click();
  await widgets.getByLabel('Название нового документа').fill('Иконки плана');
  await widgets.getByRole('button', { name: 'Создать', exact: true }).click();
  const plan = page.getByRole('group', { name: 'План · Иконки плана', exact: true });
  await expect(plan.locator('.widget-window__icon svg')).toHaveJSProperty('innerHTML', planGraphic);

  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await widgets.getByRole('button', { name: 'Ресурсы', exact: true }).click();
  const existing = widgets.getByRole('button', { name: 'Иконки плана', exact: true });
  await expect(existing.locator('svg')).toHaveJSProperty('innerHTML', resourceGraphic);
  await existing.click();
  const resources = page.getByRole('group', { name: 'Ресурсы · Иконки плана', exact: true });
  await expect(resources.locator('.widget-window__icon svg')).toHaveJSProperty('innerHTML', resourceGraphic);

  await page.getByRole('button', { name: 'Каталог документов', exact: true }).click();
  const documents = page.getByRole('dialog', { name: 'Каталог документов' });
  // У документа плана — каноническая иконка типа, у представлений — свои.
  const document = documents.getByRole('button', { name: /^Иконки плана/ });
  await expect(document.locator('.doc-catalog__tile svg')).toHaveJSProperty('innerHTML', planGraphic);
  await expect(documents.getByLabel('Тип нового документа').locator('option')).toHaveText(['Чек-лист', 'План', 'Заметки']);
  await expect(documents).not.toContainText('lucide:');
  await document.click();
  await expect(documents.getByRole('button', { name: 'План', exact: true }).locator('svg')).toHaveJSProperty('innerHTML', planGraphic);
  await expect(documents.getByRole('button', { name: 'Ресурсы', exact: true }).locator('svg')).toHaveJSProperty('innerHTML', resourceGraphic);
});
