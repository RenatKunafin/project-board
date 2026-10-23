import { expect, test } from '@playwright/test';

test('план создаётся через каталог, переживает перезагрузку и открывается по документу', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();

  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await expect(catalog.getByRole('button', { name: 'План', exact: true }).locator('svg.lucide-calendar-range')).toBeVisible();
  await catalog.getByRole('button', { name: /План/ }).click();

  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await expect(choice.getByRole('heading', { name: 'План' })).toBeVisible();
  await choice.getByLabel('Название нового документа').fill('ОКАД');
  await choice.getByRole('button', { name: 'Создать' }).click();

  const pane = page.getByRole('group', { name: 'План · ОКАД' });
  await expect(pane).toBeVisible();
  // План открывается в представлении Гантта (PBT-037).
  await expect(pane.locator('.plan-gantt__chart')).toBeVisible();
  await expect(pane.locator('[data-plan-title]')).toHaveAttribute(
    'data-plan-title',
    'ОКАД',
  );

  await expect(page.getByText('Сохраняется…')).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1500); // дебаунс 250мс + запись IDB (PBT-016: до ~500мс) — иначе reload обрывает запись

  // Панели живут в памяти: после перезагрузки документ открывается заново по каталогу.
  await page.reload();
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  const reopened = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await reopened.getByRole('button', { name: 'ОКАД' }).click();

  const restored = page.getByRole('group', { name: 'План · ОКАД' });
  // Перезагрузка восстанавливает сохранённое окно плана (PBT-024),
  // открытие из каталога добавляет второе представление того же документа.
  await expect(restored).toHaveCount(2);
  await expect(restored.first().locator('.plan-gantt__chart')).toBeVisible();
});

test('второе представление существующего плана показывает тот же документ', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  const choice = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await choice.getByLabel('Название нового документа').fill('Ремонт');
  await choice.getByRole('button', { name: 'Создать' }).click();
  await expect(
    page.getByRole('group', { name: 'План · Ремонт' }),
  ).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Ремонт' })
    .click();

  const panes = page.getByRole('group', { name: 'План · Ремонт' });
  await expect(panes).toHaveCount(2);
  await expect(panes.first().locator('.plan-gantt__chart')).toBeVisible();
  await expect(panes.nth(1).locator('.plan-gantt__chart')).toBeVisible();
});
