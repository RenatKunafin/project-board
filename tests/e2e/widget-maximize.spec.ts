import { expect, test, type Locator } from '@playwright/test';

// Спека PBT-071: разворачивание окна на весь дашборд — overlay-перенос
// без размонтирования, сокрытие соседей, сохранение геометрии раскладки,
// сброс сворачиванием и перезапуском (delta spec widget-windows ADDED).

const PANE_1 = 'Экземпляр 1 · Список 1';
const PANE_2 = 'Экземпляр 2 · Список 1';

async function isInMaximizeLayer(locator: Locator): Promise<boolean> {
  return locator.evaluate(
    (element) => element.closest('.widget-maximize-layer') !== null,
  );
}

test('разворот занимает вкладку и скрывает соседей без размонтирования', async ({
  page,
}) => {
  await page.goto('/');
  const pane1 = page.getByRole('group', { name: PANE_1 });
  const pane2 = page.getByRole('group', { name: PANE_2 });
  const layer = page.getByTestId('widget-maximize-layer');

  // Черновик соседа — свидетельство жизни состояния (keep-mounted).
  await pane2.getByPlaceholder('Новый пункт').fill('Черновик соседа');

  const tabpanelBox = await page
    .getByRole('tabpanel')
    .boundingBox();
  const pane1Box = await pane1.boundingBox();
  expect(tabpanelBox).not.toBeNull();
  expect(pane1Box).not.toBeNull();
  expect(pane1Box!.width).toBeLessThan(tabpanelBox!.width);

  await pane1
    .getByRole('button', { name: `Развернуть на весь дашборд ${PANE_1}` })
    .click();

  await expect(layer).toBeVisible();
  expect(await isInMaximizeLayer(pane1)).toBe(true);
  // Развёрнутое окно покрывает область вкладки (допуск на границы).
  const maximizedBox = await pane1.boundingBox();
  expect(maximizedBox!.width).toBeGreaterThan(tabpanelBox!.width - 8);
  expect(maximizedBox!.height).toBeGreaterThan(tabpanelBox!.height - 8);
  // Панель вкладок остаётся видимой (каркас не скрывается).
  await expect(page.getByRole('tablist')).toBeVisible();
  // Сосед скрыт (display: none), но смонтирован.
  await expect(pane2).toBeHidden();

  await pane1
    .getByRole('button', { name: `Вернуть прежний размер ${PANE_1}` })
    .click();

  await expect(layer).toBeHidden();
  expect(await isInMaximizeLayer(pane1)).toBe(false);
  const restoredBox = await pane1.boundingBox();
  expect(Math.round(restoredBox!.x)).toBe(Math.round(pane1Box!.x));
  expect(Math.round(restoredBox!.y)).toBe(Math.round(pane1Box!.y));
  expect(Math.round(restoredBox!.width)).toBe(Math.round(pane1Box!.width));
  await expect(pane2).toBeVisible();
  await expect(pane2.getByPlaceholder('Новый пункт')).toHaveValue(
    'Черновик соседа',
  );
});

test('сворачивание развёрнутого окна возвращает обычный вид', async ({
  page,
}) => {
  await page.goto('/');
  const pane1 = page.getByRole('group', { name: PANE_1 });
  const layer = page.getByTestId('widget-maximize-layer');

  await pane1
    .getByRole('button', { name: `Развернуть на весь дашборд ${PANE_1}` })
    .click();
  await expect(layer).toBeVisible();

  await pane1.getByRole('button', { name: `Свернуть ${PANE_1}` }).click();

  await expect(layer).toBeHidden();
  expect(await isInMaximizeLayer(pane1)).toBe(false);
  // Окно свёрнуто заголовком в обычной раскладке.
  await expect(pane1.getByPlaceholder('Новый пункт')).toBeHidden();
  await expect(
    pane1.getByRole('button', { name: `Развернуть ${PANE_1}` }),
  ).toBeVisible();
});

test('разворот свёрнутого окна показывает содержимое (сценарий владельца)', async ({
  page,
}) => {
  await page.goto('/');
  const pane1 = page.getByRole('group', { name: PANE_1 });
  const layer = page.getByTestId('widget-maximize-layer');

  // Разворот → сворачивание (шеврон) → повторный разворот свёрнутого.
  await pane1
    .getByRole('button', { name: `Развернуть на весь дашборд ${PANE_1}` })
    .click();
  await expect(layer).toBeVisible();

  await pane1.getByRole('button', { name: `Свернуть ${PANE_1}` }).click();
  await expect(layer).toBeHidden();
  await expect(pane1.getByPlaceholder('Новый пункт')).toBeHidden();

  await pane1
    .getByRole('button', { name: `Развернуть на весь дашборд ${PANE_1}` })
    .click();
  await expect(layer).toBeVisible();
  expect(await isInMaximizeLayer(pane1)).toBe(true);
  // Развёрнутое свёрнутое окно показывает содержимое, а не пустой заголовок.
  await expect(pane1.getByPlaceholder('Новый пункт')).toBeVisible();

  // Возврат прежнего размера возвращает свёрнутый вид в раскладке.
  await pane1
    .getByRole('button', { name: `Вернуть прежний размер ${PANE_1}` })
    .click();
  await expect(layer).toBeHidden();
  await expect(pane1.getByPlaceholder('Новый пункт')).toBeHidden();
});

test('разворот Гантта: задачи видимы, шкала не уезжает влево', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  // План с задачами в октябре (контрольный формат PlanContent v1).
  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByLabel('Название нового документа').fill('Разворот Гантта');
  await choice.getByRole('button', { name: 'Создать' }).click();
  const pane = page.getByRole('group', { name: 'План · Разворот Гантта' });
  await expect(pane).toBeVisible();
  const documentId = await pane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  await page.evaluate(
    ({ id, content }) => window.__projectBoard?.writeDocumentContent(id, content),
    {
      id: documentId,
      content: {
        title: 'Разворот Гантта',
        calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
        workTypes: [], resources: [], groups: [],
        tasks: [
          { id: 't1', title: 'Задача A', start: '2026-10-05', end: '2026-10-12' },
          { id: 't2', title: 'Задача B', start: '2026-10-15', end: '2026-10-22' },
        ],
        dependencies: [], unavailability: [],
      },
    },
  );
  await expect(pane.getByText('Задача A').first()).toBeVisible();

  // Разворот: план остаётся у левого края — задачи видимы (PBT-071:
  // SVAR-виртуализация сбрасывала шкалу к пустому запасу слева).
  await pane
    .getByRole('button', { name: 'Развернуть на весь дашборд План · Разворот Гантта' })
    .click();
  await expect(page.getByTestId('widget-maximize-layer')).toBeVisible();
  await expect(pane.getByText('Задача A').first()).toBeVisible({ timeout: 5000 });

  // Сворачивание и повторный разворот свёрнутого окна (сценарий владельца):
  // содержимое показывается, задачи на месте.
  await pane
    .getByRole('button', { name: 'Свернуть План · Разворот Гантта' })
    .click();
  await expect(page.getByTestId('widget-maximize-layer')).toBeHidden();
  await pane
    .getByRole('button', { name: 'Развернуть на весь дашборд План · Разворот Гантта' })
    .click();
  await expect(page.getByTestId('widget-maximize-layer')).toBeVisible();
  await expect(pane.getByText('Задача A').first()).toBeVisible({ timeout: 5000 });

  await pane
    .getByRole('button', { name: 'Вернуть прежний размер План · Разворот Гантта' })
    .click();
  await expect(page.getByTestId('widget-maximize-layer')).toBeHidden();
  // Возврат из разворота свёрнутого окна возвращает свёрнутый вид:
  // раскрываем и убеждаемся, что представление живо.
  await pane
    .getByRole('button', { name: 'Развернуть План · Разворот Гантта' })
    .click();
  await expect(pane.getByText('Задача A').first()).toBeVisible({ timeout: 5000 });
});

test('перезапуск восстанавливает окно в обычном виде', async ({ page }) => {
  await page.goto('/');
  const pane1 = page.getByRole('group', { name: PANE_1 });
  const layer = page.getByTestId('widget-maximize-layer');

  await pane1
    .getByRole('button', { name: `Развернуть на весь дашборд ${PANE_1}` })
    .click();
  await expect(layer).toBeVisible();

  await page.reload();
  const restoredPane = page.getByRole('group', { name: PANE_1 });

  await expect(page.getByTestId('widget-maximize-layer')).toBeHidden();
  expect(await isInMaximizeLayer(restoredPane)).toBe(false);
  const box = await restoredPane.boundingBox();
  const tabpanelBox = await page.getByRole('tabpanel').boundingBox();
  // Обычный вид: окно заведомо уже всей области вкладки.
  expect(box!.width).toBeLessThan(tabpanelBox!.width);
});

test('каскад: геометрия окна сохраняется после возврата', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Каскад' }).click();

  const pane1 = page.getByRole('group', { name: PANE_1 });
  const before = await pane1.boundingBox();
  expect(before).not.toBeNull();

  await pane1
    .getByRole('button', { name: `Развернуть на весь дашборд ${PANE_1}` })
    .click();
  await expect(page.getByTestId('widget-maximize-layer')).toBeVisible();

  await pane1
    .getByRole('button', { name: `Вернуть прежний размер ${PANE_1}` })
    .click();

  const after = await pane1.boundingBox();
  expect(Math.round(after!.x)).toBe(Math.round(before!.x));
  expect(Math.round(after!.y)).toBe(Math.round(before!.y));
  expect(Math.round(after!.width)).toBe(Math.round(before!.width));
  expect(Math.round(after!.height)).toBe(Math.round(before!.height));
});
