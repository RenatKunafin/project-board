import type { PlanContent, PlanResource, PlanTask, PlanWorkType } from './plan-document';
import type {
  PlanCommandError,
  PlanCommandResult,
} from './plan-commands';

export interface ResourceCreateInput {
  readonly title: string;
}

export interface ResourceUpdatePatch {
  readonly title?: string;
}

export interface WorkTypeCreateInput {
  readonly title: string;
  readonly allowsParallel: boolean;
}

export interface WorkTypeUpdatePatch {
  readonly title?: string;
  readonly allowsParallel?: boolean;
}

type CatalogErrorCode = 'unknown-resource' | 'unknown-work-type' | 'invalid-title';

type TitleResolution = string | { readonly ok: false; readonly error: PlanCommandError };

function fail(code: CatalogErrorCode, message: string): PlanCommandResult {
  const error: PlanCommandError = { code, message };
  return { ok: false, error };
}

function resolveTitle(rawTitle: string): TitleResolution {
  const title = rawTitle.trim();
  if (title === '') {
    return { ok: false, error: { code: 'invalid-title', message: 'Название не может быть пустым.' } };
  }
  return title;
}

function withoutAssignee(task: PlanTask, resourceId: string): PlanTask {
  const assigneeIds = task.assigneeIds?.filter((id) => id !== resourceId);
  return {
    id: task.id,
    title: task.title,
    start: task.start,
    end: task.end,
    ...(assigneeIds !== undefined && assigneeIds.length > 0
      ? { assigneeIds }
      : {}),
    ...(task.workTypeIds !== undefined ? { workTypeIds: task.workTypeIds } : {}),
  };
}

function withoutWorkType(task: PlanTask, workTypeId: string): PlanTask {
  const workTypeIds = task.workTypeIds?.filter((id) => id !== workTypeId);
  return {
    id: task.id,
    title: task.title,
    start: task.start,
    end: task.end,
    ...(task.assigneeIds !== undefined
      ? { assigneeIds: task.assigneeIds }
      : {}),
    ...(workTypeIds !== undefined && workTypeIds.length > 0
      ? { workTypeIds }
      : {}),
  };
}

export function createResource(
  plan: PlanContent,
  input: ResourceCreateInput,
): PlanCommandResult {
  const title = resolveTitle(input.title);
  if (typeof title !== 'string') {
    return title;
  }
  const resource: PlanResource = { id: crypto.randomUUID(), title };
  return { ok: true, plan: { ...plan, resources: [...plan.resources, resource] } };
}

export function updateResource(
  plan: PlanContent,
  resourceId: string,
  patch: ResourceUpdatePatch,
): PlanCommandResult {
  const resource = plan.resources.find((entry) => entry.id === resourceId);
  if (resource === undefined) {
    return fail('unknown-resource', `Ресурс «${resourceId}» не существует.`);
  }
  if (!('title' in patch)) {
    return { ok: true, plan };
  }
  const title = resolveTitle(patch.title as string);
  if (typeof title !== 'string') {
    return title;
  }
  // Идентичность по id: переименование не трогает ссылки задач.
  return {
    ok: true,
    plan: {
      ...plan,
      resources: plan.resources.map((entry) =>
        entry.id === resourceId ? { ...entry, title } : entry,
      ),
    },
  };
}

export function deleteResource(
  plan: PlanContent,
  resourceId: string,
): PlanCommandResult {
  const resource = plan.resources.find((entry) => entry.id === resourceId);
  if (resource === undefined) {
    return fail('unknown-resource', `Ресурс «${resourceId}» не существует.`);
  }
  // Утверждено владельцем (вариант A, design D2): чистка ссылок без
  // удаления задач; недоступности ресурса без ресурса невалидны — удаляются.
  return {
    ok: true,
    plan: {
      ...plan,
      resources: plan.resources.filter((entry) => entry.id !== resourceId),
      tasks: plan.tasks.map((task) =>
        task.assigneeIds?.includes(resourceId)
          ? withoutAssignee(task, resourceId)
          : task,
      ),
      unavailability: plan.unavailability.filter(
        (entry) => entry.resourceId !== resourceId,
      ),
    },
  };
}

export function createWorkType(
  plan: PlanContent,
  input: WorkTypeCreateInput,
): PlanCommandResult {
  const title = resolveTitle(input.title);
  if (typeof title !== 'string') {
    return title;
  }
  const workType: PlanWorkType = {
    id: crypto.randomUUID(),
    title,
    allowsParallel: input.allowsParallel,
  };
  return { ok: true, plan: { ...plan, workTypes: [...plan.workTypes, workType] } };
}

export function updateWorkType(
  plan: PlanContent,
  workTypeId: string,
  patch: WorkTypeUpdatePatch,
): PlanCommandResult {
  const workType = plan.workTypes.find((entry) => entry.id === workTypeId);
  if (workType === undefined) {
    return fail('unknown-work-type', `Тип работы «${workTypeId}» не существует.`);
  }
  let nextWorkType: PlanWorkType = {
    ...workType,
    ...(patch.allowsParallel !== undefined
      ? { allowsParallel: patch.allowsParallel }
      : {}),
  };
  if ('title' in patch) {
    const title = resolveTitle(patch.title as string);
    if (typeof title !== 'string') {
      return title;
    }
    nextWorkType = { ...nextWorkType, title };
  }
  return {
    ok: true,
    plan: {
      ...plan,
      workTypes: plan.workTypes.map((entry) =>
        entry.id === workTypeId ? nextWorkType : entry,
      ),
    },
  };
}

export function deleteWorkType(
  plan: PlanContent,
  workTypeId: string,
): PlanCommandResult {
  const workType = plan.workTypes.find((entry) => entry.id === workTypeId);
  if (workType === undefined) {
    return fail('unknown-work-type', `Тип работы «${workTypeId}» не существует.`);
  }
  // Утверждено владельцем (вариант A, design D2): чистка ссылок без
  // удаления задач.
  return {
    ok: true,
    plan: {
      ...plan,
      workTypes: plan.workTypes.filter((entry) => entry.id !== workTypeId),
      tasks: plan.tasks.map((task) =>
        task.workTypeIds?.includes(workTypeId)
          ? withoutWorkType(task, workTypeId)
          : task,
      ),
    },
  };
}
