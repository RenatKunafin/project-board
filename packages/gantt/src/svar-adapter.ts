import type { PlanContent, PlanGroup } from './plan-document';
import { addCalendarDays, createWorkingCalendar } from './working-calendar';

/**
 * Локальный контракт данных SVAR (минимальный, без протекания типов
 * библиотеки). Даты — локальные полночи: SVAR оперирует локальными Date
 * (спайк PBT-014).
 */
export interface GanttTask {
  readonly id: string;
  readonly text: string;
  readonly type: 'task' | 'summary';
  readonly start?: Date;
  readonly end?: Date;
  readonly parent?: string;
  readonly open?: boolean;
}

export interface GanttLink {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: 'e2s';
  readonly lag: number;
}

/** ISO (включительный день) → локальная полночь для SVAR. */
export function ganttDate(isoDate: string): Date {
  // Локальная полночь: SVAR оперирует локальными Date (спайк PBT-014).
  const utc = new Date(`${isoDate}T00:00:00Z`);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

function ganttDateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Локальные компоненты Date → ISO (подсветка дней в виджете). */
export function ganttDayIso(date: Date): string {
  return ganttDateToIso(date);
}

/**
 * Группы в порядке «родитель перед детьми» (DFS от корней в порядке
 * массива документа) — дерево SVAR собирается по parent.
 */
function orderedGroups(plan: PlanContent): readonly PlanGroup[] {
  const childrenByParent = new Map<string | undefined, PlanGroup[]>();
  for (const group of plan.groups) {
    const siblings = childrenByParent.get(group.parentId);
    if (siblings === undefined) {
      childrenByParent.set(group.parentId, [group]);
    } else {
      siblings.push(group);
    }
  }
  const ordered: PlanGroup[] = [];
  const emit = (groupId: string | undefined): void => {
    for (const group of childrenByParent.get(groupId) ?? []) {
      ordered.push(group);
      emit(group.id);
    }
  };
  emit(undefined);
  return ordered;
}

/**
 * План → задачи SVAR (ADR-4 PBT-017). Внутренняя семантика SVAR всегда
 * исключительная: включительное окончание передаётся +1 день. Сводные
 * группы идут без дат — SVAR рисует их по вложенным (спайк PBT-014).
 */
export function planToGanttTasks(plan: PlanContent): readonly GanttTask[] {
  const tasks: GanttTask[] = [];
  for (const group of orderedGroups(plan)) {
    tasks.push({
      id: group.id,
      text: group.title,
      type: 'summary',
      open: true,
      ...(group.parentId !== undefined ? { parent: group.parentId } : {}),
    });
  }
  for (const task of plan.tasks) {
    tasks.push({
      id: task.id,
      text: task.title,
      type: 'task',
      start: ganttDate(task.start),
      end: ganttDate(addCalendarDays(task.end, 1)),
      ...(task.groupId !== undefined ? { parent: task.groupId } : {}),
    });
  }
  return tasks;
}

/** FS-зависимости плана → связи SVAR «окончание → начало» с лагом. */
export function planToGanttLinks(plan: PlanContent): readonly GanttLink[] {
  return plan.dependencies.map((dependency) => ({
    id: dependency.id,
    source: dependency.fromTaskId,
    target: dependency.toTaskId,
    type: 'e2s',
    lag: dependency.lagDays,
  }));
}

export type NonWorkingDayKind = 'weekend' | 'holiday';

/**
 * Вид нерабочего дня календаря плана: праздник различим среди выходных;
 * рабочее исключение делает день рабочим (правила 8.2 решений).
 */
export function nonWorkingDayKind(
  plan: PlanContent,
  isoDate: string,
): NonWorkingDayKind | undefined {
  const calendar = createWorkingCalendar(plan.calendar);
  if (calendar.isWorkingDay(isoDate)) {
    return undefined;
  }
  return plan.calendar.holidays.includes(isoDate) ? 'holiday' : 'weekend';
}
