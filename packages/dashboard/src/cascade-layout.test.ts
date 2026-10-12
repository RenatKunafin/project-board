import { describe, expect, it } from 'vitest';
import {
  areaOf,
  cascadeSizeBounds,
  defaultCascadeArea,
  depthOf,
  orderFrom,
  type CascadeLayoutState,
} from './cascade-layout';

const checklistConstraints = { minWidth: 2, minHeight: 2 };

describe('defaultCascadeArea', () => {
  it('стартовая область 600×420 в позиции каскадного стека', () => {
    expect(defaultCascadeArea(checklistConstraints, 0)).toEqual({
      x: 24, y: 24, width: 600, height: 420,
    });
    expect(defaultCascadeArea(checklistConstraints, 3)).toEqual({
      x: 24 + 3 * 28, y: 24 + 3 * 28, width: 600, height: 420,
    });
  });

  it('стек зацикливается после восьми окон', () => {
    expect(defaultCascadeArea(checklistConstraints, 8)).toEqual(
      defaultCascadeArea(checklistConstraints, 0),
    );
  });

  it('минимумы типа поднимают стартовый размер', () => {
    const area = defaultCascadeArea({ minWidth: 5, minHeight: 6 }, 0);
    expect(area.width).toBe(5 * 140);
    expect(area.height).toBe(6 * 96);
  });

  it('максимумы типа ограничивают стартовый размер', () => {
    const area = defaultCascadeArea(
      { minWidth: 2, minHeight: 2, maxWidth: 3, maxHeight: 4 },
      0,
    );
    expect(area.width).toBe(3 * 140);
    expect(area.height).toBe(4 * 96);
  });
});

describe('cascadeSizeBounds', () => {
  it('ячейки типа пересчитываются в пиксели', () => {
    expect(cascadeSizeBounds(checklistConstraints)).toEqual({
      minWidth: 280,
      minHeight: 192,
    });
  });

  it('максимумы переносятся при наличии', () => {
    expect(
      cascadeSizeBounds({
        minWidth: 2,
        minHeight: 2,
        maxWidth: 6,
        maxHeight: 4,
      }),
    ).toEqual({ minWidth: 280, minHeight: 192, maxWidth: 840, maxHeight: 384 });
  });
});

describe('orderFrom и depthOf', () => {
  const state: CascadeLayoutState = {
    areas: {},
    order: ['w-1', 'w-2', 'w-3'],
  };

  it('порядок фильтруется по живым экземплярам', () => {
    expect(orderFrom(state.order, new Set(['w-1', 'w-3']))).toEqual([
      'w-1',
      'w-3',
    ]);
  });

  it('новые экземпляры добавляются наверх стека', () => {
    expect(orderFrom(state.order, new Set(['w-1', 'w-3', 'w-9']))).toEqual([
      'w-1',
      'w-3',
      'w-9',
    ]);
  });

  it('глубина: верхнее окно имеет наибольшее значение', () => {
    expect(depthOf(state.order, 'w-1')).toBe(1);
    expect(depthOf(state.order, 'w-3')).toBe(3);
    expect(depthOf(state.order, 'w-404')).toBe(0);
  });
});

describe('areaOf', () => {
  const state: CascadeLayoutState = {
    areas: { 'w-1': { x: 40, y: 60, width: 300, height: 200 } },
    order: ['w-1'],
  };

  it('возвращает сохранённую область', () => {
    expect(areaOf('w-1', checklistConstraints, 0, state)).toEqual({
      x: 40, y: 60, width: 300, height: 200,
    });
  });

  it('новому окну даёт стартовую область стека', () => {
    expect(areaOf('w-9', checklistConstraints, 2, state)).toEqual({
      x: 24 + 2 * 28, y: 24 + 2 * 28, width: 600, height: 420,
    });
  });
});
