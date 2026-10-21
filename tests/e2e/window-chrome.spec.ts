import { expect, test } from '@playwright/test';

test('сворачивание прячет содержимое, разворачивание возвращает черновик', async ({
  page,
}) => {
  await page.goto('/');
  const pane1 = page.getByRole('group', { name: 'Экземпляр 1 · Список 1' });

  await pane1.getByPlaceholder('Новая задача…').fill('Черновик сохраняется');
  await pane1
    .getByRole('button', { name: 'Свернуть Экземпляр 1 · Список 1' })
    .click();

  await expect(pane1.getByPlaceholder('Новая задача…')).toBeHidden();
  await expect(pane1.getByText('Экземпляр 1 · Список 1').first()).toBeVisible();

  await pane1
    .getByRole('button', { name: 'Развернуть Экземпляр 1 · Список 1' })
    .click();
  const draft = pane1.getByPlaceholder('Новая задача…');
  await expect(draft).toBeVisible();
  await expect(draft).toHaveValue('Черновик сохраняется');

  // Редактирование внутри окна не затрагивает рамку (spec widget-windows).
  await draft.fill('Пункт поверх рамки');
  await draft.press('Enter');
  await expect(pane1.getByText('Пункт поверх рамки')).toBeVisible();
  await expect(pane1.getByPlaceholder('Новая задача…')).toBeVisible();
  await expect(
    pane1.getByRole('button', { name: 'Свернуть Экземпляр 1 · Список 1' }),
  ).toBeVisible();
});

test('закрытие одного из двух представлений сохраняет документ во втором', async ({
  page,
}) => {
  await page.goto('/');
  const pane1 = page.getByRole('group', { name: 'Экземпляр 1 · Список 1' });
  const pane2 = page.getByRole('group', { name: 'Экземпляр 2 · Список 1' });

  await pane1.getByPlaceholder('Новая задача…').fill('Живёт во втором окне');
  await pane1.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Сохраняется…')).toBeVisible();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 5000 });
  // Дебаунс 250мс + холодная запись IDB (PBT-016) — иначе reload обрывает запись.
  await page.waitForTimeout(1500);

  await pane1
    .getByRole('button', { name: 'Закрыть Экземпляр 1 · Список 1' })
    .click();
  await expect(pane1).toHaveCount(0);
  await expect(pane2.getByText('Живёт во втором окне')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: /Чек-лист/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Каталог виджетов' })
    .getByRole('button', { name: 'Список 1' })
    .click();

  const reopened = page.getByRole('group', {
    name: 'Чек-лист · Список 1',
  });
  await expect(reopened).toBeVisible();
  await expect(reopened.getByText('Живёт во втором окне')).toBeVisible();
});

test('клик по рамке переключает активное окно', async ({ page }) => {
  await page.goto('/');
  const pane1 = page.getByRole('group', { name: 'Экземпляр 1 · Список 1' });
  const pane2 = page.getByRole('group', { name: 'Экземпляр 2 · Список 1' });

  await expect(pane1).toHaveAttribute('data-active', 'true');
  await expect(pane2).toHaveAttribute('data-active', 'false');

  await pane2.getByText('Экземпляр 2 · Список 1').click();

  await expect(pane2).toHaveAttribute('data-active', 'true');
  await expect(pane1).toHaveAttribute('data-active', 'false');
});

test('кнопки окна доступны с клавиатуры', async ({ page }) => {
  await page.goto('/');
  const pane1 = page.getByRole('group', { name: 'Экземпляр 1 · Список 1' });

  await pane1
    .getByRole('button', { name: 'Свернуть Экземпляр 1 · Список 1' })
    .focus();
  await page.keyboard.press('Enter');

  await expect(pane1.getByPlaceholder('Новая задача…')).toBeHidden();

  await pane1
    .getByRole('button', { name: 'Развернуть Экземпляр 1 · Список 1' })
    .focus();
  await page.keyboard.press('Enter');

  await expect(pane1.getByPlaceholder('Новая задача…')).toBeVisible();
});
