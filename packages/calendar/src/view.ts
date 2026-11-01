import type { CalendarContent, CalendarEvent } from './model';

export const CALENDAR_COMPACT_WIDTH = 300;
export const CALENDAR_COMPACT_HEIGHT = 280;

export type CalendarViewMode = 'small' | 'month' | 'year';

export interface CalendarSize {
  readonly width: number;
  readonly height: number;
}

export interface CalendarViewSettings {
  readonly month: string;
  readonly selectedDate: string | null;
}

export interface CalendarDayCell {
  readonly date: string | null;
  readonly day: number | null;
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value: string): Date | undefined {
  const match = DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return dateKey(date) === value ? date : undefined;
}

export function monthKey(date: Date): string {
  return dateKey(new Date(date.getFullYear(), date.getMonth(), 1)).slice(0, 7);
}

export function parseMonthKey(value: string): Date | undefined {
  const match = MONTH_PATTERN.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

export function todayDateKey(now = new Date()): string {
  return dateKey(now);
}

export function millisecondsToNextLocalMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function viewMode(size: CalendarSize | null, maximized: boolean): CalendarViewMode {
  if (maximized) return 'year';
  if (size && (size.width < CALENDAR_COMPACT_WIDTH || size.height < CALENDAR_COMPACT_HEIGHT)) {
    return 'small';
  }
  return 'month';
}

export function shiftMonth(value: string, delta: number): string {
  const date = parseMonthKey(value) ?? new Date();
  return monthKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

export function monthLabel(value: string, locale = 'ru-RU'): string {
  const date = parseMonthKey(value) ?? new Date();
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
}

export function yearLabel(value: string): string {
  const date = parseMonthKey(value) ?? new Date();
  return new Intl.DateTimeFormat('ru-RU', { year: 'numeric' }).format(date);
}

export function dateLabel(value: string, locale = 'ru-RU'): string {
  const date = parseDateKey(value) ?? new Date();
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', weekday: 'long' }).format(date);
}

export function monthGrid(value: string): readonly CalendarDayCell[] {
  const month = parseMonthKey(value) ?? new Date();
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > count) return { date: null, day: null };
    return { date: dateKey(new Date(year, monthIndex, day)), day };
  });
}

export function yearMonths(value: string): readonly string[] {
  const month = parseMonthKey(value) ?? new Date();
  return Array.from({ length: 12 }, (_, index) => monthKey(new Date(month.getFullYear(), index, 1)));
}

export function eventsForDate(content: CalendarContent, value: string): readonly CalendarEvent[] {
  return content.events
    .filter((event) => event.repeat === 'none' && event.date === value)
    .sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
}

export function readCalendarViewSettings(settings: Record<string, unknown>, now = new Date()): CalendarViewSettings {
  const fallback = monthKey(now);
  const month = typeof settings.calendarMonth === 'string' && parseMonthKey(settings.calendarMonth)
    ? settings.calendarMonth
    : fallback;
  const selectedDate = typeof settings.calendarSelectedDate === 'string' && parseDateKey(settings.calendarSelectedDate)
    ? settings.calendarSelectedDate
    : null;
  return { month, selectedDate };
}
