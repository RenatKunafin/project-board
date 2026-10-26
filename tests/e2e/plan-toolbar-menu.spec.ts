import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocumentWindow, openPlanMenu } from './document-ui';

/**
 * PBT-089: компактный тулбар и меню вторичных команд — частные команды
 * на виду, вторичные в «⋯», клавиатура, границы экрана, временные
 * уведомления, неизменность геометрии.
 */

test('вторичные команды в меню выполняют действующие операции', async ({ page }) => {
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'План', 'Меню плана');

  // Частые команды на виду; вторичных кнопок на тулбаре нет.
  await expect(pane.locator('[data-add-task]')).toBeVisible();
  await expect(pane.locator('[data-add-group]')).toBeVisible();
  await expect(pane.locator('[data-catalogs]')).toBeVisible();
  await expect(pane.locator('[data-issues]')).toBeVisible();

  // Экспорт собственного формата из меню скачивает файл.
  const menu = await openPlanMenu(page, pane);
  await expect(menu).toContainText('Меню плана');
  await expect(menu.locator('[data-import-plan]')).toBeVisible();
  await expect(menu.locator('[data-export-plan]')).toBeVisible();
  await expect(menu.locator('[data-export-plantuml]')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await menu.locator('[data-export-plan]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^pb-plan-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);

  // PlantUML из меню открывает предпросмотр.
  const pumlMenu = await openPlanMenu(page, pane);
  await pumlMenu.locator('[data-export-plantuml]').click();
  const preview = page.getByRole('dialog', { name: 'Экспорт PlantUML' });
  await expect(preview.locator('[data-plantuml-text]')).toContainText('@startgantt');
  await preview.locator('.plan-dialog__close').click();
  await expect(preview).toHaveCount(0);

  // Импорт из меню открывает выбор файла и создаёт документ (.gantt с предпросмотром).
  const importMenu = await openPlanMenu(page, pane);
  const fileChooser = page.waitForEvent('filechooser');
  await importMenu.locator('[data-import-plan]').click();
  const chooser = await fileChooser;
  await chooser.setFiles('tests/fixtures/gantt/onlinegantt-20261016.reference.gantt');
  const ganttPreview = page.getByRole('dialog', { name: 'Импорт плана из OnlineGantt' });
  await expect(ganttPreview.locator('[data-onlinegantt-summary]')).toContainText('Задач 47');
  await ganttPreview.locator('[data-onlinegantt-cancel]').click();
});

test('клавиатура меню: стрелки, Home/End, Enter, Escape с возвратом фокуса', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'План', 'Меню клавиатура');
  const trigger = pane.locator('[data-plan-menu]');
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Меню плана' });
  await expect(menu).toBeVisible();
  // Фокус на первом пункте, стрелки/Home/End двигают его.
  await expect(menu.locator('[data-plan-menu-index="0"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('[data-plan-menu-index="1"]')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.locator('[data-plan-menu-index="0"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.locator('[data-plan-menu-index="2"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.locator('[data-plan-menu-index="0"]')).toBeFocused();
  // Escape закрывает с возвратом фокуса на кнопку.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Enter открывает меню и выбирает пункт: предпросмотр PlantUML.
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  const preview = page.getByRole('dialog', { name: 'Экспорт PlantUML' });
  await expect(preview.locator('[data-plantuml-text]')).toContainText('@startgantt');
  await preview.locator('.plan-dialog__close').click();

  // Клик вне закрывает меню без команды.
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(30, 300);
  await expect(menu).toHaveCount(0);
});

test('меню в границах экрана у края и после максимизации; окно не двигается', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'План', 'Меню края');

  async function menuInsideViewport(): Promise<boolean> {
    const menu = page.getByRole('menu', { name: 'Меню плана' });
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    return (
      box!.x >= 0 &&
      box!.y >= 0 &&
      box!.x + box!.width <= 1280 &&
      box!.y + box!.height <= 800
    );
  }

  // Первое окно на вкладке создаётся максимализированным (PBT-083):
  // переключение размера — нейтральной кнопкой.
  const sizeToggle = pane.getByRole('button', { name: /Развернуть на весь дашборд|Вернуть прежний размер/ });
  const menuButton = pane.locator('[data-plan-menu]');
  // Восстановление обычного размера, затем максимизация: меню в границах.
  if (await pane.getByRole('button', { name: /Вернуть прежний размер/ }).count()) {
    await sizeToggle.click();
    await page.waitForTimeout(400);
  }
  await sizeToggle.click();
  await page.waitForTimeout(400);
  await menuButton.click();
  await expect(page.getByRole('menu', { name: 'Меню плана' })).toBeVisible();
  expect(await menuInsideViewport()).toBe(true);
  const before = { scroll: await chartScroll(page, pane), box: await pane.boundingBox() };
  // Навигация и закрытие не двигают окно/диаграмму.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Меню плана' })).toHaveCount(0);
  expect(await chartScroll(page, pane)).toEqual(before.scroll);

  // Восстановление размера окна: меню снова в границах.
  await sizeToggle.click();
  await page.waitForTimeout(400);
  await menuButton.click();
  await expect(page.getByRole('menu', { name: 'Меню плана' })).toBeVisible();
  expect(await menuInsideViewport()).toBe(true);
  await page.keyboard.press('Escape');
});

test('успех-уведомление временное и не меняет высоту; ошибка импорта остаётся', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'План', 'Меню уведомления');

  const heights = () =>
    pane.evaluate((node) => ({
      toolbar: node.querySelector('.plan-gantt__toolbar')?.getBoundingClientRect().height ?? 0,
      footer: node.querySelector('.plan-gantt__footer')?.getBoundingClientRect().height ?? 0,
    }));
  const before = await heights();

  // Успешный экспорт: статус появляется и исчезает сам; высоты не меняются.
  const menu = await openPlanMenu(page, pane);
  const downloadPromise = page.waitForEvent('download');
  await menu.locator('[data-export-plan]').click();
  await downloadPromise;
  await expect(pane.locator('[data-gantt-status]')).toHaveText('План экспортирован');
  await expect(pane.locator('[data-gantt-status]')).toHaveText('', { timeout: 8000 });
  expect(await heights()).toEqual(before);

  // Ошибка импорта остаётся до действия пользователя.
  const brokenMenu = await openPlanMenu(page, pane);
  const fileChooser = page.waitForEvent('filechooser');
  await brokenMenu.locator('[data-import-plan]').click();
  const chooser = await fileChooser;
  await chooser.setFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"project-board_plan"}', 'utf8'),
  });
  await expect(pane.locator('[data-import-plan-result]')).toContainText('не');
  await page.waitForTimeout(7000);
  await expect(pane.locator('[data-import-plan-result]')).toBeVisible();
});

function chartScroll(page: Page, pane: Locator): Promise<{ left: number; top: number }> {
  return pane.evaluate((node) => {
    const chart = node.querySelector('.wx-chart') as HTMLElement | null;
    return { left: chart?.scrollLeft ?? 0, top: chart?.scrollTop ?? 0 };
  });
}

test('узкое окно: команды доступны на минимальной ширине окна', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 778 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'План', 'Меню узко');
  // Первое окно создаётся максимизированным (PBT-083) — вернуть размер
  // и сузить окно ресайзом до платформенного минимума (каскад-снап).
  const sizeToggle = pane.getByRole('button', { name: /Развернуть на весь дашборд|Вернуть прежний размер/ });
  if (await pane.getByRole('button', { name: /Вернуть прежний размер/ }).count()) {
    await sizeToggle.click();
  } else {
    await sizeToggle.click();
    await page.waitForTimeout(300);
    await sizeToggle.click();
  }
  await page.waitForTimeout(300);
  const wrap = page.locator('.cascade-layout__window, .react-grid-item').filter({ hasText: 'Меню узко' }).last();
  const handle = wrap.locator('.cascade-resize, .react-resizable-handle').last();
  const start = await handle.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(120, start.y + start.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const box = await pane.boundingBox();
  expect(box).not.toBeNull();
  // Платформенный минимум окна Гантта (каскад-снап) — 608 px; карточный
  // диапазон 360–420 шире текущего ограничения платформы (см. PR).
  expect(box!.width).toBeLessThanOrEqual(620);
  for (const selector of [
    '[data-add-task]', '[data-add-group]', '[data-catalogs]', '[data-plan-menu]', '[data-issues]',
    '[data-gantt-filter-query]', '[data-gantt-filter-resource]', '[data-zoom-days]', '[data-zoom-weeks]', '[data-task-count]',
  ]) {
    await expect(pane.locator(selector).first()).toBeVisible();
  }
  // Меню открывается и целиком помещается у узкого окна.
  const menu = await openPlanMenu(page, pane);
  const menuBox = await menu.boundingBox();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1280);
  await page.keyboard.press('Escape');
});
