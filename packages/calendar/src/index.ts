export {
  CALENDAR_COLORS,
  CALENDAR_SCHEMA_VERSION,
  CalendarValidationError,
  addCalendarEvent,
  addCalendarType,
  createCalendarId,
  createEmptyCalendarContent,
  parseCalendarContent,
  removeCalendarEvent,
  removeCalendarType,
  removeNonWorkingDay,
  setNonWorkingDay,
  updateCalendarEvent,
  updateCalendarType,
  validateCalendarContent,
} from './model';
export type {
  CalendarColor,
  CalendarContent,
  CalendarEvent,
  CalendarEventType,
  CalendarIssue,
  CalendarRepeat,
  NonWorkingDay,
  NonWorkingDayKind,
} from './model';
export * from './view';
export { CALENDAR_REPEAT_LABELS } from './recurrence';
export type { CalendarOccurrence } from './recurrence';
export { CalendarWidget } from './CalendarWidget';

import { defineWidgetType } from '@project-board/widget-sdk';
import { CalendarWidget } from './CalendarWidget';
import { createEmptyCalendarContent } from './model';

export function createCalendarModule() {
  return {
    widgetTypes: [defineWidgetType({
      id: 'calendar',
      title: 'Календарь',
      icon: 'lucide:calendar-range',
      description: 'События, даты и календарный обзор',
      component: CalendarWidget,
      startSettings: {},
      sizeConstraints: { minWidth: 2, minHeight: 2 },
      documentSupport: {
        moduleId: 'calendar',
        documentType: 'calendar',
        schemaVersion: 1,
        createContent: () => ({ ...createEmptyCalendarContent() }),
      },
    })],
  };
}
