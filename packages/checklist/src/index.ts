import { defineWidgetType } from '@project-board/widget-sdk';
import ChecklistWidget from './ChecklistWidget';

export { default as ChecklistWidget } from './ChecklistWidget';
export * from './model';

export function createChecklistModule() {
  return {
    widgetTypes: [
      defineWidgetType({
        id: 'checklist',
        title: 'Чек-лист',
        component: ChecklistWidget,
        startSettings: {},
        sizeConstraints: { minWidth: 2, minHeight: 2 },
      }),
    ],
  };
}
