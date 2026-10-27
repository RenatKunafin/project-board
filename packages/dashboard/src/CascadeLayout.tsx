import { useCallback, useEffect, useRef, useState, type ComponentType, type CSSProperties, ReactNode } from 'react';
import { Rnd } from 'react-rnd';
import type { WidgetSizeConstraints } from '@project-board/widget-sdk';
import { CascadeResizeHandle } from './CascadeResizeHandle';
import {
  CASCADE_COLLAPSED_HEIGHT,
  CASCADE_SNAP,
  cascadeCanvasSize,
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
  disableDragging?: boolean;
  enableResizing?: boolean;
  style?: Record<string, string | number>;
  onDrag?: (event: unknown, data: { x: number; y: number }) => void;
  onDragStop?: (
    event: unknown,
    data: { x: number; y: number },
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

  // Измеряем viewport: он задаёт минимальную площадь, но не ограничивает
  // сохранённые координаты. Размер рабочего поля вычисляется по окнам.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [preview, setPreview] = useState<{ id: string; area: CascadeArea } | null>(null);
  const [resizeCanvasFloor, setResizeCanvasFloor] = useState<{ width: number; height: number } | null>(null);
  const previousIds = useRef(new Set(items.map(item => item.instanceId)));
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
      setViewportSize({
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
    return snapCascadeArea(raw, null, constraints, collapsed);
  };

  const applyArea = (instanceId: string, area: CascadeArea): void => {
    onStateChange({
      areas: { ...state.areas, [instanceId]: area },
      order,
    });
  };

  const normalized = items.map((item, index) => snapCascadeArea(
    areaOf(item.instanceId, item.constraints, index, state), null, item.constraints, item.collapsed));
  const extentAreas = normalized.map((area, index) => {
    const item = items[index];
    const displayed = preview?.id === item.instanceId ? preview.area : area;
    return { ...displayed, height: item.collapsed ? CASCADE_COLLAPSED_HEIGHT : displayed.height };
  });
  const viewport = viewportSize ?? { width: 0, height: 0 };
  const extent = cascadeCanvasSize(extentAreas, viewport);
  // При уменьшении окна не сжимаем канвас до конца жеста: иначе браузер
  // прижмёт scrollTop, и это смещение будет ошибочно принято за ввод.
  const canvas = {
    width: Math.max(extent.width, resizeCanvasFloor?.width ?? 0),
    height: Math.max(extent.height, resizeCanvasFloor?.height ?? 0),
  };
  const [gesture, setGesture] = useState<{ id: string; kind: 'drag' | 'resize' } | null>(null);
  const edgeStateRef = useRef<{
    id: string;
    clientY: number;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const previewRef = useRef<{ id: string; area: CascadeArea } | null>(null);
  const setTrackedPreview = useCallback((next: { id: string; area: CascadeArea } | null) => {
    previewRef.current = next;
    setPreview(next);
  }, []);
  const stopEdgeLoop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);
  useEffect(() => stopEdgeLoop, [stopEdgeLoop]);

  const edgeLoop = useCallback(() => {
    const state = edgeStateRef.current;
    const element = containerRef.current;
    const previewNow = previewRef.current;
    if (state === null || element === null || previewNow === null || previewNow.id !== state.id) {
      frameRef.current = null;
      return;
    }
    const rect = element.getBoundingClientRect();
    const EDGE = 40;
    const direction =
      state.clientY > rect.bottom - EDGE ? 1 : state.clientY < rect.top + EDGE ? -1 : 0;
    if (direction !== 0) {
      const depth = direction > 0
        ? state.clientY - (rect.bottom - EDGE)
        : rect.top + EDGE - state.clientY;
      // Автопрокрутка переноса; resize учитывает scroll в своём уголке.
      const step = Math.round(Math.min(10, 3 + depth * 0.12));
      element.scrollTop += step * direction;
    }
    frameRef.current = requestAnimationFrame(edgeLoop);
  }, []);

  const edgeScroll = useCallback((clientY: number, id: string) => {
    edgeStateRef.current = { id, clientY };
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(edgeLoop);
    }
  }, [edgeLoop]);
  useEffect(() => {
    const fresh = items.find(item => !previousIds.current.has(item.instanceId));
    previousIds.current = new Set(items.map(item => item.instanceId));
    const element = containerRef.current;
    if (!fresh || !element) return;
    const area = normalized[items.indexOf(fresh)];
    element.scrollTo({
      left: Math.max(0, area.x + Math.min(area.width, element.clientWidth) - element.clientWidth),
      top: Math.max(0, area.y + Math.min(area.height, element.clientHeight) - element.clientHeight),
    });
  });

  return (
    <div className="cascade-viewport" ref={containerRef}>
    <div className="cascade-layout" style={{ width: canvas.width, height: canvas.height, '--cascade-snap': `${CASCADE_SNAP}px`, '--cascade-dot-offset': `${-CASCADE_SNAP / 2}px` } as CSSProperties}>
      {items.map((item, index) => {
        const storedArea = areaOf(
          item.instanceId,
          item.constraints,
          index,
          state,
        );
        // Старые координаты выравниваются без ужимания до viewport;
        // запись в БД — только после пользовательского жеста.
        const area = snapCascadeArea(storedArea, null, item.constraints, item.collapsed);
        const typeBounds = cascadeSizeBounds(item.constraints);
        const widthRange = cascadeSnapRange(typeBounds.minWidth,
          Number(typeBounds.maxWidth ?? Infinity));
        const resizeArea = gesture?.id === item.instanceId && gesture.kind === 'resize'
          && preview?.id === item.instanceId ? preview.area : area;
        const visibleHeight = item.collapsed ? CASCADE_COLLAPSED_HEIGHT : area.height;
        // Запас за краем рабочего поля позволяет расширять его по preview
        // жеста. Левая/верхняя границы остаются 0, остальные — на узлах.
        // Плоскость не ловит клики и не создаёт stacking context.
        const planeWidth = area.width + Math.max(0,
          Math.floor((canvas.width + viewport.width - area.width) / CASCADE_SNAP) * CASCADE_SNAP);
        const planeHeight = visibleHeight + Math.max(0,
          Math.floor((canvas.height + viewport.height - visibleHeight) / CASCADE_SNAP) * CASCADE_SNAP);
        const depth = depthOf(order, item.instanceId);
        return (
          <div key={item.instanceId} className="cascade-layout__bounds" style={{ width: planeWidth, height: planeHeight }}>
            <RndComponent
              className={`cascade-layout__window${gesture?.id === item.instanceId ? ' cascade-layout__window--gesture' : ''}`}
              size={{ width: resizeArea.width, height: item.collapsed ? CASCADE_COLLAPSED_HEIGHT : resizeArea.height }}
              position={{ x: area.x, y: area.y }}
              minWidth={widthRange.min}
              minHeight={item.collapsed ? CASCADE_COLLAPSED_HEIGHT : typeBounds.minHeight}
              maxWidth={Number.isFinite(widthRange.max) ? widthRange.max : undefined}
              maxHeight={item.collapsed ? CASCADE_COLLAPSED_HEIGHT : typeBounds.maxHeight}
              dragHandleClassName="widget-window__head"
              bounds="parent"
              dragGrid={[CASCADE_SNAP, CASCADE_SNAP]}
              enableResizing={false}
              style={{ zIndex: depth }}
              onDrag={(event, data) => {
                setGesture({ id: item.instanceId, kind: 'drag' });
                const clientY = (event as { clientY?: number }).clientY ?? 0;
                const nextArea = { ...area, x: data.x, y: data.y };
                setTrackedPreview({ id: item.instanceId, area: nextArea });
                edgeScroll(clientY, item.instanceId);
              }}
              onDragStop={(_event, data) => {
                const tracked = previewRef.current;
                const finalDrag = tracked?.id === item.instanceId
                  ? tracked.area
                  : { ...area, x: data.x, y: data.y };
                stopEdgeLoop();
                edgeStateRef.current = null;
                setGesture(null);
                setTrackedPreview(null);
                applyArea(item.instanceId, snapFor(item.constraints, finalDrag, item.collapsed));
              }}
            >
              {item.node}
              {!item.collapsed && <CascadeResizeHandle
                viewport={containerRef}
                area={area}
                constraints={item.constraints}
                onPreview={next => {
                  const element = containerRef.current;
                  setResizeCanvasFloor(next && element
                    ? { width: element.scrollWidth, height: element.scrollHeight } : null);
                  setGesture(next ? { id: item.instanceId, kind: 'resize' } : null);
                  setTrackedPreview(next ? { id: item.instanceId, area: next } : null);
                }}
                onCommit={next => applyArea(item.instanceId, next)}
              />}
            </RndComponent>
          </div>
        );
      })}
    </div>
    </div>
  );
}
