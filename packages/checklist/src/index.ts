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
        icon: '☑️',
        component: ChecklistWidget,
        startSettings: {},
        sizeConstraints: { minWidth: 2, minHeight: 2 },
        documentSupport: {
          moduleId: 'checklist',
          documentType: 'list',
          schemaVersion: 1,
          createContent: (title: string) => ({ title, items: [] }),
        },
      }),
    ],
  };
}
