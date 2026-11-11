import type { PlanContent, PlanGroup } from './plan-document';
import type { DateMarkColor } from './date-mark-colors';
import { addCalendarDays } from './working-calendar';
import { calendarView, type NonWorkingDayKind } from './calendar-view';

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
 * collapsedGroups — свёрнутые группы экземпляра представления (B4):
 * такие группы передаются с open: false, умолчание — развёрнуто.
 */
export function planToGanttTasks(
  plan: PlanContent,
  collapsedGroups?: ReadonlySet<string>,
): GanttTask[] {
  const tasks: GanttTask[] = [];
  for (const group of orderedGroups(plan)) {
    tasks.push({
      id: group.id,
      text: group.title,
      type: 'summary',
      open: !(collapsedGroups?.has(group.id) ?? false),
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
export function planToGanttLinks(plan: PlanContent): GanttLink[] {
  return plan.dependencies.map((dependency) => ({
    id: dependency.id,
    source: dependency.fromTaskId,
    target: dependency.toTaskId,
    type: 'e2s',
    lag: dependency.lagDays,
  }));
}

export type { NonWorkingDayKind } from './calendar-view';

/**
 * Вид подсветки дня шкалы проектного Гантта: особая дата приоритетнее
 * праздника и выходного (PBT-141, решение владельца 2026-11-11).
 */
export type GanttDayHighlight =
  | { readonly kind: 'mark'; readonly color: DateMarkColor }
  | { readonly kind: 'weekend' }
  | { readonly kind: 'holiday' };

/**
 * Индекс цветовых меток дат плана (PBT-141): дата → цвет. Строится
 * реактивно по плану; план обязан пройти валидацию parsePlanContent
 * (цвета меток — известные идентификаторы палитры).
 */
export function dateMarkColorIndex(
  plan: PlanContent,
): ReadonlyMap<string, DateMarkColor> {
  return new Map(
    (plan.dateMarks ?? []).map((mark) => [
      mark.date,
      mark.color as DateMarkColor,
    ]),
  );
}

/**
 * Видимого дня шкалы: метка → праздник → выходной; рабочий день без
 * метки — без подсветки (undefined). Единая точка приоритета для
 * дневного и недельного режимов (PBT-141 design D4).
 */
export function dayHighlight(
  plan: PlanContent,
  isoDate: string,
  index?: ReadonlyMap<string, DateMarkColor>,
): GanttDayHighlight | undefined {
  const mark = (index ?? dateMarkColorIndex(plan)).get(isoDate);
  if (mark !== undefined) {
    return { kind: 'mark', color: mark };
  }
  const kind = calendarView(plan.calendar).dayKind(isoDate);
  return kind === undefined ? undefined : { kind };
}

/**
 * Вид нерабочего дня календаря плана: праздник различим среди выходных;
 * рабочее исключение делает день рабочим (правила 8.2 решений).
 */
export function nonWorkingDayKind(
  plan: PlanContent,
  isoDate: string,
): NonWorkingDayKind | undefined {
  return calendarView(plan.calendar).dayKind(isoDate);
}
