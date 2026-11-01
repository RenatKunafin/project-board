import { RRule } from 'rrule';
import type { CalendarContent, CalendarEvent, CalendarRepeat } from './model';

/** A rendered occurrence keeps a pointer to the one stored series record. */
export interface CalendarOccurrence {
  readonly event: CalendarEvent;
  readonly date: string;
  readonly key: string;
}

export const CALENDAR_REPEAT_LABELS: Readonly<Record<CalendarRepeat, string>> = {
  none: 'Не повторяется',
  daily: 'Каждый день',
  weekly: 'Каждую неделю',
  monthly: 'Каждый месяц',
  yearly: 'Каждый год',
};

/**
 * Calendar dates are deliberately converted to UTC only while rrule performs
 * date arithmetic. They are never interpreted as event instants, so local
 * dates and wall-clock values survive DST transitions unchanged.
 */
function floatingDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function frequency(repeat: Exclude<CalendarRepeat, 'none'>): number {
  switch (repeat) {
    case 'daily': return RRule.DAILY;
    case 'weekly': return RRule.WEEKLY;
    case 'monthly': return RRule.MONTHLY;
    case 'yearly': return RRule.YEARLY;
  }
}

function compareOccurrences(a: CalendarOccurrence, b: CalendarOccurrence): number {
  return a.date.localeCompare(b.date)
    || a.event.time.localeCompare(b.event.time)
    || a.event.title.localeCompare(b.event.title, 'ru-RU')
    || a.event.id.localeCompare(b.event.id);
}

/** Compute only occurrences inside the finite, inclusive calendar range. */
export function occurrencesForRange(content: CalendarContent, from: string, to: string): readonly CalendarOccurrence[] {
  if (from > to) return [];
  const occurrences: CalendarOccurrence[] = [];
  for (const event of content.events) {
    if (event.repeat === 'none') {
      if (event.date >= from && event.date <= to) occurrences.push({ event, date: event.date, key: `${event.id}:${event.date}` });
      continue;
    }
    if (event.date > to || (event.until !== '' && event.until < from)) continue;
    const rule = new RRule({
      freq: frequency(event.repeat),
      dtstart: floatingDate(event.date),
      ...(event.until ? { until: floatingDate(event.until) } : {}),
    });
    for (const occurrence of rule.between(floatingDate(from), floatingDate(to), true)) {
      const date = dateKey(occurrence);
      occurrences.push({ event, date, key: `${event.id}:${date}` });
    }
  }
  return occurrences.sort(compareOccurrences);
}

export function occurrencesForDate(content: CalendarContent, date: string): readonly CalendarOccurrence[] {
  return occurrencesForRange(content, date, date);
}

