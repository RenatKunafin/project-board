import { useEffect, useRef, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';

export interface WidgetWindowProps {
  readonly title: string;
  readonly icon?: string;
  readonly collapsed?: boolean;
  readonly active?: boolean;
  /**
   * Развёрнутость окна на весь дашборд (PBT-071): узел окна переносится
   * в overlay-слой вкладки без размонтирования; геометрия раскладки
   * не меняется.
   */
  readonly maximized?: boolean;
  /** Скрытие соседом активной максимизации: keep-mounted (display: none). */
  readonly hiddenByMaximize?: boolean;
  readonly onToggleCollapse?: () => void;
  readonly onToggleMaximize?: () => void;
  readonly onClose?: () => void;
  readonly onActivate?: () => void;
  readonly children?: ReactNode;
}

export function WidgetWindow({
  title,
  icon,
  collapsed = false,
  active = false,
  maximized = false,
  hiddenByMaximize = false,
  onToggleCollapse,
  onToggleMaximize,
  onClose,
  onActivate,
  children,
}: WidgetWindowProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Исходный родитель узла до разворота: возврат на место раскладки
  // (ячейка сетки / обёртка каскада) без размонтирования React-узла.
  const restoreParentRef = useRef<ParentNode | null>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return;
    }
    if (maximized) {
      const layer = element
        .closest('.tab-surface')
        ?.querySelector<HTMLElement>(':scope > .widget-maximize-layer');
      if (layer && element.parentElement !== layer) {
        restoreParentRef.current = element.parentElement;
        layer.appendChild(element);
      }
      return;
    }
    const parent = restoreParentRef.current;
    if (parent) {
      restoreParentRef.current = null;
      parent.appendChild(element);
    }
  }, [maximized]);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={title}
      className={[
        'widget-window',
        active ? 'widget-window--active' : '',
        collapsed ? 'widget-window--collapsed' : '',
        maximized ? 'widget-window--maximized' : '',
        hiddenByMaximize ? 'widget-window--maximize-hidden' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseDown={onActivate}
      data-active={active ? 'true' : 'false'}
    >
      <div className="widget-window__head">
        <span className="widget-window__icon" aria-hidden="true">
          {icon ?? '🧩'}
        </span>
        {/* Ручка переноса — визуальный язык прототипа (PBT-070 D1);
            сам перенос управляется раскладкой, иконка индикативна. */}
        <span className="widget-window__grip" aria-hidden="true">
          <GripVertical />
        </span>
        <span className="widget-window__title">{title}</span>
        <span
          className="widget-window__actions"
          // Кнопки окна — не ручка переноса: mousedown не уходит в drag-механику
          // сетки, иначе сеточная раскладка съедает клики кнопок.
          onMouseDown={(event) => {
            event.stopPropagation();
            onActivate?.();
          }}
        >
          <button
            type="button"
            className="widget-window__button"
            aria-label={collapsed ? `Развернуть ${title}` : `Свернуть ${title}`}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
          >
            {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="widget-window__button"
            aria-label={
              maximized
                ? `Вернуть прежний размер ${title}`
                : `Развернуть на весь дашборд ${title}`
            }
            aria-expanded={maximized}
            onClick={onToggleMaximize}
          >
            {maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="widget-window__button widget-window__button--danger"
            aria-label={`Закрыть ${title}`}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      </div>
      {/* Boundary локален содержимому: кнопки рамки доступны при падении.
          Развёрнутое окно показывает содержимое и свёрнутым до разворота
          (прототип: !collapsed || maximized). */}
      <div className="widget-window__body" hidden={collapsed && !maximized}>
        <WidgetErrorBoundary>{children}</WidgetErrorBoundary>
      </div>
    </div>
  );
}
