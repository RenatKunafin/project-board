import { createWorkingCalendar, type WorkingCalendarDefinition } from './working-calendar';

export type NonWorkingDayKind = 'weekend' | 'holiday';
export const CALENDAR_DAY_CACHE_LIMIT = 16_384;

interface CalendarView {
  readonly dayKind: (isoDate: string) => NonWorkingDayKind | undefined;
}

// Календарь документа неизменяемый: новая конфигурация получает новый
// контекст, а удалённые документы не удерживаются этим WeakMap.
const views = new WeakMap<WorkingCalendarDefinition, CalendarView>();

export function calendarView(definition: WorkingCalendarDefinition): CalendarView {
  const existing = views.get(definition);
  if (existing) return existing;
  const calendar = createWorkingCalendar(definition);
  const holidays = new Set(definition.holidays);
  // null — кэшированный рабочий день; undefined — ещё не проверенная дата.
  const days = new Map<string, NonWorkingDayKind | null>();
  const view: CalendarView = {
    dayKind(isoDate) {
      const cached = days.get(isoDate);
      if (cached !== undefined) return cached ?? undefined;
      const kind = calendar.isWorkingDay(isoDate)
        ? null
        : holidays.has(isoDate) ? 'holiday' : 'weekend';
      if (days.size >= CALENDAR_DAY_CACHE_LIMIT) {
        days.delete(days.keys().next().value!);
      }
      days.set(isoDate, kind);
      return kind ?? undefined;
    },
  };
  views.set(definition, view);
  return view;
}
