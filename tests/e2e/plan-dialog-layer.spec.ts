import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocumentWindow, openDocumentWindow } from './document-ui';

const longPlan = {
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
  resources: Array.from({ length: 50 }, (_, i) => ({ id: `r-${i}`, title: `Исполнитель ${i + 1}` })),
  workTypes: Array.from({ length: 30 }, (_, i) => ({ id: `w-${i}`, title: `Работа ${i + 1}`, allowsParallel: false })),
  groups: [], tasks: [], dependencies: [], unavailability: [],
};

const twoFrames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const scrollPositions = (page: Page) => page.locator('.instances, .cascade-viewport, .wx-chart')
  .evaluateAll(elements => elements.map(el => ({ x: el.scrollLeft, y: el.scrollTop })));

const withTasks = {
  ...longPlan,
  tasks: [
    { id: 'target', title: 'Целевая задача', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-0'], workTypeIds: ['w-0'] },
    { id: 'other', title: 'Пересечение', start: '2026-10-14', end: '2026-10-16', assigneeIds: ['r-0'], workTypeIds: ['w-0'] },
  ],
};

async function frame(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(15);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 15);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await expect(dialog.locator('.plan-dialog__plan')).not.toBeEmpty();
  const footer = await dialog.locator('footer').boundingBox();
  const body = dialog.locator('.plan-dialog__body');
  if (await body.evaluate(el => el.scrollHeight > el.clientHeight + 1)) {
    const bounds = (await body.boundingBox())!;
    await page.mouse.move(bounds.x + 2, bounds.y + 5);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await dialog.locator('footer').boundingBox()).toEqual(footer);
  }
  await expect(dialog.locator('.plan-dialog__head')).toBeVisible();
  await expect(dialog.locator('footer')).toBeVisible();
}

for (const viewport of [{ width: 1024, height: 778 }, { width: 1856, height: 1269 }]) {
  test(`native foundation: экранная форма ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const { pane, documentId } = await createDocumentWindow(page, 'План', 'Экранный диалог');
    await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: longPlan });
    const handle = page.locator('.cascade-layout__window').filter({ has: pane }).locator('.cascade-resize-se');
    const corner = (await handle.boundingBox())!;
    await page.mouse.move(corner.x + 6, corner.y + 6);
    await page.mouse.down();
    await page.mouse.move(corner.x - 500, corner.y - 350, { steps: 6 });
    await page.mouse.up();
    const head = (await pane.locator('.widget-window__head').boundingBox())!;
    await page.mouse.move(head.x + 45, head.y + 12);
    await page.mouse.down();
    await page.mouse.move(head.x + 180, head.y + 200, { steps: 6 });
    await page.mouse.up();
    await twoFrames(page);
    const before = await pane.boundingBox();
    const scrollBefore = await scrollPositions(page);
    const widgets = (await page.getByRole('button', { name: 'Виджеты', exact: true }).boundingBox())!;
    const revision = await page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, documentId);

    await pane.locator('[data-add-task]').click();
    const dialog = pane.getByRole('dialog', { name: 'Новая задача', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty('open', true);
    await expect(dialog.locator('.plan-dialog__plan')).toHaveText('Экранный диалог');
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(15);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 15);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.width).toBeGreaterThan(before!.width);
    await expect(dialog.locator('[data-task-field="title"]')).toBeFocused();
    await dialog.locator('[data-task-field="title"]').fill('Несохранённый черновик');
    const footer = await dialog.locator('footer').boundingBox();
    const body = dialog.locator('.plan-dialog__body');
    // В форме создания назначения уже ограничены своей областью прокрутки.
    const assignees = dialog.locator('[data-task-assignees]');
    const listBox = (await assignees.boundingBox())!;
    await page.mouse.move(listBox.x + 40, listBox.y + 30);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => assignees.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await dialog.locator('footer').boundingBox()).toEqual(footer);
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(dialog.locator('[data-task-save]')).toBeVisible();

    // Реальные события по затемнению не управляют фоном и не закрывают форму.
    await page.mouse.click(widgets.x + 4, widgets.y + 4);
    await page.mouse.move(2, viewport.height - 2);
    await page.mouse.wheel(0, 600);
    await twoFrames(page);
    await expect(dialog).toBeVisible();
    await expect(page.locator('.dropdown-panel')).toHaveCount(0);
    expect(await scrollPositions(page)).toEqual(scrollBefore);
    await dialog.locator('[data-task-save]').focus();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(pane.locator('[data-add-task]')).toBeFocused();
    expect(await pane.boundingBox()).toEqual(before);
    expect(await scrollPositions(page)).toEqual(scrollBefore);
    expect(await page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, documentId)).toBe(revision);
  });
}

for (const viewport of [{ width: 1024, height: 778 }, { width: 1856, height: 1269 }]) {
  test(`все панели: каскад, сетка и разворот ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await page.goto('/');
    const { pane, documentId } = await createDocumentWindow(page, 'План', 'Панели');
    await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: withTasks });
    const revision = await page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, documentId);
    for (const mode of ['Каскад', 'Сетка', 'Разворот']) {
      if (mode === 'Разворот') await pane.getByRole('button', { name: 'Развернуть на весь дашборд План · Панели', exact: true }).click();
      else await page.getByRole('button', { name: mode, exact: true }).click();
      await twoFrames(page);
      // Измеряем итоговую сетку, когда закончится её переход из каскада.
      await pane.evaluate(async el => {
        const item = el.closest('.react-grid-item') ?? el;
        await Promise.all(item.getAnimations().map(animation => animation.finished));
      });
      const geometry = await pane.boundingBox();
      const scroll = await scrollPositions(page);
      for (const [selector, name] of [
        ['[data-add-task]', 'Новая задача'], ['[data-add-group]', 'Новая группа'],
        ['[data-catalogs]', 'Настройки плана'], ['[data-issues]', 'Проблемы плана'],
        ['[data-export-plantuml]', 'Экспорт PlantUML'],
      ]) {
        await pane.locator(selector).click();
        const dialog = pane.getByRole('dialog', { name, exact: true });
        await frame(page, dialog);
        await dialog.locator('.plan-dialog__close').click();
        await expect(dialog).toHaveCount(0);
      }
      await pane.locator('[data-import-plan]').click();
      await pane.locator('[data-import-plan-input]').setInputFiles('tests/fixtures/gantt/onlinegantt-20261016.reference.gantt');
      const preview = pane.getByRole('dialog', { name: 'Импорт плана из OnlineGantt', exact: true });
      await frame(page, preview);
      await preview.locator('[data-onlinegantt-cancel]').click();
      await pane.locator('.plan-gantt__chart').getByText('Целевая задача', { exact: true }).first().dblclick();
      const editor = pane.getByRole('dialog', { name: 'Редактирование задачи', exact: true });
      await editor.locator('[data-task-field="title"]').fill('Черновик задачи');
      await editor.locator('[data-task-to-absence]').click();
      const absence = pane.getByRole('dialog', { name: 'Преобразование в отпуск', exact: true });
      await frame(page, absence);
      await page.keyboard.press('Escape');
      await expect(absence).toHaveCount(0);
      await expect(editor.locator('[data-task-field="title"]')).toHaveValue('Черновик задачи');
      await expect(editor.locator('[data-task-to-absence]')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
      expect(await pane.boundingBox(), `геометрия после диалогов: ${mode}`).toEqual(geometry);
      expect(await scrollPositions(page)).toEqual(scroll);
      expect(await page.evaluate(id => window.__projectBoard!.readDocument(id)!.revision, documentId)).toBe(revision);
    }
  });
}

test('черновик переживает hidden, а удаление владельца освобождает фон', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'План', 'Жизненный цикл');
  await pane.locator('[data-add-task]').click();
  const dialog = pane.locator('dialog.plan-dialog');
  await dialog.locator('[data-task-field="title"]').fill('Не терять');
  // Программные действия хоста проверяют lifecycle при недоступном фоне.
  await pane.locator('.widget-window__actions button').first().evaluate(el => (el as HTMLButtonElement).click());
  await expect(dialog).toHaveJSProperty('open', false);
  await expect(dialog).toHaveCount(1);
  await pane.locator('.widget-window__actions button').first().click();
  await expect(dialog).toHaveJSProperty('open', true);
  await expect(dialog.locator('[data-task-field="title"]')).toHaveValue('Не терять');
  await pane.locator('.widget-window__actions button').last().evaluate(el => (el as HTMLButtonElement).click());
  await expect(page.locator('dialog.plan-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Каталог виджетов' })).toBeVisible();
});

test('диалог работает за пределами DOM оболочки дашборда', async ({ page }) => {
  await page.goto('/');
  const { pane } = await createDocumentWindow(page, 'План', 'Независимый');
  const root = await pane.locator('.plan-gantt').elementHandle();
  await root!.evaluate(el => {
    const marker = document.createComment('module-home');
    el.before(marker);
    (el as HTMLElement & { home?: Comment }).home = marker;
    // React делегирует события своему корню; оболочка дашборда не нужна.
    document.getElementById('root')!.appendChild(el);
    Object.assign((el as HTMLElement).style, { position: 'fixed', top: '160px', left: '20px', width: '480px', height: '350px', zIndex: '100' });
  });
  try {
    await page.locator('#root > .plan-gantt [data-add-task]').click();
    const dialog = page.getByRole('dialog', { name: 'Новая задача', exact: true });
    await frame(page, dialog);
    expect(await dialog.evaluate(el => el.closest('.widget-window'))).toBeNull();
    await dialog.locator('[data-task-field="title"]').fill('Самостоятельная форма');
    await dialog.locator('.plan-dialog__close').click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await root!.evaluate(el => {
      (el as HTMLElement).removeAttribute('style');
      (el as HTMLElement & { home?: Comment }).home?.replaceWith(el);
    });
  }
});

test('ресурсное представление использует ту же экранную форму', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 778 });
  await page.goto('/');
  const { documentId } = await createDocumentWindow(page, 'План', 'Общий редактор');
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: withTasks });
  const { pane } = await openDocumentWindow(page, 'Ресурсы', 'Общий редактор');
  await pane.locator('.rct-item').filter({ hasText: 'Целевая задача' }).first().dblclick();
  const dialog = pane.getByRole('dialog', { name: 'Редактирование задачи', exact: true });
  await frame(page, dialog);
  await expect(dialog.locator('[data-task-field="title"]')).toHaveValue('Целевая задача');
  await dialog.locator('[data-task-field="title"]').fill('Отмена в ресурсах');
  await dialog.locator('[data-task-cancel]').click();
  await expect(dialog).toHaveCount(0);
});

test('смена документа не переносит открытую форму прежнего плана', async ({ page }) => {
  await page.goto('/');
  const { pane, documentId } = await createDocumentWindow(page, 'План', 'Исходный');
  await pane.locator('[data-add-task]').click();
  await pane.locator('[data-task-field="title"]').fill('Черновик прежнего документа');
  await pane.locator('[data-import-plan-input]').setInputFiles('tests/fixtures/gantt/onlinegantt-20261016.reference.gantt');
  const preview = pane.getByRole('dialog', { name: 'Импорт плана из OnlineGantt', exact: true });
  await preview.locator('[data-onlinegantt-apply]').click();
  await expect(pane.locator('[data-document-id]')).not.toHaveAttribute('data-document-id', documentId);
  await expect(pane.locator('dialog.plan-dialog')).toHaveCount(0);
  await pane.locator('[data-add-task]').click();
  await expect(pane.locator('[data-task-field="title"]')).toHaveValue('');
});

test('ошибка рендера владельца закрывает диалог и освобождает фон', async ({ page }) => {
  await page.goto('/');
  const { pane, documentId } = await createDocumentWindow(page, 'План', 'Сбой владельца');
  await pane.locator('[data-add-task]').click();
  await expect(pane.locator('dialog[open]')).toHaveCount(1);
  await page.evaluate(id => {
    // Fault injection в собственный контрольный документ, без нового API.
    const broken = {};
    Object.defineProperty(broken, 'calendar', { get() { throw new Error('PBT-085 render fault'); } });
    window.__projectBoard!.writeDocumentContent(id, broken);
  }, documentId);
  // После boundary содержимого уже нет маркера instance внутри окна.
  await expect(page.getByRole('group', { name: 'План · Сбой владельца', exact: true }).locator('.widget-error')).toBeVisible();
  await expect(page.locator('dialog.plan-dialog')).toHaveCount(0);
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: longPlan });
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Каталог виджетов' })).toBeVisible();
});
