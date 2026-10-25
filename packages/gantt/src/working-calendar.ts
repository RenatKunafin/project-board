export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 = понедельник, 7 = воскресенье

export interface WorkingCalendarDefinition {
  /** Рабочие дни недели, 1 = понедельник ... 7 = воскресенье. */
  readonly workingDays: readonly Weekday[];
  /** Праздники, YYYY-MM-DD (нерабочие дни поверх недели). */
  readonly holidays?: readonly string[];
  /** Рабочие исключения: выходной/праздник, отмеченный рабочим. */
  readonly workingExceptions?: readonly string[];
}

export interface WorkingCalendar {
  readonly isWorkingDay: (date: string) => boolean;
  readonly nextWorkingDay: (date: string) => string;
  readonly prevWorkingDay: (date: string) => string;
  readonly addWorkingDays: (date: string, lagDays: number) => string;
  readonly workingDaysBetween: (start: string, end: string) => number;
}

export type WorkingCalendarErrorCode =
  | 'invalid-date'
  | 'invalid-calendar'
  | 'invalid-lag';

export class WorkingCalendarError extends Error {
  readonly code: WorkingCalendarErrorCode;

  constructor(code: WorkingCalendarErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'WorkingCalendarError';
    this.code = code;
  }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Внутреннее представление даты: UTC-полдень, чтобы DST не сдвигал дату. */
function toUtcDate(isoDate: string): Date {
  if (!ISO_DATE_PATTERN.test(isoDate)) {
    throw new WorkingCalendarError(
      'invalid-date',
      `Дата должна быть в формате YYYY-MM-DD: "${isoDate}".`,
    );
  }
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) {
    throw new WorkingCalendarError(
      'invalid-date',
      `Несуществующая дата: "${isoDate}".`,
    );
  }
  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Календарный сдвиг даты без учёта рабочести (нужен переносу задач с 0 раб. дней). */
export function addCalendarDays(isoDate: string, days: number): string {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Календарная разница дат в днях (end − start), включая перевёрнутые интервалы. */
export function calendarDaySpan(start: string, end: string): number {
  const startDate = toUtcDate(start);
  const endDate = toUtcDate(end);
  return Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY);
}

function weekdayOf(isoDate: string): Weekday {
  // 2026-10-12 — понедельник: вычисляем от якорной недели в UTC.
  const date = toUtcDate(isoDate);
  const day = date.getUTCDay() || 7; // getUTCDay: 0 = воскресенье
  return day as Weekday;
}

export function createWorkingCalendar(
  definition: WorkingCalendarDefinition,
): WorkingCalendar {
  const workingDays = new Set<number>(definition.workingDays);
  const holidays = new Set(definition.holidays ?? []);
  const workingExceptions = new Set(definition.workingExceptions ?? []);

  if (workingDays.size === 0 && workingExceptions.size === 0) {
    throw new WorkingCalendarError(
      'invalid-calendar',
      'Календарь должен содержать хотя бы один рабочий день недели или рабочее исключение.',
    );
  }
  for (const day of workingDays) {
    if (day < 1 || day > 7) {
      throw new WorkingCalendarError(
        'invalid-calendar',
        `День недели должен быть числом 1-7: ${day}.`,
      );
    }
  }

  const isWorkingDay = (date: string): boolean => {
    const normalized = toIsoDate(toUtcDate(date));
    if (workingExceptions.has(normalized)) {
      return true;
    }
    if (holidays.has(normalized)) {
      return false;
    }
    return workingDays.has(weekdayOf(normalized));
  };

  const nextWorkingDay = (date: string): string => {
    let cursor = addCalendarDays(date, 1);
    // Календарь валиден (есть рабочие дни) — цикл конечен.
    while (!isWorkingDay(cursor)) {
      cursor = addCalendarDays(cursor, 1);
    }
    return cursor;
  };

  const prevWorkingDay = (date: string): string => {
    let cursor = addCalendarDays(date, -1);
    // Календарь валиден (есть рабочие дни) — цикл конечен.
    while (!isWorkingDay(cursor)) {
      cursor = addCalendarDays(cursor, -1);
    }
    return cursor;
  };

  const addWorkingDays = (date: string, lagDays: number): string => {
    if (!Number.isInteger(lagDays) || lagDays < 0) {
      throw new WorkingCalendarError(
        'invalid-lag',
        `Рабочий лаг должен быть целым числом >= 0: ${lagDays}.`,
      );
    }
    if (lagDays === 0) {
      return nextWorkingDay(date);
    }
    let cursor = date;
    for (let i = 0; i < lagDays; i += 1) {
      cursor = nextWorkingDay(cursor);
    }
    return cursor;
  };

  const workingDaysBetween = (start: string, end: string): number => {
    const startNorm = toIsoDate(toUtcDate(start));
    const endNorm = toIsoDate(toUtcDate(end));
    if (endNorm < startNorm) {
      return 0;
    }
    let count = 0;
    let cursor = startNorm;
    while (cursor <= endNorm) {
      if (isWorkingDay(cursor)) {
        count += 1;
      }
      cursor = addCalendarDays(cursor, 1);
    }
    return count;
  };

  return Object.freeze({
    isWorkingDay,
    nextWorkingDay,
    prevWorkingDay,
    addWorkingDays,
    workingDaysBetween,
  });
}
