export { createWidgetRegistry } from './widget-registry';
export type {
  WidgetRegistry,
  WidgetTypeLookup,
  UnknownWidgetType as UnknownWidgetTypeData,
} from './widget-registry';
export { UnknownWidgetType } from './UnknownWidgetType';

export const DASHBOARD_PACKAGE = '@project-board/dashboard' as const;
