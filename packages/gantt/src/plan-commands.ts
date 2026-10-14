import type { PlanContent, PlanTask } from './plan-document';
import type {
  GroupCreateInput,
  GroupUpdatePatch,
} from './plan-hierarchy';
import type {
  ResourceCreateInput,
  ResourceUpdatePatch,
  WorkTypeCreateInput,
  WorkTypeUpdatePatch,
} from './plan-catalogs';
import { createGroup, deleteGroup, updateGroup } from './plan-hierarchy';
import {
  createResource,
  createWorkType,
  deleteResource,
  deleteWorkType,
  updateResource,
  updateWorkType,
} from './plan-catalogs';
import type {
  UnavailabilityCreateInput,
  UnavailabilityUpdatePatch,
} from './plan-assignments';
import {
  assignResource,
  assignWorkType,
  createUnavailability,
  deleteUnavailability,
  unassignResource,
  unassignWorkType,
  updateUnavailability,
} from './plan-assignments';
import {
  addCalendarDays,
  calendarDaySpan,
  createWorkingCalendar,
  type WorkingCalendar,
} from './working-calendar';

export type PlanCommandErrorCode =
  | 'unknown-task'
  | 'unknown-group'
  | 'unknown-resource'
  | 'unknown-work-type'
  | 'unknown-unavailability'
  | 'inverted-interval'
  | 'invalid-duration'
  | 'invalid-title'
  | 'circular-group';

export interface PlanCommandError {
  readonly code: PlanCommandErrorCode;
  readonly message: string;
}

export type PlanCommandResult =
  | { readonly ok: true; readonly plan: PlanContent }
  | { readonly ok: false; readonly error: PlanCommandError };

export interface CreateTaskInput {
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly groupId?: string;
  readonly assigneeIds?: readonly string[];
  readonly workTypeIds?: readonly string[];
}

export interface UpdateTaskPatch {
  readonly title?: string;
  /** Явный `undefined` выводит задачу из группы; отсутствующее свойство не меняет поле. */
  readonly groupId?: string;
  readonly assigneeIds?: readonly string[];
  readonly workTypeIds?: readonly string[];
}

export type PlanCommand =
  | { readonly type: 'createTask'; readonly input: CreateTaskInput }
  | {
      readonly type: 'updateTask';
      readonly taskId: string;
      readonly patch: UpdateTaskPatch;
    }
  | {
      readonly type: 'setTaskDates';
      readonly taskId: string;
      readonly start: string;
      readonly end: string;
    }
  | { readonly type: 'moveTask'; readonly taskId: string; readonly newStart: string }
  | {
      readonly type: 'setTaskDuration';
      readonly taskId: string;
      readonly durationDays: number;
    }
  | { readonly type: 'deleteTask'; readonly taskId: string }
  | { readonly type: 'createGroup'; readonly input: GroupCreateInput }
  | {
      readonly type: 'updateGroup';
      readonly groupId: string;
      readonly patch: GroupUpdatePatch;
    }
  | { readonly type: 'deleteGroup'; readonly groupId: string }
  | { readonly type: 'createResource'; readonly input: ResourceCreateInput }
  | {
      readonly type: 'updateResource';
      readonly resourceId: string;
      readonly patch: ResourceUpdatePatch;
    }
  | { readonly type: 'deleteResource'; readonly resourceId: string }
  | { readonly type: 'createWorkType'; readonly input: WorkTypeCreateInput }
  | {
      readonly type: 'updateWorkType';
      readonly workTypeId: string;
      readonly patch: WorkTypeUpdatePatch;
    }
  | { readonly type: 'deleteWorkType'; readonly workTypeId: string }
  | {
      readonly type: 'assignResource';
      readonly taskId: string;
      readonly resourceId: string;
    }
  | {
      readonly type: 'unassignResource';
      readonly taskId: string;
      readonly resourceId: string;
    }
  | {
      readonly type: 'assignWorkType';
      readonly taskId: string;
      readonly workTypeId: string;
    }
  | {
      readonly type: 'unassignWorkType';
      readonly taskId: string;
      readonly workTypeId: string;
    }
  | {
      readonly type: 'createUnavailability';
      readonly input: UnavailabilityCreateInput;
    }
  | {
      readonly type: 'updateUnavailability';
      readonly unavailabilityId: string;
      readonly patch: UnavailabilityUpdatePatch;
    }
  | {
      readonly type: 'deleteUnavailability';
      readonly unavailabilityId: string;
    };

function fail(
  code: PlanCommandErrorCode,
  message: string,
): PlanCommandResult {
  return { ok: false, error: { code, message } };
}

function findTask(plan: PlanContent, taskId: string): PlanTask | undefined {
  return plan.tasks.find((task) => task.id === taskId);
}

function replaceTask(plan: PlanContent, nextTask: PlanTask): PlanContent {
  return {
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.id === nextTask.id ? nextTask : task,
    ),
  };
}

function unknownTask(taskId: string): PlanCommandResult {
  return fail('unknown-task', `Задача «${taskId}» не существует.`);
}

function checkReferences(
  plan: PlanContent,
  refs: {
    readonly groupId?: string;
    readonly assigneeIds?: readonly string[];
    readonly workTypeIds?: readonly string[];
  },
): PlanCommandError | undefined {
  if (
    refs.groupId !== undefined &&
    !plan.groups.some((group) => group.id === refs.groupId)
  ) {
    return {
      code: 'unknown-group',
      message: `Группа «${refs.groupId}» не существует.`,
    };
  }
  if (refs.assigneeIds !== undefined) {
    for (const resourceId of refs.assigneeIds) {
      if (!plan.resources.some((resource) => resource.id === resourceId)) {
        return {
          code: 'unknown-resource',
          message: `Ресурс «${resourceId}» не существует.`,
        };
      }
    }
  }
  if (refs.workTypeIds !== undefined) {
    for (const workTypeId of refs.workTypeIds) {
      if (!plan.workTypes.some((workType) => workType.id === workTypeId)) {
        return {
          code: 'unknown-work-type',
          message: `Тип работы «${workTypeId}» не существует.`,
        };
      }
    }
  }
  return undefined;
}

function calendarOf(plan: PlanContent): WorkingCalendar {
  return createWorkingCalendar(plan.calendar);
}

export function createTask(
  plan: PlanContent,
  input: CreateTaskInput,
): PlanCommandResult {
  if (input.end < input.start) {
    return fail(
      'inverted-interval',
      `Окончание «${input.end}» раньше начала «${input.start}».`,
    );
  }
  const referenceError = checkReferences(plan, input);
  if (referenceError !== undefined) {
    return { ok: false, error: referenceError };
  }
  const task: PlanTask = {
    id: crypto.randomUUID(),
    title: input.title,
    start: input.start,
    end: input.end,
    ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
    ...(input.assigneeIds === undefined
      ? {}
      : { assigneeIds: [...input.assigneeIds] }),
    ...(input.workTypeIds === undefined
      ? {}
      : { workTypeIds: [...input.workTypeIds] }),
  };
  return { ok: true, plan: { ...plan, tasks: [...plan.tasks, task] } };
}

function withoutGroup(task: PlanTask): PlanTask {
  return {
    id: task.id,
    title: task.title,
    start: task.start,
    end: task.end,
    ...(task.assigneeIds !== undefined
      ? { assigneeIds: task.assigneeIds }
      : {}),
    ...(task.workTypeIds !== undefined ? { workTypeIds: task.workTypeIds } : {}),
  };
}

export function updateTask(
  plan: PlanContent,
  taskId: string,
  patch: UpdateTaskPatch,
): PlanCommandResult {
  const task = findTask(plan, taskId);
  if (task === undefined) {
    return unknownTask(taskId);
  }
  const referenceError = checkReferences(plan, patch);
  if (referenceError !== undefined) {
    return { ok: false, error: referenceError };
  }
  let nextTask: PlanTask = {
    ...task,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.assigneeIds !== undefined
      ? { assigneeIds: [...patch.assigneeIds] }
      : {}),
    ...(patch.workTypeIds !== undefined
      ? { workTypeIds: [...patch.workTypeIds] }
      : {}),
  };
  if ('groupId' in patch) {
    nextTask =
      patch.groupId !== undefined
        ? { ...nextTask, groupId: patch.groupId }
        : withoutGroup(nextTask);
  }
  return { ok: true, plan: replaceTask(plan, nextTask) };
}

export function setTaskDates(
  plan: PlanContent,
  taskId: string,
  dates: { readonly start: string; readonly end: string },
): PlanCommandResult {
  const task = findTask(plan, taskId);
  if (task === undefined) {
    return unknownTask(taskId);
  }
  if (dates.end < dates.start) {
    return fail(
      'inverted-interval',
      `Окончание «${dates.end}» раньше начала «${dates.start}».`,
    );
  }
  // Ручной ввод (A3): даты сохраняются как введены, включая нерабочие дни.
  return {
    ok: true,
    plan: replaceTask(plan, { ...task, start: dates.start, end: dates.end }),
  };
}

export function moveTask(
  plan: PlanContent,
  taskId: string,
  newStart: string,
): PlanCommandResult {
  const task = findTask(plan, taskId);
  if (task === undefined) {
    return unknownTask(taskId);
  }
  if (newStart === task.start) {
    return { ok: true, plan };
  }
  const calendar = calendarOf(plan);
  const workingDuration = calendar.workingDaysBetween(task.start, task.end);
  let start: string;
  let end: string;
  if (workingDuration === 0) {
    // Утверждено владельцем (вариант A): календарная длина без привязки (design D3).
    start = newStart;
    end = addCalendarDays(newStart, calendarDaySpan(task.start, task.end));
  } else {
    // Перенос (A2): рабочая длительность сохраняется; новое начало —
    // ближайший рабочий день в сторону переноса.
    start = calendar.isWorkingDay(newStart)
      ? newStart
      : newStart >= task.start
        ? calendar.nextWorkingDay(newStart)
        : calendar.prevWorkingDay(newStart);
    end = calendar.addWorkingDays(start, workingDuration - 1);
  }
  return { ok: true, plan: replaceTask(plan, { ...task, start, end }) };
}

export function setTaskDuration(
  plan: PlanContent,
  taskId: string,
  durationDays: number,
): PlanCommandResult {
  const task = findTask(plan, taskId);
  if (task === undefined) {
    return unknownTask(taskId);
  }
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    return fail(
      'invalid-duration',
      `Длительность задаётся целым числом рабочих дней не меньше 1: ${durationDays}.`,
    );
  }
  const calendar = calendarOf(plan);
  // Ввод длительности (A4): N-й рабочий день от неизменного начала;
  // при рабочем начале длительности 1 окончание совпадает с началом.
  const end =
    durationDays === 1 && calendar.isWorkingDay(task.start)
      ? task.start
      : calendar.addWorkingDays(task.start, durationDays - 1);
  return { ok: true, plan: replaceTask(plan, { ...task, end }) };
}

export function deleteTask(
  plan: PlanContent,
  taskId: string,
): PlanCommandResult {
  const task = findTask(plan, taskId);
  if (task === undefined) {
    return unknownTask(taskId);
  }
  // Контракт очистки ссылок (design D6): каскад — только зависимости,
  // существование которых без задачи невалидно; справочники сохраняются.
  return {
    ok: true,
    plan: {
      ...plan,
      tasks: plan.tasks.filter((entry) => entry.id !== taskId),
      dependencies: plan.dependencies.filter(
        (dependency) =>
          dependency.fromTaskId !== taskId && dependency.toTaskId !== taskId,
      ),
    },
  };
}

export function applyPlanCommand(
  plan: PlanContent,
  command: PlanCommand,
): PlanCommandResult {
  switch (command.type) {
    case 'createTask':
      return createTask(plan, command.input);
    case 'updateTask':
      return updateTask(plan, command.taskId, command.patch);
    case 'setTaskDates':
      return setTaskDates(plan, command.taskId, {
        start: command.start,
        end: command.end,
      });
    case 'moveTask':
      return moveTask(plan, command.taskId, command.newStart);
    case 'setTaskDuration':
      return setTaskDuration(plan, command.taskId, command.durationDays);
    case 'deleteTask':
      return deleteTask(plan, command.taskId);
    case 'createGroup':
      return createGroup(plan, command.input);
    case 'updateGroup':
      return updateGroup(plan, command.groupId, command.patch);
    case 'deleteGroup':
      return deleteGroup(plan, command.groupId);
    case 'createResource':
      return createResource(plan, command.input);
    case 'updateResource':
      return updateResource(plan, command.resourceId, command.patch);
    case 'deleteResource':
      return deleteResource(plan, command.resourceId);
    case 'createWorkType':
      return createWorkType(plan, command.input);
    case 'updateWorkType':
      return updateWorkType(plan, command.workTypeId, command.patch);
    case 'deleteWorkType':
      return deleteWorkType(plan, command.workTypeId);
    case 'assignResource':
      return assignResource(plan, command.taskId, command.resourceId);
    case 'unassignResource':
      return unassignResource(plan, command.taskId, command.resourceId);
    case 'assignWorkType':
      return assignWorkType(plan, command.taskId, command.workTypeId);
    case 'unassignWorkType':
      return unassignWorkType(plan, command.taskId, command.workTypeId);
    case 'createUnavailability':
      return createUnavailability(plan, command.input);
    case 'updateUnavailability':
      return updateUnavailability(plan, command.unavailabilityId, command.patch);
    case 'deleteUnavailability':
      return deleteUnavailability(plan, command.unavailabilityId);
  }
}
