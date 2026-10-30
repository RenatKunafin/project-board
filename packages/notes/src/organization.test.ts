import { describe, expect, it, vi } from 'vitest';
import type { Note } from './model';
import { allTags, dateGroup, filterNotes, groupNotes, nextMidnight, normalizeTag, normalizedTags, noteDate, notePreview } from './organization';
const note = (id: string, patch: Partial<Note> = {}): Note => ({ id, title: 'Заголовок', body: 'Исходный текст', tags: [], pinned: false, updatedAt: '2026-10-28T12:00:00.000Z', ...patch });

describe('организация заметок', () => {
  it('нормализует теги без обрезания и изменения исходного массива', () => {
    const tags = Object.freeze([' ##ИДЕЯ ', 'идея', '#', '  ']);
    expect(normalizedTags(tags)).toEqual(['идея']);
    expect(normalizeTag('#' + 'Я'.repeat(200))).toBe('я'.repeat(200));
    expect(tags[0]).toBe(' ##ИДЕЯ ');
    expect(normalizeTag(' # #ИДЕЯ ')).toBe('идея');
    expect(normalizeTag(normalizeTag(' # #ИДЕЯ ')!)).toBe('идея');
  });
  it('считает каждую заметку один раз на тег независимо от дублей и фильтра', () => {
    const notes = [note('a', { tags: ['#ИДЕЯ', 'идея', 'новый'] }), note('b', { tags: ['ИДЕЯ'] })];
    expect(allTags(notes)).toEqual([{ tag: 'идея', count: 2 }, { tag: 'новый', count: 1 }]);
  });
  it('ищет буквальное совпадение в каждом поле и применяет тег совместно', () => {
    const notes = [note('title', { title: 'Идея релиза', tags: ['работа'] }), note('body', { body: '**ИДЕЯ**', tags: ['личное'] }), note('tag', { tags: ['##ИДЕЯ', 'Работа'] })];
    expect(filterNotes(notes, '  ИДЕЯ  ', null).map(n => n.id)).toEqual(['body', 'tag', 'title']);
    expect(filterNotes(notes, 'идея', 'работа').map(n => n.id)).toEqual(['tag', 'title']);
    expect(filterNotes(notes, '.*', null)).toEqual([]);
    expect(filterNotes([note('a', { body: 'ёлка' })], 'елка', null)).toEqual([]);
  });
  it('сортирует закреплённые/время/ID, не меняя массив', () => {
    const notes = Object.freeze([note('z'), note('a'), note('old-pin', { pinned: true, updatedAt: '2020-01-01T00:00:00.000Z' })]);
    expect(filterNotes(notes, '', null).map(n => n.id)).toEqual(['old-pin', 'a', 'z']);
    expect(filterNotes([...notes].reverse(), '', null).map(n => n.id)).toEqual(['old-pin', 'a', 'z']);
    expect(notes[0].id).toBe('z');
  });
  it('группирует по семи локальным дням и не дублирует закреплённую заметку', () => {
    const now = new Date(2026, 9, 28, 12).getTime();
    const local = (day: number, hour = 0) => new Date(2026, 9, day, hour).toISOString();
    const notes = [note('today', { updatedAt: local(28) }), note('week', { updatedAt: local(22) }), note('old', { updatedAt: local(21, 23) }), note('pin', { pinned: true })];
    expect(groupNotes(notes, '', null, now).map(g => [g.title, g.notes.map(n => n.id)])).toEqual([
      ['Закреплённые', ['pin']], ['Сегодня', ['today']], ['За неделю', ['week']], ['Раньше', ['old']],
    ]);
    expect(groupNotes(notes, 'несуществующий', null, now)).toEqual([]);
  });
  it('сохраняет календарные границы на весеннем переводе часов', () => {
    vi.stubEnv('TZ', 'America/New_York');
    try {
      const now = new Date(2026, 2, 9, 12).getTime();
      expect(dateGroup(note('edge', { updatedAt: new Date(2026, 2, 3, 0, 0).toISOString() }), now)).toBe('За неделю');
      expect(dateGroup(note('outside', { updatedAt: new Date(2026, 2, 2, 23, 59).toISOString() }), now)).toBe('Раньше');
      const start = new Date(2026, 2, 8).getTime();
      expect(nextMidnight(start) - start).toBe(23 * 60 * 60 * 1000);
      const autumn = new Date(2026, 10, 1).getTime();
      expect(nextMidnight(autumn) - autumn).toBe(25 * 60 * 60 * 1000);
    } finally { vi.unstubAllEnvs(); }
  });
  it.each([
    ['\n\n# Заголовок\nДругой', 'Заголовок'], ['---\n```ts\nconst x = 1;\n```', 'const x = 1;'],
    ['2026: планы', '2026: планы'], ['123. задача', 'задача'], ['> **Идея**', 'Идея'], ['\n---\n', 'Нет текста'],
  ])('предварительная строка %j', (body, result) => { expect(notePreview(body)).toBe(result); });
  it('форматирует дату, не меняя заметку', () => {
    const source = Object.freeze(note('a'));
    expect(noteDate(source.updatedAt)).toMatch(/\d{2}\.\d{2}.*\d{2}:\d{2}/);
    expect(source.updatedAt).toBe('2026-10-28T12:00:00.000Z');
  });
});
