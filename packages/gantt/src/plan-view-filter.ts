import type { PlanContent } from './plan-document';

export interface PlanViewFilter {
  /** Подстрока названия задачи (без учёта регистра). */
  readonly query?: string;
  /** Ресурс: показывать только задачи с этим назначением. */
  readonly resourceId?: string;
}

function taskMatches(
  plan: PlanContent,
  task: PlanContent['tasks'][number],
  filter: PlanViewFilter,
): boolean {
  const query = filter.query?.trim().toLowerCase() ?? '';
  if (query !== '' && !task.title.toLowerCase().includes(query)) {
    return false;
  }
  const resourceId = filter.resourceId ?? '';
  if (
    resourceId !== '' &&
    !(task.assigneeIds ?? []).includes(resourceId)
  ) {
    return false;
  }
  // Ресурс должен существовать в справочнике (защита от устаревшего фильтра).
  if (
    resourceId !== '' &&
    !plan.resources.some((resource) => resource.id === resourceId)
  ) {
    return false;
  }
  return true;
}

/**
 * Фильтрация плана для отображения (PBT-049): производное значение без
 * записей. Скрытые задачи остаются в документе и участвуют в проверках
 * (конфликты и нарушения FS считаются по полному плану). Группа видима,
 * если в ней или её потомках есть видимая задача; пустые группы при
 * активном фильтре скрываются вместе с деревом.
 */
export function filterPlanForView(
  plan: PlanContent,
  filter: PlanViewFilter,
): PlanContent {
  const hasQuery = (filter.query?.trim().length ?? 0) > 0;
  const hasResource = (filter.resourceId?.length ?? 0) > 0;
  if (!hasQuery && !hasResource) {
    return plan;
  }
  const tasks = plan.tasks.filter((task) => taskMatches(plan, task, filter));
  if (tasks.length === 0) {
    return { ...plan, tasks: [], groups: [] };
  }
  // Группы-предки видимых задач: поднимаемся по parentId от каждой.
  const groupById = new Map(
    plan.groups.map((group) => [group.id, group] as const),
  );
  const visibleGroups = new Set<string>();
  for (const task of tasks) {
    let cursor = task.groupId;
    while (
      cursor !== undefined &&
      !visibleGroups.has(cursor) &&
      groupById.has(cursor)
    ) {
      visibleGroups.add(cursor);
      cursor = groupById.get(cursor)?.parentId;
    }
  }
  return {
    ...plan,
    tasks,
    groups: plan.groups.filter((group) => visibleGroups.has(group.id)),
  };
}

export function planFilterActive(filter: PlanViewFilter): boolean {
  return (
    (filter.query?.trim().length ?? 0) > 0 ||
    (filter.resourceId?.length ?? 0) > 0
  );
}
