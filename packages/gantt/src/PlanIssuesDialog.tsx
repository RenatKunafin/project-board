import { useMemo } from 'react';
import type { PlanContent } from './plan-document';
import { dependencyViolations } from './plan-dependencies';
import { resourceConflicts, type ResourceConflict } from './plan-conflicts';
import './task-editor.css';

type IssueKind = 'dependency' | 'parallel-work' | 'unavailability';

interface PlanIssue {
  readonly kind: IssueKind;
  readonly message: string;
  /** Задача перехода (если применимо). */
  readonly taskId?: string;
}

const KIND_LABEL: Record<IssueKind, string> = {
  dependency: 'Нарушение FS',
  'parallel-work': 'Конфликт работ',
  unavailability: 'Отпуск исполнителя',
};

/**
 * Список проблем плана (PBT-046): нарушения FS + ресурсные конфликты.
 * Производное значение документа — пересчёт не создаёт записей.
 */
export function usePlanIssues(plan: PlanContent): readonly PlanIssue[] {
  return useMemo(() => {
    const issues: PlanIssue[] = [];
    for (const violation of dependencyViolations(plan)) {
      issues.push({
        kind: 'dependency',
        taskId: violation.toTaskId,
        message: violation.message,
      });
    }
    for (const conflict of resourceConflicts(plan)) {
      issues.push({
        kind: conflict.kind,
        taskId: resolveConflictTask(conflict),
        message: conflict.message,
      });
    }
    return issues;
  }, [plan]);
}

function resolveConflictTask(conflict: ResourceConflict): string {
  return conflict.kind === 'unavailability'
    ? conflict.taskId
    : conflict.firstTaskId;
}

export default function PlanIssuesDialog({
  issues,
  onClose,
  onShowTask,
}: {
  readonly issues: readonly PlanIssue[];
  readonly onClose: () => void;
  readonly onShowTask: (taskId: string) => void;
}) {
  return (
    <div
      className="task-editor__overlay"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <section
        className="task-editor catalog"
        role="dialog"
        aria-modal="true"
        aria-label="Проблемы плана"
      >
        <header className="task-editor__head">
          <div>
            <h3 className="task-editor__title">Проблемы плана</h3>
            <p className="task-editor__description">
              Нарушения зависимостей FS и конфликты ресурсов по календарю
              плана.
            </p>
          </div>
          <button
            type="button"
            className="task-editor__close"
            aria-label="Закрыть проблемы плана"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="task-editor__body">
          {issues.length === 0 && (
            <p className="task-editor__preview">Проблем нет.</p>
          )}
          <ul className="catalog__list" data-issues-list>
            {issues.map((issue, index) => (
              <li
                key={`${issue.kind}-${index}`}
                className={`catalog__row issues__row issues__row--${issue.kind}`}
              >
                {issue.taskId !== undefined ? (
                  <button
                    type="button"
                    className="issues__action"
                    data-issue-show={index}
                    onClick={() => onShowTask(issue.taskId as string)}
                  >
                    <span className="catalog__title">
                      <span className="issues__kind">{KIND_LABEL[issue.kind]}.</span>{' '}
                      {issue.message}
                    </span>
                    <span className="issues__show">Показать</span>
                  </button>
                ) : (
                  <span className="catalog__title">
                    <span className="issues__kind">{KIND_LABEL[issue.kind]}.</span>{' '}
                    {issue.message}
                  </span>
                )}
              </li>
            ))}
          </ul>
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
      </section>
    </div>
  );
}
