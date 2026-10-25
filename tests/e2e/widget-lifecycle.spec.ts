import { expect, test } from '@playwright/test';

async function subscriptionCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => window.__projectBoard?.activeSubscriptionCount() ?? -1);
}

test.describe('жизненный цикл скрытых виджетов (PBT-027)', () => {
  test('цикл ×20 «открыть → свернуть/развернуть → закрыть» не умножает подписки', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
    // Дождаться монтирования среза: подписки появляются в эффектах.
    await expect(page.getByRole('group', { name: 'Экземпляр 1 · Список 1', exact: true })).toBeVisible();
    const base = await subscriptionCount(page);
    expect(base).toBeGreaterThanOrEqual(1);

    const catalogButton = page.getByRole('button', { name: 'Виджеты', exact: true });
    const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });

    for (let cycle = 0; cycle < 20; cycle += 1) {
      await catalogButton.click();
      await catalog.getByRole('button', { name: /Чек-лист/ }).click();
      await catalog.getByRole('button', { name: 'Список 1' }).click();

      const window = page
        .getByRole('group', { name: 'Чек-лист · Список 1' })
        .last();
      await expect(window).toBeVisible();
      const afterOpen = await subscriptionCount(page);
      // Открытия/закрытия взаимно гасятся: после открытия всегда base + 1.
      expect(afterOpen).toBe(base + 1);

      await window.getByRole('button', { name: 'Свернуть Чек-лист · Список 1' }).click();
      await window.getByRole('button', { name: 'Развернуть Чек-лист · Список 1' }).click();

      await page
        .getByRole('button', { name: 'Закрыть Чек-лист · Список 1' })
        .last()
        .click();
      // Закрытие гасит открытие: счётчик возвращается к базовому.
      await expect(subscriptionCount(page)).resolves.toBe(base);
    }

    expect(await subscriptionCount(page)).toBe(base);
  });

  test('черновик переживает переключение вкладок', async ({ page }) => {
    await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
    const pane1 = page.getByRole('group', { name: 'Экземпляр 1 · Список 1', exact: true });
    await pane1.getByPlaceholder('Новая задача…').fill('Живой черновик');

    const tablist = page.getByRole('tablist', { name: 'Вкладки рабочего пространства' });
    await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
    await tablist.getByRole('tab', { name: /Чек-листы/ }).click();

    await expect(
      pane1.getByPlaceholder('Новая задача…'),
    ).toHaveValue('Живой черновик');
  });

  test('скрытая вкладка показывает актуальный документ при возврате', async ({ page }) => {
    await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
    const tablist = page.getByRole('tablist', { name: 'Вкладки рабочего пространства' });

    // На второй вкладке открываем окно «Список 1».
    await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
    await page.getByRole('button', { name: 'Виджеты', exact: true }).click();
    const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
    await catalog.getByRole('button', { name: /Чек-лист/ }).click();
    await catalog.getByRole('button', { name: 'Список 1' }).click();
    const hiddenView = page.getByRole('group', { name: 'Чек-лист · Список 1' });
    await expect(hiddenView).toBeVisible();

    // На первой вкладке другой экземпляр меняет общий документ.
    await tablist.getByRole('tab', { name: /Чек-листы/ }).click();
    const pane2 = page.getByLabel('Экземпляр 2 · Список 1');
    await pane2.getByPlaceholder('Новая задача…').fill('Пришло с активной');
    await pane2.getByRole('button', { name: 'Добавить' }).click();
    await expect(page.getByText('Сохранено')).toBeVisible();

    // Возврат: скрытая вкладка показывает актуальное содержимое.
    await tablist.getByRole('tab', { name: /Новая вкладка/ }).click();
    await expect(hiddenView.getByText('Пришло с активной')).toBeVisible();
  });
});
