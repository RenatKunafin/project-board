import type { CalendarContent } from './model';
import { dateKey, parseDateKey } from './view';
import { occurrencesForRange, type CalendarOccurrence } from './recurrence';

/** Number of days after today included in the seven-day window. */
export const UPCOMING_DAYS = 6;
export const UPCOMING_LIMIT = 100;
export const ALL_UPCOMING_TYPES = 'all' as const;

export interface UpcomingGroup {
  readonly date: string;
  readonly occurrences: readonly CalendarOccurrence[];
}

function addDays(value: string, days: number): string {
  const parsed = parseDateKey(value) ?? new Date();
  return dateKey(new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + days));
}

function localOccurrenceTime(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}

function compareUpcoming(a: CalendarOccurrence, b: CalendarOccurrence): number {
  return a.date.localeCompare(b.date)
    || (a.event.time === '' ? 1 : b.event.time === '' ? -1 : a.event.time.localeCompare(b.event.time))
    || a.event.title.localeCompare(b.event.title, 'ru-RU')
    || a.key.localeCompare(b.key);
}

export function normalizeUpcomingTypeFilter(content: CalendarContent, value: unknown): string {
  if (typeof value !== 'string' || value === ALL_UPCOMING_TYPES) return ALL_UPCOMING_TYPES;
  return content.types.some((type) => type.id === value) ? value : ALL_UPCOMING_TYPES;
}

export function upcomingOccurrences(
  content: CalendarContent,
  now = new Date(),
  typeFilter: unknown = ALL_UPCOMING_TYPES,
  days = UPCOMING_DAYS,
  limit = UPCOMING_LIMIT,
): readonly CalendarOccurrence[] {
  const today = dateKey(now);
  const to = addDays(today, days);
  const selectedType = normalizeUpcomingTypeFilter(content, typeFilter);
  return occurrencesForRange(content, today, to)
    .filter(({ event, date }) => {
      if (selectedType !== ALL_UPCOMING_TYPES && event.typeId !== selectedType) return false;
      if (date !== today || event.time === '') return true;
      return localOccurrenceTime(date, event.time) >= now.getTime();
    })
    .sort(compareUpcoming)
    .slice(0, Math.max(0, limit));
}

export function groupUpcomingOccurrences(occurrences: readonly CalendarOccurrence[]): readonly UpcomingGroup[] {
  const groups: UpcomingGroup[] = [];
  for (const occurrence of occurrences) {
    const previous = groups[groups.length - 1];
    if (previous?.date === occurrence.date) {
      groups[groups.length - 1] = { ...previous, occurrences: [...previous.occurrences, occurrence] };
    } else {
      groups.push({ date: occurrence.date, occurrences: [occurrence] });
    }
  }
  return groups;
}
