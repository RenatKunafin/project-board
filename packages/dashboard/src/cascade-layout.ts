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
export const CASCADE_COLLAPSED_HEIGHT = 44;

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
