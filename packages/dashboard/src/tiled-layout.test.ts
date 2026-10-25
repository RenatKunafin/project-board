import { describe, expect, it } from 'vitest';
import {
  areaBounds,
  areaOf,
  areasFromPositions,
  defaultArea,
} from './tiled-layout';

const checklistConstraints = { minWidth: 2, minHeight: 2 };

describe('defaultArea', () => {
  it('стартовая область 6×4 для типа без максимумов', () => {
    expect(defaultArea(checklistConstraints)).toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });

  it('поднимается до минимума, если он больше старта', () => {
    expect(defaultArea({ minWidth: 8, minHeight: 6 })).toEqual({
      x: 0, y: 0, w: 8, h: 6,
    });
  });

  it('ограничивается максимумами типа', () => {
    expect(
      defaultArea({ minWidth: 2, minHeight: 2, maxWidth: 4, maxHeight: 3 }),
    ).toEqual({ x: 0, y: 0, w: 4, h: 3 });
  });
});

describe('areaBounds', () => {
  it('переносит минимумы и не задаёт максимумы, если их нет', () => {
    expect(areaBounds(checklistConstraints)).toEqual({ minW: 2, minH: 2 });
  });

  it('переносит максимумы, если они не меньше минимумов', () => {
    expect(
      areaBounds({ minWidth: 2, minHeight: 2, maxWidth: 6, maxHeight: 5 }),
    ).toEqual({ minW: 2, minH: 2, maxW: 6, maxH: 5 });
  });
});

describe('areaOf', () => {
  it('возвращает сохранённую область', () => {
    const state = { 'w-1': { x: 2, y: 3, w: 4, h: 2 } };
    expect(areaOf('w-1', checklistConstraints, state)).toEqual({
      x: 2, y: 3, w: 4, h: 2,
    });
  });

  it('новому экземпляру даёт стартовую область', () => {
    expect(areaOf('w-9', checklistConstraints, {})).toEqual({
      x: 0, y: 0, w: 6, h: 4,
    });
  });
});

describe('areasFromPositions', () => {
  it('округляет и нормализует области известных экземпляров', () => {
    const state = areasFromPositions(
      [
        { i: 'w-1', x: 0.2, y: 1.7, w: 5.5, h: 2.1 },
        { i: 'w-2', x: -1, y: 0, w: 0.4, h: 3 },
      ],
      new Set(['w-1', 'w-2']),
    );
    expect(state).toEqual({
      'w-1': { x: 0, y: 2, w: 6, h: 2 },
      'w-2': { x: 0, y: 0, w: 1, h: 3 },
    });
  });

  it('отбрасывает позиции посторонних экземпляров', () => {
    const state = areasFromPositions(
      [
        { i: 'w-1', x: 0, y: 0, w: 4, h: 2 },
        { i: 'ghost', x: 8, y: 8, w: 2, h: 2 },
      ],
      new Set(['w-1']),
    );
    expect(state).toEqual({ 'w-1': { x: 0, y: 0, w: 4, h: 2 } });
  });
});
