import { expect, test } from '@playwright/test';

/**
 * PBT-073: масштаб шкалы «Дни/Недели» (design D3) и сохранение позиции
 * прокрутки шкалы при разворачивании окна (design D6, техдолг D8 PBT-071).
 */

/** Контрольный план: длинная шкала с запасом для прокрутки. */
const longPlanContent = {
  title: 'Длинный план',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-11-04'],
    workingExceptions: [],
  },
  workTypes: [
    { id: 'dev', title: 'Разработка', allowsParallel: false },
  ],
  resources: [{ id: 'r1', title: 'Разработчик R1' }],
  groups: [{ id: 'g-1', title: 'Этап 1' }],
  tasks: [
    {
      id: 't-start',
      title: 'Стартовая задача',
      groupId: 'g-1',
      start: '2026-10-12',
      end: '2026-10-16',
      assigneeIds: ['r1'],
      workTypeIds: ['dev'],
    },
    {
      id: 't-far',
      title: 'Далёкая задача января',
      groupId: 'g-1',
      start: '2027-01-11',
      end: '2027-01-15',
      assigneeIds: ['r1'],
      workTypeIds: ['dev'],
    },
  ],
  dependencies: [],
  unavailability: [],
};

const smallPlanContent = {
  title: 'Малый набор',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    workingExceptions: [],
  },
  workTypes: [
    { id: 'dev', title: 'Разработка', allowsParallel: false },
  ],
  resources: [{ id: 'r1', title: 'Разработчик R1' }],
  groups: [{ id: 'g-1', title: 'Фаза 1' }],
  tasks: [
    {
      id: 't-a',
      title: 'Задача A',
      groupId: 'g-1',
      start: '2026-10-12',
      end: '2026-10-16',
      assigneeIds: ['r1'],
      workTypeIds: ['dev'],
    },
  ],
  dependencies: [],
  unavailability: [],
};

async function createPlan(
  page: import('@playwright/test').Page,
  title: string,
  content: unknown,
): Promise<string> {
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
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
  await page.evaluate(
    ({ id, plan }) => window.__projectBoard?.writeDocumentContent(id, plan),
    { id: documentId, plan: content },
  );
  return documentId as string;
}

/** Признак формата подписи дня в шкале: дд.мм (days) или число (weeks).
 * Шкала виртуализирована — конкретный день может отсутствовать в DOM,
 * поэтому формат проверяется паттерном по видимым подписям. */
async function scaleDayFormat(
  page: import('@playwright/test').Page,
): Promise<'dayMonth' | 'dayOnly' | 'unknown'> {
  const text = await page.evaluate(() => {
    const scale = document.querySelector('.plan-gantt__chart .wx-scale');
    return scale ? (scale.textContent || '') : '';
  });
  if (/\d{2}\.\d{2}/.test(text)) {
    return 'dayMonth';
  }
  if (/\d{1,2}/.test(text)) {
    return 'dayOnly';
  }
  return 'unknown';
}

/** scrollLeft чарта (контейнер .wx-chart — единственный крупный скроллер). */
async function chartScrollLeft(
  page: import('@playwright/test').Page,
): Promise<number> {
  return page.evaluate(() => {
    const chart = document.querySelector('.plan-gantt__chart .wx-chart');
    return chart ? (chart as HTMLElement).scrollLeft : -1;
  });
}

test('зум «Дни/Недели» меняет ширину клетки и подписи дня, переживает reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await createPlan(page, 'Зум-план', smallPlanContent);

  const pane = page.getByRole('group', { name: 'План · Зум-план' });
  const chart = pane.locator('.plan-gantt__chart');
  await expect(chart).toBeVisible();
  await expect(chart.getByText('Задача A').first()).toBeVisible();

  // Ширина клетки дня — из полосы задачи A (пн 12.10–пт 16.10, 5 дней).
  const barWidth = async (): Promise<number> => {
    const bar = chart.locator('.wx-bar[data-id=":t-a"]');
    return (await bar.boundingBox())!.width;
  };

  // Дефолт — «Недели»: компактная плотность PBT-068 (33px, допуск ±2).
  await page.waitForTimeout(600);
  expect(Math.abs((await barWidth()) / 5 - 33)).toBeLessThanOrEqual(2);
  await expect(pane.locator('[data-zoom-weeks]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await scaleDayFormat(page)).toBe('dayOnly');

  // «Дни»: клетка 48px, подписи дня — дд.мм.
  await pane.locator('[data-zoom-days]').click();
  await expect(chart.getByText('Задача A').first()).toBeVisible();
  await page.waitForTimeout(600);
  expect(Math.abs((await barWidth()) / 5 - 48)).toBeLessThanOrEqual(2);
  expect(await scaleDayFormat(page)).toBe('dayMonth');

  // «Недели»: подпись дня — только число.
  await pane.locator('[data-zoom-weeks]').click();
  await expect(chart.getByText('Задача A').first()).toBeVisible();
  await page.waitForTimeout(600);
  expect(await scaleDayFormat(page)).toBe('dayOnly');

  // Масштаб — состояние экземпляра: reload восстанавливает выбранный зум.
  await pane.locator('[data-zoom-days]').click();
  await expect(chart.getByText('Задача A').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.reload();
  const restored = page.getByRole('group', { name: 'План · Зум-план' });
  await expect(restored).toBeVisible();
  const restoredChart = restored.locator('.plan-gantt__chart');
  await expect(restoredChart.getByText('Задача A').first()).toBeVisible();
  await expect(restored.locator('[data-zoom-days]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const restoredBar = restoredChart.locator('.wx-bar[data-id=":t-a"]');
  expect(
    Math.abs((await restoredBar.boundingBox())!.width / 5 - 48),
  ).toBeLessThanOrEqual(2);
});

test('разворачивание окна сохраняет позицию прокрутки шкалы (D8 PBT-071)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await createPlan(page, 'Прокрутка', longPlanContent);

  const pane = page.getByRole('group', { name: 'План · Прокрутка' });
  const chart = pane.locator('.plan-gantt__chart');
  await expect(chart.getByText('Стартовая задача').first()).toBeVisible();
  // Пауза стабилизации: writeDocumentContent пересобирает представление
  // по ревизии (прецедент PBT-051) — скроллим уже собранный чарт.
  await page.waitForTimeout(1500);

  // Прокручиваем шкалу к середине плана (край диапазона даёт кламп
  // к максимуму при развороте — это корректно, но не проверяемо точно).
  await page.evaluate(() => {
    const chart = document.querySelector('.plan-gantt__chart .wx-chart');
    if (chart) {
      chart.scrollLeft = Math.floor(
        (chart.scrollWidth - chart.clientWidth) / 2,
      );
    }
  });
  await page.waitForTimeout(400);
  const before = await chartScrollLeft(page);
  expect(before).toBeGreaterThan(500);

  // Разворачиваем окно на весь дашборд: SVAR пересобирает шкалу под новую
  // ширину — позиция взгляда восстанавливается (debounce 150 + серия
  // попыток 0/150/350 мс).
  await pane
    .getByRole('button', { name: /^Развернуть на весь дашборд/ })
    .click();
  await expect(
    page.locator('.widget-maximize-layer .plan-gantt__chart'),
  ).toBeVisible();
  await page.waitForTimeout(1200);

  const after = await chartScrollLeft(page);
  // Позиция сохранена с точностью до дня (ширина контента неизменна,
  // cellWidth не менялся при resize).
  expect(Math.abs(after - before)).toBeLessThanOrEqual(33);
});
