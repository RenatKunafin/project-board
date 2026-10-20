import { LayoutGrid } from 'lucide-react';

export interface EmptyWorkspaceProps {
  /** Открыть каталог виджетов из пустого состояния (PBT-072 D6). */
  readonly onAddWidget?: () => void;
}

export function EmptyWorkspace({ onAddWidget }: EmptyWorkspaceProps) {
  return (
    <div className="empty-workspace" role="status">
      <span className="empty-workspace__icon" aria-hidden="true">
        <LayoutGrid />
      </span>
      <p className="empty-workspace__title">Пустой дашборд</p>
      <p className="empty-workspace__hint">
        Добавьте виджеты, чтобы собрать рабочее пространство
      </p>
      {onAddWidget && (
        <button
          type="button"
          className="empty-workspace__add"
          aria-label="Добавить виджет на вкладку"
          onClick={onAddWidget}
        >
          Добавить виджет
        </button>
      )}
    </div>
  );
}
