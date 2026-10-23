import type { WidgetSizeConstraints } from '@project-board/widget-sdk';

/** Позиция и размер окна в каскаде, в пикселях области вкладки. */
export interface CascadeArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Каскадная раскладка вкладки: области окон и порядок глубины. */
export interface CascadeLayoutState {
  readonly areas: Record<string, CascadeArea>;
  /** Идентификаторы экземпляров снизу вверх; последний — верхнее окно. */
  readonly order: readonly string[];
}

/** Условная ячейка для пересчёта ограничений типа в пиксели каскада. */
export const CASCADE_CELL = { width: 140, height: 96 } as const;

/** Высота свёрнутого окна — заголовок рамки. */
export const CASCADE_COLLAPSED_HEIGHT = 34; // заголовок 32px + границы рамки

export const CASCADE_SNAP = 16;

/** Допустимые узлы; при отсутствии узлов важнее ограничения типа/канваса. */
export function cascadeSnapRange(min: number, max: number) {
  const upper = Math.max(min, max);
  const first = Math.ceil(min / CASCADE_SNAP) * CASCADE_SNAP;
  const last = Math.floor(upper / CASCADE_SNAP) * CASCADE_SNAP;
  return first <= last
    ? { min: first, max: last, step: CASCADE_SNAP }
    : { min, max: upper, step: 1 };
}

function snapWithin(value: number, min: number, max: number): number {
  const range = cascadeSnapRange(min, max);
  return Math.min(range.max, Math.max(range.min, Math.round(value / range.step) * range.step));
}

/** Нормализация отображения и итогового жеста без перезаписи старой раскладки. */
export function snapCascadeArea(
  area: CascadeArea,
  canvas: { width: number; height: number } | null,
  constraints: WidgetSizeConstraints,
  collapsed = false,
): CascadeArea {
  const bounds = cascadeSizeBounds(constraints);
  const width = snapWithin(area.width, bounds.minWidth,
    Math.min(Number(bounds.maxWidth ?? Infinity), canvas?.width ?? Infinity));
  // Перенос свёрнутого окна не меняет его сохранённую развёрнутую высоту.
  const height = collapsed ? area.height : snapWithin(area.height, bounds.minHeight,
    Math.min(Number(bounds.maxHeight ?? Infinity), canvas?.height ?? Infinity));
  return {
    x: snapWithin(area.x, 0, Math.max(0, (canvas?.width ?? Infinity) - width)),
    y: snapWithin(area.y, 0, Math.max(0, (canvas?.height ?? Infinity) - (collapsed ? CASCADE_COLLAPSED_HEIGHT : height))),
    width,
    height,
  };
}

const DEFAULT_AREA = { width: 600, height: 420 } as const;

const CASCADE_STACK_STEP = 28;
const CASCADE_STACK_OFFSET = 24;
const CASCADE_STACK_DEPTH = 8;

function clampToConstraints(
  value: number,
  min: number,
  max: number | undefined,
): number {
  const lower = Math.max(value, min);
  return max === undefined ? lower : Math.min(lower, max);
}

/** Стартовая область нового окна по ограничениям типа и позиции стека. */
export function defaultCascadeArea(
  constraints: WidgetSizeConstraints,
  stackIndex: number,
): CascadeArea {
  const step = stackIndex % CASCADE_STACK_DEPTH;
  const maxWidth =
    constraints.maxWidth === undefined
      ? undefined
      : constraints.maxWidth * CASCADE_CELL.width;
  const maxHeight =
    constraints.maxHeight === undefined
      ? undefined
      : constraints.maxHeight * CASCADE_CELL.height;
  return {
    x: CASCADE_STACK_OFFSET + step * CASCADE_STACK_STEP,
    y: CASCADE_STACK_OFFSET + step * CASCADE_STACK_STEP,
    width: clampToConstraints(
      DEFAULT_AREA.width,
      constraints.minWidth * CASCADE_CELL.width,
      maxWidth,
    ),
    height: clampToConstraints(
      DEFAULT_AREA.height,
      constraints.minHeight * CASCADE_CELL.height,
      maxHeight,
    ),
  };
}

/** Границы размера окна в пикселях по ограничениям зарегистрированного типа. */
export function cascadeSizeBounds(constraints: WidgetSizeConstraints): {
  minWidth: number;
  minHeight: number;
  maxWidth?: number | string;
  maxHeight?: number | string;
} {
  return {
    minWidth: constraints.minWidth * CASCADE_CELL.width,
    minHeight: constraints.minHeight * CASCADE_CELL.height,
    ...(constraints.maxWidth === undefined
      ? {}
      : { maxWidth: constraints.maxWidth * CASCADE_CELL.width }),
    ...(constraints.maxHeight === undefined
      ? {}
      : { maxHeight: constraints.maxHeight * CASCADE_CELL.height }),
  };
}

/**
 * Клампинг области окна в границы канваса вкладки (PBT-076, design D3):
 * окно целиком остаётся в области вкладки — заголовок, кнопки рамки и
 * ручка ресайза достижимы. Размер ограничен и типом виджета, и канвасом;
 * если минимум типа не влезает в канвас — окно прижимается к 0,0 с
 * минимальным размером (достижимость важнее вписывания). Применяется
 * на отображение (включая восстановление из БД и сжатие канваса) и на
 * фиксацию жестов (в БД попадает валидная геометрия).
 */
export function clampCascadeArea(
  area: CascadeArea,
  canvas: { width: number; height: number },
  constraints: WidgetSizeConstraints,
): CascadeArea {
  const minWidth = constraints.minWidth * CASCADE_CELL.width;
  const minHeight = constraints.minHeight * CASCADE_CELL.height;
  const maxWidth =
    constraints.maxWidth === undefined
      ? undefined
      : constraints.maxWidth * CASCADE_CELL.width;
  const maxHeight =
    constraints.maxHeight === undefined
      ? undefined
      : constraints.maxHeight * CASCADE_CELL.height;
  const width = Math.min(
    clampToConstraints(area.width, minWidth, maxWidth),
    Math.max(minWidth, canvas.width),
  );
  const height = Math.min(
    clampToConstraints(area.height, minHeight, maxHeight),
    Math.max(minHeight, canvas.height),
  );
  const x = Math.min(Math.max(0, area.x), Math.max(0, canvas.width - width));
  const y = Math.min(Math.max(0, area.y), Math.max(0, canvas.height - height));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Область окна из состояния; для нового — стартовая по типу и стеку. */
export function areaOf(
  instanceId: string,
  constraints: WidgetSizeConstraints,
  stackIndex: number,
  state: CascadeLayoutState,
): CascadeArea {
  return (
    state.areas[instanceId] ??
    defaultCascadeArea(constraints, stackIndex)
  );
}

/** Порядок глубины: известные экземпляры в порядке стека + новые наверх. */
export function orderFrom(
  previous: readonly string[],
  instanceIds: ReadonlySet<string>,
): string[] {
  const kept = previous.filter((id) => instanceIds.has(id));
  const appended = [...instanceIds].filter((id) => !kept.includes(id));
  return [...kept, ...appended];
}

/** Позиция в порядке глубины: чем больше, тем выше окно. */
export function depthOf(order: readonly string[], instanceId: string): number {
  const index = order.indexOf(instanceId);
  return index === -1 ? 0 : index + 1;
}
