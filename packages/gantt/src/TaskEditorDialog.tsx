import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanContent, PlanTask } from './plan-document';
import { createWorkingCalendar } from './working-calendar';
import {
  buildTaskDates,
  validateTaskForm,
  type TaskFormIssue,
} from './task-editor';
import './task-editor.css';

export interface TaskEditorSubmit {
  readonly title: string;
  readonly groupId?: string;
  readonly start: string;
  readonly durationDays: number;
  readonly assigneeIds: readonly string[];
  readonly workTypeIds: readonly string[];
}

interface TaskEditorDialogProps {
  readonly plan: PlanContent;
  readonly mode: 'create' | 'edit';
  readonly task?: PlanTask;
  /** Возвращает ошибку ядра (например, назначение несуществующей записи) — форма остаётся открытой. */
  readonly onSubmit: (submit: TaskEditorSubmit) => TaskFormIssue | undefined;
  readonly onDelete?: () => void;
  readonly onClose: () => void;
}

/**
 * Форма задачи (PBT-038): поля «начало + рабочая длительность»,
 * окончание вычисляется включительно по календарю плана.
 * Esc — отмена, Enter — подтверждение; фокус в первое поле.
 */
export default function TaskEditorDialog({
  plan,
  mode,
  task,
  onSubmit,
  onDelete,
  onClose,
}: TaskEditorDialogProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [groupId, setGroupId] = useState(task?.groupId ?? '');
  const [start, setStart] = useState(task?.start ?? '');
  const [duration, setDuration] = useState(() =>
    task === undefined ? 1 : computeDuration(task, plan),
  );
  const [issue, setIssue] = useState<TaskFormIssue | undefined>();
  const titleRef = useRef<HTMLInputElement>(null);
  // Назначения (PBT-042): множества id из справочников текущего плана.
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assigneeIds ? [...task.assigneeIds] : [],
  );
  const [workTypeIds, setWorkTypeIds] = useState<string[]>(
    task?.workTypeIds ? [...task.workTypeIds] : [],
  );

  const toggleId = (list: string[], setList: (next: string[]) => void, id: string) => {
    setList(
      list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id],
    );
  };

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const endPreview = useMemo(() => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !Number.isInteger(duration) ||
      duration < 1
    ) {
      return undefined;
    }
    try {
      return buildTaskDates({ start, durationDays: duration }, plan).end;
    } catch {
      return undefined;
    }
  }, [start, duration, plan]);

  const submit = () => {
    const input = {
      title,
      ...(groupId === '' ? {} : { groupId }),
      start,
      durationDays: duration,
    };
    const validation = validateTaskForm(input, plan);
    if (validation !== undefined) {
      setIssue(validation);
      return;
    }
    const coreIssue = onSubmit({
      ...input,
      assigneeIds,
      workTypeIds,
    });
    if (coreIssue !== undefined) {
      setIssue(coreIssue);
      return;
    }
    setIssue(undefined);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  // Enter в поле ввода — подтверждение формы (дизайн D4); Esc — отмена.
  const handleFieldKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="task-editor__overlay"
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <section
        className="task-editor"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'create' ? 'Новая задача' : 'Редактирование задачи'}
      >
        <header className="task-editor__head">
          <h3 className="task-editor__title">
            {mode === 'create' ? 'Новая задача' : 'Редактирование задачи'}
          </h3>
          <button
            type="button"
            className="task-editor__close"
            aria-label="Закрыть форму"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="task-editor__body">
          <label className="task-editor__field">
            <span className="task-editor__label">Название</span>
            <input
              ref={titleRef}
              type="text"
              value={title}
              data-task-field="title"
              onKeyDown={handleFieldKeyDown}
              onChange={(event) => setTitle(event.target.value)}
            />
            {issue?.field === 'title' && (
              <span className="task-editor__error" role="alert">
                {issue.message}
              </span>
            )}
          </label>
          <label className="task-editor__field">
            <span className="task-editor__label">Группа</span>
            <select
              value={groupId}
              data-task-field="group"
              onChange={(event) => setGroupId(event.target.value)}
            >
              <option value="">Без группы</option>
              {plan.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.title}
                </option>
              ))}
            </select>
            {issue?.field === 'group' && (
              <span className="task-editor__error" role="alert">
                {issue.message}
              </span>
            )}
          </label>
          <div className="task-editor__row">
            <label className="task-editor__field">
              <span className="task-editor__label">Исполнители</span>
              {plan.resources.length === 0 ? (
                <span className="task-editor__preview">
                  Справочник пуст — добавьте в «Справочниках».
                </span>
              ) : (
                <div className="task-editor__checks" data-task-assignees>
                  {plan.resources.map((resource) => (
                    <label key={resource.id} className="task-editor__check">
                      <input
                        type="checkbox"
                        checked={assigneeIds.includes(resource.id)}
                        data-task-assignee={resource.title}
                        onChange={() =>
                          toggleId(assigneeIds, setAssigneeIds, resource.id)
                        }
                      />
                      {resource.title}
                    </label>
                  ))}
                </div>
              )}
            </label>
            <label className="task-editor__field">
              <span className="task-editor__label">Типы работы</span>
              {plan.workTypes.length === 0 ? (
                <span className="task-editor__preview">
                  Справочник пуст — добавьте в «Справочниках».
                </span>
              ) : (
                <div className="task-editor__checks" data-task-worktypes>
                  {plan.workTypes.map((workType) => (
                    <label key={workType.id} className="task-editor__check">
                      <input
                        type="checkbox"
                        checked={workTypeIds.includes(workType.id)}
                        data-task-worktype={workType.title}
                        onChange={() =>
                          toggleId(workTypeIds, setWorkTypeIds, workType.id)
                        }
                      />
                      {workType.title}
                    </label>
                  ))}
                </div>
              )}
            </label>
          </div>
          <div className="task-editor__row">
            <label className="task-editor__field">
              <span className="task-editor__label">Дата начала</span>
              <input
                type="date"
                value={start}
                data-task-field="start"
              onKeyDown={handleFieldKeyDown}
                onChange={(event) => setStart(event.target.value)}
              />
              {issue?.field === 'start' && (
                <span className="task-editor__error" role="alert">
                  {issue.message}
                </span>
              )}
            </label>
            <label className="task-editor__field task-editor__field--narrow">
              <span className="task-editor__label">Раб. дни</span>
              <input
                type="number"
                min={1}
                step={1}
                value={Number.isNaN(duration) ? '' : duration}
                data-task-field="duration"
              onKeyDown={handleFieldKeyDown}
                onChange={(event) =>
                  setDuration(Number.parseInt(event.target.value, 10))
                }
              />
              {issue?.field === 'duration' && (
                <span className="task-editor__error" role="alert">
                  {issue.message}
                </span>
              )}
            </label>
          </div>
          <p className="task-editor__preview" data-task-end-preview>
            {endPreview === undefined
              ? 'Окончание: —'
              : `Окончание (включительно): ${endPreview}`}
          </p>
        </div>
        <footer className="task-editor__foot">
          {mode === 'edit' && onDelete !== undefined && (
            <button
              type="button"
              className="task-editor__button task-editor__button--danger"
              data-task-delete
              onClick={() => {
                if (window.confirm(`Удалить задачу «${title}»?`)) {
                  onDelete();
                }
              }}
            >
              Удалить
            </button>
          )}
          <div className="task-editor__foot-spacer" />
          <button
            type="button"
            className="task-editor__button"
            data-task-cancel
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            className="task-editor__button task-editor__button--primary"
            data-task-save
            onClick={submit}
          >
            Сохранить
          </button>
        </footer>
      </section>
    </div>
  );
}

function computeDuration(task: PlanTask, plan: PlanContent): number {
  try {
    const calendar = createWorkingCalendar(plan.calendar);
    return Math.max(calendar.workingDaysBetween(task.start, task.end), 1);
  } catch {
    return 1;
  }
}
