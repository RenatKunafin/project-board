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
export { countdown, formatCountdown, isNonWorkingDay } from './workday';
export type { CalendarCountdown } from './workday';
export { CalendarWidget } from './CalendarWidget';
export { UpcomingWidget } from './UpcomingWidget';
export { groupUpcomingOccurrences, normalizeUpcomingTypeFilter, upcomingOccurrences } from './upcoming';

import { defineWidgetType } from '@project-board/widget-sdk';
import { CalendarWidget } from './CalendarWidget';
import { UpcomingWidget } from './UpcomingWidget';
import { createEmptyCalendarContent } from './model';

const calendarDocumentSupport = {
  moduleId: 'calendar',
  documentType: 'calendar',
  schemaVersion: 1,
  createContent: () => ({ ...createEmptyCalendarContent() }),
} as const;

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
      documentSupport: calendarDocumentSupport,
    }), defineWidgetType({
      id: 'upcoming-events',
      title: 'Ближайшие события',
      icon: 'lucide:calendar-clock',
      description: 'Список ближайших событий календаря',
      component: UpcomingWidget,
      startSettings: { typeFilter: 'all' },
      sizeConstraints: { minWidth: 2, minHeight: 2 },
      documentSupport: calendarDocumentSupport,
    })],
  };
}
