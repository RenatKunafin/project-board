import { expect, test } from '@playwright/test';
import { createDocumentWindow } from './document-ui';

test.use({ channel: 'chrome' });

test('пустая БД ждёт решения о восстановлении до создания вкладки', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Восстановить рабочее пространство?' })).toBeVisible();
  expect(await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('project-board');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('tabs').objectStore('tabs').count();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }))).toBe(0);
  await page.getByRole('button', { name: 'Продолжить без восстановления' }).click();
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Дашборд');
});

test('неподдерживаемая база не считается пустой и не заменяется новым пространством', async ({ page }) => {
  await page.route('**/__recovery-blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' }));
  await page.goto('/__recovery-blank');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('project-board', 99);
    open.onupgradeneeded = () => open.result.createObjectStore('documents', { keyPath: 'id' });
    open.onsuccess = () => { open.result.close(); resolve(); };
    open.onerror = () => reject(open.error);
  }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть локальные данные');
  await expect(page.getByRole('button', { name: 'Продолжить без восстановления' })).toHaveCount(0);
});

test('файловый снимок восстанавливает документы после удаления обеих IndexedDB', async ({ page, context }) => {
  // Нативный FileSystemDirectoryHandle для e2e; реальную выбранную папку
  // проверяем отдельно на рабочем Chrome, потому что его picker требует человека.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => navigator.storage.getDirectory(),
    });
  });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Продолжить без восстановления' }).click();
  const { pane } = await createDocumentWindow(page, 'Чек-лист', 'Для восстановления');
  await pane.getByPlaceholder('Новая задача…').fill('Сохранённый пункт');
  await pane.getByRole('button', { name: 'Добавить', exact: true }).click();
  await pane.getByRole('button', { name: 'Скрыть выполненные' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Резервные копии' }).click();
  const dialog = page.getByRole('dialog', { name: 'Резервные копии' });
  await dialog.getByRole('button', { name: 'Выбрать папку' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Папка для автоматических копий выбрана.' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть' }).click();
  await page.clock.fastForward(30_001);
  await expect.poll(async () => page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    try {
      const file = await directory.getFileHandle('project-board-recovery-a.json');
      return JSON.parse(await (await file.getFile()).text()).generation as number;
    } catch { return 0; }
  })).toBe(1);
  expect(await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('project-board');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('backups').objectStore('backups').count();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }))).toBe(0);
  await page.evaluate(async () => {
    const prototype = Object.getPrototypeOf(await navigator.storage.getDirectory()) as {
      queryPermission: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    };
    const original = prototype.queryPermission;
    prototype.queryPermission = function (this: FileSystemDirectoryHandle, options: { mode: 'read' | 'readwrite' }) {
      return options.mode === 'readwrite' ? Promise.resolve('prompt' as PermissionState) : original.call(this, options);
    };
  });
  await pane.getByPlaceholder('Новая задача…').fill('После потери доступа');
  await pane.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.waitForTimeout(500);
  await page.clock.fastForward(30_001);
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Резервные копии' }).click();
  await expect(page.getByRole('dialog', { name: 'Резервные копии' }).getByText('Доступ к папке нужно разрешить повторно; новые копии пока не создаются.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Резервные копии' }).getByText(/Последняя проверенная копия:/)).toBeVisible();
  await page.getByRole('dialog', { name: 'Резервные копии' }).getByRole('button', { name: 'Закрыть' }).click();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await page.route('**/__recovery-blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' }));
  await page.goto('/__recovery-blank');
  await page.evaluate(async () => {
    for (const name of ['project-board', 'project-board-recovery-config']) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Удаление ${name} заблокировано открытой вкладкой.`));
      });
    }
  });
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Восстановить рабочее пространство?' })).toBeVisible();
  await page.getByRole('button', { name: 'Выбрать папку с копиями' }).click();
  await expect(page.getByText('1 документов')).toBeVisible();
  await expect(page.getByText(/Возраст копии:/)).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить копию' }).click();
  const recovered = page.getByRole('group', { name: 'Чек-лист · Для восстановления' });
  await expect(recovered).toBeVisible();
  await expect(recovered.getByText('Сохранённый пункт')).toBeVisible();
  await expect(recovered.getByRole('button', { name: 'Показать выполненные' })).toHaveAttribute('aria-pressed', 'true');
});

test('отказ не удаляет файл и восстановление остаётся доступным в настройках', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => navigator.storage.getDirectory() });
  });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Продолжить без восстановления' }).click();
  await createDocumentWindow(page, 'Чек-лист', 'Сохранён после отказа');
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Резервные копии' }).click();
  await page.getByRole('dialog', { name: 'Резервные копии' }).getByRole('button', { name: 'Выбрать папку' }).click();
  await page.getByRole('dialog', { name: 'Резервные копии' }).getByRole('button', { name: 'Закрыть' }).click();
  await page.clock.fastForward(30_001);
  await expect.poll(async () => page.evaluate(async () => {
    try {
      const file = await (await navigator.storage.getDirectory()).getFileHandle('project-board-recovery-a.json');
      return JSON.parse(await (await file.getFile()).text()).generation as number;
    } catch { return 0; }
  })).toBe(1);
  await page.route('**/__recovery-blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' }));
  await page.goto('/__recovery-blank');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('project-board');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Удаление базы заблокировано.'));
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Восстановить копию' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить без восстановления' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Резервные копии' }).click();
  const dialog = page.getByRole('dialog', { name: 'Резервные копии' });
  await expect(dialog.getByText(/Последняя проверенная копия:/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Восстановить автоматическую копию' }).click();
  await expect(dialog.getByRole('heading', { name: 'Заменить текущее пространство?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Заменить пространство' }).click();
  await expect(page.getByRole('group', { name: 'Чек-лист · Сохранён после отказа' })).toBeVisible();
});

test('повреждённый файл не применяется и не удаляется молча', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => navigator.storage.getDirectory() });
  });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Продолжить без восстановления' }).click();
  await createDocumentWindow(page, 'Чек-лист', 'Повреждённая копия');
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Резервные копии' }).click();
  await page.getByRole('dialog', { name: 'Резервные копии' }).getByRole('button', { name: 'Выбрать папку' }).click();
  await page.getByRole('dialog', { name: 'Резервные копии' }).getByRole('button', { name: 'Закрыть' }).click();
  await page.clock.fastForward(30_001);
  await expect.poll(async () => page.evaluate(async () => {
    try {
      const file = await (await navigator.storage.getDirectory()).getFileHandle('project-board-recovery-a.json');
      return JSON.parse(await (await file.getFile()).text()).generation as number;
    } catch { return 0; }
  })).toBe(1);
  await page.evaluate(async () => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle('project-board-recovery-a.json');
    const writer = await file.createWritable();
    await writer.write('{broken');
    await writer.close();
  });
  await page.route('**/__recovery-blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' }));
  await page.goto('/__recovery-blank');
  await page.evaluate(async () => {
    for (const name of ['project-board', 'project-board-recovery-config']) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Удаление ${name} заблокировано.`));
      });
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Выбрать папку с копиями' }).click();
  await expect(page.getByRole('alert')).toContainText('повреждены');
  await expect(page.getByRole('button', { name: 'Восстановить копию' })).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle('project-board-recovery-a.json');
    return (await file.getFile()).text();
  })).toBe('{broken');
});
