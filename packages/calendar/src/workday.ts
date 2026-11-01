import type { CalendarContent } from './model';
import { dateKey, parseDateKey } from './view';

export interface CalendarCountdown {
  readonly days: number;
  readonly working: number;
  readonly weeks: number;
  readonly rest: number;
  readonly past: boolean;
}

function floatingDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function addLocalDays(value: string, amount: number): string {
  const date = parseDateKey(value);
  if (!date) return value;
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

export function isNonWorkingDay(content: CalendarContent, value: string): boolean {
  const date = parseDateKey(value);
  if (!date) return false;
  const weekday = date.getDay();
  return weekday === 0 || weekday === 6 || content.days.some((day) => day.date === value);
}

export function countdown(content: CalendarContent, today: string, target: string): CalendarCountdown {
  const diff = floatingDay(target) - floatingDay(today);
  if (diff === 0) return { days: 0, working: 0, weeks: 0, rest: 0, past: false };
  const future = diff > 0;
  const first = future ? addLocalDays(today, 1) : target;
  const last = future ? target : addLocalDays(today, -1);
  let working = 0;
  for (let cursor = first; cursor <= last; cursor = addLocalDays(cursor, 1)) {
    if (!isNonWorkingDay(content, cursor)) working += 1;
  }
  const days = Math.abs(diff);
  return { days, working, weeks: Math.floor(days / 7), rest: days % 7, past: !future };
}

function plural(value: number, forms: readonly [string, string, string]): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function formatCountdown(value: CalendarCountdown): string {
  if (value.days === 0) return 'Сегодня';
  const weekPart = value.weeks > 0
    ? `${value.weeks} ${plural(value.weeks, ['неделя', 'недели', 'недель'])}${value.rest ? ` ${value.rest} ${plural(value.rest, ['день', 'дня', 'дней'])}` : ''}`
    : 'меньше недели';
  return `${value.past ? 'Прошло' : 'Через'} ${value.days} ${plural(value.days, ['день', 'дня', 'дней'])} · ${value.working} ${plural(value.working, ['рабочий день', 'рабочих дня', 'рабочих дней'])} · ${weekPart}`;
}

