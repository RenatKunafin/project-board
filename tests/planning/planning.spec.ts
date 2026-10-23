import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  createPlan, documentId, editTask, existingView, exportNative, importFile,
  maximize, paneOf, restoreSize, saveTask, storedPlan, waitWorkspace, workspace,
} from './helpers';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__network', { data: { online: true } })).ok()).toBe(true);
});
test.afterEach(async ({ request }) => {
  expect((await request.post('/__network', { data: { online: true } })).ok()).toBe(true);
});

const TITLE = 'Сквозной рабочий план';
const A = 'Сквозная A';
const B = 'Сквозная B';

test('рабочий импорт → планирование → календарь/конфликты → два вида → файловый обмен', async ({ page, browser }, info) => {
  await info.attach('browser', { body: JSON.stringify({ project: info.project.name, version: browser.version() }), contentType: 'application/json' });
  const initial = await createPlan(page);
  const plan = await importFile(page, initial, 'tests/fixtures/gantt/onlinegantt-20261016.reference.gantt', TITLE);
  const id = await documentId(plan);
  await expect(plan.locator('[data-task-count]')).toHaveText('Задач: 47');
  await expect.poll(async () => (await storedPlan(page, id))?.content.tasks.length).toBe(47);
  const imported = (await storedPlan(page, id))!.content;

  await test.step('группа, справочник и назначенные задачи', async () => {
    await plan.locator('[data-catalogs]').click();
    const settings = page.getByRole('dialog', { name: 'Настройки плана' });
    await settings.locator('[data-catalog-new="workType"]').fill('Сквозная работа');
    await settings.locator('[data-catalog-new-parallel]').uncheck();
    await settings.locator('[data-catalog-add="workType"]').click();
    await settings.locator('[data-catalog-close]').click();
    await plan.locator('[data-add-group]').click();
    const group = page.getByRole('dialog');
    await group.locator('[data-group-field="title"]').fill('Сквозная группа');
    await group.locator('[data-group-save]').click();
    for (const [title, start, duration] of [[A, '2026-10-19', '5'], [B, '2026-10-20', '3']]) {
      await plan.locator('[data-add-task]').click();
      const dialog = page.getByRole('dialog', { name: 'Новая задача' });
      await dialog.locator('[data-task-field="title"]').fill(title);
      await dialog.locator('[data-task-field="start"]').fill(start);
      await dialog.locator('[data-task-field="duration"]').fill(duration);
      await dialog.locator('[data-task-assignee="QA"]').check();
      await dialog.locator('[data-task-worktype="Сквозная работа"]').check();
      await saveTask(dialog);
    }
    for (const title of [A, B]) {
      const dialog = await editTask(page, plan, title);
      await dialog.locator('[data-task-field="group"]').selectOption({ label: 'Сквозная группа' });
      if (title === B) {
        await dialog.locator('[data-dep-new-from]').selectOption({ label: A });
        await dialog.locator('[data-dep-new-lag]').fill('0');
        await dialog.locator('[data-dep-add]').click();
      }
      await saveTask(dialog);
    }
  });

  await test.step('явное преобразование импортированного отпуска и диагностика', async () => {
    const dialog = await editTask(page, plan, 'ОТПУСК-DEV-iOS');
    await dialog.locator('[data-task-to-absence]').click();
    const convert = page.getByRole('dialog', { name: 'Преобразование в отпуск' });
    await expect(convert.locator('[data-absence-resource]')).toHaveValue('');
    await convert.locator('[data-absence-resource]').selectOption({ label: 'QA' });
    await convert.locator('[data-absence-start]').fill('2026-10-21');
    await convert.locator('[data-absence-end]').fill('2026-10-22');
    await convert.locator('[data-absence-apply]').click();
    await expect(convert).not.toBeAttached();
    await expect(plan.locator('[data-task-count]')).toHaveText('Задач: 48');
    const qa = imported.resources.find(resource => resource.title === 'QA')!;
    await expect.poll(async () => (await storedPlan(page, id))?.content.unavailability
      .some(entry => entry.resourceId === qa.id && entry.start === '2026-10-21' && entry.end === '2026-10-22')).toBe(true);
    await plan.locator('[data-issues]').click();
    const issues = page.getByRole('dialog', { name: 'Проблемы плана' });
    await expect(issues.locator('[data-issues-list] li').filter({ hasText: B }).filter({ hasText: 'Нарушение FS' })).not.toHaveCount(0);
    await expect(issues.locator('[data-issues-list] li').filter({ hasText: A }).filter({ hasText: 'Конфликт работ' })).not.toHaveCount(0);
    await expect(issues.locator('[data-issues-list] li').filter({ hasText: A }).filter({ hasText: 'Отпуск исполнителя' })).not.toHaveCount(0);
    await issues.locator('[data-issues-close]').click();
  });

  await test.step('праздник меняет длительность, сохраняя ручные границы и остальные задачи', async () => {
    await plan.locator('[data-catalogs]').click();
    const settings = page.getByRole('dialog', { name: 'Настройки плана' });
    await settings.locator('[data-calendar-holiday-from]').fill('2026-10-21');
    await settings.locator('[data-calendar-add-holiday]').click();
    await settings.locator('[data-catalog-close]').click();
    const dialog = await editTask(page, plan, A);
    await expect(dialog.locator('[data-task-field="start"]')).toHaveValue('2026-10-19');
    await expect(dialog.locator('[data-task-field="duration"]')).toHaveValue('4');
    await expect(dialog.locator('[data-task-end-preview]')).toContainText('2026-10-23');
    await dialog.locator('[data-task-cancel]').click();
    const secondTask = await editTask(page, plan, B);
    await expect(secondTask.locator('[data-task-field="duration"]')).toHaveValue('2');
    await expect(secondTask.locator('[data-task-end-preview]')).toContainText('2026-10-22');
    await secondTask.locator('[data-task-cancel]').click();
    await expect.poll(async () => (await storedPlan(page, id))?.content.calendar.holidays).toContain('2026-10-21');
    const saved = (await storedPlan(page, id))!.content;
    for (const previous of imported.tasks.filter(task => task.title !== 'ОТПУСК-DEV-iOS')) {
      const current = saved.tasks.find(task => task.id === previous.id)!;
      expect([current.start, current.end]).toEqual([previous.start, previous.end]);
    }
    expect(saved.tasks.find(task => task.title === B)).toMatchObject({ start: '2026-10-20', end: '2026-10-22' });
  });

  const resource = await existingView(page, TITLE);
  expect(await documentId(resource)).toBe(id);
  await maximize(resource);
  await resource.locator('[data-rt-filter-query]').fill(A);
  const saved = (await storedPlan(page, id))!.content;
  const taskA = saved.tasks.find(task => task.title === A)!;
  await resource.locator(`[data-rt-task="${taskA.id}"]`).dblclick();
  const resourceForm = page.getByRole('dialog', { name: 'Редактирование задачи' });
  await expect(resourceForm.locator('[data-task-field="start"]')).toHaveValue('2026-10-19');
  await expect(resourceForm.locator('[data-task-field="duration"]')).toHaveValue('4');
  await expect(resourceForm.locator('[data-task-end-preview]')).toContainText('2026-10-23');
  await resourceForm.locator('[data-task-field="title"]').fill(`${A} правка`);
  await resourceForm.locator('[data-task-field="start"]').fill('2026-10-26');
  await expect(resourceForm.locator('[data-task-end-preview]')).toContainText('2026-10-29');
  await saveTask(resourceForm);
  await restoreSize(page);
  await maximize(plan);
  await plan.locator('[data-gantt-filter-query]').fill(`${A} правка`);
  await expect(plan.locator('.wx-row').filter({ hasText: `${A} правка` }).first()).toBeVisible();

  await plan.locator('[data-gantt-filter-query]').fill('Сквозная');
  const summary = plan.locator('.wx-row').filter({ hasText: 'Сквозная группа' }).first();
  await expect(summary).toContainText('20.10');
  await expect(summary).toContainText('29.10');
  const exported = await exportNative(page, plan);
  expect(exported.value.content.tasks.find(task => task.title === `${A} правка`)).toMatchObject({ start: '2026-10-26', end: '2026-10-29' });
  expect(exported.value.content.tasks.find(task => task.title === B)).toMatchObject({ start: '2026-10-20', end: '2026-10-22' });
  expect(exported.value.format).toBe('project-board-plan');
  await plan.getByRole('button', { name: 'Экспорт PlantUML' }).click();
  const plantuml = page.getByRole('dialog', { name: 'Экспорт PlantUML' });
  const text = await plantuml.locator('[data-plantuml-text]').textContent();
  expect(text).toContain('@startgantt');
  expect(text!.trimEnd().endsWith('@endgantt')).toBe(true);
  expect(text).toContain(`${A} правка`);
  expect(text).toContain(B);
  expect(text).toContain('2026/10/21 is closed');
  expect(text).toContain('[Отпуск — QA]');
  await expect(plantuml.locator('[data-plantuml-report]')).not.toBeEmpty();
  const download = page.waitForEvent('download');
  await plantuml.locator('[data-plantuml-download]').click();
  expect(await readFile((await (await download).path())!, 'utf8')).toBe(text);
  await plantuml.getByRole('button', { name: 'Закрыть', exact: true }).click();

  // Независимый импорт в то же окно, затем повторный экспорт без потерь.
  const copy = await importFile(page, plan, exported.path, TITLE);
  const copyId = await documentId(copy);
  expect(copyId).not.toBe(id);
  const repeated = await exportNative(page, copy);
  expect(repeated.value).toEqual(exported.value);
  const copyEdit = await editTask(page, copy, `${A} правка`);
  await copyEdit.locator('[data-task-field="title"]').fill('Изменение только копии');
  await saveTask(copyEdit);
  await expect.poll(async () => (await storedPlan(page, copyId))?.content.tasks.some(task => task.title === 'Изменение только копии')).toBe(true);
  expect((await storedPlan(page, id))!.content.tasks.some(task => task.title === `${A} правка`)).toBe(true);
  await restoreSize(page);
  await page.getByRole('button', { name: 'Каталог документов', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог документов' });
  await expect(catalog.getByText(TITLE, { exact: true })).toHaveCount(2);
  // Каталог упорядочен по последней записи: только что изменённая копия первая.
  const copyRow = catalog.locator('.doc-catalog__row').first();
  await expect(copyRow).toContainText(TITLE);
  await copyRow.getByRole('button', { name: `Переименовать «${TITLE}»`, exact: true }).click();
  await copyRow.getByLabel('Новое название документа').fill('Сквозная копия');
  await copyRow.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(async () => (await storedPlan(page, copyId))?.title).toBe('Сквозная копия');
  await page.keyboard.press('Escape');
  await paneOf(page, 'Сквозная копия').getByRole('button', { name: 'Закрыть План · Сквозная копия', exact: true }).click();
  await resource.getByRole('button', { name: `Закрыть Ресурсы · ${TITLE}`, exact: true }).click();
  const reopened = await existingView(page, TITLE, 'План');
  expect(await documentId(reopened)).toBe(id);
  expect((await exportNative(page, reopened)).value).toEqual(exported.value);
  await info.attach('working-plan', { body: JSON.stringify(exported.value, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('working-plan.png') });
});

test('native импорт → оба режима и представления → холодный офлайн-запуск → правка и повторное открытие', async ({ page, context, browser, browserName, request }, info) => {
  await info.attach('browser', { body: JSON.stringify({ project: info.project.name, version: browser.version() }), contentType: 'application/json' });
  const initial = await createPlan(page, 'Сетка');
  const title = 'Малый контрольный набор';
  const plan = await importFile(page, initial, 'tests/fixtures/gantt/native-plan-sample.json', title);
  const id = await documentId(plan);
  await plan.locator('[data-gantt-filter-query]').fill('Задача A');
  await plan.locator('[data-zoom-weeks]').click();
  const resources = await existingView(page, title);
  await resources.locator('[data-rt-filter-query]').fill('Задача A');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await page.getByRole('button', { name: 'Каскад', exact: true }).click();
  // Пользовательский перенос: геометрия записывается только по mouseup.
  await plan.locator('.widget-window__head').scrollIntoViewIfNeeded();
  const head = await plan.locator('.widget-window__head').boundingBox();
  await page.mouse.move(head!.x + 30, head!.y + 10);
  await page.mouse.down();
  await page.mouse.move(head!.x + 110, head!.y + 58, { steps: 5 });
  await page.mouse.up();
  await waitWorkspace(page, 5); // 3 стартовых окна + исходное и ресурсное.
  await expect.poll(async () => (await storedPlan(page, id))?.content.tasks.length).toBe(5);
  await expect(page.getByRole('status', { name: 'Готовность к офлайн-работе' })).toHaveText('Готово к работе офлайн');
  const before = await exportNative(page, plan);
  const instanceId = (await plan.locator('.plan-gantt').getAttribute('data-widget-instance'))!;
  const expectedArea = await plan.evaluate(element => {
    const wrapper = element.closest('.cascade-layout__window') as HTMLElement;
    const matrix = new DOMMatrix(getComputedStyle(wrapper).transform);
    return { x: matrix.m41, y: matrix.m42, width: wrapper.offsetWidth, height: wrapper.offsetHeight };
  });
  await expect.poll(async () => (await workspace(page)).instances.find(item => item.id === instanceId)?.cascadeArea).toEqual(expectedArea);
  await expect.poll(async () => (await workspace(page)).tabs.find(tab => tab.active === 1)?.cascadeOrder.at(-1)).toBe(instanceId);
  const beforeWorkspace = await workspace(page);
  expect(beforeWorkspace.tabs.map(tab => tab.mode)).toEqual(['grid', 'cascade']);
  expect(JSON.stringify(beforeWorkspace.settings)).toContain('Задача A');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.close();
  expect((await request.post('/__network', { data: { online: false } })).ok()).toBe(true);
  // Отрицательный контроль идёт мимо SW и HTTP-кэша браузера: origin недоступен.
  await expect(request.get('/')).rejects.toThrow();
  // В Playwright 1.63 setOffline ломает даже буквальный SW Response в WebKit
  // (microsoft/playwright#42775). Для него проверяем реальную недоступность
  // origin без этого флага; no-store исключает HTTP-кэш во всех проектах.
  if (browserName !== 'webkit') await context.setOffline(true);
  await info.attach('offline-mode', { body: browserName === 'webkit'
    ? 'origin unavailable; browser offline flag not used (Playwright #42775)'
    : 'origin unavailable + browserContext.setOffline(true)', contentType: 'text/plain' });
  const offline = await context.newPage();
  await offline.goto('/');
  await expect.poll(() => workspace(offline)).toEqual(beforeWorkspace);
  await offline.getByRole('tab', { name: /Чек-листы/ }).getByText('Чек-листы', { exact: true }).click();
  await expect(offline.getByRole('button', { name: 'Сетка', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await offline.getByRole('tab', { name: /Новая вкладка/ }).getByText('Новая вкладка', { exact: true }).click();
  await expect(offline.getByRole('button', { name: 'Каскад', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => paneOf(offline, title).evaluate(element => {
    const wrapper = element.closest('.cascade-layout__window') as HTMLElement;
    const matrix = new DOMMatrix(getComputedStyle(wrapper).transform);
    return { x: matrix.m41, y: matrix.m42, width: wrapper.offsetWidth, height: wrapper.offsetHeight };
  })).toEqual(expectedArea);
  await expect(paneOf(offline, title).locator('[data-gantt-filter-query]')).toHaveValue('Задача A');
  await expect(paneOf(offline, title).locator('[data-zoom-weeks]')).toHaveAttribute('aria-pressed', 'true');
  await expect(paneOf(offline, title, 'Ресурсы').locator('[data-rt-filter-query]')).toHaveValue('Задача A');
  await maximize(paneOf(offline, title));
  const dialog = await editTask(offline, paneOf(offline, title), 'Задача A');
  await dialog.locator('[data-task-field="title"]').fill('Правка без сети');
  await saveTask(dialog);
  await expect.poll(async () => (await storedPlan(offline, id))?.content.tasks[0].title).toBe('Правка без сети');
  await restoreSize(offline);
  const offlineResources = paneOf(offline, title, 'Ресурсы');
  await maximize(offlineResources);
  await offlineResources.locator('[data-rt-filter-query]').fill('Правка без сети');
  await expect(offlineResources.locator('[data-rt-task="t-a"]')).toContainText('Правка без сети');
  await restoreSize(offline);
  await maximize(paneOf(offline, title));
  const after = await exportNative(offline, paneOf(offline, title));
  const expected = structuredClone(before.value);
  expected.content = { ...expected.content, tasks: expected.content.tasks.map((task, index) =>
    index === 0 ? { ...task, title: 'Правка без сети' } : task) };
  expect(after.value).toEqual(expected);
  await offline.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await maximize(paneOf(reopened, title));
  await paneOf(reopened, title).locator('[data-gantt-filter-query]').fill('Правка без сети');
  await expect(paneOf(reopened, title).locator('.wx-row').filter({ hasText: 'Правка без сети' }).first()).toBeVisible();
  await reopened.screenshot({ path: info.outputPath('offline-reopened.png') });
});
