import { restoreChecklistWorkspace } from './saved-workspace';
import { expect, test } from '@playwright/test';
import { persistedDocument, storedWorkspace } from './workspace-helper';

test('операция синхронизирует экземпляры 1-2 и не задевает список 2', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const pane1 = page.getByLabel('Экземпляр 1 · Список 1');
  const pane2 = page.getByLabel('Экземпляр 2 · Список 1');
  const pane3 = page.getByLabel('Экземпляр 3 · Список 2');

  await pane1.getByPlaceholder('Новая задача…').fill('Из первого списка');
  await pane1.getByRole('button', { name: 'Добавить' }).click();

  await expect(pane2.getByText('Из первого списка')).toBeVisible();
  await expect(pane3.getByText('Из первого списка')).toHaveCount(0);

  await pane3.getByPlaceholder('Новая задача…').fill('Из второго списка');
  await pane3.getByRole('button', { name: 'Добавить' }).click();
  await expect(pane3.getByText('Из второго списка')).toBeVisible();
  await expect(pane1.getByText('Из второго списка')).toHaveCount(0);
});

test('локальная настройка экземпляра изолирована', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const pane1 = page.getByLabel('Экземпляр 1 · Список 1');
  const pane2 = page.getByLabel('Экземпляр 2 · Список 1');

  await pane1.getByPlaceholder('Новая задача…').fill('Выполненный пункт');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await pane1.getByRole('checkbox', { name: 'Выполненный пункт' }).check();

  await pane1.getByRole('button', { name: 'Скрыть выполненные' }).click();
  // В нажатом состоянии кнопка зовёт «Показать выполненные» (ревью PR#54).
  await expect(
    pane1.getByRole('button', { name: 'Показать выполненные' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(pane1.getByText('Выполненный пункт')).toHaveCount(0);
  await expect(pane2.getByText('Выполненный пункт')).toBeVisible();

  await pane1
    .getByRole('button', { name: 'Показать выполненные' })
    .click();
  await expect(pane1.getByText('Выполненный пункт')).toBeVisible();
});

test('новая вкладка активна и пуста; переключение сохраняет наборы', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const tablist = page.getByRole('tablist', {
    name: 'Вкладки рабочего пространства',
  });

  await expect(tablist.getByRole('tab', { selected: true })).toContainText('Чек-листы');
  await expect(page.getByRole('group', { name: 'Экземпляр 1 · Список 1' })).toBeVisible();
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
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
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

test('вкладки без стрелок сохраняют порядок создания после reload', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  const tablist = page.getByRole('tablist', { name: 'Вкладки рабочего пространства' });
  await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
  await tablist.getByRole('tab').first().hover();
  await expect(tablist.getByRole('button', { name: /Переместить.*(влево|вправо)/ })).toHaveCount(0);
  await expect(tablist.locator('.tab__move')).toHaveCount(0);
  await expect.poll(async () => (await storedWorkspace(page)).tabs
    .sort((a, b) => a.position - b.position).map(tab => tab.title)).toEqual(['Чек-листы', 'Новая вкладка']);
  await page.reload();
  const tabs = tablist.getByRole('tab');
  await expect(tabs.nth(0)).toContainText('Чек-листы');
  await expect(tabs.nth(1)).toContainText('Новая вкладка');
  await expect(tablist.getByRole('button', { name: /Переместить.*(влево|вправо)/ })).toHaveCount(0);
});

test('документ закрытой вкладки доступен для повторного открытия', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const tablist = page.getByRole('tablist', {
    name: 'Вкладки рабочего пространства',
  });
  const pane1 = page.getByLabel('Экземпляр 1 · Список 1');
  await pane1.getByPlaceholder('Новая задача…').fill('Документ жив');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Сохраняется…')).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });
  await persistedDocument(page, 'Список 1', { items: [{ text: 'Документ жив' }] });

  await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
  await expect(page.getByText('Пустой дашборд')).toBeVisible();

  await tablist
    .getByRole('button', { name: 'Закрыть Чек-листы' })
    .click();
  await expect(tablist.getByRole('tab', { name: /Чек-листы/ })).toHaveCount(0);
  await expect(tablist.getByRole('tab', { selected: true })).toContainText(
    'Новая вкладка',
  );

  // Ждём отложенный снапшот: иначе reload проверяет прежнее состояние БД.
  await expect.poll(async () => (await storedWorkspace(page)).tabs.map(tab => tab.title)).toEqual(['Новая вкладка']);
  // Закрытая вкладка и её окна не восстанавливаются, сам документ доступен.
  await page.reload();
  await expect(page.locator('.widget-window')).toHaveCount(0);
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: 'Чек-лист', exact: true }).click();
  await catalog.getByRole('button', { name: 'Список 1', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Чек-лист · Список 1', exact: true })
    .getByText('Документ жив', { exact: true })).toBeVisible();
});

test('единственная вкладка не показывает кнопку закрытия', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Закрыть Чек-листы/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Чек-листы/ })).toBeVisible();
});

test('клавиатура: стрелка вправо активирует соседнюю вкладку', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
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
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const tablist = page.getByRole('tablist', { name: 'Вкладки рабочего пространства' });
  await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
  await expect(page.getByText('Пустой дашборд')).toBeVisible();

  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await expect(catalog.getByRole('button', { name: 'Чек-лист', exact: true }).locator('svg.lucide-list-todo')).toBeVisible();
  await catalog.getByRole('button', { name: /Чек-лист/ }).click();

  // Пикер документа открывается в той же dropdown-панели.
  const picker = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await picker.getByLabel('Название нового документа').fill('Покупки');
  await picker.getByRole('button', { name: 'Создать' }).click();

  const pane = page.getByRole('group', { name: 'Чек-лист · Покупки' });
  await expect(pane).toBeVisible();
  await expect(pane.getByPlaceholder('Новая задача…')).toBeVisible();
});

test('каталог: второе представление существующего документа', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const pane1 = page.getByLabel('Экземпляр 1 · Список 1');
  await pane1.getByPlaceholder('Новая задача…').fill('Общий пункт');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();

  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /Чек-лист/ })
    .click();

  const picker = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await picker.getByRole('button', { name: 'Список 1' }).click();

  const secondView = page.getByRole('group', { name: 'Чек-лист · Список 1' });
  await expect(secondView.getByText('Общий пункт')).toBeVisible();

  await secondView.getByPlaceholder('Новая задача…').fill('Второе представление');
  await secondView.getByRole('button', { name: 'Добавить' }).click();
  await expect(pane1.getByText('Второе представление')).toBeVisible();
});

test('каталог: отмена не создаёт документов и экземпляров', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const catalogButton = page.getByRole('button', { name: 'Виджеты', exact: true });
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

test('производный прогресс: счётчик и полоса из документа (PBT-075)', async ({
  page,
}) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const pane = page.getByLabel('Экземпляр 1 · Список 1');
  const progress = pane.locator('[data-checklist-progress]');
  const bar = pane.locator('[data-checklist-progress-bar]');

  // Пустой список: нулевой прогресс, полоса пустая.
  await expect(progress).toContainText('0/0 выполнено (0%)');
  await expect(bar).toHaveCSS('width', '0px');

  // Сценарий карточки: 3 пункта, 2 выполнено → 67%.
  for (const text of ['Собрать метрики', 'Обновить документацию', 'Подготовить демо']) {
    await pane.getByPlaceholder('Новая задача…').fill(text);
    await pane.getByRole('button', { name: 'Добавить' }).click();
  }
  const boxes = pane.locator('.checklist__item input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(progress).toContainText('2/3 выполнено (67%)');
  // Полоса анимируется (transition width — прототип): ждём стабилизации.
  await expect
    .poll(async () =>
      bar.evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBeGreaterThan(20); // ≈ две трети дорожки
});

test('скрытие выполненных переживает reload (PBT-075)', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const pane = page.getByLabel('Экземпляр 1 · Список 1');
  const toggle = pane.getByRole('button', { name: 'Скрыть выполненные' });

  await pane.getByPlaceholder('Новая задача…').fill('Выполненный пункт');
  await pane.getByRole('button', { name: 'Добавить' }).click();
  await pane
    .locator('.checklist__item input[type="checkbox"]')
    .first()
    .check();
  await expect(pane.locator('[data-checklist-progress]')).toContainText(
    '1/1 выполнено (100%)',
  );

  // Настройка — persisted-состояние экземпляра: до PBT-075 флаг был
  // in-memory и reload терял его. В нажатом состоянии кнопка зовёт
  // «Показать выполненные» (ревью PR#54).
  await toggle.click();
  const toggleOn = pane.getByRole('button', {
    name: 'Показать выполненные',
  });
  await expect(toggleOn).toHaveAttribute('aria-pressed', 'true');
  await expect(pane.getByText('Выполненный пункт')).toHaveCount(0);
  await expect(pane.getByText('Все пункты выполнены.')).toBeVisible();

  await expect.poll(async () => {
    const workspace = await storedWorkspace(page);
    return workspace.tabs.length === 1 && workspace.tabs[0]?.mode === 'grid' &&
      workspace.widgetInstances.some(instance => instance.id === 'w-1') &&
      (workspace.settings.find(row => row.key === 'view:w-1')?.value as { hideDone?: boolean })?.hideDone === true;
  }).toBe(true);
  await persistedDocument(page, 'Список 1', { items: [{ text: 'Выполненный пункт', done: true }] });
  await page.reload();
  const paneAfter = page.getByLabel('Экземпляр 1 · Список 1');
  // После reload флаг включён: кнопка в нажатом состоянии — «Показать…».
  const toggleAfter = paneAfter.getByRole('button', {
    name: 'Показать выполненные',
  });
  await expect(toggleAfter).toHaveAttribute('aria-pressed', 'true');
  await expect(paneAfter.getByText('Выполненный пункт')).toHaveCount(0);
});
