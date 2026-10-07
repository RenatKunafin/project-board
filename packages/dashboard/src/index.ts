export { createWidgetRegistry } from './widget-registry.js';
export type {
  WidgetRegistry,
  WidgetTypeLookup,
  UnknownWidgetType as UnknownWidgetTypeData,
} from './widget-registry.js';
export { UnknownWidgetType } from './UnknownWidgetType.js';

export const DASHBOARD_PACKAGE = '@project-board/dashboard' as const;
