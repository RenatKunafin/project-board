import { describe, expect, it } from 'vitest';
import {
  addItem,
  emptyChecklistContent,
  parseChecklistContent,
  removeItem,
  renameItem,
  setItemDone,
} from './model.js';

const sample = {
  items: [
    { id: 'a', text: 'Первая', done: false },
    { id: 'b', text: 'Вторая', done: true },
  ],
};

describe('checklist model — добавление', () => {
  it('добавляет пункт в конец, не выполненный', () => {
    const next = addItem(sample, 'Купить молоко');
    expect(next.items).toHaveLength(3);
    expect(next.items[2]).toMatchObject({ text: 'Купить молоко', done: false });
    expect(next.items[2].id).not.toBe('');
  });

  it('пустой и пробельный текст не меняют документ', () => {
    expect(addItem(sample, '')).toBe(sample);
    expect(addItem(sample, '   ')).toBe(sample);
  });

  it('parseChecklistContent возвращает пустой список для мусора', () => {
    expect(parseChecklistContent(undefined)).toEqual(emptyChecklistContent);
    expect(parseChecklistContent('junk')).toEqual(emptyChecklistContent);
    expect(parseChecklistContent({ items: sample.items })).toEqual(sample);
  });
});

describe('checklist model — переименование и отметка', () => {
  it('переименовывает пункт по id', () => {
    const next = renameItem(sample, 'a', 'Первая обновлена');
    expect(next.items[0]).toMatchObject({ id: 'a', text: 'Первая обновлена' });
    expect(next.items[1]).toBe(sample.items[1]);
  });

  it('пустой текст переименования игнорируется', () => {
    expect(renameItem(sample, 'a', '  ')).toBe(sample);
  });

  it('отмечает выполнение и снимает его', () => {
    expect(setItemDone(sample, 'a', true).items[0]).toMatchObject({
      id: 'a',
      done: true,
    });
    expect(setItemDone(sample, 'b', false).items[1]).toMatchObject({
      id: 'b',
      done: false,
    });
  });
});

describe('checklist model — удаление', () => {
  it('удаляет пункт по id, остальные не трогает', () => {
    const next = removeItem(sample, 'a');
    expect(next.items).toEqual([sample.items[1]]);
  });

  it('удаление несуществующего id возвращает исходный массив ссылок', () => {
    expect(removeItem(sample, 'missing').items).toEqual(sample.items);
  });
});
