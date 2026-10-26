import { defineWidgetType } from '@project-board/widget-sdk';
import PlanGanttWidget from './PlanGanttWidget';
import ResourceTimelineWidget from './ResourceTimelineWidget';
import {
  createPlanContent,
  PLAN_DOCUMENT_TYPE,
  PLAN_MODULE_ID,
  PLAN_SCHEMA_VERSION,
} from './plan-document';

export { default as PlanGanttWidget } from './PlanGanttWidget';
export { default as ResourceTimelineWidget } from './ResourceTimelineWidget';
export * from './plan-document';
export * from './native-plan-format';
export * from './onlinegantt-parser';
export * from './plantuml-export';
export * from './plan-commands';
export * from './task-colors';
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
export {
  planToTimelineGroups,
  planToTimelineItems,
  timelineConflictMarks,
  timelineDayIso,
  timelineDayStartMs,
  timelineRange,
} from './resource-timeline-adapter';

export const GANTT_PACKAGE = '@project-board/gantt' as const;

export function createGanttModule() {
  return {
    widgetTypes: [
      defineWidgetType({
        id: 'plan',
        title: 'План',
        icon: 'lucide:calendar-range',
        description: 'Диаграмма Ганта: задачи, сроки, зависимости',
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
      defineWidgetType({
        // Ресурсное представление (PBT-047): тот же документ plan,
        // другой компонент (ADR PBT-017 ADR-2, ADR-6.6 PBT-002).
        id: 'plan-resources',
        title: 'Ресурсы',
        icon: 'lucide:users',
        description: 'Загрузка и отсутствия команды',
        component: ResourceTimelineWidget,
        startSettings: {},
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
