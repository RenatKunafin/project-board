import { expect, test } from '@playwright/test';

test('план создаётся через каталог, переживает перезагрузку и открывается по документу', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Добавить виджет' }).click();

  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await expect(catalog.getByText('📅')).toBeVisible();
  await catalog.getByRole('button', { name: /План/ }).click();

  const choice = page.getByRole('dialog', { name: 'Выбор документа' });
  await expect(choice.getByRole('heading', { name: 'План' })).toBeVisible();
  await choice.getByLabel('Название нового плана').fill('ОКАД');
  await choice.getByRole('button', { name: 'Создать' }).click();

  const pane = page.getByRole('group', { name: 'План · ОКАД' });
  await expect(pane).toBeVisible();
  await expect(pane.getByText('ОКАД')).toBeVisible();
  await expect(pane.getByText('Задачи: 0')).toBeVisible();

  await expect(page.getByText('Сохраняется…')).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1500); // дебаунс 250мс + запись IDB (PBT-016: до ~500мс) — иначе reload обрывает запись

  // Панели живут в памяти: после перезагрузки документ открывается заново по каталогу.
  await page.reload();
  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  const reopened = page.getByRole('dialog', { name: 'Выбор документа' });
  await reopened.getByRole('button', { name: 'ОКАД' }).click();

  const restored = page.getByRole('group', { name: 'План · ОКАД' });
  await expect(restored).toBeVisible();
  await expect(restored.getByText('ОКАД')).toBeVisible();
});

test('второе представление существующего плана показывает тот же документ', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  const choice = page.getByRole('dialog', { name: 'Выбор документа' });
  await choice.getByLabel('Название нового плана').fill('Ремонт');
  await choice.getByRole('button', { name: 'Создать' }).click();
  await expect(
    page.getByRole('group', { name: 'План · Ремонт' }),
  ).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Добавить виджет' }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /План/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Выбор документа' })
    .getByRole('button', { name: 'Ремонт' })
    .click();

  const panes = page.getByRole('group', { name: 'План · Ремонт' });
  await expect(panes).toHaveCount(2);
  await expect(panes.first().getByText('Задачи: 0')).toBeVisible();
  await expect(panes.nth(1).getByText('Задачи: 0')).toBeVisible();
});
