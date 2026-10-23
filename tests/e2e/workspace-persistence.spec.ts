import { expect, test } from '@playwright/test';

test('рабочее пространство восстанавливается после перезапуска', async ({
  page,
}) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log('PAGE_ERROR:', msg.text());
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();

  // Настройка: названия вкладок, содержимое, сворачивание, режим каскада.
  const tablist = page.getByRole('tablist', {
    name: 'Вкладки рабочего пространства',
  });
  const firstTab = tablist.getByRole('tab', { name: /Чек-листы/ });
  await firstTab.getByText('Чек-листы').dblclick();
  await page.getByLabel('Название вкладки').fill('Рабочая');
  await page.getByLabel('Название вкладки').press('Enter');

  const pane1 = page.getByRole('group', { name: 'Экземпляр 1 · Список 1' });
  await pane1.getByPlaceholder('Новая задача…').fill('Переживает перезапуск');
  await pane1.getByRole('button', { name: 'Добавить' }).click();

  await page
    .getByRole('group', { name: 'Экземпляр 3 · Список 2' })
    .getByRole('button', { name: 'Свернуть Экземпляр 3 · Список 2' })
    .click();

  await switchMode(page, 'Каскад');
  await expect(page.locator('.tab-surface:not([hidden]) .cascade-layout')).toBeVisible();

  // Вторая вкладка с окном плана, активной становится она.
  await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
  const secondTab = tablist.getByRole('tab', { name: /Новая вкладка/ });
  await secondTab.getByText('Новая вкладка').dblclick();
  await page.getByLabel('Название вкладки').fill('Планы');
  await page.getByLabel('Название вкладки').press('Enter');
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByLabel('Название нового документа')
    .fill('ОКАД');
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Создать' })
    .click();
  await expect(page.getByRole('group', { name: 'План · ОКАД' })).toBeVisible();

  // Хвост автосохранения документов и снапшота рабочего пространства.
  await page.waitForTimeout(900);
  await page.reload();

  // Вкладки: порядок, названия, активная.
  await expect(tablist.getByRole('tab', { name: /Рабочая/ })).toBeVisible();
  await expect(tablist.getByRole('tab', { name: /Планы/ })).toBeVisible();
  await expect(tablist.getByRole('tab', { name: /Планы/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Новая вкладка плана восстановлена в каскаде — новом режиме по умолчанию.
  await expect(page.getByRole('group', { name: 'План · ОКАД' })).toBeVisible();
  await expect(page.locator('.tab-surface:not([hidden]) .cascade-layout')).toBeVisible();

  // Первая вкладка: режим каскада, сворачивание, содержимое сохранены.
  // Клик по названию активирует саму вкладку.
  await tablist.getByRole('tab', { name: /Рабочая/ }).getByText('Рабочая').click();
  await expect(page.locator('.tab-surface:not([hidden]) .cascade-layout')).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Экземпляр 1 · Список 1' })
      .getByText('Переживает перезапуск'),
  ).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Экземпляр 3 · Список 2' })
      .getByRole('button', { name: 'Развернуть Экземпляр 3 · Список 2' }),
  ).toBeVisible();

  // Закрытие окна переживает перезапуск (свёрнутое окно закрывается из
  // заголовка), остальные окна остаются.
  await page
    .getByRole('group', { name: 'Экземпляр 3 · Список 2' })
    .getByRole('button', { name: 'Закрыть Экземпляр 3 · Список 2' })
    .click();
  await expect(
    page.getByRole('group', { name: 'Экземпляр 3 · Список 2' }),
  ).toHaveCount(0);
  await page.waitForTimeout(700);
  await page.reload();
  await tablist
    .getByRole('tab', { name: /Рабочая/ })
    .getByText('Рабочая')
    .click();
  await expect(
    page.getByRole('group', { name: 'Экземпляр 3 · Список 2' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: 'Экземпляр 1 · Список 1' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Экземпляр 1 · Список 1' })
      .getByText('Переживает перезапуск'),
  ).toBeVisible();

  await page.screenshot({
    path: 'test-results/screenshots/workspace-persistence.png',
    fullPage: false,
  });
});

async function switchMode(page: import('@playwright/test').Page, mode: 'Сетка' | 'Каскад'): Promise<void> {
  await page.getByRole('button', { name: mode }).click();
  await expect(page.getByRole('button', { name: mode })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(300);
}
