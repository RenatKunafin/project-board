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

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function addSecondChecklist(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /Чек-лист/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Список 1' })
    .click();
}

test('перенос за заголовок двигает окно, соседи не перекрываются', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await addSecondChecklist(page);

  const labels = [
    'Экземпляр 1 · Список 1',
    'Экземпляр 2 · Список 1',
    'Экземпляр 3 · Список 2',
    'Чек-лист · Список 1',
  ];
  const before = await Promise.all(labels.map((label) => paneBox(page, label)));

  const head = page
    .getByRole('group', { name: labels[0] })
    .locator('.widget-window__head');
  const headBox = await head.boundingBox();
  if (!headBox) {
    throw new Error('Нет заголовка');
  }
  await page.mouse.move(headBox.x + headBox.width / 2, headBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(headBox.x + headBox.width / 2 + 340, headBox.y + 400, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForTimeout(700); // переходы RGL ~200мс + пересборка компакт-раскладки

  const after = await Promise.all(labels.map((label) => paneBox(page, label)));
  const moved = after[0];
  // Перенос вниз-вправо: окно занимает слот ниже, соседи сдвигаются.
  expect(moved.x).toBeGreaterThan(before[0].x + 100);
  expect(moved.y).toBeGreaterThan(before[0].y + 20);

  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      expect(overlaps(after[i], after[j]), `${labels[i]} × ${labels[j]}`).toBe(
        false,
      );
    }
  }
});

test('поле ввода не переносит окно', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  const before = await paneBox(page, 'Экземпляр 1 · Список 1');
  const input = page
    .getByRole('group', { name: 'Экземпляр 1 · Список 1' })
    .getByPlaceholder('Новая задача…');
  const inputBox = await input.boundingBox();
  if (!inputBox) {
    throw new Error('Нет поля ввода');
  }
  await page.mouse.move(inputBox.x + 20, inputBox.y + inputBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(inputBox.x + 260, inputBox.y + 200, { steps: 10 });
  await page.mouse.up();

  const after = await paneBox(page, 'Экземпляр 1 · Список 1');
  expect(Math.abs(after.x - before.x)).toBeLessThan(8);
  expect(Math.abs(after.y - before.y)).toBeLessThan(8);
  await expect(input).toBeVisible();
});

test('resize соблюдает минимальный размер типа', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  const pane = page.getByRole('group', { name: 'Экземпляр 1 · Список 1' });
  // Уголок resize рендерит адаптер внутри item сетки, рядом с рамкой окна.
  const handle = page
    .locator('.react-grid-item')
    .filter({ has: pane })
    .locator('.react-resizable-handle-se');
  const initial = await paneBox(page, 'Экземпляр 1 · Список 1');
  const handleBox = await handle.boundingBox();
  if (!handleBox) {
    throw new Error('Нет уголка resize');
  }

  // Два сжатия подряд: второе не меняет размер — упёрлись в минимум 2×2.
  for (const step of [700, 700]) {
    // Точка внутри уголка (его якорь — правый нижний угол окна).
    await page.mouse.move(handleBox.x + 4, handleBox.y + 4);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 4 - step, handleBox.y + 4 - step, {
      steps: 10,
    });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }

  const squeezed = await paneBox(page, 'Экземпляр 1 · Список 1');
  expect(squeezed.width).toBeLessThan(initial.width);
  const grid = page.locator('.tiled-grid');
  const gridBox = await grid.boundingBox();
  if (!gridBox) {
    throw new Error('Нет сетки');
  }
  // Минимум типа — 2 колонки: ширина двух колонок плюс один отступ сетки.
  const gap = 12;
  const columnWidth = (gridBox.width - 13 * gap) / 12;
  const minWidth = columnWidth * 2 + gap;
  expect(squeezed.width).toBeGreaterThanOrEqual(minWidth - 6);
});

test('сворачивание сжимает окно до строки, разворачивание возвращает высоту', async ({
  page,
}) => {
  await page.goto('/');
  const label = 'Экземпляр 1 · Список 1';
  const expanded = await paneBox(page, label);

  await page
    .getByRole('group', { name: label })
    .getByRole('button', { name: `Свернуть ${label}` })
    .click();
  await page.waitForTimeout(400);
  const collapsed = await paneBox(page, label);
  expect(collapsed.height).toBeLessThan(120);

  await page
    .getByRole('group', { name: label })
    .getByRole('button', { name: `Развернуть ${label}` })
    .click();
  await page.waitForTimeout(400);
  const restored = await paneBox(page, label);
  expect(Math.abs(restored.height - expanded.height)).toBeLessThanOrEqual(4);
});

test('шесть окон прокручиваются; раскладка видна на скриншоте', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await addSecondChecklist(page);
  for (let extra = 0; extra < 2; extra += 1) {
    await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Каталог виджетов' })
      .getByRole('button', { name: /Чек-лист/ })
      .click();
    await page
      .getByRole('dialog', { name: 'Каталог виджетов' })
      .getByRole('button', { name: 'Список 1' })
      .click();
    await page.waitForTimeout(150);
  }

  const grid = page.locator('.tiled-grid');
  await expect(grid.locator('.react-grid-item')).toHaveCount(6);
  // Прокрутку пространства вкладки даёт .instances при переполнении сетки.
  const workspace = page.getByLabel('Пространство: Чек-листы');
  await expect
    .poll(
      async () =>
        workspace.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      { timeout: 5000 },
    )
    .toBeGreaterThan(10);

  await page.screenshot({
    path: 'test-results/screenshots/tiled-layout.png',
    fullPage: false,
  });
});
