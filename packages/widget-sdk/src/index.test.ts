import { describe, expect, it } from 'vitest';
import {
  WidgetRegistryError,
  defineWidgetType,
  type WidgetTypeDefinition,
} from '../src/index';

const definition: WidgetTypeDefinition = defineWidgetType({
  id: 'demo',
  title: 'Панель',
  component: () => null,
  startSettings: { title: 'Панель' },
  sizeConstraints: { minWidth: 2, minHeight: 2, maxWidth: 6, maxHeight: 4 },
});

describe('defineWidgetType', () => {
  it('возвращает определение без изменений', () => {
    expect(defineWidgetType(definition)).toBe(definition);
  });
});

describe('WidgetRegistryError', () => {
  it('ловится через instanceof и хранит конфликтующий id', () => {
    try {
      throw new WidgetRegistryError('Дубликат: demo', 'demo');
    } catch (error) {
      expect(error).toBeInstanceOf(WidgetRegistryError);
      expect(error).toBeInstanceOf(Error);
      const registryError = error as WidgetRegistryError;
      expect(registryError.conflictingId).toBe('demo');
      expect(registryError.message).toContain('demo');
    }
  });
});
