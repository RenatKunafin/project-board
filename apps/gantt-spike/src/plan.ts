// Локальная fixtures-only копия арифметики рабочих дней (PBT-013,
// packages/gantt/src/working-calendar.ts). Спайк не меняет продуктовый
// пакет; при принятом решении PBT-017 арифметика берётся из пакета.

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 = понедельник, 7 = воскресенье

export interface SpikeCalendar {
  readonly workingDays: readonly Weekday[];
  readonly holidays: readonly string[];
  readonly workingExceptions?: readonly string[];
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toUtcDate(isoDate: string): Date {
  if (!ISO_DATE_PATTERN.test(isoDate)) {
    throw new Error(`Дата должна быть в формате YYYY-MM-DD: "${isoDate}".`);
  }
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) {
    throw new Error(`Несуществующая дата: "${isoDate}".`);
  }
  return date;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(isoDate: string, days: number): string {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function addCalendarDaysIso(isoDate: string, days: number): string {
  return addCalendarDays(isoDate, days);
}

function weekdayOf(isoDate: string): Weekday {
  const day = toUtcDate(isoDate).getUTCDay() || 7;
  return day as Weekday;
}

export interface WorkingCalendar {
  readonly isWorkingDay: (date: string) => boolean;
  readonly nextWorkingDay: (date: string) => string;
  readonly prevWorkingDay: (date: string) => string;
  readonly addWorkingDays: (date: string, lagDays: number) => string;
  readonly workingDaysBetween: (start: string, end: string) => number;
}

export function createWorkingCalendar(definition: SpikeCalendar): WorkingCalendar {
  const workingDays = new Set<number>(definition.workingDays);
  const holidays = new Set(definition.holidays);
  const workingExceptions = new Set(definition.workingExceptions ?? []);

  const isWorkingDay = (date: string): boolean => {
    const normalized = toIsoDate(toUtcDate(date));
    if (workingExceptions.has(normalized)) return true;
    if (holidays.has(normalized)) return false;
    return workingDays.has(weekdayOf(normalized));
  };

  const nextWorkingDay = (date: string): string => {
    let cursor = addCalendarDays(date, 1);
    while (!isWorkingDay(cursor)) {
      cursor = addCalendarDays(cursor, 1);
    }
    return cursor;
  };

  const prevWorkingDay = (date: string): string => {
    let cursor = addCalendarDays(date, -1);
    while (!isWorkingDay(cursor)) {
      cursor = addCalendarDays(cursor, -1);
    }
    return cursor;
  };

  const addWorkingDays = (date: string, lagDays: number): string => {
    if (!Number.isInteger(lagDays) || lagDays < 0) {
      throw new Error(`Рабочий лаг должен быть целым числом >= 0: ${lagDays}.`);
    }
    if (lagDays === 0) return nextWorkingDay(date);
    let cursor = date;
    for (let i = 0; i < lagDays; i += 1) {
      cursor = nextWorkingDay(cursor);
    }
    return cursor;
  };

  const workingDaysBetween = (start: string, end: string): number => {
    const startNorm = toIsoDate(toUtcDate(start));
    const endNorm = toIsoDate(toUtcDate(end));
    if (endNorm < startNorm) return 0;
    let count = 0;
    let cursor = startNorm;
    while (cursor <= endNorm) {
      if (isWorkingDay(cursor)) count += 1;
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

// Модель плана спайка (подмножество фикстурного формата PBT-012)

export interface SpikeTask {
  readonly id: string;
  readonly title: string;
  readonly groupId?: string;
  /** Включительное начало, YYYY-MM-DD. */
  readonly start: string;
  /** Включительное окончание, YYYY-MM-DD (ADR PBT-003, A1). */
  readonly end: string;
  readonly workTypeIds: readonly string[];
}

export interface SpikeGroup {
  readonly id: string;
  readonly title: string;
}

export interface SpikeDependency {
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly lagDays: number;
}

export interface SpikePlan {
  readonly title: string;
  readonly calendar: SpikeCalendar;
  readonly groups: readonly SpikeGroup[];
  readonly tasks: readonly SpikeTask[];
  readonly dependencies: readonly SpikeDependency[];
}

export function workingDuration(plan: SpikePlan, task: SpikeTask): number {
  return createWorkingCalendar(plan.calendar).workingDaysBetween(task.start, task.end);
}

// A2: перетаскивание сохраняет рабочую длительность; начало привязывается
// к ближайшему рабочему дню вперёд, если введённый день нерабочий.
export function dragTaskTo(plan: SpikePlan, id: string, newStartIso: string): SpikePlan {
  const cal = createWorkingCalendar(plan.calendar);
  const task = plan.tasks.find((t) => t.id === id);
  if (!task) return plan;
  const duration = cal.workingDaysBetween(task.start, task.end);
  let start = newStartIso;
  if (!cal.isWorkingDay(start)) start = cal.nextWorkingDay(start);
  let end = start;
  let count = cal.isWorkingDay(start) ? 1 : 0;
  while (count < duration) {
    end = cal.nextWorkingDay(end);
    count += 1;
  }
  return replaceTask(plan, id, { start, end });
}

// A3/A4: ресайз сохраняет введённое окончание как есть (даже нерабочее),
// рабочая длительность пересчитывается.
export function resizeTaskEnd(plan: SpikePlan, id: string, newEndIso: string): SpikePlan {
  const task = plan.tasks.find((t) => t.id === id);
  if (!task) return plan;
  const end = newEndIso < task.start ? task.start : newEndIso;
  return replaceTask(plan, id, { end });
}

// A5/A6: праздник <-> рабочее исключение; границы задач не меняются.
export function toggleHoliday(plan: SpikePlan, isoDate: string): SpikePlan {
  const normalized = toIsoDate(toUtcDate(isoDate));
  const holidays = new Set(plan.calendar.holidays);
  const exceptions = new Set(plan.calendar.workingExceptions ?? []);
  if (holidays.has(normalized)) {
    holidays.delete(normalized);
    exceptions.add(normalized);
  } else {
    exceptions.delete(normalized);
    holidays.add(normalized);
  }
  return {
    ...plan,
    calendar: {
      ...plan.calendar,
      holidays: [...holidays].sort(),
      workingExceptions: [...exceptions].sort(),
    },
  };
}

function replaceTask(
  plan: SpikePlan,
  id: string,
  patch: { start?: string; end?: string },
): SpikePlan {
  return {
    ...plan,
    tasks: plan.tasks.map((t) =>
      t.id === id ? { ...t, start: patch.start ?? t.start, end: patch.end ?? t.end } : t,
    ),
  };
}

export function formatIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isoToDate(isoDate: string): Date {
  const date = toUtcDate(isoDate);
  // Локальная полночь: SVAR оперирует локальными Date.
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
