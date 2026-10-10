import type { WidgetTypeDefinition } from '@project-board/widget-sdk';
import { createChecklistModule } from '@project-board/checklist';
import { createGanttModule } from '@project-board/gantt';

// Единственная точка регистрации типов виджетов.
// Приложение собирает комплектацию: подключение новых модулей — только здесь.
export const widgetTypes: readonly WidgetTypeDefinition[] = [
  ...createChecklistModule().widgetTypes,
  ...createGanttModule().widgetTypes,
];
