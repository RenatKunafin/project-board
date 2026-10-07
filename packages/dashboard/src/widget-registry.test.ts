import { describe, expect, it } from 'vitest';
import { WidgetRegistryError, type WidgetTypeDefinition } from '@project-board/widget-sdk';
import { createWidgetRegistry } from './widget-registry';

const demo: WidgetTypeDefinition = {
  id: 'demo',
  title: 'Панель',
  component: () => null,
  startSettings: { title: 'Панель' },
  sizeConstraints: { minWidth: 2, minHeight: 2, maxWidth: 6, maxHeight: 4 },
};

describe('createWidgetRegistry — регистрация типа виджета', () => {
  it('успешная регистрация: тип доступен со всеми полями', () => {
    const registry = createWidgetRegistry([demo]);
    const lookup = registry.get('demo');

    expect(lookup).not.toHaveProperty('kind');
    expect(registry.list()).toEqual([demo]);
  });

  it('дубликат идентификатора отклоняется ошибкой с указанием id', () => {
    expect(() => createWidgetRegistry([demo, demo])).toThrowError(
      WidgetRegistryError,
    );
    expect(() => createWidgetRegistry([demo, demo])).toThrowError(/demo/);
  });

  it('пустой идентификатор отклоняется', () => {
    expect(() =>
      createWidgetRegistry([{ ...demo, id: '  ' }]),
    ).toThrowError(WidgetRegistryError);
  });
});

describe('createWidgetRegistry — неизвестный тип виджета', () => {
  it('запрос отсутствующего id возвращает состояние unknown, приложение продолжает работу', () => {
    const registry = createWidgetRegistry([demo]);
    const lookup = registry.get('checklist');

    expect(lookup).toEqual({ kind: 'unknown', id: 'checklist' });
    expect(registry.list()).toHaveLength(1);
  });
});
