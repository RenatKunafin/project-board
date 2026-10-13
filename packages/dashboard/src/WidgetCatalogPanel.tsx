import { useState } from 'react';
import type { WidgetTypeDefinition } from '@project-board/widget-sdk';

export interface WidgetCatalogPanelProps {
  readonly types: readonly WidgetTypeDefinition[];
  readonly onPick: (type: WidgetTypeDefinition) => void;
}

/** Каталог типов виджетов: поиск по подстроке названия (макет 04). */
export function WidgetCatalogPanel({
  types,
  onPick,
}: WidgetCatalogPanelProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? types.filter((type) => type.title.toLowerCase().includes(needle))
    : types;

  return (
    <div className="widget-catalog">
      <input
        className="widget-catalog__search"
        placeholder="Поиск виджета"
        aria-label="Поиск виджета"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {visible.length === 0 ? (
        <p className="widget-catalog__empty" role="status">
          Виджет «{query.trim()}» не найден.
        </p>
      ) : (
        <ul className="widget-catalog__list">
          {visible.map((type) => (
            <li key={type.id}>
              <button
                type="button"
                className="widget-catalog__item"
                onClick={() => onPick(type)}
              >
                <span className="widget-catalog__icon" aria-hidden="true">
                  {type.icon ?? '🧩'}
                </span>
                <span className="widget-catalog__name">{type.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
