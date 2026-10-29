import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDocumentWindow, openDocumentWindow } from './document-ui';
import { persistedDocument, storedWorkspace } from './workspace-helper';

async function rename(page: Page, pane: Locator, title: string) {
  await pane.getByRole('button', { name: 'Переименовать заметку', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Заголовок заметки', exact: true });
  await dialog.getByLabel('Новый заголовок').fill(title);
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function prepare(page: Page, title = 'Блокнот') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  const window = await createDocumentWindow(page, 'Заметки', title);
  await window.pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  return window;
}
async function externalBody(page: Page, id: string, body: string, remove = false) {
  await page.evaluate(({ id, body, remove }) => {
    const document = window.__projectBoard!.readDocument(id)!;
    const content = document.content as { notes: { body: string }[] };
    window.__projectBoard!.writeDocumentContent(id, { ...content,
      notes: remove ? [] : content.notes.map(note => ({ ...note, body })) });
  }, { id, body, remove });
}
async function compose(pane: Locator, text: string) {
  const input = pane.getByLabel('Текст заметки', { exact: true });
  await input.dispatchEvent('compositionstart');
  await input.fill(text);
}
async function backups(page: Page) {
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Резервные копии', exact: true }).click();
  return page.getByRole('dialog', { name: 'Резервные копии', exact: true });
}

test('заметки: CRUD, независимый выбор двух окон, немедленное закрытие и reload', async ({ page }) => {
  const first = await prepare(page);
  await expect(first.pane.locator('.widget-window__icon .lucide-book-open')).toBeVisible();
  await rename(page, first.pane, 'Первая');
  await first.pane.getByLabel('Текст заметки', { exact: true }).fill('Первый текст  \n\n');
  await first.pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await rename(page, first.pane, 'Вторая');
  const second = await openDocumentWindow(page, 'Заметки', 'Блокнот');
  await second.pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true }).click();
  await first.pane.getByLabel('Текст заметки', { exact: true }).fill('Вторая независимо');
  await expect(second.pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Первый текст  \n\n');
  await second.pane.getByLabel('Текст заметки', { exact: true }).fill('Правка второго окна  \n');
  await first.pane.getByRole('navigation').getByRole('button', { name: 'Первая', exact: true }).click();
  await expect(first.pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Правка второго окна  \n');
  await second.pane.getByRole('button', { name: /^Закрыть/ }).click();
  await first.pane.getByLabel('Текст заметки', { exact: true }).fill('Перед закрытием  \n\n');
  await first.pane.getByRole('button', { name: /^Закрыть/ }).click();
  await expect(page.locator('.widget-window')).toHaveCount(0);
  await persistedDocument(page, 'Блокнот', { notes: [{ title: 'Первая', body: 'Перед закрытием  \n\n' }, { title: 'Вторая', body: 'Вторая независимо' }] });
  const reopened = await openDocumentWindow(page, 'Заметки', 'Блокнот');
  await page.reload();
  await expect(reopened.pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Перед закрытием  \n\n');
  await reopened.pane.getByRole('button', { name: 'Удалить заметку', exact: true }).click();
  await page.getByRole('dialog', { name: 'Удалить заметку?', exact: true }).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(reopened.pane.getByRole('heading', { name: 'Первая', exact: true })).toBeVisible();
  for (const remaining of [1, 0]) {
    await reopened.pane.getByRole('button', { name: 'Удалить заметку', exact: true }).click();
    await page.getByRole('dialog', { name: 'Удалить заметку?', exact: true }).getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(reopened.pane.getByRole('navigation').getByRole('button')).toHaveCount(remaining);
  }
  await expect(reopened.pane.getByText('В блокноте пока нет заметок. Создайте первую заметку.')).toBeVisible();
});

test('Markdown: независимый просмотр, безопасный HTML и скачивание исходника', async ({ page }) => {
  const first = await prepare(page, 'Markdown');
  await rename(page, first.pane, 'План');
  const externalRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('example.com')) externalRequests.push(request.url()); });
  const source = '# Заголовок\n\n**Жирный** [ссылка](https://example.com) [опасная](javascript:alert(1))\n\n<script>window.__pbt104 = true</script>\n<img src=x onerror=alert(1)>\n![изображение](https://example.com/image.png)\n\n- [x] обычный текст';
  await first.pane.getByLabel('Текст заметки', { exact: true }).fill(source);
  await first.pane.getByLabel('Добавить тег', { exact: true }).fill('идея');
  await first.pane.getByRole('button', { name: 'Просмотр', exact: true }).focus();
  await page.keyboard.press('Enter');
  await persistedDocument(page, 'Markdown', { notes: [{ title: 'План', body: source, tags: ['идея'] }] });
  const before = await page.evaluate(id => window.__projectBoard!.readDocument(id), first.documentId);
  const view = first.pane.getByLabel('Просмотр заметки', { exact: true });
  await expect(view).toBeFocused();
  await expect(view.locator('h1')).toHaveText('Заголовок');
  await expect(view.locator('strong')).toHaveText('Жирный');
  await expect(view.getByRole('link', { name: 'ссылка' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(view.getByRole('link', { name: 'опасная' })).toHaveCount(0);
  await expect(view.locator('script, img, input[type=checkbox]')).toHaveCount(0);
  await expect(view).toContainText('<script>window.__pbt104 = true</script>');
  await view.getByRole('link', { name: 'ссылка' }).dispatchEvent('dblclick');
  await expect(first.pane.getByLabel('Просмотр заметки', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __pbt104?: boolean }).__pbt104)).toBeUndefined();
  await expect(first.pane.getByText(/\d+ слов · Markdown/)).toBeVisible();
  const footer = first.pane.locator('.notes-footer');
  const savedFooter = await footer.textContent();

  const second = await openDocumentWindow(page, 'Заметки', 'Markdown');
  await expect(second.pane.getByRole('button', { name: 'Текст', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await view.getByText('Жирный', { exact: true }).dblclick();
  const restoredInput = first.pane.getByLabel('Текст заметки', { exact: true });
  await expect(restoredInput).toHaveValue(source);
  await expect(restoredInput).toBeFocused();
  await expect(footer).toHaveText(savedFooter!);

  const downloaded = page.waitForEvent('download');
  await first.pane.getByRole('button', { name: 'Скачать .md', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('План.md');
  expect(await readFile((await file.path())!, 'utf8')).toBe('# План\n\n' + source + '\n\n#идея\n');
  expect(await page.evaluate(id => window.__projectBoard!.readDocument(id), first.documentId)).toEqual(before);
  expect(externalRequests).toEqual([]);
});

test('Markdown: узкая панель повторяет мобильную компоновку прототипа и прокручивает длинный код локально', async ({ page }) => {
  const { pane } = await prepare(page, 'Узкий блокнот');
  const widget = pane.locator('.notes-widget');
  await widget.evaluate(element => { (element as HTMLElement).style.width = '380px'; });
  const longWord = 'длинноесловобезпробелов'.repeat(12);
  const source = `${longWord}\n\n[длинная ссылка](https://example.com/${'путь'.repeat(22)})\n\n\`\`\`\n${'кодстрокой'.repeat(30)}\n\`\`\``;
  await pane.getByLabel('Текст заметки', { exact: true }).fill(source);
  await pane.getByRole('button', { name: 'Просмотр', exact: true }).click();
  const editor = pane.locator('.notes-editor');
  const listPane = pane.locator('.notes-list-pane');
  await expect(listPane).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Назад к списку', exact: true })).toBeVisible();
  const view = pane.getByLabel('Просмотр заметки', { exact: true });
  const dimensions = await view.evaluate(element => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    contentClient: element.parentElement!.clientHeight,
    contentScroll: element.parentElement!.scrollHeight,
    codeClient: element.querySelector('pre')!.clientWidth,
    codeScroll: element.querySelector('pre')!.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  expect(dimensions.contentScroll).toBeGreaterThan(dimensions.contentClient);
  expect(dimensions.codeScroll).toBeGreaterThan(dimensions.codeClient);
  await expect(pane.getByRole('button', { name: 'Скачать .md', exact: true })).toBeVisible();
  await view.evaluate(element => { element.parentElement!.scrollTop = element.parentElement!.scrollHeight; });
  await pane.screenshot({ path: 'test-results/pbt-104-notes-narrow.png' });
  await pane.getByRole('button', { name: 'Назад к списку', exact: true }).click();
  await expect(listPane).toBeVisible();
  await expect(editor).toBeHidden();
  await listPane.getByRole('navigation', { name: 'Заметки блокнота' }).getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await expect(pane.getByLabel('Просмотр заметки', { exact: true })).toBeVisible();
  await expect(pane.getByLabel('Просмотр заметки', { exact: true })).toContainText(longWord);
  await pane.getByRole('button', { name: 'Текст', exact: true }).click();
  await expect(pane.getByLabel('Текст заметки', { exact: true })).toHaveValue(source);
});

test('Markdown: просмотр и экспорт завершают текущую IME-композицию', async ({ page }) => {
  const { pane } = await prepare(page, 'IME');
  await compose(pane, 'Композиция перед просмотром');
  await pane.getByRole('button', { name: 'Просмотр', exact: true }).click();
  await expect(pane.getByLabel('Просмотр заметки', { exact: true })).toContainText('Композиция перед просмотром');
  await persistedDocument(page, 'IME', { notes: [{ body: 'Композиция перед просмотром' }] });

  await pane.getByRole('button', { name: 'Текст', exact: true }).click();
  await compose(pane, 'Последняя IME-правка');
  const downloaded = page.waitForEvent('download');
  await pane.getByRole('button', { name: 'Скачать .md', exact: true }).click();
  const file = await downloaded;
  expect(await readFile((await file.path())!, 'utf8')).toBe('# Новая заметка\n\nПоследняя IME-правка\n');
  await persistedDocument(page, 'IME', { notes: [{ body: 'Последняя IME-правка' }] });
});

test('Markdown: футер остаётся привязан к сохранённой заметке и обновляется из второго окна', async ({ page }) => {
  const first = await prepare(page, 'Футер');
  await rename(page, first.pane, 'План');
  await first.pane.getByLabel('Текст заметки', { exact: true }).fill('# План\n\n**три** слова');
  const second = await openDocumentWindow(page, 'Заметки', 'Футер');
  const secondInput = second.pane.getByLabel('Текст заметки', { exact: true });
  const firstFooter = first.pane.locator('.notes-footer');
  const initialFooter = await firstFooter.textContent();
  await first.pane.getByRole('button', { name: 'Просмотр', exact: true }).click();
  await expect(firstFooter).toHaveText(initialFooter!);
  await first.pane.getByRole('button', { name: 'Текст', exact: true }).click();
  await expect(firstFooter).toHaveText(initialFooter!);
  await secondInput.fill('# План\n\nчетыре слова в новом тексте');
  await expect(first.pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('# План\n\nчетыре слова в новом тексте');
  const updatedAt = await page.evaluate(id => {
    const document = window.__projectBoard!.readDocument(id)!;
    return (document.content as { notes: { updatedAt: string }[] }).notes[0]!.updatedAt;
  }, first.documentId);
  const updatedFooter = `6 слов · MarkdownИзменено ${new Date(updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  await expect(firstFooter).toHaveText(updatedFooter);
});

test('Markdown: скрытое окно обновляет просмотр после возврата во вкладку', async ({ page }) => {
  const { pane, documentId } = await prepare(page, 'Скрытый Markdown');
  await pane.getByLabel('Текст заметки', { exact: true }).fill('Старый текст');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await externalBody(page, documentId, '# Новое состояние\n\nОбновлено, пока окно скрыто');
  await page.getByRole('tab').first().click();
  await pane.getByRole('button', { name: 'Просмотр', exact: true }).click();
  await expect(pane.getByRole('heading', { name: 'Новое состояние', exact: true })).toBeVisible();
  await expect(pane.getByLabel('Просмотр заметки', { exact: true })).toContainText('Обновлено, пока окно скрыто');
});

test('Markdown: конфликт блокирует просмотр и скачивание без отложенного действия', async ({ page }) => {
  const { pane, documentId } = await prepare(page, 'Конфликт Markdown');
  await openDocumentWindow(page, 'Заметки', 'Конфликт Markdown');
  await compose(pane, 'Локальный текст');
  await externalBody(page, documentId, 'Сохранённый текст');
  const dialog = page.getByRole('dialog', { name: 'Конфликт заметки', exact: true });
  await expect(dialog).toBeVisible();
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await pane.getByRole('button', { name: 'Просмотр', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await pane.getByRole('button', { name: 'Скачать .md', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await dialog.getByRole('button', { name: 'Принять сохранённую версию', exact: true }).click();
  await expect(pane.getByRole('button', { name: 'Текст', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(pane.getByLabel('Просмотр заметки', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(downloads).toBe(0);
  await expect(pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Сохранённый текст');
});

test('Markdown: ошибка записи и переименование блокируют просмотр до явного действия', async ({ page }) => {
  const { pane, documentId } = await prepare(page, 'Переходы');
  const before = await page.evaluate(id => window.__projectBoard!.readDocument(id)!, documentId);
  await page.evaluate(id => window.__projectBoard!.writeDocumentContent(id, { notes: 'broken' }), documentId);
  await pane.getByLabel('Текст заметки', { exact: true }).fill('Локальный текст');
  const failed = page.getByRole('dialog', { name: 'Не удалось применить ввод', exact: true });
  await expect(failed).toBeVisible();
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await pane.getByRole('button', { name: 'Просмотр', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await pane.getByRole('button', { name: 'Скачать .md', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(pane.getByRole('button', { name: 'Текст', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(({ id, content }) => window.__projectBoard!.writeDocumentContent(id, content), { id: documentId, content: before.content });
  await failed.getByRole('button', { name: 'Отбросить мой ввод', exact: true }).click();
  await expect(failed).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(downloads).toBe(0);
  await pane.getByRole('button', { name: 'Переименовать заметку', exact: true }).click();
  const renameDialog = page.getByRole('dialog', { name: 'Заголовок заметки', exact: true });
  await pane.getByRole('button', { name: 'Просмотр', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(renameDialog).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Текст', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await renameDialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(pane.getByLabel('Просмотр заметки', { exact: true })).toHaveCount(0);
});

test('пустой заголовок, Escape и явная отмена формы не теряют ввод', async ({ page }) => {
  const { pane } = await prepare(page);
  await pane.getByRole('button', { name: 'Переименовать заметку', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Заголовок заметки', exact: true });
  await dialog.getByLabel('Новый заголовок').fill('');
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Заголовок заметки не может быть пустым.');
  await dialog.getByLabel('Новый заголовок').fill('Несохранённый заголовок');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Новый заголовок')).toHaveValue('Несохранённый заголовок');
  await dialog.getByRole('button', { name: 'Продолжить редактирование' }).click();
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(pane.getByRole('heading', { name: 'Несохранённый заголовок', exact: true })).toBeVisible();
});

for (const accept of [false, true]) {
  test(`конфликт IME: защита фона и ${accept ? 'принятие сохранённого' : 'сохранение обеих версий'}`, async ({ page }) => {
    const { pane, documentId } = await prepare(page);
    await openDocumentWindow(page, 'Заметки', 'Блокнот');
    await compose(pane, 'Локальный вариант');
    await externalBody(page, documentId, 'Сохранённый вариант');
    const dialog = page.getByRole('dialog', { name: 'Конфликт заметки', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Мой вариант', { exact: true })).toHaveValue('Локальный вариант');
    await expect(dialog.getByLabel('Сохранённый вариант', { exact: true })).toHaveValue('Сохранённый вариант');
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    for (let index = 0; index < 14; index++) {
      await page.keyboard.press(index < 7 ? 'Tab' : 'Shift+Tab');
      await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    }
    const close = await pane.getByRole('button', { name: /^Закрыть/ }).boundingBox();
    await page.mouse.click(close!.x + close!.width / 2, close!.y + close!.height / 2);
    await expect(page.locator('.widget-window')).toHaveCount(2);
    await externalBody(page, documentId, 'Последняя версия');
    await expect(dialog.getByLabel('Сохранённый вариант', { exact: true })).toHaveValue('Последняя версия');
    await dialog.getByRole('button', { name: accept ? 'Принять сохранённую версию' : 'Сохранить мой вариант отдельной заметкой', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await persistedDocument(page, 'Блокнот', { notes: accept ? [{ body: 'Последняя версия' }] : [{ body: 'Последняя версия' }, { body: 'Локальный вариант' }] });
    await expect(page.locator('.widget-window')).toHaveCount(2);
  });
}

test('скрытые/свёрнутые владельцы: очередь конфликтов и удаление редактируемой заметки', async ({ page }) => {
  const first = await prepare(page, 'Первый');
  const second = await createDocumentWindow(page, 'Заметки', 'Второй');
  await second.pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  // Незавершённые композиции моделируются без перевода фокуса между полями.
  for (const [pane, text] of [[first.pane, 'Первый локальный'], [second.pane, 'Второй локальный']] as const) {
    await pane.getByLabel('Текст заметки', { exact: true }).evaluate((input, value) => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  }
  await page.getByRole('button', { name: 'Виджеты', exact: true }).focus();
  await first.pane.getByRole('button', { name: /^Свернуть/ }).evaluate(button => (button as HTMLButtonElement).click());
  await externalBody(page, first.documentId, '', true);
  await externalBody(page, second.documentId, 'Внешний второй');
  let dialog = page.getByRole('dialog', { name: 'Конфликт заметки', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Мой вариант', { exact: true })).toHaveValue('Первый локальный');
  await dialog.getByRole('button', { name: 'Сохранить мой вариант отдельной заметкой' }).click();
  dialog = page.getByRole('dialog', { name: 'Конфликт заметки', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Мой вариант', { exact: true })).toHaveValue('Второй локальный');
  await dialog.getByRole('button', { name: 'Сохранить мой вариант отдельной заметкой' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Виджеты', exact: true })).toBeFocused();
  await persistedDocument(page, 'Первый', { notes: [{ body: 'Первый локальный' }] });
  await persistedDocument(page, 'Второй', { notes: [{ body: 'Внешний второй' }, { body: 'Второй локальный' }] });
});

test('блокноты и правки переживают холодную офлайн-перезагрузку', async ({ page, context }) => {
  const { pane } = await prepare(page);
  await pane.getByLabel('Текст заметки', { exact: true }).fill('Офлайн  \n\n');
  await persistedDocument(page, 'Блокнот', { notes: [{ body: 'Офлайн  \n\n' }] });
  await expect(page.getByRole('status', { name: 'Готовность к офлайн-работе' })).toHaveText('Готово к работе офлайн');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.close(); await context.setOffline(true);
  const offline = await context.newPage();
  const cdp = await context.newCDPSession(offline);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await offline.goto('/');
  const input = offline.getByLabel('Текст заметки', { exact: true });
  await expect(input).toHaveValue('Офлайн  \n\n');
  await input.fill('Изменено офлайн');
  await persistedDocument(offline, 'Блокнот', { notes: [{ body: 'Изменено офлайн' }] });
  await offline.reload(); await expect(input).toHaveValue('Изменено офлайн');
});

test('общий backup переносит закрытый, пустой и общий блокноты в чистое хранилище', async ({ page, browser }) => {
  const { pane, documentId } = await prepare(page, 'Закрытый');
  await rename(page, pane, 'Заголовок');
  await pane.getByLabel('Текст заметки', { exact: true }).fill('# Markdown  \n\nИсходный текст');
  await page.evaluate(id => {
    const document = window.__projectBoard!.readDocument(id)!;
    const content = document.content as { notes: Record<string, unknown>[] };
    window.__projectBoard!.writeDocumentContent(id, { ...content, notes: content.notes.map(note => ({ ...note, tags: ['идея', 'архив'], pinned: true })) });
  }, documentId);
  await pane.getByRole('button', { name: /^Закрыть/ }).click();
  await createDocumentWindow(page, 'Заметки', 'Пустой');
  const shared = await createDocumentWindow(page, 'Заметки', 'Общий');
  await shared.pane.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await shared.pane.getByLabel('Текст заметки', { exact: true }).fill('Общий текст');
  await openDocumentWindow(page, 'Заметки', 'Общий');
  await persistedDocument(page, 'Общий', { notes: [{ body: 'Общий текст' }] });
  const before = await storedWorkspace(page);
  const dialog = await backups(page);
  await dialog.getByRole('button', { name: 'Создать копию', exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать', exact: true }).click();
  const file = await download;
  const buffer = await readFile((await file.path())!);
  const clean = await browser.newContext();
  try {
    const target = await clean.newPage(); await target.goto('/');
    const restore = await backups(target);
    await restore.locator('input[type="file"]').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer });
    await restore.getByLabel('Перед заменой создать страховочную копию текущего пространства').uncheck();
    await restore.getByRole('button', { name: 'Заменить пространство', exact: true }).click();
    await expect(target.locator('.widget-window')).toHaveCount(3);
    await expect.poll(async () => (await storedWorkspace(target)).documents).toEqual(before.documents);
    expect((await storedWorkspace(target)).widgetInstances).toEqual(before.widgetInstances);
    await target.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await clean.setOffline(true);
    const closed = await openDocumentWindow(target, 'Заметки', 'Закрытый');
    await expect(closed.pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('# Markdown  \n\nИсходный текст');
    await closed.pane.getByRole('button', { name: 'Просмотр', exact: true }).click();
    await expect(closed.pane.getByRole('heading', { name: 'Markdown', exact: true })).toBeVisible();
    const restoredExport = target.waitForEvent('download');
    await closed.pane.getByRole('button', { name: 'Скачать .md', exact: true }).click();
    const restoredFile = await restoredExport;
    expect(await readFile((await restoredFile.path())!, 'utf8'))
      .toBe('# Заголовок\n\n# Markdown  \n\nИсходный текст\n\n#идея #архив\n');
  } finally { await clean.close(); }
});

test('повреждение диагностируется без перезаписи', async ({ page }) => {
  const { pane, documentId } = await prepare(page);
  await page.evaluate(id => window.__projectBoard!.writeDocumentContent(id, { notes: 'broken' }), documentId);
  await expect(pane.getByRole('alert')).toBeVisible();
  await persistedDocument(page, 'Блокнот', { notes: 'broken' });
  await page.reload(); await expect(pane.getByRole('alert')).toBeVisible();
  expect((await storedWorkspace(page)).documents.find(doc => doc.id === documentId)?.content).toEqual({ notes: 'broken' });
});


test('будущая схема блокнота не заменяется пустым содержимым', async ({ page }) => {
  const { documentId } = await prepare(page);
  await persistedDocument(page, 'Блокнот', { notes: [{ title: 'Новая заметка' }] });
  await page.evaluate(async id => {
    const request = indexedDB.open('project-board');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      const read = store.get(id);
      read.onsuccess = () => store.put({ ...read.result, schemaVersion: 99 });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, documentId);
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: /новее|верси/ }).first()).toBeVisible();
  const document = await page.evaluate(id => window.__projectBoard!.readDocument(id), documentId);
  expect(document?.schemaVersion).toBe(99);
  expect(document?.content).toMatchObject({ notes: [{ title: 'Новая заметка' }] });
});


test('конфликт скрытой вкладки доступен через портал; возврат показывает актуальный документ', async ({ page }) => {
  const { pane, documentId } = await prepare(page);
  const input = pane.getByLabel('Текст заметки', { exact: true });
  // Keep focus on the chrome: focusing this synthetic composition with fill()
  // lets the browser commit it on blur before the remote update is delivered.
  await input.evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, 'Черновик скрытой вкладки');
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(input).toHaveValue('Черновик скрытой вкладки');
  await page.getByRole('button', { name: 'Новая вкладка', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(pane).toBeHidden();
  const committed = await page.evaluate(id => window.__projectBoard!.readDocument(id)?.content, documentId);
  expect(committed).toMatchObject({ notes: [{ body: '' }] });
  await expect(input).toHaveValue('Черновик скрытой вкладки');
  await externalBody(page, documentId, 'Изменение на скрытой вкладке');
  const dialog = page.getByRole('dialog', { name: 'Конфликт заметки', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Мой вариант', { exact: true })).toHaveValue('Черновик скрытой вкладки');
  await dialog.getByRole('button', { name: 'Принять сохранённую версию', exact: true }).click();
  await page.getByRole('tab', { name: /Дашборд/ }).click();
  await expect(pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Изменение на скрытой вкладке');
});


test('ошибка применения сохраняет локальный ввод до явного отказа', async ({ page }) => {
  const { pane, documentId } = await prepare(page);
  await compose(pane, 'Не потерять при ошибке');
  await page.evaluate(id => window.__projectBoard!.writeDocumentContent(id, { notes: 'broken' }), documentId);
  await pane.getByLabel('Текст заметки', { exact: true }).dispatchEvent('compositionend');
  const dialog = page.getByRole('dialog', { name: 'Не удалось применить ввод', exact: true });
  await expect(dialog).toBeVisible();
  await expect(pane.getByLabel('Текст заметки', { exact: true })).toHaveValue('Не потерять при ошибке');
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Отбросить мой ввод', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await persistedDocument(page, 'Блокнот', { notes: 'broken' });
  await pane.getByRole('button', { name: /^Закрыть/ }).click();
  await expect(pane).toHaveCount(0);
});
