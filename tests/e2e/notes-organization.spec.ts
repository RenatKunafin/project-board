import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDocumentWindow, openDocumentWindow } from './document-ui';
import { storedWorkspace, persistedDocument } from './workspace-helper';

async function rename(page: Page, pane: Locator, title: string) {
  await pane.getByRole('button', { name: 'Переименовать заметку', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Заголовок заметки', exact: true });
  await dialog.getByLabel('Новый заголовок').fill(title);
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
}
async function addTag(pane: Locator, tag: string) {
  await pane.getByLabel('Добавить тег', { exact: true }).fill(tag);
  await pane.getByLabel('Добавить тег', { exact: true }).press('Enter');
}
async function prepare(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const window = await createDocumentWindow(page, 'Заметки', 'Организация');
  await window.pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await rename(page, window.pane, 'Первая');
  await window.pane.getByLabel('Текст заметки', { exact: true }).fill('Первая строка\nДругие мысли');
  return window;
}
async function raw(page: Page, id: string) { return page.evaluate(id => window.__projectBoard!.readDocument(id), id); }
async function openBackups(page: Page) {
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Резервные копии', exact: true }).click();
  return page.getByRole('dialog', { name: 'Резервные копии', exact: true });
}

test('поиск, счётчики и тег работают вместе; создание очищает только свой поиск', async ({ page }) => {
  const first = await prepare(page); await addTag(first.pane, ' ##РАБОТА ');
  await first.pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await rename(page, first.pane, 'Вторая'); await addTag(first.pane, 'работа');
  await addTag(first.pane, 'личное');
  const second = await openDocumentWindow(page, 'Заметки', 'Организация');
  await second.pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true }).click();
  const before = await raw(page, first.documentId);
  await first.pane.getByLabel('Поиск заметок').fill('пЕрВаЯ');
  await first.pane.getByRole('button', { name: 'Фильтр работа', exact: true }).click();
  await expect(first.pane.getByRole('navigation').getByRole('button')).toHaveCount(1);
  await expect(first.pane.getByRole('button', { name: 'Фильтр работа', exact: true })).toHaveText('#работа 2');
  await expect(first.pane.getByRole('heading', { name: 'Вторая', exact: true })).toBeVisible();
  await expect(first.pane.getByText('Открытая заметка не входит в текущий фильтр.')).toBeVisible();
  await expect(second.pane.getByLabel('Поиск заметок')).toHaveValue('');
  expect((await raw(page, first.documentId))?.revision).toBe(before?.revision);
  await first.pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await expect(first.pane.getByLabel('Поиск заметок')).toHaveValue('');
  await expect(first.pane.getByRole('button', { name: 'Фильтр работа', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(first.pane.getByRole('button', { name: 'Убрать тег работа', exact: true })).toBeVisible();
  await expect(second.pane.getByRole('heading', { name: 'Первая', exact: true })).toBeVisible();
  await second.pane.getByLabel('Поиск заметок').fill('ЛИЧНОЕ');
  await expect(second.pane.getByRole('navigation').getByRole('button', { name: 'Вторая', exact: true })).toBeVisible();
  await first.pane.getByLabel('Поиск заметок').fill('нет совпадений');
  await expect(first.pane.getByText('Ничего не найдено', { exact: true })).toBeVisible();
  await first.pane.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(first.pane.getByRole('navigation').getByRole('button')).toHaveCount(3);
});

test('теги принимаются Enter, запятой, вставкой и blur без дублей; снятие последнего сбрасывает фильтр', async ({ page }) => {
  const { pane, documentId } = await prepare(page);
  const input = pane.getByLabel('Добавить тег', { exact: true });
  await expect(input.locator('xpath=..')).toHaveClass(/notes-tag-entry/);
  await expect(input).toHaveCSS('border-top-width', '0px');
  expect(await input.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(140);
  await input.focus();
  expect(await input.evaluate(element => getComputedStyle(element).borderBottomColor))
    .toBe(await input.locator('xpath=..').evaluate(element => getComputedStyle(element).color));
  await input.fill(' ##ИДЕЯ '); await input.press(',');
  await expect(input).toHaveValue('');
  const before = await raw(page, documentId);
  await addTag(pane, '# #Идея'); expect((await raw(page, documentId))?.revision).toBe(before?.revision);
  await input.fill('РАБОТА,личное,'); await expect(input).toHaveValue('');
  await input.fill('на потом'); await pane.getByLabel('Поиск заметок').click();
  await expect(pane.getByRole('button', { name: 'Убрать тег на потом', exact: true })).toBeVisible();
  await input.dispatchEvent('compositionstart'); await input.fill('ЯПОНСКИЙ'); await input.press('Enter');
  await expect(pane.getByRole('button', { name: 'Убрать тег японский', exact: true })).toHaveCount(0);
  await input.dispatchEvent('compositionend'); await input.press('Enter');
  await expect(pane.getByRole('button', { name: 'Убрать тег японский', exact: true })).toBeVisible();
  await pane.getByRole('button', { name: 'Фильтр идея', exact: true }).click();
  await pane.getByLabel('Поиск заметок').fill('мысли');
  await pane.getByRole('button', { name: 'Убрать тег идея', exact: true }).click();
  await expect(pane.getByRole('button', { name: 'Все теги', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(pane.getByLabel('Поиск заметок')).toHaveValue('мысли');
  await persistedDocument(page, 'Организация', { notes: [{ tags: ['работа', 'личное', 'на потом', 'японский'], body: 'Первая строка\nДругие мысли' }] });
});

test('изменение выдачи сохраняет редактор и caret, метаданные видны второму окну', async ({ page }) => {
  const first = await prepare(page); await addTag(first.pane, 'идея');
  const second = await openDocumentWindow(page, 'Заметки', 'Организация');
  await first.pane.getByLabel('Поиск заметок').fill('строка');
  const input = first.pane.getByLabel('Текст заметки', { exact: true });
  await input.fill('Совсем другой текст'); await input.press('End'); await input.pressSequentially('!');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('Совсем другой текст!');
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe('Совсем другой текст!'.length);
  await expect(first.pane.getByText('Ничего не найдено', { exact: true })).toBeVisible();
  await expect(second.pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Совсем другой текст!');
  await first.pane.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  const pin = first.pane.getByRole('button', { name: 'Закрепить', exact: true }); await pin.click();
  await expect(first.pane.getByRole('button', { name: 'Открепить', exact: true })).toBeFocused();
  await expect(second.pane.getByRole('button', { name: 'Открепить', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(second.pane.getByRole('navigation').getByRole('heading', { name: 'Закреплённые', exact: true })).toBeVisible();
  await first.pane.getByLabel('Добавить тег', { exact: true }).fill('первый');
  await first.pane.getByLabel('Добавить тег', { exact: true }).press('Enter'); await addTag(second.pane, 'второй');
  await expect(first.pane.getByRole('button', { name: 'Убрать тег второй', exact: true })).toBeVisible();
});

test('группы меняются в полночь и при возврате скрытого окна без изменения документа', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00') });
  const { pane, documentId } = await prepare(page);
  await page.clock.pauseAt(new Date('2026-10-29T23:59:59'));
  await page.evaluate(id => {
    const doc = window.__projectBoard!.readDocument(id)!;
    const base = (doc.content as { notes: Record<string, unknown>[] }).notes[0];
    window.__projectBoard!.writeDocumentContent(id, { notes: [
      { ...base, id: 'today', title: 'Сегодняшняя', updatedAt: new Date(2026, 9, 29, 12).toISOString() },
      { ...base, id: 'week', title: 'Недавняя', updatedAt: new Date(2026, 9, 23).toISOString() },
      { ...base, id: 'old', title: 'Старая', updatedAt: new Date(2026, 9, 22, 23).toISOString() },
      { ...base, id: 'pin', title: 'Важная', pinned: true, updatedAt: new Date(2020, 0, 1).toISOString() },
    ] });
  }, documentId);
  const before = await raw(page, documentId);
  await expect(pane.getByRole('navigation').getByRole('heading')).toHaveText(['Закреплённые', 'Сегодня', 'За неделю', 'Раньше']);
  await page.clock.fastForward(1500);
  await expect(pane.getByRole('navigation').getByRole('heading')).toHaveText(['Закреплённые', 'За неделю', 'Раньше']);
  expect((await raw(page, documentId))?.revision).toBe(before?.revision);
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await page.clock.fastForward(8 * 24 * 60 * 60 * 1000);
  await page.getByRole('tab', { name: /Дашборд/ }).click();
  await expect(pane.getByRole('navigation').getByRole('heading')).toHaveText(['Закреплённые', 'Раньше']);
  expect((await raw(page, documentId))?.revision).toBe(before?.revision);
});

test('удаление выбирает по фильтру; blur тега принадлежит предыдущей заметке', async ({ page }) => {
  const { pane } = await prepare(page); await addTag(pane, 'важно');
  await pane.getByRole('button', { name: 'Новая заметка', exact: true }).click(); await rename(page, pane, 'Вторая');
  await pane.getByLabel('Добавить тег', { exact: true }).fill('только вторая');
  await pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true }).click();
  await expect(pane.getByRole('button', { name: 'Убрать тег только вторая', exact: true })).toHaveCount(0);
  await pane.getByRole('button', { name: 'Фильтр только вторая', exact: true }).click();
  await pane.getByRole('button', { name: 'Удалить заметку', exact: true }).click();
  await page.getByRole('dialog', { name: 'Удалить заметку?', exact: true }).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(pane.getByRole('heading', { name: 'Вторая', exact: true })).toBeVisible();
  await pane.getByLabel('Поиск заметок').fill('нет');
  await pane.getByRole('button', { name: 'Удалить заметку', exact: true }).click();
  await page.getByRole('dialog', { name: 'Удалить заметку?', exact: true }).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(pane.getByText('В блокноте пока нет заметок. Создайте первую заметку.')).toBeVisible();
});

test('теги и закрепление переживают offline и чистое восстановление общего backup', async ({ page, context, browser }) => {
  const { pane } = await prepare(page); await addTag(pane, ' #ИДЕЯ '); await addTag(pane, 'длинный тег с пробелами');
  await pane.getByRole('button', { name: 'Закрепить', exact: true }).click();
  await persistedDocument(page, 'Организация', { notes: [{ tags: ['идея', 'длинный тег с пробелами'], pinned: true }] });
  const before = (await storedWorkspace(page)).documents;
  await expect(page.getByRole('status', { name: 'Готовность к офлайн-работе' })).toHaveText('Готово к работе офлайн');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true); await page.reload();
  await expect(pane.getByRole('button', { name: 'Открепить', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(pane.getByRole('button', { name: 'Убрать тег идея', exact: true })).toBeVisible();
  await pane.getByRole('button', { name: /^Закрыть/ }).click();
  const backups = await openBackups(page); await backups.getByRole('button', { name: 'Создать копию', exact: true }).click();
  const download = page.waitForEvent('download'); await backups.getByRole('button', { name: 'Скачать', exact: true }).click();
  const file = await download; const buffer = await readFile((await file.path())!);
  const clean = await browser.newContext();
  try {
    const target = await clean.newPage(); await target.goto('/');
    const restore = await openBackups(target);
    await restore.locator('input[type="file"]').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer });
    await restore.getByLabel('Перед заменой создать страховочную копию текущего пространства').uncheck();
    await restore.getByRole('button', { name: 'Заменить пространство', exact: true }).click();
    await expect.poll(async () => (await storedWorkspace(target)).documents).toEqual(before);
    const reopened = await openDocumentWindow(target, 'Заметки', 'Организация');
    await reopened.pane.getByLabel('Поиск заметок').fill('ИДЕЯ');
    await reopened.pane.getByRole('button', { name: 'Фильтр идея', exact: true }).click();
    await expect(reopened.pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true })).toBeVisible();
    await expect(reopened.pane.getByRole('navigation').getByRole('heading', { name: 'Закреплённые', exact: true })).toBeVisible();
  } finally { await clean.close(); }
});


test('ошибка принятия тега сохраняет сырой ввод до успешного повторения', async ({ page }) => {
  const { pane, documentId } = await prepare(page);
  const before = await raw(page, documentId);
  const input = pane.getByLabel('Добавить тег', { exact: true });
  await input.fill(' ##Не потерять ');
  await page.evaluate(id => window.__projectBoard!.writeDocumentContent(id, { notes: 'broken' }), documentId);
  await input.press('Enter');
  await expect(input).toHaveValue(' ##Не потерять ');
  await expect(pane.getByRole('alert').first()).toBeVisible();
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: before!.content });
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await persistedDocument(page, 'Организация', { notes: [{ tags: ['не потерять'], body: 'Первая строка\nДругие мысли' }] });
});


test('конфликт при активных фильтрах сохраняет текст и локальное состояние окна', async ({ page }) => {
  const { pane, documentId } = await prepare(page); await addTag(pane, 'идея');
  await pane.getByRole('button', { name: 'Фильтр идея', exact: true }).click();
  await pane.getByLabel('Поиск заметок').fill('мысли');
  const input = pane.getByLabel('Текст заметки', { exact: true });
  await input.dispatchEvent('compositionstart'); await input.fill('Мой несохранённый вариант');
  await page.evaluate(id => {
    const doc = window.__projectBoard!.readDocument(id)!;
    const content = doc.content as { notes: Record<string, unknown>[] };
    window.__projectBoard!.writeDocumentContent(id, { ...content, notes: content.notes.map(note => ({ ...note, body: 'Внешний вариант' })) });
  }, documentId);
  const dialog = page.getByRole('dialog', { name: 'Конфликт заметки', exact: true });
  await expect(dialog).toBeVisible(); await page.keyboard.press('Escape');
  await expect(dialog.getByLabel('Мой вариант', { exact: true })).toHaveValue('Мой несохранённый вариант');
  await dialog.getByRole('button', { name: 'Сохранить мой вариант отдельной заметкой', exact: true }).click();
  await expect(input).toHaveValue('Мой несохранённый вариант');
  await expect(pane.getByLabel('Поиск заметок')).toHaveValue('мысли');
  await expect(pane.getByRole('button', { name: 'Фильтр идея', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await persistedDocument(page, 'Организация', { notes: [{ body: 'Внешний вариант', tags: ['идея'] }, { body: 'Мой несохранённый вариант', tags: ['идея'] }] });
});


test('при минимальном размере длинные теги не скрывают редактор и команды', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const { pane } = await prepare(page);
  await addTag(pane, 'очень-длинный-тег-для-проверки-переноса-и-доступности-управления');
  await addTag(pane, 'ещё один тег');
  const handle = page.locator('.react-grid-item').first().locator('.react-resizable-handle-se');
  await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox();
  await page.mouse.move(box!.x + 4, box!.y + 4); await page.mouse.down();
  await page.mouse.move(box!.x - 1000, box!.y - 1000, { steps: 15 }); await page.mouse.up();
  await expect.poll(async () => (await pane.boundingBox())!.height).toBeLessThanOrEqual(260);
  expect(await pane.locator('.notes-content').evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(150);
  const input = pane.getByLabel('Текст заметки', { exact: true });
  await input.click(); await input.fill('Редактор доступен'); await input.pressSequentially('!');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('Редактор доступен!');
  await pane.getByRole('button', { name: 'Закрепить', exact: true }).click();
  await expect(pane.getByRole('button', { name: 'Открепить', exact: true })).toBeVisible();
  await pane.getByRole('button', { name: 'Убрать тег ещё один тег', exact: true }).click();
  await pane.getByRole('button', { name: 'Назад к списку', exact: true }).click();
  await pane.getByLabel('Поиск заметок').fill('Редактор');
  await expect(pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true })).toBeVisible();
  await pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true }).click();
  await expect(input).toBeVisible();
});
