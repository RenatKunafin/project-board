import { useEffect, useRef, useState, type ComponentType, ReactNode } from 'react';
import { Rnd } from 'react-rnd';
import type { WidgetSizeConstraints } from '@project-board/widget-sdk';
import {
  CASCADE_COLLAPSED_HEIGHT,
  areaOf,
  cascadeSizeBounds,
  clampCascadeArea,
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
  const clampFor = (
    constraints: WidgetSizeConstraints,
    raw: CascadeArea,
  ): CascadeArea => {
    const canvas = canvasSizeRef.current;
    return canvas === null ? raw : clampCascadeArea(raw, canvas, constraints);
  };

  const applyArea = (instanceId: string, area: CascadeArea): void => {
    onStateChange({
      areas: { ...state.areas, [instanceId]: area },
      order,
    });
  };

  return (
    <div className="cascade-layout" ref={containerRef}>
      {items.map((item, index) => {
        const storedArea = areaOf(
          item.instanceId,
          item.constraints,
          index,
          state,
        );
        // Отображение через клампинг: восстановленные и «убежавшие»
        // за край области показываются внутри канваса (запись в БД —
        // только пользовательской операцией, см. clampFor).
        const area =
          canvasSize === null
            ? storedArea
            : clampCascadeArea(storedArea, canvasSize, item.constraints);
        const bounds = cascadeSizeBounds(item.constraints);
        const depth = depthOf(order, item.instanceId);
        return (
          <RndComponent
            key={item.instanceId}
            className="cascade-layout__window"
            size={{ width: area.width, height: item.collapsed ? CASCADE_COLLAPSED_HEIGHT : area.height }}
            position={{ x: area.x, y: area.y }}
            minWidth={bounds.minWidth}
            minHeight={bounds.minHeight}
            maxWidth={bounds.maxWidth}
            maxHeight={bounds.maxHeight}
            dragHandleClassName="widget-window__head"
            bounds="parent"
            enableResizing={{ bottomRight: !item.collapsed, top: false, right: false, bottom: false, left: false, topRight: false, bottomLeft: false, topLeft: false }}
            resizeHandleClasses={RESIZE_HANDLE_CLASSES}
            style={{ zIndex: depth }}
            onDragStop={(_event, data) => {
              applyArea(
                item.instanceId,
                clampFor(item.constraints, {
                  ...area,
                  x: data.x,
                  y: data.y,
                }),
              );
            }}
            onResizeStop={(_event, _direction, ref, _delta, position) => {
              applyArea(
                item.instanceId,
                clampFor(item.constraints, {
                  x: position.x,
                  y: position.y,
                  width: ref.offsetWidth,
                  height: ref.offsetHeight,
                }),
              );
            }}
          >
            {item.node}
          </RndComponent>
        );
      })}
    </div>
  );
}
