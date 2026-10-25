import { WidgetIcon } from './WidgetIcon';
import { useId, useState } from 'react';
import type { WidgetTypeDefinition } from '@project-board/widget-sdk';

export interface WidgetCatalogPanelProps {
  readonly types: readonly WidgetTypeDefinition[];
  readonly onPick: (type: WidgetTypeDefinition) => void;
}

/** Каталог типов виджетов: карточки с иконкой-плиткой, названием и
 *  описанием; поиск по подстроке названия и описания (PBT-072 D4–D5). */
export function WidgetCatalogPanel({
  types,
  onPick,
}: WidgetCatalogPanelProps) {
  const [query, setQuery] = useState('');
  const idPrefix = useId();
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? types.filter(
        (type) =>
          type.title.toLowerCase().includes(needle) ||
          (type.description ?? '').toLowerCase().includes(needle),
      )
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
          {visible.map((type) => {
            const descriptionId = `${idPrefix}-${type.id}-desc`;
            return (
              <li key={type.id}>
                {/* Доступное имя карточки — только название типа (контракт
                    локаторов «План»/«Ресурсы»); описание — aria-describedby. */}
                <button
                  type="button"
                  className="widget-catalog__item"
                  aria-label={type.title}
                  aria-describedby={type.description ? descriptionId : undefined}
                  onClick={() => onPick(type)}
                >
                  <span className="widget-catalog__tile" aria-hidden="true">
                    <WidgetIcon icon={type.icon} />
                  </span>
                  <span className="widget-catalog__body">
                    <span className="widget-catalog__name">{type.title}</span>
                    {type.description && (
                      <span id={descriptionId} className="widget-catalog__desc">
                        {type.description}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
