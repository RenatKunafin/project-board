import { expect, test, type Page } from '@playwright/test';

async function cascadeWindowBox(page: Page, label: string) {
  const pane = page.getByRole('group', { name: label });
  await expect(pane).toBeVisible();
  const box = await pane.boundingBox();
  if (!box) {
    throw new Error(`Нет boundingBox у «${label}»`);
  }
  return box;
}

async function zIndexOf(page: Page, label: string): Promise<number> {
  return page
    .getByRole('group', { name: label })
    .evaluate((el) => Number(el.closest('.cascade-layout__window')?.style.zIndex ?? '0'));
}

async function switchToCascade(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Каскад' }).click();
  await expect(page.locator('.cascade-layout')).toBeVisible();
  const cascade = page.getByRole('button', { name: 'Каскад' });
  await expect(cascade).toHaveAttribute('aria-pressed', 'true');
}

test('каскад: окна перекрываются, активация нижнего поднимает поверх', async ({
  page,
}) => {
  await page.goto('/');
  await switchToCascade(page);

  const labels = [
    'Экземпляр 1 · Список 1',
    'Экземпляр 2 · Список 1',
    'Экземпляр 3 · Список 2',
  ];
  const boxes = await Promise.all(
    labels.map((label) => cascadeWindowBox(page, label)),
  );
  // Каскадный стек со сдвигом 28px: соседние окна перекрываются.
  for (let i = 0; i < labels.length - 1; i += 1) {
    const a = boxes[i];
    const b = boxes[i + 1];
    const intersects =
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height;
    expect(intersects, `${labels[i]} × ${labels[i + 1]}`).toBe(true);
  }

  // Нижнее окно стека активируется кликом по видимой части (угол стека).
  const lowest = page.getByRole('group', { name: labels[0] });
  const lowestBox = boxes[0];
  await page.mouse.click(lowestBox.x + 8, lowestBox.y + 8);
  await expect(lowest).toHaveAttribute('data-active', 'true');
  const zLow = await zIndexOf(page, labels[0]);
  const zSecond = await zIndexOf(page, labels[1]);
  expect(zLow).toBeGreaterThan(zSecond);

  // Порядок глубины стабилен: активация вне перекрытия не меняет стек.
  await lowest.getByRole('button', { name: `Свернуть ${labels[0]}` }).click();
  await lowest.getByRole('button', { name: `Развернуть ${labels[0]}` }).click();
  const zLowAfter = await zIndexOf(page, labels[0]);
  expect(zLowAfter).toBe(zLow);
});

test('каскад: перенос фиксируется после отпускания, заголовок остаётся достижимым', async ({
  page,
}) => {
  await page.goto('/');
  await switchToCascade(page);

  const label = 'Экземпляр 1 · Список 1';
  const head = page
    .getByRole('group', { name: label })
    .locator('.widget-window__head');
  const headBox = await head.boundingBox();
  if (!headBox) {
    throw new Error('Нет заголовка');
  }

  await page.mouse.move(headBox.x + 40, headBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(headBox.x + 40 + 180, headBox.y + 10 + 120, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const moved = await cascadeWindowBox(page, label);
  expect(moved.x).toBeGreaterThan(headBox.x);
  expect(moved.y).toBeGreaterThan(headBox.y);

  // Правило границ: перенос к левому краю за пределы области ограничивается.
  const again = await head.boundingBox();
  if (!again) {
    throw new Error('Нет заголовка после переноса');
  }
  await page.mouse.move(again.x + 40, again.y + 10);
  await page.mouse.down();
  await page.mouse.move(again.x + 40 - 900, again.y + 10, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const clamped = await cascadeWindowBox(page, label);
  expect(clamped.x).toBeGreaterThanOrEqual(0);
});

test('каскад: resize за уголок соблюдает минимум типа', async ({ page }) => {
  await page.goto('/');
  await switchToCascade(page);

  const label = 'Экземпляр 3 · Список 2';
  const pane = page.getByRole('group', { name: label });
  const initial = await cascadeWindowBox(page, label);
  const handle = page
    .locator('.cascade-layout__window')
    .filter({ has: pane })
    .locator('.cascade-resize-se');
  const handleBox = await handle.boundingBox();
  if (!handleBox) {
    throw new Error('Нет уголка resize');
  }

  await page.mouse.move(handleBox.x + 4, handleBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 4 - 700, handleBox.y + 4 - 500, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const squeezed = await cascadeWindowBox(page, label);
  expect(squeezed.width).toBeLessThan(initial.width);
  // Минимум чек-листа 2×2 ячейки → 280×192 пикселей.
  expect(squeezed.width).toBeGreaterThanOrEqual(280 - 6);
  expect(squeezed.height).toBeGreaterThanOrEqual(192 - 6);
});

test('каскад: поле ввода не двигает окно; возврат в сетку работает', async ({
  page,
}) => {
  await page.goto('/');
  await switchToCascade(page);

  const label = 'Экземпляр 1 · Список 1';
  const pane = page.getByRole('group', { name: label });
  const before = await cascadeWindowBox(page, label);
  const input = pane.getByPlaceholder('Новый пункт');
  const inputBox = await input.boundingBox();
  if (!inputBox) {
    throw new Error('Нет поля ввода');
  }
  await page.mouse.move(inputBox.x + 20, inputBox.y + inputBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(inputBox.x + 240, inputBox.y + 160, { steps: 8 });
  await page.mouse.up();
  const after = await cascadeWindowBox(page, label);
  expect(Math.abs(after.x - before.x)).toBeLessThan(4);
  expect(Math.abs(after.y - before.y)).toBeLessThan(4);

  await page.getByRole('button', { name: 'Сетка' }).click();
  await expect(page.locator('.tiled-grid')).toBeVisible();
  await expect(page.locator('.cascade-layout')).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: label }),
  ).toBeVisible();
});

test('каскад: скриншот перекрытых окон', async ({ page }) => {
  await page.goto('/');
  await switchToCascade(page);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: 'test-results/screenshots/cascade-layout.png',
    fullPage: false,
  });
});
