import type { ReactNode } from 'react';

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
        <span className="widget-window__title">{title}</span>
        <span className="widget-window__actions">
          <button
            type="button"
            className="widget-window__button"
            aria-label={collapsed ? `Развернуть ${title}` : `Свернуть ${title}`}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
          >
            {collapsed ? '□' : '−'}
          </button>
          <button
            type="button"
            className="widget-window__button"
            aria-label={`Закрыть ${title}`}
            onClick={onClose}
          >
            ×
          </button>
        </span>
      </div>
      <div className="widget-window__body" hidden={collapsed}>
        {children}
      </div>
    </div>
  );
}
