import { expect, test, type Page } from '@playwright/test';
import { createDocumentWindow } from './document-ui';

/**
 * PBT-088: представление списка проблем — группы, фильтры со счётчиками,
 * поиск по задаче/исполнителю, структурированная строка, два действия,
 * различённые пустые состояния; ядро и документ не меняются.
 */

const read = (page: Page, id: string) => page.evaluate(id => window.__projectBoard!.readDocument(id), id);

/** Большой план: 8 пересекающихся непараллелизуемых работ одного ресурса,
 * нарушение FS и отпуск с длинными названиями (по карточке: импортированный
 * план с большим количеством реальных конфликтов). */
function crowdedPlan() {
  const tasks = [
    { id: 'src', title: 'Подготовка исходного контура интеграции', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r0'], workTypeIds: ['w0'] },
    { id: 'fs', title: 'Приёмка до готовности предшественника', start: '2026-10-13', end: '2026-10-15', assigneeIds: ['r0'], workTypeIds: ['w0'] },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `w${i}`,
      title: `Модуль ${i + 1}: стабилизация релизного контура и регресс очень длинного названия задачи`,
      start: `2026-10-${String(19 + i).padStart(2, '0')}`,
      end: `2026-10-${String(22 + i).padStart(2, '0')}`,
      assigneeIds: ['r0'],
      workTypeIds: ['w0'],
    })),
    { id: 'vac', title: 'Задача поверх отпуска ведущего специалиста', start: '2026-11-09', end: '2026-11-10', assigneeIds: ['r0'] },
  ];
  return {
    calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
    resources: [{ id: 'r0', title: 'Ведущий специалист с длинным именем' }],
    workTypes: [{ id: 'w0', title: 'Разработка', allowsParallel: false }],
    groups: [],
    tasks,
    dependencies: [{ id: 'd1', fromTaskId: 'src', toTaskId: 'fs', lagDays: 0 }],
    unavailability: [{ id: 'u1', resourceId: 'r0', start: '2026-11-09', end: '2026-11-10' }],
  };
}

test('группы, счётчики, фильтр и поиск; счётчик тулбара независим', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const { pane, documentId } = await createDocumentWindow(page, 'План', 'Проблемы представление');
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: crowdedPlan() });

  const toolbar = pane.locator('[data-issues]');
  await expect(toolbar).toContainText(/Проблемы \(\d+\)/);
  const totalBefore = Number((await toolbar.textContent())!.match(/\d+/)![0]);
  expect(totalBefore).toBeGreaterThan(10);
  const before = await read(page, documentId);

  await toolbar.click();
  const dialog = page.getByRole('dialog', { name: 'Проблемы плана' });
  await expect(dialog).toBeVisible();

  // Группы трёх типов с счётчиками; длинные названия не ломают строку.
  await expect(dialog.locator('.plan-issues__group', { hasText: 'Нарушение FS' })).toBeVisible();
  await expect(dialog.locator('.plan-issues__group', { hasText: 'Конфликт работ' })).toBeVisible();
  await expect(dialog.locator('.plan-issues__group', { hasText: 'Отпуск исполнителя' })).toBeVisible();
  const workEntries = dialog.locator('.plan-issues__group[aria-label="Конфликт работ"] .plan-issues__entry');
  expect(await workEntries.count()).toBeGreaterThan(5);
  // Длинные названия задач присутствуют в строках и переносятся.
  await expect(workEntries.filter({ hasText: 'Модуль 1:' }).first()).toBeVisible();
  // Структурированная строка: даты пересечения и ресурс.
  await expect(workEntries.first().locator('.plan-issues__meta')).toContainText('Пересечение');
  await expect(workEntries.first().locator('.plan-issues__meta')).toContainText('Ведущий специалист');

  // Фильтр типа: остаются только работы; счётчик тулбара не изменился.
  await dialog.locator('[data-issue-filter="parallel-work"]').click();
  await expect(dialog.locator('.plan-issues__group', { hasText: 'Нарушение FS' })).toHaveCount(0);
  await expect(workEntries.first()).toBeVisible();
  await expect(toolbar).toContainText(`Проблемы (${totalBefore})`);

  // Поиск по исполнителю в рамках фильтра; без совпадений — «Ничего не найдено».
  await dialog.locator('[data-issue-search]').fill('Ведущий специалист');
  await expect(workEntries.first()).toBeVisible();
  await dialog.locator('[data-issue-search]').fill('несуществующее');
  await expect(dialog.locator('[data-issues-empty="filtered"]')).toContainText('Ничего не найдено');
  await expect(toolbar).toContainText(`Проблемы (${totalBefore})`);

  // Сброс фильтра: поиск по задаче находит обе записи с её участием
  // (FS-нарушение и конфликт работ), FS-запись — со структурой дат.
  await dialog.locator('[data-issue-filter="all"]').click();
  await dialog.locator('[data-issue-search]').fill('Приёмка');
  await expect(dialog.locator('.plan-issues__entry')).toHaveCount(2);
  await expect(dialog.locator('.plan-issues__entry').first().locator('.plan-issues__meta')).toContainText('Ожидается 19.10.2026');

  // Закрытие без действий: документ и счётчик без изменений.
  await dialog.locator('[data-issues-close]').click();
  await expect(dialog).toHaveCount(0);
  expect(await read(page, documentId)).toEqual(before);
  // Консоль живого прогона без ошибок.
  expect(consoleErrors).toEqual([]);
});

test('«Открыть» — форма с актуальными данными; исправление обновляет список', async ({ page }) => {
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const { pane, documentId } = await createDocumentWindow(page, 'План', 'Проблемы правка');
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: crowdedPlan() });

  await pane.locator('[data-issues]').click();
  const dialog = page.getByRole('dialog', { name: 'Проблемы плана' });
  await expect(dialog).toBeVisible();

  // Открываем FS-запись (фильтр типа, затем поиск): модалка списка
  // закрывается, форма — в режиме правки с актуальными данными.
  await dialog.locator('[data-issue-filter="dependency"]').click();
  await dialog.locator('[data-issue-search]').fill('Приёмка');
  await expect(dialog.locator('.plan-issues__entry')).toHaveCount(1);
  await dialog.locator('[data-issue-edit]').click();
  await expect(dialog).toHaveCount(0);
  const form = pane.getByRole('dialog', { name: 'Редактирование задачи', exact: true });
  await expect(form).toBeVisible();
  await expect(form.locator('[data-task-field="title"]')).toHaveValue('Приёмка до готовности предшественника');

  // Исправляем дату начала на свободный слот (30.10, после всех работ):
  // исчезает и FS-нарушение, и пересечение со «src» — счётчик падает.
  const totalBefore = Number((await pane.locator('[data-issues]').textContent())!.match(/\d+/)![0]);
  await form.locator('[data-task-field="start"]').fill('2026-10-30');
  await form.locator('[data-task-save]').click();
  await expect(form).toHaveCount(0);
  const totalAfter = Number((await pane.locator('[data-issues]').textContent())!.match(/\d+/)![0]);
  expect(totalAfter).toBeLessThan(totalBefore);

  // «Показать» из списка: переход к задаче (сценарии PBT-082) сохранён.
  await pane.locator('[data-issues]').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-issue-filter="dependency"]').click();
  await expect(dialog.locator('[data-issues-empty="filtered"]')).toContainText('Нет проблем по выбранному фильтру');
  await dialog.locator('[data-issues-close]').click();
  await pane.locator('[data-issues]').click();
  await dialog.locator('[data-issue-search]').fill('Модуль 8');
  await dialog.locator('[data-issue-show]').first().click();
  await expect(dialog).toHaveCount(0);
  await expect(pane.locator('.plan-gantt__chart')).toContainText('Модуль 8');
});

test('фильтр без совпадений и пустой план — различимые пустые состояния', async ({ page }) => {
  await page.setViewportSize({ width: 1856, height: 1269 });
  await page.goto('/');
  const { pane, documentId } = await createDocumentWindow(page, 'План', 'Проблемы пусто');
  const fsOnly = {
    calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
    resources: [{ id: 'r0', title: 'Один' }],
    workTypes: [],
    groups: [],
    tasks: [
      { id: 'a', title: 'Предшественник', start: '2026-10-12', end: '2026-10-16' },
      { id: 'b', title: 'Ранняя задача', start: '2026-10-13', end: '2026-10-14' },
    ],
    dependencies: [{ id: 'd1', fromTaskId: 'a', toTaskId: 'b', lagDays: 0 }],
    unavailability: [],
  };
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: fsOnly });

  await pane.locator('[data-issues]').click();
  const dialog = page.getByRole('dialog', { name: 'Проблемы плана' });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-issue-filter="unavailability"]').click();
  await expect(dialog.locator('[data-issues-empty="filtered"]')).toContainText('Нет проблем по выбранному фильтру');

  // Чистый план: «Проблем нет».
  await dialog.locator('[data-issues-close]').click();
  await page.evaluate(({ id }) => window.__projectBoard!.writeDocumentContent(id, {
    calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
    resources: [], workTypes: [], groups: [],
    tasks: [{ id: 'a', title: 'Спокойная задача', start: '2026-10-12', end: '2026-10-13' }],
    dependencies: [], unavailability: [],
  }), { id: documentId });
  await pane.locator('[data-issues]').click();
  await expect(dialog.locator('[data-issues-empty="none"]')).toContainText('Проблем нет');
});
