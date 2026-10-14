import { defineWidgetType } from '@project-board/widget-sdk';
import PlanPlaceholderWidget from './PlanPlaceholderWidget';
import {
  createPlanContent,
  PLAN_DOCUMENT_TYPE,
  PLAN_MODULE_ID,
  PLAN_SCHEMA_VERSION,
} from './plan-document';

export { default as PlanPlaceholderWidget } from './PlanPlaceholderWidget';
export * from './plan-document';
export * from './plan-commands';
export * from './plan-hierarchy';

export const GANTT_PACKAGE = '@project-board/gantt' as const;

export function createGanttModule() {
  return {
    widgetTypes: [
      defineWidgetType({
        id: 'plan',
        title: 'План',
        icon: '📅',
        component: PlanPlaceholderWidget,
        startSettings: {},
        sizeConstraints: { minWidth: 3, minHeight: 3 },
        documentSupport: {
          moduleId: PLAN_MODULE_ID,
          documentType: PLAN_DOCUMENT_TYPE,
          schemaVersion: PLAN_SCHEMA_VERSION,
          createContent: () => ({ ...createPlanContent() }),
        },
      }),
    ],
  };
}
