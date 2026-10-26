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
import type {
  DependencyCreateInput,
  DependencyUpdatePatch,
} from './plan-dependencies';
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
  createDependency,
  deleteDependency,
  updateDependency,
} from './plan-dependencies';
import {
  addCalendarDays,
  calendarDaySpan,
  createWorkingCalendar,
  type WorkingCalendar,
} from './working-calendar';
import { isTaskColor } from './task-colors';

export type PlanCommandErrorCode =
  | 'unknown-task'
  | 'unknown-group'
  | 'unknown-resource'
  | 'unknown-work-type'
  | 'unknown-unavailability'
  | 'unknown-dependency'
  | 'inverted-interval'
  | 'invalid-duration'
  | 'invalid-title'
  | 'invalid-lag'
  | 'invalid-color'
  | 'invalid-calendar'
  | 'circular-group'
  | 'circular-dependency'
  | 'duplicate-dependency';

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
  /** Идентификатор палитры цветов (PBT-084); отсутствует — «Авто». */
  readonly color?: string;
}

export interface UpdateTaskPatch {
  readonly title?: string;
  /** Явный `undefined` выводит задачу из группы; отсутствующее свойство не меняет поле. */
  readonly groupId?: string;
  readonly assigneeIds?: readonly string[];
  readonly workTypeIds?: readonly string[];
  /** Явный `undefined` сбрасывает цвет в «Авто»; отсутствующее свойство не меняет поле. */
  readonly color?: string;
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
    }
  | { readonly type: 'createDependency'; readonly input: DependencyCreateInput }
  | {
      readonly type: 'updateCalendar';
      readonly workingDays: readonly number[];
      readonly holidays: readonly string[];
      readonly workingExceptions: readonly string[];
    }
  | {
      readonly type: 'updateDependency';
      readonly dependencyId: string;
      readonly patch: DependencyUpdatePatch;
    }
  | { readonly type: 'deleteDependency'; readonly dependencyId: string };

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
  if (input.color !== undefined && !isTaskColor(input.color)) {
    return fail('invalid-color', 'Цвет задачи — неизвестный идентификатор палитры.');
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
    ...(input.color === undefined ? {} : { color: input.color }),
  };
  return { ok: true, plan: { ...plan, tasks: [...plan.tasks, task] } };
}

function withoutField<K extends keyof PlanTask>(
  task: PlanTask,
  field: K,
): PlanTask {
  const copy = { ...task };
  delete (copy as Record<string, unknown>)[field as string];
  return copy;
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
  };
  // Контракт PBT-034 «опустевший массив убирается»: пустое множество
  // в патче снимает все назначения (поле отсутствует), не-пустое — заменяет.
  if (patch.assigneeIds !== undefined) {
    nextTask =
      patch.assigneeIds.length > 0
        ? { ...nextTask, assigneeIds: [...patch.assigneeIds] }
        : withoutField(nextTask, 'assigneeIds');
  }
  if (patch.workTypeIds !== undefined) {
    nextTask =
      patch.workTypeIds.length > 0
        ? { ...nextTask, workTypeIds: [...patch.workTypeIds] }
        : withoutField(nextTask, 'workTypeIds');
  }
  if ('groupId' in patch) {
    nextTask =
      patch.groupId !== undefined
        ? { ...nextTask, groupId: patch.groupId }
        : withoutField(nextTask, 'groupId');
  }
  if ('color' in patch) {
    if (patch.color !== undefined && !isTaskColor(patch.color)) {
      return fail('invalid-color', 'Цвет задачи — неизвестный идентификатор палитры.');
    }
    nextTask =
      patch.color !== undefined
        ? { ...nextTask, color: patch.color }
        : withoutField(nextTask, 'color');
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
    // ближайший рабочий день в сторону переноса. Особый случай
    // длительности 1 при рабочем начале — окончание совпадает с началом
    // (addWorkingDays(x, 0) даёт следующий рабочий день — синхронно
    // с setTaskDuration; регрессия PBT-039).
    start = calendar.isWorkingDay(newStart)
      ? newStart
      : newStart >= task.start
        ? calendar.nextWorkingDay(newStart)
        : calendar.prevWorkingDay(newStart);
    end =
      workingDuration === 1 && calendar.isWorkingDay(start)
        ? start
        : calendar.addWorkingDays(start, workingDuration - 1);
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Замена календаря плана (PBT-044): атомарная валидация и замена.
 * Отклоняются: не-ISO/несуществующие даты, дубли дней недели и дат,
 * пересечение праздников и исключений, пустой календарь (без рабочих
 * дней и без исключений — createWorkingCalendar бросает invalid-calendar).
 */
export function updateCalendar(
  plan: PlanContent,
  workingDays: readonly number[],
  holidays: readonly string[],
  workingExceptions: readonly string[],
): PlanCommandResult {
  const days = [...workingDays];
  if (new Set(days).size !== days.length) {
    return fail('invalid-calendar', 'Рабочие дни недели не могут повторяться.');
  }
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    return fail('invalid-calendar', 'День недели должен быть числом 1–7.');
  }
  const holidaysList = [...holidays];
  const exceptionsList = [...workingExceptions];
  for (const date of [...holidaysList, ...exceptionsList]) {
    if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      return fail(
        'invalid-calendar',
        `Дата должна быть в формате YYYY-MM-DD: "${date}".`,
      );
    }
  }
  if (new Set(holidaysList).size !== holidaysList.length) {
    return fail('invalid-calendar', 'Праздничные даты не могут повторяться.');
  }
  if (new Set(exceptionsList).size !== exceptionsList.length) {
    return fail('invalid-calendar', 'Рабочие исключения не могут повторяться.');
  }
  const overlap = holidaysList.find((date) => exceptionsList.includes(date));
  if (overlap !== undefined) {
    return fail(
      'invalid-calendar',
      `Дата «${overlap}» не может быть одновременно праздником и рабочим исключением.`,
    );
  }
  try {
    createWorkingCalendar({
      workingDays: days as PlanContent['calendar']['workingDays'],
      holidays: holidaysList,
      workingExceptions: exceptionsList,
    });
  } catch (error) {
    return fail(
      'invalid-calendar',
      error instanceof Error ? error.message : String(error),
    );
  }
  return {
    ok: true,
    plan: {
      ...plan,
      calendar: {
        workingDays: [...days].sort() as PlanContent['calendar']['workingDays'],
        holidays: [...holidaysList].sort(),
        workingExceptions: [...exceptionsList].sort(),
      },
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
    case 'createDependency':
      return createDependency(plan, command.input);
    case 'updateDependency':
      return updateDependency(plan, command.dependencyId, command.patch);
    case 'deleteDependency':
      return deleteDependency(plan, command.dependencyId);
    case 'updateCalendar':
      return updateCalendar(
        plan,
        command.workingDays,
        command.holidays,
        command.workingExceptions,
      );
  }
}
