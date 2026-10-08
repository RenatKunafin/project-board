/** FIXTURES-ONLY: временный тестовый формат плана для исследований PBT-012–016.
 * Продуктовый контракт документа плана определит ядро планирования (PBT-030). */

export interface FixtureCalendar {
  /** Рабочие дни недели, 1 = понедельник ... 7 = воскресенье. */
  readonly workingDays: readonly number[];
  readonly holidays: readonly string[];
}

export interface FixtureWorkType {
  readonly id: string;
  readonly title: string;
  /** Может ли работа выполняться параллельно с другой у одного ресурса. */
  readonly parallel: boolean;
}

export interface FixtureResource {
  readonly id: string;
  readonly name: string;
  readonly workTypeIds: readonly string[];
}

export interface FixtureGroup {
  readonly id: string;
  readonly title: string;
  readonly parentId?: string;
}

export interface FixtureTask {
  readonly id: string;
  readonly title: string;
  readonly groupId?: string;
  /** Календарная дата включительно, YYYY-MM-DD. */
  readonly start: string;
  /** Календарная дата включительно, YYYY-MM-DD. */
  readonly end: string;
  readonly assigneeIds: readonly string[];
  readonly workTypeIds: readonly string[];
}

export interface FixtureDependency {
  readonly fromTaskId: string;
  readonly toTaskId: string;
  /** Рабочих дней, >= 0. */
  readonly lagDays: number;
}

export interface FixtureUnavailability {
  readonly id: string;
  readonly resourceId: string;
  readonly start: string;
  readonly end: string;
  readonly title?: string;
}

export interface FixturePlan {
  readonly meta: { readonly title: string; readonly calendar: FixtureCalendar };
  readonly workTypes: readonly FixtureWorkType[];
  readonly resources: readonly FixtureResource[];
  readonly groups: readonly FixtureGroup[];
  readonly tasks: readonly FixtureTask[];
  readonly dependencies: readonly FixtureDependency[];
  readonly unavailability: readonly FixtureUnavailability[];
}

/** Детерминированный PRNG (mulberry32). Возвращает функцию [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWorkingDay(isoDate: string, workingDays: readonly number[]): boolean {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay() || 7;
  return workingDays.includes(weekday);
}

/** Следующий рабочий день после указанной даты (исключая её). */
function nextWorkingDay(
  isoDate: string,
  workingDays: readonly number[],
): string {
  let cursor = addDays(isoDate, 1);
  while (!isWorkingDay(cursor, workingDays)) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/** Рабочая длительность включительного интервала [start, end]. */
export function workingDaysBetween(
  start: string,
  end: string,
  workingDays: readonly number[],
): number {
  let count = 0;
  let cursor = start;
  while (cursor <= end) {
    if (isWorkingDay(cursor, workingDays)) {
      count += 1;
    }
    cursor = addDays(cursor, 1);
  }
  return count;
}

const WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

export interface GeneratePlanOptions {
  readonly seed: number;
  readonly taskCount: number;
}

/**
 * Детерминированно генерирует план для нагрузочных исследований:
 * группы (10% корневых, 15% подгрупп), задачи с FS-связями между соседями
 * внутри группы (лаг 0-2 рабочих дня), 9 ресурсов, типы работ, назначения.
 */
export function generatePlan(options: GeneratePlanOptions): FixturePlan {
  const random = mulberry32(options.seed);
  const pick = <T,>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)];
  const pickRange = (min: number, max: number): number =>
    min + Math.floor(random() * (max - min + 1));

  const rootGroupCount = Math.max(2, Math.round(options.taskCount * 0.05));
  const subGroupCount = Math.round(options.taskCount * 0.15);
  const groups: FixtureGroup[] = [];
  for (let i = 1; i <= rootGroupCount; i += 1) {
    groups.push({ id: `g-root-${i}`, title: `Направление ${i}` });
  }
  for (let i = 1; i <= subGroupCount; i += 1) {
    const parent = groups[Math.floor(random() * rootGroupCount)];
    groups.push({
      id: `g-sub-${i}`,
      title: `Подгруппа ${i}`,
      parentId: parent.id,
    });
  }

  const taskGroups = groups.filter((group) => group.id.startsWith('g-sub-'));
  const taskPoolGroups =
    taskGroups.length > 0 ? taskGroups : groups.slice(0, rootGroupCount);

  const resourceCount = 9;
  const resources: FixtureResource[] = Array.from(
    { length: resourceCount },
    (_, index) => ({
      id: `r-${index + 1}`,
      name: `Ресурс ${index + 1}`,
      workTypeIds: [index % 3 === 0 ? 'psi' : 'dev'],
    }),
  );
  const workTypes: FixtureWorkType[] = [
    { id: 'dev', title: 'Разработка', parallel: false },
    { id: 'psi', title: 'ПСИ', parallel: true },
  ];

  const tasks: FixtureTask[] = [];
  const dependencies: FixtureDependency[] = [];
  const lastTaskByGroup = new Map<string, string>();
  let startDate = '2026-10-12'; // понедельник

  for (let i = 1; i <= options.taskCount; i += 1) {
    const group = taskPoolGroups[Math.floor(random() * taskPoolGroups.length)];
    const workTypeIds = random() < 0.2 ? (['psi'] as const) : (['dev'] as const);
    const assigneeCount = random() < 0.75 ? 1 : 2;
    const assigneeIds: string[] = [];
    while (assigneeIds.length < assigneeCount) {
      const resource = pick(resources);
      if (!assigneeIds.includes(resource.id)) {
        assigneeIds.push(resource.id);
      }
    }

    const start = startDate;
    const duration = pickRange(1, 10);
    let end = start;
    let remaining = duration - 1;
    while (remaining > 0) {
      end = nextWorkingDay(end, WORKING_DAYS);
      remaining -= 1;
    }
    tasks.push({
      id: `t-${i}`,
      title: `Задача ${i}`,
      groupId: group.id,
      start,
      end,
      assigneeIds,
      workTypeIds,
    });

    // FS-связь с предыдущей задачей той же группы (лаг 0-2 рабочих дня).
    const previousInGroup = lastTaskByGroup.get(group.id);
    if (previousInGroup) {
      dependencies.push({
        fromTaskId: previousInGroup,
        toTaskId: `t-${i}`,
        lagDays: pickRange(0, 2),
      });
    }
    lastTaskByGroup.set(group.id, `t-${i}`);

    // Следующая задача группы начинается после окончания текущей.
    startDate = nextWorkingDay(end, WORKING_DAYS);
  }

  return {
    meta: {
      title: `Нагрузочный план (${options.taskCount} задач, seed ${options.seed})`,
      calendar: { workingDays: WORKING_DAYS, holidays: [] },
    },
    workTypes,
    resources,
    groups,
    tasks,
    dependencies,
    unavailability: [],
  };
}
