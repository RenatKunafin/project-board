import { expect, test, type Page } from './app-test';

/**
 * PBT-141: цветовые метки дат (особые даты) на проектном Гантте.
 * Метки декоративны: не влияют на длительности и календарь, перекрывают
 * подсветку нерабочих дней, видны в обоих масштабах с дневной точностью,
 * не отображаются ресурсным видом и переживают перезапуск.
 */
const planContent = {
  title: 'Особые даты',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-10-14'],
    workingExceptions: [],
  },
  workTypes: [],
  resources: [],
  groups: [],
  tasks: [
    { id: 't-1', title: 'Задача 1', start: '2026-10-12', end: '2026-10-16' },
  ],
  dependencies: [],
  unavailability: [],
};

async function createPlan(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
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

async function openSettings(page: Page, paneTitle: string, index = 0) {
  const pane = page.getByRole('group', { name: `План · ${paneTitle}` }).nth(index);
  await pane.locator('[data-catalogs]').click();
  const dialog = pane.getByRole('dialog', { name: 'Настройки плана' });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-settings-section="calendar"]').click();
  return dialog;
}

interface Stripe {
  readonly mark: string | null;
  readonly kind: string | null;
  readonly width: number;
}

async function readStripes(page: Page, scope: string): Promise<Stripe[] | null> {
  return page.evaluate((selector) => {
    const layer = document.querySelector(
      `${selector} .plan-gantt__chart .wx-gantt-holidays`,
    );
    if (!layer) {
      return null;
    }
    return [...layer.children].map((child) => ({
      mark: child.getAttribute('data-gantt-day-mark'),
      kind: child.getAttribute('data-gantt-nonworking'),
      width: parseFloat((child as HTMLElement).style.width),
    }));
  }, scope);
}

test('метка в недельном режиме: перекрывает праздник и выходные, длительности не меняются', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Особые даты');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: planContent },
  );
  const pane = page.locator(`[data-document-id="${documentId}"]`).nth(0);
  await expect(pane.locator('.wx-row[data-id=":t-1"]')).toContainText('4');

  const dialog = await openSettings(page, 'Особые даты');
  // Праздник 14.10 перекрашивается меткой coral (дефолтный свотч).
  await dialog.locator('[data-calendar-mark-from]').fill('2026-10-14');
  await dialog.locator('[data-calendar-add-mark]').click();
  await expect(
    dialog.locator('[data-calendar-remove-mark="2026-10-14"]'),
  ).toBeVisible();
  // Диапазон 17–18 октября (сб–вс) цветом jade.
  await dialog.locator('[data-calendar-mark-color="jade"]').check();
  await dialog.locator('[data-calendar-mark-from]').fill('2026-10-17');
  await dialog.locator('[data-calendar-mark-to]').fill('2026-10-18');
  await dialog.locator('[data-calendar-add-mark]').click();
  await expect(
    dialog.locator('[data-calendar-remove-mark="2026-10-18"]'),
  ).toBeVisible();
  await dialog.locator('[data-catalog-save]').click();

  await page.waitForTimeout(1500);
  const stripes = await readStripes(page, `[data-document-id="${documentId}"]`);
  expect(stripes).not.toBeNull();
  const list = stripes ?? [];
  // Метка на празднике: полос holiday больше нет — 14.10 перекрыт coral.
  expect(list.filter((stripe) => stripe.kind === 'holiday')).toHaveLength(0);
  // Coral — один день, jade — пара выходных, дневная точность.
  const coral = list.filter((stripe) => stripe.mark === 'coral');
  expect(coral).toHaveLength(1);
  expect(Math.abs(coral[0].width - 16)).toBeLessThanOrEqual(1);
  const jade = list.filter((stripe) => stripe.mark === 'jade');
  expect(jade).toHaveLength(1);
  expect(Math.abs(jade[0].width - 32)).toBeLessThanOrEqual(1);
  // Прочие выходные — серые пары, различимость сохранена.
  expect(list.filter((stripe) => stripe.kind === 'weekend').length).toBeGreaterThan(0);

  // Метки декоративны: праздник 14.10 продолжает уменьшать длительность.
  await expect(pane.locator('.wx-row[data-id=":t-1"]')).toContainText('4');
  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.dateMarks,
    documentId,
  );
  expect(content).toEqual([
    { date: '2026-10-14', color: 'coral' },
    { date: '2026-10-17', color: 'jade' },
    { date: '2026-10-18', color: 'jade' },
  ]);
});

test('дневной масштаб: заливка ячеек цветом метки', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Дневной режим');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: { ...planContent, title: 'Дневной режим' } },
  );
  const pane = page.locator(`[data-document-id="${documentId}"]`).nth(0);
  const dialog = await openSettings(page, 'Дневной режим');
  await dialog.locator('[data-calendar-mark-from]').fill('2026-10-14');
  await dialog.locator('[data-calendar-add-mark]').click();
  await dialog.locator('[data-catalog-save]').click();

  await pane.getByRole('button', { name: 'Дни', exact: true }).click();
  await page.waitForTimeout(600);
  const painted = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const cells = root
      ? [...root.querySelectorAll('[class*="gantt-date-mark-"]')]
      : [];
    return {
      count: cells.length,
      firstBackground: cells[0]
        ? getComputedStyle(cells[0]).backgroundColor
        : 'none',
    };
  }, `[data-document-id="${documentId}"]`);
  expect(painted.count).toBeGreaterThan(0);
  expect(painted.firstBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(painted.firstBackground).not.toBe('transparent');
});

test('второй экземпляр обновляется по ревизии; перезапуск сохраняет метки', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Общий план');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: { ...planContent, title: 'Общий план' } },
  );
  // Второй экземпляр на тот же документ.
  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Общий план' })
    .click();
  const second = page.locator(`[data-document-id="${documentId}"]`).nth(1);
  await expect(second.locator('.plan-gantt__chart')).toBeVisible();

  const dialog = await openSettings(page, 'Общий план', 0);
  await dialog.locator('[data-calendar-mark-from]').fill('2026-10-15');
  await dialog.locator('[data-calendar-add-mark]').click();
  await dialog.locator('[data-catalog-save]').click();

  await page.waitForTimeout(1500);
  // Оба экземпляра показывают метку без перезагрузки.
  for (const index of [0, 1]) {
    const stripes = await readStripesIndex(page, documentId, index);
    expect(
      (stripes ?? []).some((stripe) => stripe.mark === 'coral'),
    ).toBe(true);
  }

  await page.reload();
  const restored = await readStripesIndex(page, documentId, 0);
  expect((restored ?? []).some((stripe) => stripe.mark === 'coral')).toBe(true);
  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.dateMarks,
    documentId,
  );
  expect(content).toEqual([{ date: '2026-10-15', color: 'coral' }]);
});

async function readStripesIndex(
  page: Page,
  documentId: string,
  index: number,
): Promise<Stripe[] | null> {
  return page.evaluate(
    ({ id, nth }) => {
      const root = document.querySelectorAll(`[data-document-id="${id}"]`)[nth];
      const layer = root?.querySelector('.plan-gantt__chart .wx-gantt-holidays');
      if (!layer) {
        return null;
      }
      return [...layer.children].map((child) => ({
        mark: child.getAttribute('data-gantt-day-mark'),
        kind: child.getAttribute('data-gantt-nonworking'),
        width: parseFloat((child as HTMLElement).style.width),
      }));
    },
    { id: documentId, nth: index },
  );
}

test('отмена настроек не меняет документ', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Отмена');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: { ...planContent, title: 'Отмена' } },
  );
  page.on('dialog', (dialog) => void dialog.accept());

  const dialog = await openSettings(page, 'Отмена');
  await dialog.locator('[data-calendar-mark-from]').fill('2026-10-15');
  await dialog.locator('[data-calendar-add-mark]').click();
  await expect(
    dialog.locator('[data-calendar-remove-mark="2026-10-15"]'),
  ).toBeVisible();
  await dialog.locator('[data-catalog-close]').click();

  await page.waitForTimeout(400);
  const content = await page.evaluate(
    (id) => window.__projectBoard.readDocument(id)?.content?.dateMarks,
    documentId,
  );
  expect(content).toBeUndefined();
  const stripes = await readStripes(page, `[data-document-id="${documentId}"]`);
  expect((stripes ?? []).some((stripe) => stripe.mark !== null)).toBe(false);
});

test('ресурсное представление метки не отображает', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Ресурсы без меток');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: { ...planContent, title: 'Ресурсы без меток' } },
  );
  const dialog = await openSettings(page, 'Ресурсы без меток');
  await dialog.locator('[data-calendar-mark-from]').fill('2026-10-14');
  await dialog.locator('[data-calendar-add-mark]').click();
  await dialog.locator('[data-catalog-save]').click();

  await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Ресурсы' })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Ресурсы без меток' })
    .click();
  const pane = page.getByRole('group', { name: 'Ресурсы · Ресурсы без меток' });
  await expect(pane).toBeVisible();
  await page.waitForTimeout(800);
  await expect(pane.locator('[class*="gantt-date-mark-"]')).toHaveCount(0);
});

test('метки видны при активном фильтре задач', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const documentId = await createPlan(page, 'Фильтр');
  await page.evaluate(
    ({ id, value }) => window.__projectBoard?.writeDocumentContent(id, value),
    { id: documentId, value: { ...planContent, title: 'Фильтр' } },
  );
  const dialog = await openSettings(page, 'Фильтр');
  await dialog.locator('[data-calendar-mark-from]').fill('2026-10-15');
  await dialog.locator('[data-calendar-add-mark]').click();
  await dialog.locator('[data-catalog-save]').click();

  const pane = page.locator(`[data-document-id="${documentId}"]`).nth(0);
  await pane.locator('[data-gantt-filter-query]').fill('Задача');
  await page.waitForTimeout(600);
  const stripes = await readStripes(page, `[data-document-id="${documentId}"]`);
  expect((stripes ?? []).some((stripe) => stripe.mark === 'coral')).toBe(true);
});
