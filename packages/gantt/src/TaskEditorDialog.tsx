import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanCommandError } from './plan-commands';
import type { PlanContent, PlanDependency, PlanTask } from './plan-document';
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

/** Команды редактора зависимостей (PBT-045) — родитель исполняет ядром. */
export type DependencyCommand =
  | {
      readonly type: 'createDependency';
      readonly fromTaskId: string;
      readonly toTaskId: string;
      readonly lagDays: number;
    }
  | {
      readonly type: 'updateDependencyLag';
      readonly dependencyId: string;
      readonly lagDays: number;
    }
  | { readonly type: 'deleteDependency'; readonly dependencyId: string };

interface TaskEditorDialogProps {
  readonly plan: PlanContent;
  readonly mode: 'create' | 'edit';
  readonly task?: PlanTask;
  /** Возвращает ошибку ядра (например, назначение несуществующей записи) — форма остаётся открытой. */
  readonly onSubmit: (submit: TaskEditorSubmit) => TaskFormIssue | undefined;
  /** Команды зависимостей исполняются немедленно; ошибка — по месту. */
  readonly applyDependencyCommand?: (
    command: DependencyCommand,
  ) => PlanCommandError | undefined;
  readonly onDelete?: () => void;
  /** PBT-054: открытие диалога преобразования в отпуск (edit-режим). */
  readonly onConvertToAbsence?: () => void;
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
  applyDependencyCommand,
  onDelete,
  onConvertToAbsence,
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

  // Предшественники (PBT-045): инлайн-лаг, добавление, удаление.
  const predecessors: readonly PlanDependency[] =
    task !== undefined
      ? plan.dependencies.filter((entry) => entry.toTaskId === task.id)
      : [];
  const [editingDep, setEditingDep] = useState<{
    id: string;
    lag: string;
  } | null>(null);
  const [depError, setDepError] = useState<string | null>(null);
  const [newDepFrom, setNewDepFrom] = useState('');
  const [newDepLag, setNewDepLag] = useState('0');

  const depLagValid = (lag: string): number | null => {
    const value = Number(lag);
    if (lag === '' || !Number.isInteger(value) || value < 0) {
      return null;
    }
    return value;
  };

  const submitNewDependency = () => {
    if (task === undefined || applyDependencyCommand === undefined) {
      return;
    }
    if (newDepFrom === '') {
      setDepError('Выберите задачу-предшественника.');
      return;
    }
    const lag = depLagValid(newDepLag);
    if (lag === null) {
      setDepError('Лаг — целое число рабочих дней не меньше нуля.');
      return;
    }
    const error = applyDependencyCommand({
      type: 'createDependency',
      fromTaskId: newDepFrom,
      toTaskId: task.id,
      lagDays: lag,
    });
    if (error !== undefined) {
      setDepError(error.message);
      return;
    }
    setNewDepFrom('');
    setNewDepLag('0');
    setDepError(null);
  };

  const submitDepLag = () => {
    if (editingDep === null || applyDependencyCommand === undefined) {
      return;
    }
    const lag = depLagValid(editingDep.lag);
    if (lag === null) {
      setDepError('Лаг — целое число рабочих дней не меньше нуля.');
      return;
    }
    const error = applyDependencyCommand({
      type: 'updateDependencyLag',
      dependencyId: editingDep.id,
      lagDays: lag,
    });
    if (error !== undefined) {
      setDepError(error.message);
      return;
    }
    setEditingDep(null);
    setDepError(null);
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
  // Инпут лага предшественника: Enter — сохранить, Esc — отмена редактирования.
  const handleDepInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      submitDepLag();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setEditingDep(null);
      setDepError(null);
    }
  };

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
          <div>
            <h3 className="task-editor__title">
              {mode === 'create' ? 'Новая задача' : 'Редактирование задачи'}
            </h3>
            <p className="task-editor__description">
              Изменения записываются в документ плана; даты других задач не
              переносятся.
            </p>
          </div>
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
          {mode === 'edit' && task !== undefined && (
            <div className="task-editor__field">
              <span className="task-editor__label">Предшественники (FS)</span>
              {predecessors.length === 0 && (
                <span className="task-editor__preview">Нет предшественников.</span>
              )}
              <ul className="catalog__list" data-dep-list>
                {predecessors.map((dependency) => {
                  const from = plan.tasks.find(
                    (entry) => entry.id === dependency.fromTaskId,
                  );
                  return (
                    <li key={dependency.id} className="catalog__row">
                      {editingDep?.id === dependency.id ? (
                        <>
                          <span className="catalog__title">
                            {from?.title ?? '—'}
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={editingDep.lag}
                            data-dep-lag-input
                            onKeyDown={handleDepInputKeyDown}
                            onChange={(event) =>
                              setEditingDep({
                                ...editingDep,
                                lag: event.target.value,
                              })
                            }
                          />
                          <span className="task-editor__label">дн.</span>
                          <button
                            type="button"
                            className="task-editor__button"
                            aria-label="Сохранить лаг"
                            onClick={submitDepLag}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            className="task-editor__button"
                            aria-label="Отменить изменение лага"
                            onClick={() => setEditingDep(null)}
                          >
                            ×
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="catalog__title">
                            {from?.title ?? '—'} · лаг {dependency.lagDays} дн.
                          </span>
                          <button
                            type="button"
                            className="task-editor__button"
                            aria-label="Изменить лаг"
                            onClick={() => {
                              setEditingDep({
                                id: dependency.id,
                                lag: String(dependency.lagDays),
                              });
                              setDepError(null);
                            }}
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            className="task-editor__button task-editor__button--danger"
                            aria-label={`Удалить связь от ${from?.title ?? ''}`}
                            onClick={() => {
                              applyDependencyCommand?.({
                                type: 'deleteDependency',
                                dependencyId: dependency.id,
                              });
                              setDepError(null);
                            }}
                          >
                            Удалить
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="catalog__add">
                <select
                  value={newDepFrom}
                  data-dep-new-from
                  onChange={(event) => setNewDepFrom(event.target.value)}
                >
                  <option value="">Задача-предшественник</option>
                  {plan.tasks.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={newDepLag}
                  data-dep-new-lag
                  title="Лаг, рабочих дней"
                  onChange={(event) => setNewDepLag(event.target.value)}
                />
                <span className="task-editor__label">дн.</span>
                <button
                  type="button"
                  className="task-editor__button"
                  data-dep-add
                  onClick={submitNewDependency}
                >
                  Добавить
                </button>
              </div>
              {depError !== null && (
                <p className="task-editor__error" role="alert" data-dep-error>
                  {depError}
                </p>
              )}
            </div>
          )}
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
          {mode === 'edit' && onConvertToAbsence !== undefined && (
            <button
              type="button"
              className="task-editor__button"
              data-task-to-absence
              onClick={onConvertToAbsence}
            >
              В отпуск…
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
