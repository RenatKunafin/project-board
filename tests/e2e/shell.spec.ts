import { expect, test } from '@playwright/test';

test('оболочка приложения открывается', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Project Board');
  await expect(page.getByRole('heading', { name: 'Project Board' })).toBeVisible();
});

test('каталог содержит модуль чек-листа', async ({ page }) => {
  await page.goto('/');
  const catalog = page.getByRole('region', { name: 'Каталог типов виджетов' });
  await expect(catalog.getByText('checklist')).toBeVisible();
  await expect(catalog.getByText('Чек-лист')).toBeVisible();
});

test('добавленный пункт появляется в обоих экземплярах', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  const pane1 = instances.getByLabel('Экземпляр 1');
  const pane2 = instances.getByLabel('Экземпляр 2');

  await pane1.getByPlaceholder('Новый пункт').fill('Купить молоко');
  await pane1.getByRole('button', { name: 'Добавить' }).click();

  await expect(pane1.getByText('Купить молоко')).toBeVisible();
  await expect(pane2.getByText('Купить молоко')).toBeVisible();
});

test('перезагрузка восстанавливает пункты после автосохранения', async ({ page }) => {
  await page.goto('/');
  const pane1 = page
    .getByRole('region', { name: 'Экземпляры виджетов' })
    .getByLabel('Экземпляр 1');

  await pane1.getByPlaceholder('Новый пункт').fill('Живёт после перезагрузки');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();

  await page.reload();
  await expect(pane1.getByText('Живёт после перезагрузки')).toBeVisible();
});

test('конфликт двух страниц: устаревшая страница перечитывает документ', async ({ browser }) => {
  // Один контекст: страницы разделяют IndexedDB одного origin.
  const context = await browser.newContext();
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  const instances1 = page1.getByRole('region', { name: 'Экземпляры виджетов' });
  const pane1 = instances1.getByLabel('Экземпляр 1');
  const instances2 = page2.getByRole('region', { name: 'Экземпляры виджетов' });
  const pane2 = instances2.getByLabel('Экземпляр 2');

  // 1. Первое окно создаёт документ (rev 1) и сохраняет его.
  await page1.goto('/');
  await expect(page1.getByText('Сохранено')).toBeVisible();

  // 2. Второе окно восстанавливает устаревшую редакцию (rev 1).
  await page2.goto('/');
  await expect(instances2.getByText('Список пуст')).toHaveCount(2);

  // 3. Первое окно сохраняет новую редакцию (rev 2).
  await pane1.getByPlaceholder('Новый пункт').fill('Правка первого окна');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await expect(page1.getByText('Сохранено')).toBeVisible();

  // 4. Второе окно (память rev 1) сохраняет свою правку -> конфликт с rev 2.
  await pane2.getByPlaceholder('Новый пункт').fill('Правка второго окна');
  await pane2.getByRole('button', { name: 'Добавить' }).click();

  // Хранилище побеждает: второе окно перечитывает документ первого.
  await expect(
    page2.getByText('Обновлено из другого окна'),
  ).toBeVisible({ timeout: 15000 });
  await expect(pane2.getByText('Правка первого окна')).toBeVisible();

  await page1.close();
  await page2.close();
});

test('неизвестный тип показывает состояние без падения приложения', async ({ page }) => {
  await page.goto('/');
  const instances = page.getByRole('region', { name: 'Экземпляры виджетов' });
  await expect(instances.getByText('Неизвестный тип виджета')).toBeVisible();
  await expect(page.getByText('Каталог типов виджетов: 1')).toBeVisible();
});
