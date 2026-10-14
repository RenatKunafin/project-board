import type { PlanContent, PlanTask, PlanUnavailability } from './plan-document';
import type {
  PlanCommandError,
  PlanCommandResult,
} from './plan-commands';

export interface UnavailabilityCreateInput {
  readonly resourceId: string;
  readonly start: string;
  readonly end: string;
}

export interface UnavailabilityUpdatePatch {
  readonly resourceId?: string;
  readonly start?: string;
  readonly end?: string;
}

type AssignmentsErrorCode =
  | 'unknown-task'
  | 'unknown-resource'
  | 'unknown-work-type'
  | 'unknown-unavailability'
  | 'inverted-interval';

function fail(
  code: AssignmentsErrorCode,
  message: string,
): PlanCommandResult {
  const error: PlanCommandError = { code, message };
  return { ok: false, error };
}

function findTask(plan: PlanContent, taskId: string): PlanTask | undefined {
  return plan.tasks.find((task) => task.id === taskId);
}

function withAssignment(
  task: PlanTask,
  field: 'assigneeIds' | 'workTypeIds',
  entryId: string,
  assign: boolean,
): PlanTask {
  const current = task[field] ?? [];
  const contains = current.includes(entryId);
  let next: readonly string[];
  if (assign) {
    // Идемпотентность (design D1): повторное назначение не дублирует связь.
    if (contains) {
      return task;
    }
    next = [...current, entryId];
  } else {
    // Снятие отсутствующего — noop (design D1).
    if (!contains) {
      return task;
    }
    next = current.filter((id) => id !== entryId);
  }
  const rest: PlanTask = {
    id: task.id,
    title: task.title,
    start: task.start,
    end: task.end,
    ...(field === 'assigneeIds'
      ? task.workTypeIds !== undefined
        ? { workTypeIds: task.workTypeIds }
        : {}
      : task.assigneeIds !== undefined
        ? { assigneeIds: task.assigneeIds }
        : {}),
  };
  // Опустевший массив убирается из задачи (единообразие с чисткой PBT-033).
  return next.length > 0 ? { ...rest, [field]: next } : rest;
}

function assignEntry(
  plan: PlanContent,
  taskId: string,
  field: 'assigneeIds' | 'workTypeIds',
  entryId: string,
): PlanCommandResult {
  return changeAssignment(plan, taskId, field, entryId, true);
}

function unassignEntry(
  plan: PlanContent,
  taskId: string,
  field: 'assigneeIds' | 'workTypeIds',
  entryId: string,
): PlanCommandResult {
  return changeAssignment(plan, taskId, field, entryId, false);
}

function changeAssignment(
  plan: PlanContent,
  taskId: string,
  field: 'assigneeIds' | 'workTypeIds',
  entryId: string,
  assign: boolean,
): PlanCommandResult {
  const task = findTask(plan, taskId);
  if (task === undefined) {
    return fail('unknown-task', `Задача «${taskId}» не существует.`);
  }
  // Проверка ссылок — до мутации (design D1): в том числе для снятия.
  if (field === 'assigneeIds') {
    if (!plan.resources.some((resource) => resource.id === entryId)) {
      return fail('unknown-resource', `Ресурс «${entryId}» не существует.`);
    }
  } else if (!plan.workTypes.some((workType) => workType.id === entryId)) {
    return fail('unknown-work-type', `Тип работы «${entryId}» не существует.`);
  }
  const nextTask = withAssignment(task, field, entryId, assign);
  return { ok: true, plan: replaceTask(plan, taskId, nextTask) };
}

function replaceTask(
  plan: PlanContent,
  taskId: string,
  nextTask: PlanTask,
): PlanContent {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => (task.id === taskId ? nextTask : task)),
  };
}

export function assignResource(
  plan: PlanContent,
  taskId: string,
  resourceId: string,
): PlanCommandResult {
  return assignEntry(plan, taskId, 'assigneeIds', resourceId);
}

export function unassignResource(
  plan: PlanContent,
  taskId: string,
  resourceId: string,
): PlanCommandResult {
  return unassignEntry(plan, taskId, 'assigneeIds', resourceId);
}

export function assignWorkType(
  plan: PlanContent,
  taskId: string,
  workTypeId: string,
): PlanCommandResult {
  return assignEntry(plan, taskId, 'workTypeIds', workTypeId);
}

export function unassignWorkType(
  plan: PlanContent,
  taskId: string,
  workTypeId: string,
): PlanCommandResult {
  return unassignEntry(plan, taskId, 'workTypeIds', workTypeId);
}

function validateUnavailabilityInterval(
  start: string,
  end: string,
): PlanCommandError | undefined {
  if (end < start) {
    return {
      code: 'inverted-interval',
      message: `Окончание «${end}» раньше начала «${start}».`,
    };
  }
  return undefined;
}

export function createUnavailability(
  plan: PlanContent,
  input: UnavailabilityCreateInput,
): PlanCommandResult {
  if (!plan.resources.some((resource) => resource.id === input.resourceId)) {
    return fail('unknown-resource', `Ресурс «${input.resourceId}» не существует.`);
  }
  const intervalError = validateUnavailabilityInterval(input.start, input.end);
  if (intervalError !== undefined) {
    return { ok: false, error: intervalError };
  }
  const entry: PlanUnavailability = {
    id: crypto.randomUUID(),
    resourceId: input.resourceId,
    start: input.start,
    end: input.end,
  };
  return {
    ok: true,
    plan: { ...plan, unavailability: [...plan.unavailability, entry] },
  };
}

export function updateUnavailability(
  plan: PlanContent,
  unavailabilityId: string,
  patch: UnavailabilityUpdatePatch,
): PlanCommandResult {
  const entry = plan.unavailability.find((item) => item.id === unavailabilityId);
  if (entry === undefined) {
    return fail(
      'unknown-unavailability',
      `Период недоступности «${unavailabilityId}» не существует.`,
    );
  }
  // Итоговое состояние: неприсутствующие стороны интервала и ресурс
  // берутся из текущей записи (design D2).
  const resourceId = patch.resourceId ?? entry.resourceId;
  const start = patch.start ?? entry.start;
  const end = patch.end ?? entry.end;
  if (!plan.resources.some((resource) => resource.id === resourceId)) {
    return fail('unknown-resource', `Ресурс «${resourceId}» не существует.`);
  }
  const intervalError = validateUnavailabilityInterval(start, end);
  if (intervalError !== undefined) {
    return { ok: false, error: intervalError };
  }
  const nextEntry: PlanUnavailability = {
    ...entry,
    resourceId,
    start,
    end,
  };
  return {
    ok: true,
    plan: {
      ...plan,
      unavailability: plan.unavailability.map((item) =>
        item.id === unavailabilityId ? nextEntry : item,
      ),
    },
  };
}

export function deleteUnavailability(
  plan: PlanContent,
  unavailabilityId: string,
): PlanCommandResult {
  const entry = plan.unavailability.find((item) => item.id === unavailabilityId);
  if (entry === undefined) {
    return fail(
      'unknown-unavailability',
      `Период недоступности «${unavailabilityId}» не существует.`,
    );
  }
  return {
    ok: true,
    plan: {
      ...plan,
      unavailability: plan.unavailability.filter(
        (item) => item.id !== unavailabilityId,
      ),
    },
  };
}
