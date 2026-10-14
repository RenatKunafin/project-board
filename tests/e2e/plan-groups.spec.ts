import { expect, test, type Page } from '@playwright/test';

/**
 * PBT-040: управление группами в интерфейсе проектного Гантта.
 * Контрольные данные грузятся dev-хуком writeDocumentContent (PBT-037).
 */

interface TestGroup {
  readonly id: string;
  readonly title: string;
  readonly parentId?: string;
}

interface TestTask {
  readonly id: string;
  readonly title: string;
  readonly groupId?: string;
  readonly start: string;
  readonly end: string;
}

function planContent(groups: readonly TestGroup[], tasks: readonly TestTask[]) {
  return {
    title: 'Группы',
    calendar: {
      workingDays: [1, 2, 3, 4, 5],
      holidays: [],
      workingExceptions: [],
    },
    workTypes: [],
    resources: [],
    groups,
    tasks,
    dependencies: [],
    unavailability: [],
  };
}

async function createPlan(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByLabel('Название нового документа').fill(title);
  await choice.getByRole('button', { name: 'Создать' }).click();
  const pane = page.getByRole('group', { name: `План · ${title}` });
  await expect(pane).toBeVisible();
  const documentId = await pane
    .locator('[data-document-id]')
    .getAttribute('data-document-id');
  expect(documentId).not.toBeNull();
  return documentId as string;
}

async function seedPlan(
  page: Page,
  documentId: string,
  content: unknown,
): Promise<void> {
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: content },
  );
}

async function readContent(page: Page, documentId: string) {
  return page.evaluate(
    (id) => window.__projectBoard?.readDocument(id)?.content,
    documentId,
  );
}

async function readRevision(page: Page, documentId: string) {
  return page.evaluate(
    (id) => window.__projectBoard?.readDocument(id)?.revision,
    documentId,
  );
}

function paneOf(page: Page, title: string) {
  return page.getByRole('group', { name: `План · ${title}` });
}

const flatPlan = planContent(
  [],
  [
    { id: 't-1', title: 'Аналитика', start: '2026-10-12', end: '2026-10-14' },
    { id: 't-2', title: 'Разработка', start: '2026-10-15', end: '2026-10-20' },
  ],
);

test('из плоского плана строится структура «направление → платформа → задачи», порядок сохраняется после reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Структура');
  await seedPlan(page, documentId, flatPlan);

  const pane = paneOf(page, 'Структура');
  const chart = pane.locator('.plan-gantt__chart');

  // Группа «Направление» на корне.
  await pane.locator('[data-add-group]').click();
  let dialog = pane.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-group-field="title"]').fill('Направление');
  await dialog.locator('[data-group-save]').click();
  await expect(dialog).not.toBeAttached();

  // Подгруппа «Платформа» внутри «Направления».
  await pane.locator('[data-add-group]').click();
  dialog = pane.getByRole('dialog');
  await dialog.locator('[data-group-field="title"]').fill('Платформа');
  await dialog
    .locator('[data-group-field="parent"]')
    .selectOption({ label: 'Направление' });
  await dialog.locator('[data-group-save]').click();
  await expect(dialog).not.toBeAttached();

  // Задачи переносятся в «Платформу» через форму задачи.
  for (const taskTitle of ['Аналитика', 'Разработка']) {
    await chart.getByText(taskTitle).first().dblclick();
    const taskDialog = pane.getByRole('dialog');
    await expect(taskDialog).toBeVisible();
    await taskDialog
      .locator('[data-task-field="group"]')
      .selectOption({ label: 'Платформа' });
    await taskDialog.locator('[data-task-save]').click();
    await expect(taskDialog).not.toBeAttached();
  }

  // Автосохранение 1500 мс → reload → структура и порядок восстановлены.
  await page.waitForTimeout(1500);
  await page.reload();
  const restoredPane = paneOf(page, 'Структура');
  await expect(
    restoredPane
      .locator('.plan-gantt__chart')
      .getByText('Платформа')
      .first(),
  ).toBeVisible();
  const content = await readContent(page, documentId);
  expect(content.groups).toEqual([
    { id: expect.any(String), title: 'Направление' },
    {
      id: expect.any(String),
      title: 'Платформа',
      parentId: expect.any(String),
    },
  ]);
  const directionId = content.groups[0].id;
  expect(content.groups[1].parentId).toBe(directionId);
  for (const task of content.tasks) {
    expect(task.groupId).toBe(content.groups[1].id);
    expect(task.start).toBe(
      task.title === 'Аналитика' ? '2026-10-12' : '2026-10-15',
    );
  }
});

test('перенос подгруппы между родителями пересчитывает сводную и не трогает даты', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Перенос');
  await seedPlan(
    page,
    documentId,
    planContent(
      [
        { id: 'g-a', title: 'Направление A' },
        { id: 'g-b', title: 'Направление B' },
        { id: 'g-sub', title: 'Платформа', parentId: 'g-a' },
      ],
      [
        {
          id: 't-1',
          title: 'Задача 1',
          groupId: 'g-a',
          start: '2026-10-12',
          end: '2026-10-16',
        },
        {
          id: 't-2',
          title: 'Задача 2',
          groupId: 'g-sub',
          start: '2026-10-19',
          end: '2026-10-21',
        },
      ],
    ),
  );

  const pane = paneOf(page, 'Перенос');
  const chart = pane.locator('.plan-gantt__chart');

  // До переноса сводная «Направления A» охватывает обе задачи (12–21).
  const summaryA = chart.locator('.wx-bar[data-id$="g-a"]');
  await expect(summaryA).toBeVisible();
  const widthBefore = (await summaryA.boundingBox())?.width ?? 0;
  expect(widthBefore).toBeGreaterThan(0);

  await chart.getByText('Платформа').first().dblclick();
  const dialog = pane.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-group-field="title"]')).toHaveValue(
    'Платформа',
  );
  await dialog
    .locator('[data-group-field="parent"]')
    .selectOption({ label: 'Направление B' });
  await dialog.locator('[data-group-save]').click();
  await expect(dialog).not.toBeAttached();

  const content = await readContent(page, documentId);
  expect(content.groups.find((g: TestGroup) => g.id === 'g-sub').parentId).toBe(
    'g-b',
  );
  // Даты задач неприкосновенны (DoD-3).
  expect(content.tasks.find((t: TestTask) => t.id === 't-1').start).toBe(
    '2026-10-12',
  );
  expect(content.tasks.find((t: TestTask) => t.id === 't-1').end).toBe(
    '2026-10-16',
  );
  expect(content.tasks.find((t: TestTask) => t.id === 't-2').start).toBe(
    '2026-10-19',
  );
  expect(content.tasks.find((t: TestTask) => t.id === 't-2').end).toBe(
    '2026-10-21',
  );

  // Сводная «Направления A» пересчитана по оставшейся задаче (12–16):
  // полоса стала уже, подгруппа с полосой осталась видима.
  const widthAfter = (await summaryA.boundingBox())?.width ?? 0;
  expect(widthAfter).toBeLessThan(widthBefore);
  await expect(chart.locator('.wx-bar[data-id$="g-sub"]')).toBeVisible();
});

test('перенос группы в собственную подгруппу отклоняется с объяснением цикла', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Цикл');
  await seedPlan(
    page,
    documentId,
    planContent(
      [
        { id: 'g-a', title: 'Направление A' },
        { id: 'g-sub', title: 'Платформа', parentId: 'g-a' },
      ],
      [
        {
          id: 't-1',
          title: 'Задача 1',
          groupId: 'g-sub',
          start: '2026-10-12',
          end: '2026-10-16',
        },
      ],
    ),
  );

  const pane = paneOf(page, 'Цикл');
  const revisionBefore = await readRevision(page, documentId);

  await pane
    .locator('.plan-gantt__chart')
    .getByText('Направление A')
    .first()
    .dblclick();
  const dialog = pane.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog
    .locator('[data-group-field="parent"]')
    .selectOption({ label: 'Платформа' });
  await dialog.locator('[data-group-save]').click();

  // Ядро отклоняет цикл, форма объясняет причину и остаётся открытой.
  await expect(dialog.locator('[role="alert"]')).toContainText('потомка');
  await expect(dialog).toBeAttached();
  const content = await readContent(page, documentId);
  expect(content.groups.find((g: TestGroup) => g.id === 'g-a').parentId).toBeUndefined();
  expect(await readRevision(page, documentId)).toBe(revisionBefore);

  await dialog.locator('[data-group-cancel]').click();
  await expect(dialog).not.toBeAttached();
});

test('сворачивание группы — состояние экземпляра: документ и второй виджет не затронуты', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Раскрытие');
  await seedPlan(
    page,
    documentId,
    planContent(
      [{ id: 'g-a', title: 'Направление A' }],
      [
        {
          id: 't-1',
          title: 'Задача 1',
          groupId: 'g-a',
          start: '2026-10-12',
          end: '2026-10-16',
        },
      ],
    ),
  );

  // Второй экземпляр того же документа.
  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Раскрытие' })
    .click();
  const first = paneOf(page, 'Раскрытие').nth(0);
  const second = paneOf(page, 'Раскрытие').nth(1);
  await expect(second.locator('.plan-gantt__chart')).toBeVisible();

  const revisionBefore = await readRevision(page, documentId);

  // Сворачивание группы в первом экземпляре: строка задачи скрыта только там.
  await first
    .locator('.plan-gantt__chart')
    .locator('.wx-row[data-id=":g-a"] .wx-toggle-icon')
    .first()
    .click();
  await expect(
    first.locator('.plan-gantt__chart').locator('.wx-row[data-id=":t-1"]'),
  ).toHaveCount(0);
  await expect(
    second.locator('.plan-gantt__chart').locator('.wx-row[data-id=":t-1"]'),
  ).toBeVisible();
  expect(await readRevision(page, documentId)).toBe(revisionBefore);

  // Изменение документа (remount чарта) не сбрасывает сворачивание первого.
  await first.locator('[data-add-task]').click();
  const taskDialog = first.getByRole('dialog');
  await taskDialog.locator('[data-task-field="title"]').fill('Новая задача');
  await taskDialog.locator('[data-task-field="start"]').fill('2026-10-22');
  await taskDialog.locator('[data-task-save]').click();
  await expect(taskDialog).not.toBeAttached();

  await expect(
    first.locator('.plan-gantt__chart').locator('.wx-row[data-id=":t-1"]'),
  ).toHaveCount(0);
  await expect(
    first.locator('.plan-gantt__chart').getByText('Новая задача').first(),
  ).toBeVisible();
  await expect(
    second.locator('.plan-gantt__chart').locator('.wx-row[data-id=":t-1"]'),
  ).toBeVisible();
  await expect(
    second.locator('.plan-gantt__chart').getByText('Новая задача').first(),
  ).toBeVisible();
});

test('удаление группы переносит подгруппу и задачи к родителю, сохраняется после reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  const documentId = await createPlan(page, 'Удаление');
  await seedPlan(
    page,
    documentId,
    planContent(
      [
        { id: 'g-a', title: 'Направление A' },
        { id: 'g-sub', title: 'Платформа', parentId: 'g-a' },
      ],
      [
        {
          id: 't-1',
          title: 'Задача 1',
          groupId: 'g-sub',
          start: '2026-10-12',
          end: '2026-10-16',
        },
      ],
    ),
  );

  const pane = paneOf(page, 'Удаление');
  await pane
    .locator('.plan-gantt__chart')
    .getByText('Платформа')
    .first()
    .dblclick();
  const dialog = pane.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-group-delete]').click();
  await expect(dialog).not.toBeAttached();

  const content = await readContent(page, documentId);
  expect(content.groups.map((g: TestGroup) => g.id)).toEqual(['g-a']);
  expect(content.tasks[0].groupId).toBe('g-a');
  expect(content.tasks[0].start).toBe('2026-10-12');

  await page.waitForTimeout(1500);
  await page.reload();
  const restored = paneOf(page, 'Удаление');
  await expect(
    restored.locator('.plan-gantt__chart').getByText('Задача 1').first(),
  ).toBeVisible();
  const restoredContent = await readContent(page, documentId);
  expect(restoredContent.tasks[0].groupId).toBe('g-a');
});
