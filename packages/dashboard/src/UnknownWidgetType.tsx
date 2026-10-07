import type { WidgetTypeLookup } from './widget-registry.js';

export function UnknownWidgetType({ lookup }: { lookup: WidgetTypeLookup }) {
  if (!('kind' in lookup)) {
    return null;
  }
  return (
    <div className="unknown-widget" role="status">
      <p className="unknown-widget__title">Неизвестный тип виджета</p>
      <p className="unknown-widget__hint">
        Тип «{lookup.id}» не зарегистрирован в этой сборке приложения.
      </p>
    </div>
  );
}
