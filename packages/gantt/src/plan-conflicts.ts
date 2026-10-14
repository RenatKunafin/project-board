import type { PlanContent, PlanTask } from './plan-document';
import { addCalendarDays, createWorkingCalendar } from './working-calendar';

export type ResourceConflict =
  | {
      readonly kind: 'parallel-work';
      readonly resourceId: string;
      readonly firstTaskId: string;
      readonly secondTaskId: string;
      readonly intervalStart: string;
      readonly intervalEnd: string;
      readonly message: string;
    }
  | {
      readonly kind: 'unavailability';
      readonly resourceId: string;
      readonly taskId: string;
      readonly unavailabilityId: string;
      readonly intervalStart: string;
      readonly intervalEnd: string;
      readonly message: string;
    };

/**
 * Утверждено владельцем (вариант A, design D2): работа параллелизуема,
 * только если все её типы разрешают; отсутствие типов — непараллелизуема (D4).
 */
function isParallelAllowed(plan: PlanContent, task: PlanTask): boolean {
  const workTypeIds = task.workTypeIds;
  if (workTypeIds === undefined || workTypeIds.length === 0) {
    return false;
  }
  const typeById = new Map(
    plan.workTypes.map((workType) => [workType.id, workType] as const),
  );
  return workTypeIds.every(
    (workTypeId) => typeById.get(workTypeId)?.allowsParallel === true,
  );
}

interface WorkingContact {
  readonly start: string;
  readonly end: string;
}

/** Календарное пересечение, суженное до рабочих дней (design D1). */
function workingContact(
  calendar: ReturnType<typeof createWorkingCalendar>,
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): WorkingContact | undefined {
  const start = startA > startB ? startA : startB;
  const end = endA < endB ? endA : endB;
  if (start > end) {
    return undefined;
  }
  let first: string | undefined;
  let last: string | undefined;
  let cursor = start;
  while (cursor <= end) {
    if (calendar.isWorkingDay(cursor)) {
      if (first === undefined) {
        first = cursor;
      }
      last = cursor;
    }
    cursor = addCalendarDays(cursor, 1);
  }
  return first === undefined || last === undefined
    ? undefined
    : { start: first, end: last };
}

export function resourceConflicts(
  plan: PlanContent,
): readonly ResourceConflict[] {
  const calendar = createWorkingCalendar(plan.calendar);
  const taskPosition = new Map(
    plan.tasks.map((task, index) => [task.id, index] as const),
  );
  const resourceTitleById = new Map(
    plan.resources.map((resource) => [resource.id, resource.title] as const),
  );

  // Назначения по ресурсам (D1: конфликт проверяется по каждому ресурсу;
  // D2: задачи без назначений не участвуют).
  const assignmentsByResource = new Map<string, PlanTask[]>();
  for (const task of plan.tasks) {
    for (const resourceId of task.assigneeIds ?? []) {
      const assigned = assignmentsByResource.get(resourceId);
      if (assigned === undefined) {
        assignmentsByResource.set(resourceId, [task]);
      } else {
        assigned.push(task);
      }
    }
  }

  const conflicts: ResourceConflict[] = [];

  // Работа × работа: пары i < j в порядке массива задач — без дублей пар.
  for (const [resourceId, assignedTasks] of assignmentsByResource) {
    const resourceTitle = resourceTitleById.get(resourceId) ?? resourceId;
    for (let i = 0; i < assignedTasks.length; i += 1) {
      for (let j = i + 1; j < assignedTasks.length; j += 1) {
        const first = assignedTasks[i];
        const second = assignedTasks[j];
        if (isParallelAllowed(plan, first) || isParallelAllowed(plan, second)) {
          continue;
        }
        const contact = workingContact(
          calendar,
          first.start,
          first.end,
          second.start,
          second.end,
        );
        if (contact === undefined) {
          continue;
        }
        const firstPosition = taskPosition.get(first.id) ?? 0;
        const secondPosition = taskPosition.get(second.id) ?? 0;
        const firstTaskId =
          firstPosition <= secondPosition ? first.id : second.id;
        const secondTaskId =
          firstPosition <= secondPosition ? second.id : first.id;
        const earlier =
          firstPosition <= secondPosition ? first.title : second.title;
        const later = firstPosition <= secondPosition ? second.title : first.title;
        conflicts.push({
          kind: 'parallel-work',
          resourceId,
          firstTaskId,
          secondTaskId,
          intervalStart: contact.start,
          intervalEnd: contact.end,
          message: `Ресурс «${resourceTitle}»: работы «${earlier}» и «${later}» обе запрещают параллельное выполнение и пересекаются в рабочие дни ${contact.start} – ${contact.end}.`,
        });
      }
    }
  }

  // Работа × недоступность (раздел 12): параллельность типов игнорируется;
  // отпуск, целиком лежащий в нерабочих днях, контакта не даёт (D6).
  for (const unavailability of plan.unavailability) {
    const assignedTasks = assignmentsByResource.get(unavailability.resourceId);
    if (assignedTasks === undefined) {
      continue;
    }
    const resourceTitle =
      resourceTitleById.get(unavailability.resourceId) ??
      unavailability.resourceId;
    for (const task of assignedTasks) {
      const contact = workingContact(
        calendar,
        task.start,
        task.end,
        unavailability.start,
        unavailability.end,
      );
      if (contact === undefined) {
        continue;
      }
      conflicts.push({
        kind: 'unavailability',
        resourceId: unavailability.resourceId,
        taskId: task.id,
        unavailabilityId: unavailability.id,
        intervalStart: contact.start,
        intervalEnd: contact.end,
        message: `Работа «${task.title}» пересекается с периодом недоступности ресурса «${resourceTitle}» в рабочие дни ${contact.start} – ${contact.end}.`,
      });
    }
  }

  return conflicts;
}
