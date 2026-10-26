import type { PlanContent } from './plan-document';
import { dependencyViolations } from './plan-dependencies';
import { resourceConflicts } from './plan-conflicts';

/**
 * Представление проблем плана (PBT-046 ядро, PBT-088 презентация):
 * структурированная запись из полей ядра — без разбора текста сообщений,
 * без изменения алгоритма и числа проблем.
 */
export type IssueKind = 'dependency' | 'parallel-work' | 'unavailability';

export interface PlanProblem {
  readonly kind: IssueKind;
  readonly message: string;
  /** Задача-цель перехода/редактирования. */
  readonly taskId?: string;
  /** Все задачи-участники записи. */
  readonly taskIds: readonly string[];
  /** Ресурс пересечения (когда применимо). */
  readonly resourceId?: string;
  /** Интервал пересечения (ресурсные конфликты). */
  readonly intervalStart?: string;
  readonly intervalEnd?: string;
  /** Ожидаемая/фактическая дата начала (нарушения FS). */
  readonly expectedStart?: string;
  readonly actualStart?: string;
}

export const ISSUE_KIND_ORDER: readonly IssueKind[] = [
  'dependency',
  'parallel-work',
  'unavailability',
];

export const ISSUE_KIND_LABEL: Record<IssueKind, string> = {
  dependency: 'Нарушение FS',
  'parallel-work': 'Конфликт работ',
  unavailability: 'Отпуск исполнителя',
};

/** Полный результат ядра в порядке: FS → конфликты работ → отпуска. */
export function buildPlanIssues(plan: PlanContent): readonly PlanProblem[] {
  const issues: PlanProblem[] = [];
  for (const violation of dependencyViolations(plan)) {
    issues.push({
      kind: 'dependency',
      taskId: violation.toTaskId,
      taskIds: [violation.fromTaskId, violation.toTaskId],
      message: violation.message,
      expectedStart: violation.expectedStart,
      actualStart: violation.actualStart,
    });
  }
  for (const conflict of resourceConflicts(plan)) {
    issues.push(
      conflict.kind === 'parallel-work'
        ? {
            kind: 'parallel-work',
            taskId: conflict.firstTaskId,
            taskIds: [conflict.firstTaskId, conflict.secondTaskId],
            resourceId: conflict.resourceId,
            intervalStart: conflict.intervalStart,
            intervalEnd: conflict.intervalEnd,
            message: conflict.message,
          }
        : {
            kind: 'unavailability',
            taskId: conflict.taskId,
            taskIds: [conflict.taskId],
            resourceId: conflict.resourceId,
            intervalStart: conflict.intervalStart,
            intervalEnd: conflict.intervalEnd,
            message: conflict.message,
          },
    );
  }
  return issues;
}

export type IssueFilter = 'all' | IssueKind;

/** Счётчики по типам полного результата ядра (для фильтров). */
export function issueKindCounts(
  issues: readonly PlanProblem[],
): Record<IssueKind, number> {
  const counts: Record<IssueKind, number> = {
    dependency: 0,
    'parallel-work': 0,
    unavailability: 0,
  };
  for (const issue of issues) {
    counts[issue.kind] += 1;
  }
  return counts;
}

/** Поисковый текст записи: названия задач-участников, ресурс и их исполнители. */
function issueSearchText(
  issue: PlanProblem,
  plan: PlanContent,
): string {
  const parts: string[] = [];
  for (const taskId of issue.taskIds) {
    const task = plan.tasks.find((entry) => entry.id === taskId);
    if (task === undefined) {
      continue;
    }
    parts.push(task.title);
    for (const resourceId of task.assigneeIds ?? []) {
      const resource = plan.resources.find((entry) => entry.id === resourceId);
      if (resource !== undefined) {
        parts.push(resource.title);
      }
    }
  }
  if (issue.resourceId !== undefined) {
    const resource = plan.resources.find(
      (entry) => entry.id === issue.resourceId,
    );
    if (resource !== undefined) {
      parts.push(resource.title);
    }
  }
  return parts.join(' ').toLocaleLowerCase();
}

/** Фильтр типа и поиск комбинируются; порядок записей сохраняется. */
export function filterPlanIssues(
  issues: readonly PlanProblem[],
  plan: PlanContent,
  filter: IssueFilter,
  search: string,
): readonly PlanProblem[] {
  const query = search.trim().toLocaleLowerCase();
  return issues.filter(
    (issue) =>
      (filter === 'all' || issue.kind === filter) &&
      (query === '' || issueSearchText(issue, plan).includes(query)),
  );
}

/** ISO-дата ядра → компактный «дд.ММ.гггг» для строки записи. */
export function issueDateLabel(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}
