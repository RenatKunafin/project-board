import { restoreChecklistWorkspace } from './saved-workspace';
import { expect, test, type Page } from '@playwright/test';

async function paneBox(page: Page, label: string) {
  const pane = page.getByRole('group', { name: label });
  await expect(pane).toBeVisible();
  const box = await pane.boundingBox();
  if (!box) {
    throw new Error(`Нет boundingBox у «${label}»`);
  }
  return box;
}

async function switchMode(page: Page, mode: 'Сетка' | 'Каскад'): Promise<void> {
  await page.getByRole('button', { name: mode }).click();
  await expect(
    page.getByRole('button', { name: mode }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
}

test('режим принадлежит вкладке: смена не затрагивает другие вкладки', async ({
  page,
}) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await page.getByRole('button', { name: 'Новая вкладка' }).click();
  // На новой вкладке нужно окно — иначе она показывает пустое состояние.
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /Чек-лист/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByLabel('Название нового документа')
    .fill('Вторая вкладка');
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Создать' })
    .click();
  await expect(
    page.getByRole('group', { name: 'Чек-лист · Вторая вкладка' }),
  ).toBeVisible();

  await switchMode(page, 'Каскад');
  await expect(page.locator('.cascade-layout')).toBeVisible();
  // Keep-mounted (PBT-027): сетка скрытой вкладки остаётся в DOM, но скрыта.
  await expect(
    page.locator('.tab-surface:not([hidden]) .tiled-grid'),
  ).toHaveCount(0);

  // Вторая вкладка остаётся в сетке, управление отражает её режим.
  await page
    .getByRole('tablist')
    .getByRole('tab', { name: /Чек-листы/ })
    .click();
  await expect(
    page.locator('.tab-surface:not([hidden]) .tiled-grid'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Сетка' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('тайлинг → каскад → изменение состава → сетка → каскад (сценарий карточки)', async ({
  page,
}) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const label1 = 'Экземпляр 1 · Список 1';
  const label3 = 'Экземпляр 3 · Список 2';

  // Сетка: запоминаем области, добавляем пункт в документ.
  const gridBefore = await paneBox(page, label1);
  const pane1 = page.getByRole('group', { name: label1 });
  await pane1.getByPlaceholder('Новая задача…').fill('Живёт через смены режимов');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Сохраняется…')).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });

  // Каскад: перемещаем окно 3, добавляем новое окно, закрываем окно 2.
  await switchMode(page, 'Каскад');
  const cascadeBefore = await paneBox(page, label3);
  const head = page
    .getByRole('group', { name: label3 })
    .locator('.widget-window__head');
  const headBox = await head.boundingBox();
  await page.mouse.move(headBox.x + 40, headBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(headBox.x + 40 + 220, headBox.y + 10 + 150, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const cascadeMoved = await paneBox(page, label3);
  expect(cascadeMoved.x).toBeGreaterThan(cascadeBefore.x);

  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /Чек-лист/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Список 1' })
    .click();
  await expect(
    page.getByRole('group', { name: 'Чек-лист · Список 1' }),
  ).toBeVisible();

  await page
    .getByRole('group', { name: 'Экземпляр 2 · Список 1' })
    .getByRole('button', { name: 'Закрыть Экземпляр 2 · Список 1' })
    .click();
  await expect(
    page.getByRole('group', { name: 'Экземпляр 2 · Список 1' }),
  ).toHaveCount(0);

  // Сетка: прежние области, закрытого нет, новое окно в стартовой области.
  await switchMode(page, 'Сетка');
  const gridAfter = await paneBox(page, label1);
  expect(Math.abs(gridAfter.x - gridBefore.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(gridAfter.y - gridBefore.y)).toBeLessThanOrEqual(4);
  await expect(
    page.getByRole('group', { name: 'Экземпляр 2 · Список 1' }),
  ).toHaveCount(0);
  const newPane = page.getByRole('group', { name: 'Чек-лист · Список 1' });
  await expect(newPane).toBeVisible();
  const newBox = await newPane.boundingBox();
  expect(newBox?.width).toBeGreaterThan(100);

  // Содержимое пережило обе смены режима.
  await expect(
    page.getByRole('group', { name: label1 }).getByText('Живёт через смены режимов'),
  ).toBeVisible();

  // Каскад: перемещённая позиция окна 3 сохранена, закрытого нет.
  await switchMode(page, 'Каскад');
  const cascadeRestored = await paneBox(page, label3);
  expect(Math.abs(cascadeRestored.x - cascadeMoved.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(cascadeRestored.y - cascadeMoved.y)).toBeLessThanOrEqual(4);
  await expect(
    page.getByRole('group', { name: 'Экземпляр 2 · Список 1' }),
  ).toHaveCount(0);
});

test('сворачивание переживает смену режима', async ({ page }) => {
  await restoreChecklistWorkspace(page);
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const label = 'Экземпляр 1 · Список 1';

  await page
    .getByRole('group', { name: label })
    .getByRole('button', { name: `Свернуть ${label}` })
    .click();

  await switchMode(page, 'Каскад');
  await expect(
    page
      .getByRole('group', { name: label })
      .getByRole('button', { name: `Развернуть ${label}` }),
  ).toBeVisible();

  await switchMode(page, 'Сетка');
  await expect(
    page
      .getByRole('group', { name: label })
      .getByRole('button', { name: `Развернуть ${label}` }),
  ).toBeVisible();

  await page
    .getByRole('group', { name: label })
    .getByRole('button', { name: `Развернуть ${label}` })
    .click();
  await expect(
    page.getByRole('group', { name: label }).getByPlaceholder('Новая задача…'),
  ).toBeVisible();
});
