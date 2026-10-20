import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * PBT-048: редактирование сроков в ресурсном виде (PBT-047 + жесты).
 * ADR-5: жест после клика-выделения, факт применяется после mouseup
 * («факт → правила ядра → применение»). A2: перенос сохраняет рабочую
 * длительность с привязкой начала к рабочему дню; A3: край — дата как
 * введена. Переназначение ресурса жестом исключено (DoD-5).
 */
const planContent = {
  title: 'Дорожки-ред',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-10-14'],
    workingExceptions: [],
  },
  workTypes: [
    { id: 'wt-dev', title: 'Разработка', allowsParallel: false },
    { id: 'wt-psi', title: 'ПСИ', allowsParallel: true },
  ],
  resources: [
    { id: 'r-qa', title: 'QA' },
    { id: 'r-qa2', title: 'QA2' },
  ],
  groups: [],
  tasks: [
    // Конфликтующие непараллелизуемые работы QA (праздник 14.10 внутри).
    {
      id: 't-a',
      title: 'Задача A',
      assigneeIds: ['r-qa'],
      workTypeIds: ['wt-dev'],
      start: '2026-10-12',
      end: '2026-10-16',
    },
    {
      id: 't-b',
      title: 'Задача B',
      assigneeIds: ['r-qa'],
      workTypeIds: ['wt-dev'],
      start: '2026-10-14',
      end: '2026-10-18',
    },
    // Двухресурсная (ПСИ): элемент на каждой дорожке (D1).
    {
      id: 't-psi',
      title: 'ПСИ',
      assigneeIds: ['r-qa', 'r-qa2'],
      workTypeIds: ['wt-psi'],
      start: '2026-10-19',
      end: '2026-10-20',
    },
    // Одиночная у QA2: холостой жест и форма.
    {
      id: 't-c',
      title: 'Свободная',
      assigneeIds: ['r-qa2'],
      start: '2026-10-22',
      end: '2026-10-23',
    },
  ],
  dependencies: [],
  unavailability: [
    { id: 'u-1', resourceId: 'r-qa', start: '2026-10-13', end: '2026-10-14' },
  ],
};

async function createResourcesView(
  page: Page,
  title: string,
): Promise<{ documentId: string; pane: Locator }> {
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Ресурсы' })
    .click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByLabel('Название нового документа').fill(title);
  await choice.getByRole('button', { name: 'Создать' }).click();
  const pane = page.getByRole('group', { name: `Ресурсы · ${title}` });
  await expect(pane).toBeVisible();
  const documentId = await pane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  expect(documentId).not.toBeNull();
  return { documentId: documentId as string, pane };
}

async function loadPlan(page: Page, documentId: string): Promise<void> {
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  // t-a, t-b, t-psi ×2, t-c, u-1
  await expect(
    page.locator(`[data-document-id="${documentId}"] .rct-item`),
  ).toHaveCount(6);
}

async function planState(
  page: Page,
  documentId: string,
): Promise<{ revision: number; tasks: Record<string, { start: string; end: string; assigneeIds?: readonly string[] }> }> {
  return page.evaluate((id) => {
    const doc = window.__projectBoard?.readDocument(id);
    const tasks: Record<string, { start: string; end: string; assigneeIds?: readonly string[] }> = {};
    for (const task of (doc?.content?.tasks ?? []) as Array<{ id: string; start: string; end: string; assigneeIds?: readonly string[] }>) {
      tasks[task.id] = { start: task.start, end: task.end, assigneeIds: task.assigneeIds };
    }
    return { revision: doc?.revision ?? 0, tasks };
  }, documentId);
}

test('drag конфликтующей работы: конфликт снят, A2 (рабочая длительность), одна ревизия', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const { documentId, pane } = await createResourcesView(page, 'Дорожки-ред');
  await loadPlan(page, documentId);
  const chart = pane.locator('[data-rt-chart]');

  // Обе конфликтующие полосы помечены ядром.
  await expect(chart.locator('[data-rt-task="t-a"]')).toHaveClass(
    /rtl-item--conflict/,
  );
  await expect(chart.locator('[data-rt-task="t-b"]')).toHaveClass(
    /rtl-item--conflict/,
  );

  // Выделение t-b, затем drag на 5 дней вправо (17.10 — суббота):
  // A2 — начало привязывается вперёд к понедельнику 19.10.
  const item = chart.locator('[data-rt-task="t-b"]');
  await item.click();
  // Выделение включает interactjs на элементе (бета) — ждем монтирования.
  await page.waitForTimeout(250);
  const box = await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width };
  });
  // t-b: 14–18 (5 календарных дней) → пикселей на день.
  const dayPx = box.width / 5;
  await page.mouse.move(box.cx, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx + dayPx * 2.5, box.cy, { steps: 6 });
  await page.mouse.move(box.cx + dayPx * 5 + dayPx / 3, box.cy, { steps: 8 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  // Применение факта — setTimeout 60 мс после mouseup + запись.
  await page.waitForTimeout(400);

  const state = await planState(page, documentId);
  // 14+5=17 (сб) → привязка вперёд: пн 19.10; рабочая длительность 14–18
  // = 2 дня (14 — праздник, 17–18 — выходные) → конец = 20.10.
  expect(state.tasks['t-b']?.start).toBe('2026-10-19');
  expect(state.tasks['t-b']?.end).toBe('2026-10-20');
  // Конфликт работ снят: t-b больше не помечена. t-a остаётся помеченной —
  // её пересечение с отпуском QA (13–14) сохраняется (D6: параллельность
  // игнорируется), это другой тип конфликта из той же диагностики.
  await expect(chart.locator('[data-rt-task="t-b"]')).not.toHaveClass(
    /rtl-item--conflict/,
  );
  await expect(chart.locator('[data-rt-task="t-a"]')).toHaveClass(
    /rtl-item--conflict/,
  );
  // Одна запись жеста: ревизия выросла ровно на 1 (2 → 3).
  expect(state.revision).toBe(3);
});

test('drag двухресурсной задачи на второй дорожке правит задачу один раз', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const { documentId, pane } = await createResourcesView(page, 'Дорожки-ред');
  await loadPlan(page, documentId);
  const chart = pane.locator('[data-rt-chart]');

  // Элемент ПСИ на дорожке QA2 (второй из двух).
  const psiOnQa2 = chart.locator('[data-rt-task="t-psi"]').nth(1);
  await psiOnQa2.click();
  await page.waitForTimeout(250);
  const box = await psiOnQa2.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width };
  });
  const dayPx = box.width / 2; // ПСИ 19–20 — 2 календарных дня
  await page.mouse.move(box.cx, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx + dayPx * 3, box.cy, { steps: 8 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  // Применение факта — setTimeout 60 мс после mouseup + запись.
  await page.waitForTimeout(400);

  const state = await planState(page, documentId);
  // 19+3=22 (чт, рабочий); конец = следующий рабочий день (23).
  expect(state.tasks['t-psi']?.start).toBe('2026-10-22');
  expect(state.tasks['t-psi']?.end).toBe('2026-10-23');
  // Оба элемента задачи сместились влево на одинаковую величину.
  const lefts: number[] = [];
  for (const element of await chart.locator('[data-rt-task="t-psi"]').all()) {
    lefts.push(
      await element.evaluate((el) => Math.round(el.getBoundingClientRect().left)),
    );
  }
  expect(lefts).toHaveLength(2);
  expect(Math.abs(lefts[0] - lefts[1])).toBeLessThan(3);
});

test('resize правого края на выходной сохраняет дату края (A3); вертикаль не переназначает; холостой жест без записи', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const { documentId, pane } = await createResourcesView(page, 'Дорожки-ред');
  await loadPlan(page, documentId);
  const chart = pane.locator('[data-rt-chart]');
  const revisionBefore = (await planState(page, documentId)).revision;

  // Выделение t-a, затем drag правой ручки на 2 дня: край 17→19 (исключительный)
  // = включительное окончание 18.10 (вс) — A3: дата сохраняется как введена.
  const item = chart.locator('[data-rt-task="t-a"]');
  await item.click();
  await page.waitForTimeout(250);
  const handle = item.locator('.rct-item-handler-right');
  await expect(handle).toBeAttached();
  const box = await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width };
  });
  const dayPx = box.width / 5;
  await page.mouse.move(box.cx + box.width / 2 - 4, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx + box.width / 2 + dayPx * 2, box.cy, { steps: 8 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(400);

  let state = await planState(page, documentId);
  expect(state.tasks['t-a'].end).toBe('2026-10-18');
  expect(state.tasks['t-a'].start).toBe('2026-10-12');

  // Вертикальный drag ПСИ вниз (на дорожку QA2): назначение не меняется.
  const psi = chart.locator('[data-rt-task="t-psi"]').first();
  await psi.click();
  await page.waitForTimeout(250);
  const psiBox = await psi.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width };
  });
  await page.mouse.move(psiBox.cx, psiBox.cy);
  await page.mouse.down();
  await page.mouse.move(psiBox.cx + 30, psiBox.cy + 40, { steps: 8 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(400);
  state = await planState(page, documentId);
  expect(state.tasks['t-psi'].assigneeIds).toEqual(['r-qa', 'r-qa2']);

  // Холостой жест (сдвиг меньше половины дня): ревизия не растёт.
  const free = chart.locator('[data-rt-task="t-c"]');
  await free.click();
  await page.waitForTimeout(250);
  const freeBox = await free.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width };
  });
  const revisionBeforeIdle = (await planState(page, documentId)).revision;
  await page.mouse.move(freeBox.cx, freeBox.cy);
  await page.mouse.down();
  await page.mouse.move(freeBox.cx + 3, freeBox.cy, { steps: 3 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(300);
  state = await planState(page, documentId);
  expect(state.tasks['t-c']?.start).toBe('2026-10-22');
  expect(state.tasks['t-c']?.end).toBe('2026-10-23');
  expect(state.revision).toBe(revisionBeforeIdle);
  expect(state.revision).toBeGreaterThanOrEqual(revisionBefore);
});

test('форма задачи по dblclick; правка попеременно с проектным видом даёт тот же результат', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const { documentId, pane } = await createResourcesView(page, 'Дорожки-ред');
  await loadPlan(page, documentId);
  const chart = pane.locator('[data-rt-chart]');

  // Двойной клик по элементу открывает общую форму задачи.
  const item = chart.locator('[data-rt-task="t-c"]');
  await item.click();
  await item.dblclick();
  const dialog = pane.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-task-field="title"]')).toHaveValue(
    'Свободная',
  );
  await expect(dialog.locator('[data-task-field="start"]')).toHaveValue(
    '2026-10-22',
  );
  await expect(dialog.locator('[data-task-field="duration"]')).toHaveValue('2');

  // Длительность 2 → 3; сохранение из ресурсного вида.
  await dialog.locator('[data-task-field="duration"]').fill('3');
  await dialog.locator('[data-task-save]').click();
  await expect(dialog).not.toBeAttached();
  const state = await planState(page, documentId);
  expect(state.tasks['t-c']?.start).toBe('2026-10-22');
  expect(state.tasks['t-c']?.end).toBe('2026-10-26');
  expect(state.tasks['t-c']?.assigneeIds).toEqual(['r-qa2']);

  // Проектный вид на том же документе: форма показывает те же даты.
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'План', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Дорожки-ред' })
    .click();
  const ganttPane = page.getByRole('group', { name: 'План · Дорожки-ред' });
  await expect(ganttPane).toBeVisible();
  await expect(ganttPane.locator('.wx-row[data-id=":t-c"]')).toBeVisible();
  await ganttPane
    .locator('.plan-gantt__chart')
    .locator('.wx-row[data-id=":t-c"]')
    .dblclick();
  const ganttDialog = ganttPane.getByRole('dialog');
  await expect(ganttDialog).toBeVisible();
  await expect(ganttDialog.locator('[data-task-field="start"]')).toHaveValue(
    '2026-10-22',
  );
  await expect(ganttDialog.locator('[data-task-field="duration"]')).toHaveValue(
    '3',
  );
});
