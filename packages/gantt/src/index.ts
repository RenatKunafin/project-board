import { defineWidgetType } from '@project-board/widget-sdk';
import PlanGanttWidget from './PlanGanttWidget';
import {
  createPlanContent,
  PLAN_DOCUMENT_TYPE,
  PLAN_MODULE_ID,
  PLAN_SCHEMA_VERSION,
} from './plan-document';

export { default as PlanGanttWidget } from './PlanGanttWidget';
export * from './plan-document';
export * from './plan-commands';
export * from './plan-hierarchy';
export * from './plan-catalogs';
export * from './plan-assignments';
export * from './plan-dependencies';
export * from './plan-conflicts';
export {
  ganttDayIso,
  nonWorkingDayKind,
  planToGanttLinks,
  planToGanttTasks,
} from './svar-adapter';

export const GANTT_PACKAGE = '@project-board/gantt' as const;

export function createGanttModule() {
  return {
    widgetTypes: [
      defineWidgetType({
        id: 'plan',
        title: 'План',
        icon: '📅',
        component: PlanGanttWidget,
        startSettings: {},
        // Шкала Гантта требует заметной ширины: в более узком окне
        // диаграммная часть SVAR скрывается (наблюдение PBT-037).
        sizeConstraints: { minWidth: 4, minHeight: 3 },
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
