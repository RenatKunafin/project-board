import type { WidgetSizeConstraints } from '@project-board/widget-sdk';

/** Область окна в сетке: колонка, строка, ширина и высота в ячейках. */
export interface TiledArea {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Раскладка вкладки: область каждого экземпляра по его идентификатору. */
export type TiledLayoutState = Record<string, TiledArea>;

export const TILE_GRID_COLUMNS = 12;
export const TILE_ROW_HEIGHT = 72;
export const TILE_GAP = 12;

const DEFAULT_AREA_WIDTH = 6;
const DEFAULT_AREA_HEIGHT = 4;

function clampToUpper(value: number, min: number, max?: number): number {
  const lower = Math.max(value, min);
  return max === undefined ? lower : Math.min(lower, max);
}

/** Стартовая область нового окна по ограничениям зарегистрированного типа. */
export function defaultArea(constraints: WidgetSizeConstraints): TiledArea {
  return {
    x: 0,
    y: 0,
    w: clampToUpper(DEFAULT_AREA_WIDTH, constraints.minWidth, constraints.maxWidth),
    h: clampToUpper(DEFAULT_AREA_HEIGHT, constraints.minHeight, constraints.maxHeight),
  };
}

/** Ограничения типа в границы элемента сетки. */
export function areaBounds(constraints: WidgetSizeConstraints): {
  minW: number;
  minH: number;
  maxW?: number;
  maxH?: number;
} {
  return {
    minW: Math.max(1, constraints.minWidth),
    minH: Math.max(1, constraints.minHeight),
    ...(constraints.maxWidth === undefined
      ? {}
      : { maxW: Math.max(constraints.maxWidth, constraints.minWidth) }),
    ...(constraints.maxHeight === undefined
      ? {}
      : { maxH: Math.max(constraints.maxHeight, constraints.minHeight) }),
  };
}

/** Область экземпляра из состояния; для нового окна — стартовая по типу. */
export function areaOf(
  instanceId: string,
  constraints: WidgetSizeConstraints,
  state: TiledLayoutState,
): TiledArea {
  return state[instanceId] ?? defaultArea(constraints);
}

/**
 * Раскладка в собственной структуре из позиций сетки: известные экземпляры
 * с целочисленными областями; записи библиотеки и посторонние ключи отбрасываются.
 */
export function areasFromPositions(
  positions: ReadonlyArray<{
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>,
  knownInstanceIds: ReadonlySet<string>,
): TiledLayoutState {
  const next: TiledLayoutState = {};
  for (const position of positions) {
    if (!knownInstanceIds.has(position.i)) {
      continue;
    }
    next[position.i] = {
      x: Math.max(0, Math.round(position.x)),
      y: Math.max(0, Math.round(position.y)),
      w: Math.max(1, Math.round(position.w)),
      h: Math.max(1, Math.round(position.h)),
    };
  }
  return next;
}
