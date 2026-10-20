import { expect, test } from '@playwright/test';

test('оболочка приложения открывается', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Project Board');
  await expect(page.getByRole('heading', { name: 'Project Board' })).toBeVisible();
});

test('вкладка «Чек-листы» активна по умолчанию и содержит срез', async ({ page }) => {
  await page.goto('/');
  const tablist = page.getByRole('tablist', {
    name: 'Вкладки рабочего пространства',
  });
  await expect(tablist.getByRole('tab', { name: /Чек-листы/ })).toBeVisible();
  await expect(tablist.getByRole('tab', { selected: true })).toContainText(
    'Чек-листы',
  );
  await expect(page.getByRole('group', { name: 'Экземпляр 1 · Список 1' })).toBeVisible();
});

test('операция синхронизирует экземпляры 1-2 и не задевает список 2', async ({ page }) => {
  await page.goto('/');
  const pane1 = page.getByLabel('Экземпляр 1 · Список 1');
  const pane2 = page.getByLabel('Экземпляр 2 · Список 1');
  const pane3 = page.getByLabel('Экземпляр 3 · Список 2');

  await pane1.getByPlaceholder('Новый пункт').fill('Из первого списка');
  await pane1.getByRole('button', { name: 'Добавить' }).click();

  await expect(pane2.getByText('Из первого списка')).toBeVisible();
  await expect(pane3.getByText('Из первого списка')).toHaveCount(0);

  await pane3.getByPlaceholder('Новый пункт').fill('Из второго списка');
  await pane3.getByRole('button', { name: 'Добавить' }).click();
  await expect(pane3.getByText('Из второго списка')).toBeVisible();
  await expect(pane1.getByText('Из второго списка')).toHaveCount(0);
});

test('локальная настройка экземпляра изолирована', async ({ page }) => {
  await page.goto('/');
  const pane1 = page.getByLabel('Экземпляр 1 · Список 1');
  const pane2 = page.getByLabel('Экземпляр 2 · Список 1');

  await pane1.getByPlaceholder('Новый пункт').fill('Выполненный пункт');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await pane1.getByRole('checkbox', { name: 'Выполненный пункт' }).check();

  await pane1.getByRole('checkbox', { name: 'Скрывать выполненные' }).check();
  await expect(pane1.getByText('Выполненный пункт')).toHaveCount(0);
  await expect(pane2.getByText('Выполненный пункт')).toBeVisible();

  await pane1
    .getByRole('checkbox', { name: 'Скрывать выполненные' })
    .uncheck();
  await expect(pane1.getByText('Выполненный пункт')).toBeVisible();
});

test('закрытие и перезагрузка сохраняют документ', async ({ page }) => {
  await page.goto('/');
  const pane1 = page.getByLabel('Экземпляр 1 · Список 1');

  await pane1.getByPlaceholder('Новый пункт').fill('Переживает закрытие');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  // Ждём старт именно тестовой записи: «Сохранено» может висеть от bootstrap.
  await expect(page.getByText('Сохраняется…')).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1500); // дебаунс 250мс + запись IDB (PBT-016: до ~500мс) — иначе reload обрывает запись

  await pane1.getByRole('button', { name: 'Закрыть Экземпляр 1 · Список 1' }).click();
  await expect(page.getByLabel('Экземпляр 1 · Список 1')).toHaveCount(0);

  await page.reload();
  // Документ открыт в двух экземплярах — текст ищем в конкретной панели.
  await expect(
    page
      .getByLabel('Экземпляр 1 · Список 1')
      .getByText('Переживает закрытие'),
  ).toBeVisible({ timeout: 10000 });
});

test('новая вкладка активна и пуста; переключение сохраняет наборы', async ({ page }) => {
  await page.goto('/');
  const tablist = page.getByRole('tablist', {
    name: 'Вкладки рабочего пространства',
  });

  await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
  const newTab = tablist.getByRole('tab', { name: /Новая вкладка/ });
  await expect(newTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Пустой дашборд')).toBeVisible();

  await tablist.getByRole('tab', { name: /Чек-листы/ }).click();
  await expect(
    page.getByRole('group', { name: 'Экземпляр 1 · Список 1' }),
  ).toBeVisible();

  await newTab.click();
  await expect(page.getByText('Пустой дашборд')).toBeVisible();
});

test('вкладка переименовывается по двойному клику', async ({ page }) => {
  await page.goto('/');
  const tablist = page.getByRole('tablist', {
    name: 'Вкладки рабочего пространства',
  });
  const tab = tablist.getByRole('tab', { name: /Чек-листы/ });

  await tab.getByText('Чек-листы').dblclick();
  await page.getByLabel('Название вкладки').fill('План ОКАД');
  await page.getByLabel('Название вкладки').press('Enter');

  await expect(tablist.getByRole('tab', { name: /План ОКАД/ })).toContainText(
    'План ОКАД',
  );
});

test('порядок вкладок меняется кнопками перемещения', async ({ page }) => {
  await page.goto('/');
  const tablist = page.getByRole('tablist', {
    name: 'Вкладки рабочего пространства',
  });

  await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
  await tablist
    .getByRole('button', { name: 'Переместить Новая вкладка влево' })
    .click();

  const tabs = tablist.getByRole('tab');
  await expect(tabs.nth(0)).toContainText('Новая вкладка');
  await expect(tabs.nth(1)).toContainText('Чек-листы');
});

test('удаление активной вкладки делает активной соседнюю, документ жив', async ({ page }) => {
  await page.goto('/');
  const tablist = page.getByRole('tablist', {
    name: 'Вкладки рабочего пространства',
  });
  const pane1 = page.getByLabel('Экземпляр 1 · Список 1');
  await pane1.getByPlaceholder('Новый пункт').fill('Документ жив');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Сохраняется…')).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1500); // дебаунс 250мс + запись IDB (PBT-016: до ~500мс) — иначе reload обрывает запись

  await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
  await expect(page.getByText('Пустой дашборд')).toBeVisible();

  await tablist
    .getByRole('button', { name: 'Закрыть Чек-листы' })
    .click({ force: true });
  await expect(tablist.getByRole('tab', { name: /Чек-листы/ })).toHaveCount(0);
  await expect(tablist.getByRole('tab', { selected: true })).toContainText(
    'Новая вкладка',
  );

  // Документ пережил удаление вкладки: перезагрузка восстанавливает его.
  // Он открыт в двух экземплярах — текст ищем в конкретной панели.
  await page.reload();
  await expect(
    page.getByLabel('Экземпляр 1 · Список 1').getByText('Документ жив'),
  ).toBeVisible({ timeout: 10000 });
});

test('последняя вкладка не удаляется (кнопка disabled)', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /Закрыть Чек-листы/ }),
  ).toBeDisabled();
  await expect(page.getByRole('tab', { name: /Чек-листы/ })).toBeVisible();
});

test('клавиатура: стрелка вправо активирует соседнюю вкладку', async ({ page }) => {
  await page.goto('/');
  const tablist = page.getByRole('tablist', {
    name: 'Вкладки рабочего пространства',
  });
  await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
  await tablist.getByRole('tab', { name: /Чек-листы/ }).click();

  const firstTab = tablist.getByRole('tab', { name: /Чек-листы/ });
  await firstTab.focus();
  await page.keyboard.press('ArrowRight');

  await expect(
    tablist.getByRole('tab', { name: /Новая вкладка/ }),
  ).toHaveAttribute('aria-selected', 'true');
});

test('каталог: новый чек-лист создаётся из пустой вкладки', async ({ page }) => {
  await page.goto('/');
  const tablist = page.getByRole('tablist', { name: 'Вкладки рабочего пространства' });
  await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
  await expect(page.getByText('Пустой дашборд')).toBeVisible();

  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await expect(catalog.getByText('☑️')).toBeVisible();
  await catalog.getByRole('button', { name: /Чек-лист/ }).click();

  // Пикер документа открывается в той же dropdown-панели.
  const picker = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await picker.getByLabel('Название нового документа').fill('Покупки');
  await picker.getByRole('button', { name: 'Создать' }).click();

  const pane = page.getByRole('group', { name: 'Чек-лист · Покупки' });
  await expect(pane).toBeVisible();
  await expect(pane.getByPlaceholder('Новый пункт')).toBeVisible();
});

test('каталог: второе представление существующего документа', async ({ page }) => {
  await page.goto('/');
  const pane1 = page.getByLabel('Экземпляр 1 · Список 1');
  await pane1.getByPlaceholder('Новый пункт').fill('Общий пункт');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();

  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /Чек-лист/ })
    .click();

  const picker = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await picker.getByRole('button', { name: 'Список 1' }).click();

  const secondView = page.getByRole('group', { name: 'Чек-лист · Список 1' });
  await expect(secondView.getByText('Общий пункт')).toBeVisible();

  await secondView.getByPlaceholder('Новый пункт').fill('Второе представление');
  await secondView.getByRole('button', { name: 'Добавить' }).click();
  await expect(pane1.getByText('Второе представление')).toBeVisible();
});

test('каталог: отмена не создаёт документов и экземпляров', async ({ page }) => {
  await page.goto('/');
  const catalogButton = page.getByRole('button', { name: 'Добавить виджет', exact: true });
  const catalogDialog = page.getByRole('dialog', { name: 'Каталог виджетов' });

  await catalogButton.click();
  await catalogDialog.getByRole('button', { name: /Чек-лист/ }).click();
  const pickerItems = catalogDialog.getByRole('button', { name: /^Список / });
  const countBefore = await pickerItems.count();

  // Отмена: Escape закрывает dropdown-панель.
  await page.keyboard.press('Escape');
  await expect(catalogDialog).toHaveCount(0);

  // Повторное открытие: документ от отмены не создан.
  await catalogButton.click();
  await catalogDialog.getByRole('button', { name: /Чек-лист/ }).click();
  await expect(
    catalogDialog.getByRole('button', { name: /^Список / }),
  ).toHaveCount(countBefore);
  await expect(
    page.getByRole('group', { name: 'Чек-лист · Список 1' }),
  ).toHaveCount(0);
});
