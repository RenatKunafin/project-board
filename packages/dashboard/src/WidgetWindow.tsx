import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';

export interface WidgetWindowProps {
  readonly title: string;
  readonly icon?: string;
  readonly collapsed?: boolean;
  readonly active?: boolean;
  readonly onToggleCollapse?: () => void;
  readonly onClose?: () => void;
  readonly onActivate?: () => void;
  readonly children?: ReactNode;
}

export function WidgetWindow({
  title,
  icon,
  collapsed = false,
  active = false,
  onToggleCollapse,
  onClose,
  onActivate,
  children,
}: WidgetWindowProps) {
  return (
    <div
      role="group"
      aria-label={title}
      className={[
        'widget-window',
        active ? 'widget-window--active' : '',
        collapsed ? 'widget-window--collapsed' : '',
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
            className="widget-window__button widget-window__button--danger"
            aria-label={`Закрыть ${title}`}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      </div>
      {/* Boundary локален содержимому: кнопки рамки доступны при падении. */}
      <div className="widget-window__body" hidden={collapsed}>
        <WidgetErrorBoundary>{children}</WidgetErrorBoundary>
      </div>
    </div>
  );
}
