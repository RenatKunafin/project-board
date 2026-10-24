import { defineWidgetType } from '@project-board/widget-sdk';
import CounterWidget from './CounterWidget';
import { migrateCounterV1 } from './model';

export function createCounterModule() {
  return { widgetTypes: [defineWidgetType({
    id: 'counter-example', title: 'Счётчик (пример)', icon: 'lucide:list-todo',
    description: 'Учебный виджет: общий документ и настройки окна',
    component: CounterWidget, startSettings: { compact: false },
    sizeConstraints: { minWidth: 2, minHeight: 2 },
    documentSupport: {
      moduleId: 'counter-example', documentType: 'counter', schemaVersion: 2,
      createContent: () => ({ count: 0 }),
      migrations: [{ from: 1, to: 2, migrate: migrateCounterV1 }],
    },
  })] };
}
