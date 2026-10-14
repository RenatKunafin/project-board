import type { PlanContent, PlanGroup, PlanTask } from './plan-document';
import type {
  PlanCommandError,
  PlanCommandResult,
} from './plan-commands';

export interface GroupCreateInput {
  readonly title: string;
  readonly parentId?: string;
}

export interface GroupUpdatePatch {
  readonly title?: string;
  /** Явный `undefined` выносит группу на корень; отсутствующее свойство не меняет поле. */
  readonly parentId?: string;
}

export interface GroupSummaryBounds {
  readonly start: string;
  readonly end: string;
}

function fail(
  code: 'unknown-group' | 'circular-group',
  message: string,
): PlanCommandResult {
  const error: PlanCommandError = { code, message };
  return { ok: false, error };
}

function findGroup(plan: PlanContent, groupId: string): PlanGroup | undefined {
  return plan.groups.find((group) => group.id === groupId);
}

function withoutParent(group: PlanGroup): PlanGroup {
  return { id: group.id, title: group.title };
}

function withoutTaskGroup(task: PlanTask): PlanTask {
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

export function createGroup(
  plan: PlanContent,
  input: GroupCreateInput,
): PlanCommandResult {
  if (
    input.parentId !== undefined &&
    !plan.groups.some((group) => group.id === input.parentId)
  ) {
    return fail('unknown-group', `Группа «${input.parentId}» не существует.`);
  }
  const group: PlanGroup = {
    id: crypto.randomUUID(),
    title: input.title,
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
  };
  return { ok: true, plan: { ...plan, groups: [...plan.groups, group] } };
}

export function updateGroup(
  plan: PlanContent,
  groupId: string,
  patch: GroupUpdatePatch,
): PlanCommandResult {
  const group = findGroup(plan, groupId);
  if (group === undefined) {
    return fail('unknown-group', `Группа «${groupId}» не существует.`);
  }
  let nextGroup: PlanGroup = {
    ...group,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
  };
  if (!('parentId' in patch)) {
    return { ok: true, plan: replaceGroup(plan, nextGroup) };
  }
  const newParentId = patch.parentId;
  if (newParentId !== undefined) {
    if (newParentId === groupId) {
      return fail(
        'circular-group',
        `Группа «${groupId}» не может быть родителем самой себя.`,
      );
    }
    if (!plan.groups.some((entry) => entry.id === newParentId)) {
      return fail('unknown-group', `Группа «${newParentId}» не существует.`);
    }
    // Подъём по цепочке родителей нового родителя: встреча переносимой
    // группы означает перенос в собственного потомка (DoD: отклоняется целиком).
    let cursor: string | undefined = newParentId;
    while (cursor !== undefined) {
      if (cursor === groupId) {
        return fail(
          'circular-group',
          `Группа «${groupId}» не может быть перенесена в собственного потомка «${newParentId}».`,
        );
      }
      cursor = findGroup(plan, cursor)?.parentId;
    }
    nextGroup = { ...nextGroup, parentId: newParentId };
  } else {
    nextGroup = withoutParent(nextGroup);
  }
  // Перенос (design D4): группа встаёт в конец массива групп.
  const rest = plan.groups.filter((entry) => entry.id !== groupId);
  return { ok: true, plan: { ...plan, groups: [...rest, nextGroup] } };
}

function replaceGroup(plan: PlanContent, nextGroup: PlanGroup): PlanContent {
  return {
    ...plan,
    groups: plan.groups.map((group) =>
      group.id === nextGroup.id ? nextGroup : group,
    ),
  };
}

export function deleteGroup(
  plan: PlanContent,
  groupId: string,
): PlanCommandResult {
  const group = findGroup(plan, groupId);
  if (group === undefined) {
    return fail('unknown-group', `Группа «${groupId}» не существует.`);
  }
  // Утверждено владельцем (вариант A, design D2): прямые потомки
  // перепривязываются к родителю удаляемой группы (корневая — в корень);
  // задачи и их зависимости сохраняются.
  const parentId = group.parentId;
  return {
    ok: true,
    plan: {
      ...plan,
      groups: plan.groups
        .filter((entry) => entry.id !== groupId)
        .map((entry) => {
          if (entry.parentId !== groupId) {
            return entry;
          }
          return parentId === undefined
            ? withoutParent(entry)
            : { ...entry, parentId };
        }),
      tasks: plan.tasks.map((task) => {
        if (task.groupId !== groupId) {
          return task;
        }
        return parentId === undefined
          ? withoutTaskGroup(task)
          : { ...task, groupId: parentId };
      }),
    },
  };
}

export function childGroups(
  plan: PlanContent,
  groupId: string,
): readonly PlanGroup[] {
  return plan.groups.filter((group) => group.parentId === groupId);
}

export function childTasks(
  plan: PlanContent,
  groupId: string,
): readonly PlanTask[] {
  return plan.tasks.filter((task) => task.groupId === groupId);
}

export function groupSummaryBounds(
  plan: PlanContent,
  groupId: string,
): GroupSummaryBounds | undefined {
  let start: string | undefined;
  let end: string | undefined;
  const visit = (currentId: string): void => {
    for (const task of childTasks(plan, currentId)) {
      start = start === undefined || task.start < start ? task.start : start;
      end = end === undefined || task.end > end ? task.end : end;
    }
    for (const child of childGroups(plan, currentId)) {
      visit(child.id);
    }
  };
  visit(groupId);
  return start === undefined || end === undefined
    ? undefined
    : { start, end };
}
