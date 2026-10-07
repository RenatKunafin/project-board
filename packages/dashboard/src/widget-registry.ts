import {
  WidgetRegistryError,
  type WidgetTypeDefinition,
} from '@project-board/widget-sdk';

export interface UnknownWidgetType {
  readonly kind: 'unknown';
  readonly id: string;
}

export type WidgetTypeLookup = WidgetTypeDefinition | UnknownWidgetType;

export interface WidgetRegistry {
  list(): readonly WidgetTypeDefinition[];
  get(id: string): WidgetTypeLookup;
}

export function createWidgetRegistry(
  definitions: readonly WidgetTypeDefinition[],
): WidgetRegistry {
  const byId = new Map<string, WidgetTypeDefinition>();

  for (const definition of definitions) {
    if (definition.id.trim() === '') {
      throw new WidgetRegistryError(
        'Определение типа виджета отклонено: идентификатор пуст.',
      );
    }
    if (byId.has(definition.id)) {
      throw new WidgetRegistryError(
        `Тип виджета "${definition.id}" уже зарегистрирован: повторяющийся идентификатор.`,
        definition.id,
      );
    }
    byId.set(definition.id, definition);
  }

  return {
    list: () => [...byId.values()],
    get: (id: string): WidgetTypeLookup =>
      byId.get(id) ?? { kind: 'unknown', id },
  };
}
