import { useEffect, useRef, useState, type ComponentType, type CSSProperties, ReactNode } from 'react';
import { Rnd } from 'react-rnd';
import type { WidgetSizeConstraints } from '@project-board/widget-sdk';
import {
  CASCADE_COLLAPSED_HEIGHT,
  CASCADE_SNAP,
  cascadeSnapRange,
  areaOf,
  cascadeSizeBounds,
  snapCascadeArea,
  depthOf,
  orderFrom,
  type CascadeArea,
  type CascadeLayoutState,
} from './cascade-layout';

/**
 * Минимальный контракт свободного окна react-rnd, изолированный в адаптере:
 * приложение и виджеты типов библиотеки не видят.
 */
interface RndProps {
  children?: ReactNode;
  className?: string;
  size: { width: number; height: number };
  position: { x: number; y: number };
  minWidth?: number | string;
  minHeight?: number | string;
  maxWidth?: number | string;
  maxHeight?: number | string;
  dragHandleClassName?: string;
  bounds?: string;
  dragGrid?: [number, number];
  resizeGrid?: [number, number];
  disableDragging?: boolean;
  enableResizing?: Record<string, boolean>;
  resizeHandleClasses?: Record<string, string>;
  style?: Record<string, string | number>;
  onDragStop?: (
    event: unknown,
    data: { x: number; y: number },
  ) => void;
  onResizeStop?: (
    event: unknown,
    direction: unknown,
    ref: { offsetWidth: number; offsetHeight: number },
    delta: unknown,
    position: { x: number; y: number },
  ) => void;
}

const RndComponent = Rnd as unknown as ComponentType<RndProps>;

export interface CascadeItemInput {
  readonly instanceId: string;
  readonly constraints: WidgetSizeConstraints;
  readonly collapsed: boolean;
  readonly node: ReactNode;
}

export interface CascadeLayoutProps {
  readonly items: readonly CascadeItemInput[];
  readonly state: CascadeLayoutState;
  readonly onStateChange: (next: CascadeLayoutState) => void;
}

const RESIZE_HANDLE_CLASSES: Record<string, string> = {
  top: 'cascade-resize',
  right: 'cascade-resize',
  bottom: 'cascade-resize',
  left: 'cascade-resize',
  topRight: 'cascade-resize',
  bottomRight: 'cascade-resize cascade-resize-se',
  bottomLeft: 'cascade-resize',
  topLeft: 'cascade-resize',
};

/**
 * Каскадная раскладка вкладки: свободные позиции и размеры, перекрытие окон,
 * активное окно поверх по порядку глубины. Библиотека изолирована здесь.
 */
export function CascadeLayout({
  items,
  state,
  onStateChange,
}: CascadeLayoutProps) {
  const instanceIds = new Set(items.map((item) => item.instanceId));
  const order = orderFrom(state.order, instanceIds);

  // Размер канваса вкладки (PBT-076, design D3): ResizeObserver —
  // клампинг работает при восстановлении сохранённой геометрии
  // (записанной на большем экране) и при сжатии канваса вживую.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;
  useEffect(() => {
    const element = containerRef.current;
    if (
      element === null ||
      typeof window === 'undefined' ||
      typeof window.ResizeObserver !== 'function'
    ) {
      return;
    }
    const observer = new window.ResizeObserver(() => {
      setCanvasSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Клампинг при фиксации жеста: в раскладку (и БД) — валидная геометрия. */
  const snapFor = (
    constraints: WidgetSizeConstraints,
    raw: CascadeArea,
    collapsed: boolean,
  ): CascadeArea => {
    const canvas = canvasSizeRef.current;
    return snapCascadeArea(raw, canvas, constraints, collapsed);
  };

  const applyArea = (instanceId: string, area: CascadeArea): void => {
    onStateChange({
      areas: { ...state.areas, [instanceId]: area },
      order,
    });
  };

  return (
    <div className="cascade-layout" ref={containerRef} style={{ '--cascade-snap': `${CASCADE_SNAP}px`, '--cascade-dot-offset': `${-CASCADE_SNAP / 2}px` } as CSSProperties}>
      {items.map((item, index) => {
        const storedArea = areaOf(
          item.instanceId,
          item.constraints,
          index,
          state,
        );
        // Отображение через клампинг: восстановленные и «убежавшие»
        // за край области показываются внутри канваса (запись в БД —
        // только пользовательской операцией, см. snapFor).
        const area = snapCascadeArea(storedArea, canvasSize, item.constraints, item.collapsed);
        const typeBounds = cascadeSizeBounds(item.constraints);
        const widthRange = cascadeSnapRange(typeBounds.minWidth,
          Math.min(Number(typeBounds.maxWidth ?? Infinity), (canvasSize?.width ?? Infinity) - area.x));
        const heightRange = cascadeSnapRange(typeBounds.minHeight,
          Math.min(Number(typeBounds.maxHeight ?? Infinity), (canvasSize?.height ?? Infinity) - area.y));
        const visibleHeight = item.collapsed ? CASCADE_COLLAPSED_HEIGHT : area.height;
        // Границы drag тоже на узлах: штатный bounds иначе допускает
        // несеточную позицию у края. Прозрачная плоскость не ловит клики
        // и не создаёт stacking context — z-index окон остаётся общим.
        const planeWidth = canvasSize === null ? '100%' : area.width + Math.max(0,
          Math.floor((canvasSize.width - area.width) / CASCADE_SNAP) * CASCADE_SNAP);
        const planeHeight = canvasSize === null ? '100%' : visibleHeight + Math.max(0,
          Math.floor((canvasSize.height - visibleHeight) / CASCADE_SNAP) * CASCADE_SNAP);
        const depth = depthOf(order, item.instanceId);
        return (
          <div key={item.instanceId} className="cascade-layout__bounds" style={{ width: planeWidth, height: planeHeight }}>
            <RndComponent
              className="cascade-layout__window"
              size={{ width: area.width, height: item.collapsed ? CASCADE_COLLAPSED_HEIGHT : area.height }}
              position={{ x: area.x, y: area.y }}
              minWidth={widthRange.min}
              minHeight={item.collapsed ? CASCADE_COLLAPSED_HEIGHT : heightRange.min}
              maxWidth={Number.isFinite(widthRange.max) ? widthRange.max : undefined}
              maxHeight={item.collapsed ? CASCADE_COLLAPSED_HEIGHT : Number.isFinite(heightRange.max) ? heightRange.max : undefined}
              dragHandleClassName="widget-window__head"
              bounds="parent"
              dragGrid={[CASCADE_SNAP, CASCADE_SNAP]}
              resizeGrid={[widthRange.step, heightRange.step]}
              enableResizing={{ bottomRight: !item.collapsed, top: false, right: false, bottom: false, left: false, topRight: false, bottomLeft: false, topLeft: false }}
              resizeHandleClasses={RESIZE_HANDLE_CLASSES}
              style={{ zIndex: depth }}
              onDragStop={(_event, data) => {
                applyArea(
                  item.instanceId,
                  snapFor(item.constraints, {
                    ...area,
                    x: data.x,
                    y: data.y,
                  }, item.collapsed),
                );
              }}
              onResizeStop={(_event, _direction, ref, _delta, position) => {
                applyArea(
                  item.instanceId,
                  snapFor(item.constraints, {
                    x: position.x,
                    y: position.y,
                    width: ref.offsetWidth,
                    height: ref.offsetHeight,
                  }, false),
                );
              }}
            >
              {item.node}
            </RndComponent>
          </div>
        );
      })}
    </div>
  );
}
