import { defineWidgetType, type WidgetTypeDefinition } from '@project-board/widget-sdk';
import DemoWidget from './widgets/demo-widget';

// Единственная точка регистрации типов виджетов.
// Приложение собирает комплектацию: подключение новых модулей — только здесь.
// Чек-лист и Гантт подключаются задачами PBT-008 и PBT-030+.
export const widgetTypes: readonly WidgetTypeDefinition[] = [
  defineWidgetType({
    id: 'demo',
    title: 'Панель-заглушка',
    component: DemoWidget,
    startSettings: { title: 'Демонстрационная панель' },
    sizeConstraints: { minWidth: 2, minHeight: 2, maxWidth: 6, maxHeight: 4 },
  }),
];
