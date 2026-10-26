import { useMemo, useState } from 'react';
import type { PlanContent } from './plan-document';
import {
  ISSUE_KIND_LABEL,
  ISSUE_KIND_ORDER,
  buildPlanIssues,
  filterPlanIssues,
  issueDateLabel,
  issueKindCounts,
  type IssueFilter,
  type IssueKind,
  type PlanProblem,
} from './plan-issues';
import './task-editor.css';
import './plan-issues.css';
import PlanDialog, { type PlanDialogOwner } from './PlanDialog';

/**
 * Список проблем плана (PBT-046 ядро, PBT-088 представление):
 * группы по типам, фильтры со счётчиками полного ядра, поиск по
 * задаче/исполнителю, структурированная строка и два действия —
 * «Показать» (переход PBT-082) и «Открыть» (общая форма задачи).
 * Производное значение документа — пересчёт не создаёт записей.
 */
export function usePlanIssues(plan: PlanContent): readonly PlanProblem[] {
  return useMemo(() => buildPlanIssues(plan), [plan]);
}

const FILTER_LABEL: Record<IssueFilter, string> = {
  all: 'Все',
  dependency: ISSUE_KIND_LABEL.dependency,
  'parallel-work': ISSUE_KIND_LABEL['parallel-work'],
  unavailability: ISSUE_KIND_LABEL.unavailability,
};

export default function PlanIssuesDialog({
  owner,
  plan,
  issues,
  onClose,
  onShowTask,
  onEditTask,
}: {
  readonly owner: PlanDialogOwner;
  readonly plan: PlanContent;
  readonly issues: readonly PlanProblem[];
  readonly onClose: () => void;
  readonly onShowTask: (taskId: string) => void;
  readonly onEditTask: (taskId: string) => void;
}) {
  const [filter, setFilter] = useState<IssueFilter>('all');
  const [search, setSearch] = useState('');
  const counts = issueKindCounts(issues);
  const visible = filterPlanIssues(issues, plan, filter, search);
  const query = search.trim();
  const titleOf = (taskId: string): string =>
    plan.tasks.find((task) => task.id === taskId)?.title ?? '—';
  const resourceOf = (issue: PlanProblem): string | undefined =>
    issue.resourceId === undefined
      ? undefined
      : plan.resources.find((entry) => entry.id === issue.resourceId)?.title;

  return (
    <PlanDialog
      owner={owner}
      title="Проблемы плана"
      description="Нарушения зависимостей FS и конфликты ресурсов по календарю плана."
      closeLabel="Закрыть проблемы плана"
      className="task-editor catalog plan-issues"
      wide
      onClose={onClose}
    >
      <div className="task-editor__body plan-dialog__body plan-issues__body">
        <div className="plan-issues__controls">
          <div className="plan-issues__filters" role="group" aria-label="Тип проблемы">
            {(['all', ...ISSUE_KIND_ORDER] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={`plan-issues__filter${filter === kind ? ' plan-issues__filter--active' : ''}`}
                aria-pressed={filter === kind}
                data-issue-filter={kind}
                onClick={() => setFilter(kind)}
              >
                {FILTER_LABEL[kind]}
                <span className="plan-issues__count">
                  {kind === 'all' ? issues.length : counts[kind]}
                </span>
              </button>
            ))}
          </div>
          <label className="task-editor__field plan-issues__search">
            <span className="task-editor__label">Поиск проблем</span>
            <input
              type="search"
              value={search}
              placeholder="Задача или исполнитель…"
              data-issue-search
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="plan-issues__scroll">
          {issues.length === 0 ? (
            <p className="task-editor__preview" data-issues-empty="none">
              Проблем нет.
            </p>
          ) : visible.length === 0 ? (
            <p className="task-editor__preview" data-issues-empty="filtered">
              {query !== ''
                ? `Ничего не найдено по запросу «${query}».`
                : 'Нет проблем по выбранному фильтру.'}
            </p>
          ) : (
            ISSUE_KIND_ORDER.filter((kind) =>
              visible.some((issue) => issue.kind === kind),
            ).map((kind) => (
              <IssueGroup
                key={kind}
                kind={kind}
                entries={visible.filter((issue) => issue.kind === kind)}
                titleOf={titleOf}
                resourceOf={resourceOf}
                onShowTask={onShowTask}
                onEditTask={onEditTask}
              />
            ))
          )}
        </div>
      </div>
      <footer className="task-editor__foot">
        <div className="task-editor__foot-spacer" />
        <button
          type="button"
          className="task-editor__button"
          data-issues-close
          onClick={onClose}
        >
          Готово
        </button>
      </footer>
    </PlanDialog>
  );
}

function IssueGroup({
  kind,
  entries,
  titleOf,
  resourceOf,
  onShowTask,
  onEditTask,
}: {
  readonly kind: IssueKind;
  readonly entries: readonly PlanProblem[];
  readonly titleOf: (taskId: string) => string;
  readonly resourceOf: (issue: PlanProblem) => string | undefined;
  readonly onShowTask: (taskId: string) => void;
  readonly onEditTask: (taskId: string) => void;
}) {
  return (
    <section className="plan-issues__group" aria-label={ISSUE_KIND_LABEL[kind]}>
      <h4 className="plan-issues__group-title">
        {ISSUE_KIND_LABEL[kind]}
        <span className="plan-issues__count">{entries.length}</span>
      </h4>
      <ul className="plan-issues__list" data-issues-list>
        {entries.map((issue, index) => (
          <li
            key={`${issue.kind}-${index}`}
            className="plan-issues__entry"
          >
            <div className="plan-issues__info">
              <span className="plan-issues__task">
                {issue.taskId === undefined ? '—' : titleOf(issue.taskId)}
              </span>
              <p className="plan-issues__message">{issue.message}</p>
              <p className="plan-issues__meta">
                {issue.kind === 'dependency' && issue.expectedStart !== undefined && issue.actualStart !== undefined ? (
                  <>
                    Ожидается {issueDateLabel(issue.expectedStart)} · факт{' '}
                    {issueDateLabel(issue.actualStart)}
                  </>
                ) : null}
                {issue.kind !== 'dependency' && issue.intervalStart !== undefined && issue.intervalEnd !== undefined ? (
                  <>
                    Пересечение {issueDateLabel(issue.intervalStart)}–
                    {issueDateLabel(issue.intervalEnd)}
                    {resourceOf(issue) !== undefined ? ` · ${resourceOf(issue)}` : ''}
                  </>
                ) : null}
              </p>
            </div>
            <div className="plan-issues__actions">
              {issue.taskId !== undefined ? (
                <>
                  <button
                    type="button"
                    className="task-editor__button"
                    data-issue-show={index}
                    onClick={() => onShowTask(issue.taskId as string)}
                  >
                    Показать
                  </button>
                  <button
                    type="button"
                    className="task-editor__button"
                    data-issue-edit={index}
                    onClick={() => onEditTask(issue.taskId as string)}
                  >
                    Открыть
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
