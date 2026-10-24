import { describe, expect, it } from 'vitest';
import { migrateCounterV1, parseCounter } from './model';

describe('документ учебного счётчика', () => {
  it('читает целое значение, включая ноль', () => {
    expect(parseCounter({ count: 0 })).toEqual({ count: 0 });
    expect(parseCounter({ count: -5 })).toEqual({ count: -5 });
  });
  it('отвергает повреждённые данные и переполнение вместо сброса', () => {
    for (const content of [null, {}, { count: '2' }, { count: 0.5 }, { count: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(() => parseCounter(content)).toThrow();
    }
  });
  it('мигрирует v1 без изменения входного объекта и не теряет ошибку', () => {
    const legacy = Object.freeze({ value: 7 });
    expect(migrateCounterV1(legacy)).toEqual({ count: 7 });
    expect(legacy).toEqual({ value: 7 });
    expect(() => migrateCounterV1({ value: 'bad' })).toThrow();
  });
});
