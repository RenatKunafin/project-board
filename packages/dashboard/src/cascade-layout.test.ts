import { describe, expect, it } from 'vitest';
import {
  areaOf,
  cascadeSizeBounds,
  defaultCascadeArea,
  depthOf,
  orderFrom,
  snapCascadeArea,
  cascadeSnapRange,
  cascadeCanvasSize,
  freeCascadeArea,
  type CascadeLayoutState,
} from './cascade-layout';

const checklistConstraints = { minWidth: 2, minHeight: 2 };

describe('сетка каскада (PBT-078)', () => {
  const canvas = { width: 1000, height: 700 };

  it('нормализует старую геометрию, не изменяя исходную запись', () => {
    const legacy = Object.freeze({ x: 24, y: 52, width: 600, height: 420 });
    expect(snapCascadeArea(legacy, canvas, checklistConstraints)).toEqual({
      x: 32, y: 48, width: 608, height: 416,
    });
    expect(legacy).toEqual({ x: 24, y: 52, width: 600, height: 420 });
  });

  it('выбирает крайние допустимые узлы, сохраняя окно внутри несеточного канваса', () => {
    const area = snapCascadeArea({ x: 900, y: 650, width: 600, height: 420 }, canvas, checklistConstraints);
    expect(area).toEqual({ x: 384, y: 272, width: 608, height: 416 });
    expect(area.x + area.width).toBeLessThanOrEqual(canvas.width);
    expect(area.y + area.height).toBeLessThanOrEqual(canvas.height);
  });

  it('не округляет минимум вниз или максимум вверх', () => {
    expect(cascadeSnapRange(280, 420)).toEqual({ min: 288, max: 416, step: 16 });
    expect(snapCascadeArea({ x: -20, y: -5, width: 10, height: 900 }, canvas,
      { ...checklistConstraints, maxWidth: 3, maxHeight: 3 })).toEqual({
      x: 0, y: 0, width: 288, height: 288,
    });
  });

  it('в интервале без узлов приоритет имеют границы размера', () => {
    expect(cascadeSnapRange(280, 283)).toEqual({ min: 280, max: 283, step: 1 });
    expect(snapCascadeArea({ x: 50, y: 50, width: 600, height: 420 },
      { width: 283, height: 199 }, checklistConstraints)).toEqual({
      x: 0, y: 0, width: 283, height: 192,
    });
  });

  it('при канвасе меньше минимума сохраняет минимум и позицию 0', () => {
    expect(snapCascadeArea({ x: 50, y: 50, width: 600, height: 420 },
      { width: 200, height: 150 }, checklistConstraints)).toEqual({
      x: 0, y: 0, width: 280, height: 192,
    });
  });

  it('свёрнутое окно движется до нижних узлов, не теряя развёрнутую высоту', () => {
    expect(snapCascadeArea({ x: 0, y: 900, width: 600, height: 420 },
      canvas, checklistConstraints, true)).toEqual({
      x: 0, y: 656, width: 608, height: 420,
    });
  });

  it('работает до первого измерения канваса без бесконечных размеров', () => {
    expect(snapCascadeArea({ x: 24, y: 52, width: 600, height: 420 },
      null, checklistConstraints)).toEqual({ x: 32, y: 48, width: 608, height: 416 });
  });

  it('повторная нормализация не сдвигает геометрию', () => {
    for (const width of [200, 283, 511, 1000]) {
      const bounds = { width, height: 699 };
      const area = snapCascadeArea({ x: 943, y: 637, width: 612, height: 417 }, bounds, checklistConstraints);
      expect(snapCascadeArea(area, bounds, checklistConstraints)).toEqual(area);
    }
  });
});

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

describe('расширяемое поле каскада', () => {
  it('новое окно помещается ниже занятого экрана и не перекрывает окна', () => {
    const occupied = [{ x: 16, y: 16, width: 608, height: 416 }];
    const next = freeCascadeArea(checklistConstraints, occupied, 1024);
    expect(next).toEqual({ x: 16, y: 448, width: 608, height: 416 });
    expect(cascadeCanvasSize([...occupied, next], { width: 1024, height: 600 })).toEqual({ width: 1024, height: 928 });
  });

  it('использует свободное место в строке при достаточной ширине', () => {
    expect(freeCascadeArea(checklistConstraints,
      [{ x: 16, y: 16, width: 608, height: 416 }], 1440)).toEqual({ x: 640, y: 16, width: 608, height: 416 });
  });

  it('канвас растёт по сохранённым окнам, а маленький экран не меняет геометрию', () => {
    const area = { x: 1600, y: 1200, width: 608, height: 416 };
    expect(cascadeCanvasSize([area], { width: 820, height: 500 })).toEqual({ width: 2272, height: 1680 });
    expect(snapCascadeArea(area, null, checklistConstraints)).toEqual(area);
  });

  it('повторное добавление на узком экране не создаёт пересечений', () => {
    const occupied: { x: number; y: number; width: number; height: number }[] = [];
    for (let index = 0; index < 10; index += 1) {
      const next = freeCascadeArea(checklistConstraints, occupied, 400);
      for (const previous of occupied) expect(next.y).toBeGreaterThanOrEqual(previous.y + previous.height + 16);
      occupied.push(next);
    }
  });
});
