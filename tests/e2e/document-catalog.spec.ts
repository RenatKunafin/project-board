import { expect, test } from '@playwright/test';

test.describe.serial('каталог документов', () => {
  test('полный сценарий: создать → открыть дважды → закрыть → открыть → переименовать → перезапуск → удалить → выбрать другой', async ({
    page,
  }) => {
    await page.goto('/');

    // Создание «Покупки» на новой вкладке через каталог виджетов и пикер.
    const tablist = page.getByRole('tablist', { name: 'Вкладки рабочего пространства' });
    await tablist.getByRole('button', { name: 'Новая вкладка' }).click();
    await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
    const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
    await catalog.getByRole('button', { name: /Чек-лист/ }).click();
    await catalog.getByLabel('Название нового документа').fill('Покупки');
    await catalog.getByRole('button', { name: 'Создать' }).click();

    const firstView = page.getByRole('group', { name: 'Чек-лист · Покупки' });
    await expect(firstView).toBeVisible();
    await firstView.getByPlaceholder('Новый пункт').fill('Хлеб');
    await firstView.getByRole('button', { name: 'Добавить' }).click();
    await expect(page.getByText('Сохранено')).toBeVisible();

    // Повторное открытие того же документа — второе представление.
    await page.getByRole('button', { name: 'Добавить виджет', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Каталог виджетов' })
      .getByRole('button', { name: /Чек-лист/ })
      .click();
    await page
      .getByRole('dialog', { name: 'Каталог виджетов' })
      .getByRole('button', { name: 'Покупки' })
      .click();
    const secondView = page.getByRole('group', { name: 'Чек-лист · Покупки' }).nth(1);
    await expect(secondView.getByText('Хлеб')).toBeVisible();

    // Закрытие обоих окон: документ остаётся в каталоге.
    await page
      .getByRole('button', { name: 'Закрыть Чек-лист · Покупки' })
      .nth(1)
      .click();
    await page
      .getByRole('button', { name: 'Закрыть Чек-лист · Покупки' })
      .first()
      .click();
    await expect(page.getByRole('group', { name: 'Чек-лист · Покупки' })).toHaveCount(0);

    // Повторное открытие из каталога документов.
    await page.getByRole('button', { name: 'Каталог документов' }).click();
    const documents = page.getByRole('dialog', { name: 'Каталог документов' });
    await expect(
      documents.getByRole('button', { name: 'Покупки Чек-лист' }),
    ).toBeVisible();
    await documents.getByRole('button', { name: 'Покупки Чек-лист' }).click();
    const reopened = page.getByRole('group', { name: 'Чек-лист · Покупки' });
    await expect(reopened.getByText('Хлеб')).toBeVisible();

    // Переименование из каталога: подпись окна обновляется.
    await page.getByRole('button', { name: 'Каталог документов' }).click();
    await page
      .getByRole('dialog', { name: 'Каталог документов' })
      .getByRole('button', { name: /Переименовать «Покупки»/ })
      .click();
    await page
      .getByRole('dialog', { name: 'Каталог документов' })
      .getByLabel('Новое название документа')
      .fill('Продукты');
    await page
      .getByRole('dialog', { name: 'Каталог документов' })
      .getByRole('button', { name: 'Сохранить' })
      .click();
    await page.keyboard.press('Escape');

    const renamed = page.getByRole('group', { name: 'Чек-лист · Продукты' });
    await expect(renamed).toBeVisible();
    await expect(renamed.getByText('Хлеб')).toBeVisible();

    // Перезапуск: название и содержимое переживают запись.
    await expect(page.getByText('Сохранено')).toBeVisible();
    await page.waitForTimeout(1500); // дебаунс 250мс + запись IDB — иначе reload обрывает запись
    await page.reload();
    await expect(
      page.getByRole('group', { name: 'Чек-лист · Продукты' }).getByText('Хлеб'),
    ).toBeVisible({ timeout: 10000 });

    // Удаление при открытом окне: состояние «документ недоступен».
    await page.getByRole('button', { name: 'Каталог документов' }).click();
    await page
      .getByRole('dialog', { name: 'Каталог документов' })
      .getByRole('button', { name: /Удалить «Продукты»/ })
      .click();
    await page
      .getByRole('dialog', { name: 'Каталог документов' })
      .getByRole('button', { name: 'Удалить', exact: true })
      .click();
    await page.keyboard.press('Escape');

    const missingWindow = page.getByRole('group', { name: 'Чек-лист', exact: true });
    await expect(
      missingWindow.getByText('Документ недоступен.'),
    ).toBeVisible();

    // Замена: выбор другого документа того же типа.
    await missingWindow.getByRole('button', { name: 'Выбрать документ…' }).click();
    await missingWindow.getByRole('button', { name: 'Список 2' }).click();
    await expect(page.getByRole('group', { name: 'Чек-лист · Список 2' })).toBeVisible();
  });

  test('фильтр по типу: пустой результат отличим от пустого каталога', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Каталог документов' }).click();
    const documents = page.getByRole('dialog', { name: 'Каталог документов' });

    // Существующие чек-листы видны без фильтра.
    await expect(documents.getByRole('button', { name: /^Список / })).toHaveCount(2);

    // Фильтр по плану: отдельное состояние «нет документов выбранного типа».
    await documents.getByRole('button', { name: /План/ }).click();
    await expect(documents.getByText('Нет документов выбранного типа')).toBeVisible();

    // Снятие фильтра возвращает все документы.
    await documents.getByRole('button', { name: 'Все' }).click();
    await expect(documents.getByRole('button', { name: /^Список / })).toHaveCount(2);

    await page.screenshot({
      path: 'test-results/screenshots/document-catalog.png',
      fullPage: true,
    });
  });

  test('отмена подтверждения удаления ничего не меняет', async ({ page }) => {
    await page.goto('/');
    const pane1 = page.getByLabel('Экземпляр 1 · Список 1');
    await pane1.getByPlaceholder('Новый пункт').fill('Живой пункт');
    await pane1.getByRole('button', { name: 'Добавить' }).click();
    await expect(page.getByText('Сохранено')).toBeVisible();

    await page.getByRole('button', { name: 'Каталог документов' }).click();
    const documents = page.getByRole('dialog', { name: 'Каталог документов' });
    await documents.getByRole('button', { name: /Удалить «Список 1»/ }).click();
    await documents.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.keyboard.press('Escape');

    await expect(pane1.getByText('Живой пункт')).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel('Экземпляр 1 · Список 1').getByText('Живой пункт'),
    ).toBeVisible({ timeout: 10000 });
  });
});
