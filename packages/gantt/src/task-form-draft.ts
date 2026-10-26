import type { PlanContent, PlanTask } from './plan-document';
import { createTask, setTaskDates, updateTask } from './plan-commands';
import { createDependency, deleteDependency, updateDependency } from './plan-dependencies';
import { buildTaskDates, validateTaskForm, type TaskFormInput, type TaskFormIssue } from './task-editor';
import { createWorkingCalendar } from './working-calendar';

export interface TaskFormSession {
  readonly plan: PlanContent;
  readonly revision: number;
  readonly taskId?: string;
}

export interface TaskEditorSubmit extends TaskFormInput {
  readonly assigneeIds: readonly string[];
  readonly workTypeIds: readonly string[];
  readonly predecessors: readonly { readonly fromTaskId: string; readonly lagDays: number }[];
}

export function taskDuration(task: PlanTask, plan: PlanContent): number {
  return createWorkingCalendar(plan.calendar).workingDaysBetween(task.start, task.end);
}

const sameIds = (a: readonly string[] = [], b: readonly string[] = []) =>
  a.length === b.length && a.every(id => b.includes(id));

type PreparedTask = { readonly ok: true; readonly plan: PlanContent } |
  { readonly ok: false; readonly issue: TaskFormIssue };

/** Только чистые команды: ошибка любого шага не публикует промежуточный план. */
export function prepareTaskForm(session: TaskFormSession, input: TaskEditorSubmit): PreparedTask {
  const { plan, taskId } = session;
  const original = taskId === undefined ? undefined : plan.tasks.find(task => task.id === taskId);
  const fail = (field: TaskFormIssue['field'], message: string): PreparedTask => ({ ok: false, issue: { field, message } });
  if (taskId !== undefined && original === undefined) return fail('document', 'Исходная задача удалена. Закройте форму.');
  const datesUnchanged = original !== undefined && original.start === input.start &&
    taskDuration(original, plan) === input.durationDays;
  // Нетронутый ручной интервал может иметь нулевую рабочую длительность.
  const issue = validateTaskForm(datesUnchanged ? { ...input, durationDays: Math.max(1, input.durationDays) } : input, plan);
  if (issue) return { ok: false, issue };
  let dates: { start: string; end: string };
  try {
    dates = datesUnchanged ? { start: original.start, end: original.end } : buildTaskDates(input, plan);
  } catch {
    return fail('start', 'Укажите существующую дату начала.');
  }
  const fields = original === undefined ? {
    title: input.title, ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
    ...(input.assigneeIds.length ? { assigneeIds: input.assigneeIds } : {}),
    ...(input.workTypeIds.length ? { workTypeIds: input.workTypeIds } : {}),
    ...(input.color ? { color: input.color } : {}),
  } : {
    ...(input.title === original.title ? {} : { title: input.title }),
    ...(input.groupId === original.groupId ? {} : { groupId: input.groupId }),
    ...(sameIds(input.assigneeIds, original.assigneeIds) ? {} : { assigneeIds: input.assigneeIds }),
    ...(sameIds(input.workTypeIds, original.workTypeIds) ? {} : { workTypeIds: input.workTypeIds }),
    // Отсутствие поля в черновике не меняет цвет; явный undefined
    // в переданном черновике — сброс в «Авто» (контракт UpdateTaskPatch).
    ...('color' in input && input.color !== original.color
      ? { color: input.color }
      : {}),
  };
  const changed = original === undefined ? createTask(plan, { ...fields, title: input.title, ...dates }) : updateTask(plan, original.id, fields);
  if (!changed.ok) return fail('assignments', changed.error.message);
  let next = changed.plan;
  const id = original?.id ?? next.tasks[next.tasks.length - 1].id;
  if (original && !datesUnchanged) {
    const dated = setTaskDates(next, id, dates);
    if (!dated.ok) return fail('start', dated.error.message);
    next = dated.plan;
  }
  for (const dependency of plan.dependencies.filter(dep => dep.toTaskId === id)) {
    const desired = input.predecessors.find(dep => dep.fromTaskId === dependency.fromTaskId);
    const result = desired === undefined ? deleteDependency(next, dependency.id) :
      updateDependency(next, dependency.id, { lagDays: desired.lagDays });
    if (!result.ok) return fail('dependencies', result.error.message);
    next = result.plan;
  }
  const seen = new Set<string>();
  for (const dependency of input.predecessors) {
    if (seen.has(dependency.fromTaskId)) return fail('dependencies', 'Предшественник уже выбран.');
    seen.add(dependency.fromTaskId);
    if (next.dependencies.some(dep => dep.fromTaskId === dependency.fromTaskId && dep.toTaskId === id)) continue;
    const result = createDependency(next, { ...dependency, toTaskId: id });
    if (!result.ok) return fail('dependencies', result.error.message);
    next = result.plan;
  }
  if (original && JSON.stringify(original) === JSON.stringify(next.tasks.find(task => task.id === id)) &&
      JSON.stringify(plan.dependencies) === JSON.stringify(next.dependencies)) return { ok: true, plan };
  return { ok: true, plan: next };
}
