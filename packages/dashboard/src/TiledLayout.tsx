import type { ComponentType, ReactNode } from 'react';
import GridLayout from 'react-grid-layout';
// Базовые стили сетки и resize-уголков: импортированы в адаптере платформы,
// резолвятся относительно пакета независимо от hoisting в workspaces.
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { WidgetSizeConstraints } from '@project-board/widget-sdk';
import {
  TILE_GAP,
  TILE_GRID_COLUMNS,
  TILE_ROW_HEIGHT,
  areaBounds,
  areaOf,
  areasFromPositions,
  type TiledArea,
  type TiledLayoutState,
} from './tiled-layout';

/**
 * Минимальный контракт сетки React Grid Layout, изолированный в адаптере:
 * приложение и виджеты типов библиотеки не видят.
 */
interface GridLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

interface GridLayoutProps {
  children?: ReactNode;
  layout?: GridLayoutItem[];
  cols?: number;
  rowHeight?: number;
  margin?: [number, number];
  compactType?: 'vertical' | 'horizontal' | null;
  draggableHandle?: string;
  className?: string;
  onLayoutChange?: (layout: GridLayoutItem[]) => void;
}

const Grid = (
  GridLayout as unknown as {
    WidthProvider: (component: ComponentType<GridLayoutProps>) => ComponentType<
      GridLayoutProps & { width?: number }
    >;
  }
).WidthProvider(GridLayout as ComponentType<GridLayoutProps>);

export interface TiledItemInput {
  readonly instanceId: string;
  readonly constraints: WidgetSizeConstraints;
  readonly collapsed: boolean;
  readonly node: ReactNode;
}

export interface TiledLayoutProps {
  readonly items: readonly TiledItemInput[];
  readonly areas: TiledLayoutState;
  readonly onAreasChange: (next: TiledLayoutState) => void;
}

/**
 * Сеточная раскладка вкладки: перенос за заголовок окна, resize по ограничениям
 * типа, сдвиг соседей без перекрытий. Библиотека раскладки изолирована здесь.
 */
export function TiledLayout({ items, areas, onAreasChange }: TiledLayoutProps) {
  const knownIds = new Set(items.map((item) => item.instanceId));
  const layout: GridLayoutItem[] = items.map((item) => {
    const area: TiledArea = areaOf(item.instanceId, item.constraints, areas);
    return {
      i: item.instanceId,
      x: area.x,
      y: area.y,
      w: area.w,
      h: item.collapsed ? 1 : area.h,
      ...areaBounds(item.constraints),
    };
  });

  const handleLayoutChange = (next: GridLayoutItem[]): void => {
    onAreasChange(areasFromPositions(next, knownIds));
  };

  return (
    <Grid
      className="tiled-grid"
      layout={layout}
      cols={TILE_GRID_COLUMNS}
      rowHeight={TILE_ROW_HEIGHT}
      margin={[TILE_GAP, TILE_GAP]}
      compactType="vertical"
      draggableHandle=".widget-window__head"
      onLayoutChange={handleLayoutChange}
    >
      {items.map((item) => (
        <div key={item.instanceId} className="tiled-grid__cell">
          {item.node}
        </div>
      ))}
    </Grid>
  );
}
