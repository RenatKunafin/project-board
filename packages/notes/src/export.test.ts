import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadNoteMarkdown, markdownFilename, serializeNoteMarkdown } from './export';

describe('экспорт заметки в Markdown', () => {
  afterEach(() => {
    if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('сохраняет тело без изменения и добавляет заголовок, теги и UTF-8 текст', () => {
    const body = 'Кириллица  \r\n\n<script>буквально</script>\n';
    expect(serializeNoteMarkdown({ title: 'План', body, tags: ['работа', 'идея'] }))
      .toBe(`# План\n\n${body}\n\n#работа #идея\n`);
    expect(new TextDecoder().decode(new TextEncoder().encode('План'))).toBe('План');
  });

  it('обрабатывает пустое тело и теги', () => {
    expect(serializeNoteMarkdown({ title: 'Заметка', body: '', tags: [] })).toBe('# Заметка\n\n\n');
    expect(serializeNoteMarkdown({ title: 'Пустая', body: '', tags: ['архив'] })).toBe('# Пустая\n\n\n\n#архив\n');
    const exact = '# Ёлка\n\nстрока\nвторая\n\n#идея\n';
    expect(new TextEncoder().encode(serializeNoteMarkdown({ title: 'Ёлка', body: 'строка\nвторая', tags: ['идея'] })))
      .toEqual(new TextEncoder().encode(exact));
  });

  it('создаёт безопасное имя файла, включая резервные имена и длинный Unicode', () => {
    expect(markdownFilename('План: заметки/сегодня')).toBe('План_ заметки_сегодня.md');
    expect(markdownFilename('CON')).toBe('_CON.md');
    expect(markdownFilename('lpt9.txt')).toBe('_lpt9.txt.md');
    expect(markdownFilename('  <план>?  ')).toBe('_план__.md');
    expect(markdownFilename('')).toBe('note.md');
    expect(new TextEncoder().encode(markdownFilename('я'.repeat(300))).length).toBeLessThanOrEqual(183);
  });

  it('скачивает Blob и освобождает object URL после click', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:notes-export');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { href: '', download: '', hidden: false, click, remove };
    const append = vi.fn();
    vi.stubGlobal('document', { createElement: () => anchor, body: { append } });
    downloadNoteMarkdown({ title: 'План', body: 'Текст', tags: [] });
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('План.md');
    expect(append).toHaveBeenCalledWith(anchor);
    expect(revoke).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:notes-export');
  });

  it('освобождает object URL и временный anchor, если скачивание завершается ошибкой', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-export');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const remove = vi.fn();
    const append = vi.fn(() => { throw new Error('download blocked'); });
    const anchor = { href: '', download: '', hidden: false, click: vi.fn(), remove };
    vi.stubGlobal('document', { createElement: () => anchor, body: { append } });
    expect(() => downloadNoteMarkdown({ title: 'План', body: '', tags: [] })).toThrow('download blocked');
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:failed-export');
    expect(remove).toHaveBeenCalledOnce();
  });
});
