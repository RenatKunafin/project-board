import { useEffect, useRef, useState } from 'react';
import type { PlanCommandError } from './plan-commands';
import type { PlanContent } from './plan-document';
import PlanCalendarSection from './PlanCalendarSection';
import './task-editor.css';

/** Команды редакторов справочников — родитель исполняет их ядром. */
export type CatalogCommand =
  | { readonly type: 'createResource'; readonly title: string }
  | { readonly type: 'renameResource'; readonly resourceId: string; readonly title: string }
  | { readonly type: 'deleteResource'; readonly resourceId: string }
  | { readonly type: 'createWorkType'; readonly title: string; readonly allowsParallel: boolean }
  | { readonly type: 'renameWorkType'; readonly workTypeId: string; readonly title: string }
  | { readonly type: 'toggleWorkTypeParallel'; readonly workTypeId: string; readonly allowsParallel: boolean }
  | { readonly type: 'deleteWorkType'; readonly workTypeId: string }
  | {
      readonly type: 'createUnavailability';
      readonly resourceId: string;
      readonly start: string;
      readonly end: string;
    }
  | {
      readonly type: 'updateUnavailability';
      readonly unavailabilityId: string;
      readonly resourceId: string;
      readonly start: string;
      readonly end: string;
    }
  | { readonly type: 'deleteUnavailability'; readonly unavailabilityId: string }
  | {
      readonly type: 'updateCalendar';
      readonly workingDays: readonly number[];
      readonly holidays: readonly string[];
      readonly workingExceptions: readonly string[];
    };

interface ResourceCatalogDialogProps {
  readonly plan: PlanContent;
  /** Возвращает ошибку ядра — показывается у места действия, документ не меняется. */
  readonly applyCommand: (command: CatalogCommand) => PlanCommandError | undefined;
  readonly onClose: () => void;
}

type Section = 'resources' | 'workTypes';

interface EditingState {
  readonly section: Section;
  readonly id: string;
  readonly title: string;
}

/**
 * Редакторы справочников плана (PBT-041): исполнители и типы работ.
 * Инлайн-переименование, флажок параллельности типа, удаление с
 * пояснением последствий контракта ядра (вариант A PBT-033).
 * Esc — закрыть, Enter — подтвердить действие поля.
 */
export default function ResourceCatalogDialog({
  plan,
  applyCommand,
  onClose,
}: ResourceCatalogDialogProps) {
  const [newResourceTitle, setNewResourceTitle] = useState('');
  const [newWorkTypeTitle, setNewWorkTypeTitle] = useState('');
  const [newWorkTypeParallel, setNewWorkTypeParallel] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const newResourceRef = useRef<HTMLInputElement>(null);
  // Отпуска (PBT-043): форма добавления и инлайн-редактирование периода.
  const [newAbsence, setNewAbsence] = useState({
    resourceId: '',
    start: '',
    end: '',
  });
  const [editingAbsence, setEditingAbsence] = useState<{
    id: string;
    resourceId: string;
    start: string;
    end: string;
  } | null>(null);
  const [absenceError, setAbsenceError] = useState<string | null>(null);

  useEffect(() => {
    newResourceRef.current?.focus();
  }, []);

  const submitNewResource = () => {
    const title = newResourceTitle;
    if (title.trim() === '') {
      setAddError('Название не может быть пустым.');
      return;
    }
    const error = applyCommand({ type: 'createResource', title });
    if (error !== undefined) {
      setAddError(error.message);
      return;
    }
    setNewResourceTitle('');
    setAddError(null);
  };

  const submitNewWorkType = () => {
    const title = newWorkTypeTitle;
    if (title.trim() === '') {
      setAddError('Название не может быть пустым.');
      return;
    }
    const error = applyCommand({
      type: 'createWorkType',
      title,
      allowsParallel: newWorkTypeParallel,
    });
    if (error !== undefined) {
      setAddError(error.message);
      return;
    }
    setNewWorkTypeTitle('');
    setNewWorkTypeParallel(false);
    setAddError(null);
  };

  const submitRename = () => {
    if (editing === null) {
      return;
    }
    const { section, id, title } = editing;
    if (title.trim() === '') {
      setRowError({ id, message: 'Название не может быть пустым.' });
      return;
    }
    const command: CatalogCommand =
      section === 'resources'
        ? { type: 'renameResource', resourceId: id, title }
        : { type: 'renameWorkType', workTypeId: id, title };
    const error = applyCommand(command);
    if (error !== undefined) {
      setRowError({ id, message: error.message });
      return;
    }
    setEditing(null);
    setRowError(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  const validateAbsence = (
    resourceId: string,
    start: string,
    end: string,
  ): string | null => {
    if (resourceId === '') {
      return 'Выберите ресурс.';
    }
    if (start === '' || end === '') {
      return 'Укажите даты отпуска.';
    }
    return null;
  };

  const submitNewAbsence = () => {
    const problem = validateAbsence(
      newAbsence.resourceId,
      newAbsence.start,
      newAbsence.end,
    );
    if (problem !== null) {
      setAbsenceError(problem);
      return;
    }
    const error = applyCommand({
      type: 'createUnavailability',
      resourceId: newAbsence.resourceId,
      start: newAbsence.start,
      end: newAbsence.end,
    });
    if (error !== undefined) {
      setAbsenceError(error.message);
      return;
    }
    setNewAbsence({ resourceId: '', start: '', end: '' });
    setAbsenceError(null);
  };

  const submitAbsenceEdit = () => {
    if (editingAbsence === null) {
      return;
    }
    const problem = validateAbsence(
      editingAbsence.resourceId,
      editingAbsence.start,
      editingAbsence.end,
    );
    if (problem !== null) {
      setRowError({ id: editingAbsence.id, message: problem });
      return;
    }
    const error = applyCommand({
      type: 'updateUnavailability',
      unavailabilityId: editingAbsence.id,
      resourceId: editingAbsence.resourceId,
      start: editingAbsence.start,
      end: editingAbsence.end,
    });
    if (error !== undefined) {
      setRowError({ id: editingAbsence.id, message: error.message });
      return;
    }
    setEditingAbsence(null);
    setRowError(null);
  };

  const absenceTitle = (resourceId: string): string =>
    plan.resources.find((entry) => entry.id === resourceId)?.title ?? '—';

  const handleFieldKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitNewResource();
      submitNewWorkType();
    }
  };

  const handleEditingKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      submitRename();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setEditing(null);
      setRowError(null);
    }
  };

  return (
    <div
      className="task-editor__overlay"
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <section
        className="task-editor catalog"
        role="dialog"
        aria-modal="true"
        aria-label="Настройки плана"
      >
        <header className="task-editor__head">
          <div>
            <h3 className="task-editor__title">Справочники плана</h3>
            <p className="task-editor__description">
              Ресурсы, типы работ, отпуска и календарь этого плана.
            </p>
          </div>
          <button
            type="button"
            className="task-editor__close"
            aria-label="Закрыть настройки плана"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="task-editor__body">
          <section aria-label="Исполнители">
            <h4 className="catalog__section-title">Исполнители</h4>
            {plan.resources.length === 0 && (
              <p className="task-editor__preview">Нет исполнителей — добавьте первого.</p>
            )}
            <ul className="catalog__list">
              {plan.resources.map((resource) => (
                <li key={resource.id} className="catalog__row">
                  {editing?.section === 'resources' && editing.id === resource.id ? (
                    <>
                      <input
                        type="text"
                        value={editing.title}
                        autoFocus
                        data-catalog-edit="resource"
                        onKeyDown={handleEditingKeyDown}
                        onChange={(event) =>
                          setEditing({ ...editing, title: event.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="task-editor__button"
                        aria-label="Сохранить название"
                        onClick={submitRename}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="task-editor__button"
                        aria-label="Отменить переименование"
                        onClick={() => setEditing(null)}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="catalog__title">{resource.title}</span>
                      <button
                        type="button"
                        className="task-editor__button"
                        aria-label={`Изменить ${resource.title}`}
                        onClick={() => {
                          setEditing({
                            section: 'resources',
                            id: resource.id,
                            title: resource.title,
                          });
                          setRowError(null);
                        }}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="task-editor__button task-editor__button--danger"
                        aria-label={`Удалить ${resource.title}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Удалить исполнителя «${resource.title}»? Задачи потеряют назначение, его периоды недоступности будут удалены.`,
                            )
                          ) {
                            applyCommand({
                              type: 'deleteResource',
                              resourceId: resource.id,
                            });
                            setRowError(null);
                          }
                        }}
                      >
                        Удалить
                      </button>
                    </>
                  )}
                  {rowError?.id === resource.id && (
                    <span className="task-editor__error" role="alert">
                      {rowError.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="catalog__add">
              <input
                ref={newResourceRef}
                type="text"
                value={newResourceTitle}
                placeholder="Новый исполнитель"
                data-catalog-new="resource"
                onKeyDown={handleFieldKeyDown}
                onChange={(event) => setNewResourceTitle(event.target.value)}
              />
              <button
                type="button"
                className="task-editor__button"
                data-catalog-add="resource"
                onClick={submitNewResource}
              >
                Добавить
              </button>
            </div>
          </section>
          <section aria-label="Типы работ">
            <h4 className="catalog__section-title">Типы работ</h4>
            <p className="task-editor__preview">
              Разработка — нельзя параллельно; ПСИ — можно: пересечение
              непараллелизуемых работ одного исполнителя — конфликт.
            </p>
            {plan.workTypes.length === 0 && (
              <p className="task-editor__preview">Нет типов работ — добавьте первый.</p>
            )}
            <ul className="catalog__list">
              {plan.workTypes.map((workType) => (
                <li key={workType.id} className="catalog__row">
                  {editing?.section === 'workTypes' && editing.id === workType.id ? (
                    <>
                      <input
                        type="text"
                        value={editing.title}
                        autoFocus
                        data-catalog-edit="workType"
                        onKeyDown={handleEditingKeyDown}
                        onChange={(event) =>
                          setEditing({ ...editing, title: event.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="task-editor__button"
                        aria-label="Сохранить название"
                        onClick={submitRename}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="task-editor__button"
                        aria-label="Отменить переименование"
                        onClick={() => setEditing(null)}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="catalog__title">{workType.title}</span>
                      <label className="catalog__flag">
                        <input
                          type="checkbox"
                          checked={workType.allowsParallel}
                          data-catalog-parallel={workType.id}
                          onChange={(event) =>
                            applyCommand({
                              type: 'toggleWorkTypeParallel',
                              workTypeId: workType.id,
                              allowsParallel: event.target.checked,
                            })
                          }
                        />
                        можно параллельно
                      </label>
                      <button
                        type="button"
                        className="task-editor__button"
                        aria-label={`Изменить ${workType.title}`}
                        onClick={() => {
                          setEditing({
                            section: 'workTypes',
                            id: workType.id,
                            title: workType.title,
                          });
                          setRowError(null);
                        }}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="task-editor__button task-editor__button--danger"
                        aria-label={`Удалить ${workType.title}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Удалить тип работы «${workType.title}»? Задачи потеряют тип и станут непараллелизуемыми по умолчанию.`,
                            )
                          ) {
                            applyCommand({
                              type: 'deleteWorkType',
                              workTypeId: workType.id,
                            });
                            setRowError(null);
                          }
                        }}
                      >
                        Удалить
                      </button>
                    </>
                  )}
                  {rowError?.id === workType.id && (
                    <span className="task-editor__error" role="alert">
                      {rowError.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="catalog__add">
              <input
                type="text"
                value={newWorkTypeTitle}
                placeholder="Новый тип работы"
                data-catalog-new="workType"
                onKeyDown={handleFieldKeyDown}
                onChange={(event) => setNewWorkTypeTitle(event.target.value)}
              />
              <label className="catalog__flag">
                <input
                  type="checkbox"
                  checked={newWorkTypeParallel}
                  data-catalog-new-parallel
                  onChange={(event) => setNewWorkTypeParallel(event.target.checked)}
                />
                можно параллельно
              </label>
              <button
                type="button"
                className="task-editor__button"
                data-catalog-add="workType"
                onClick={submitNewWorkType}
              >
                Добавить
              </button>
            </div>
          </section>
          <section aria-label="Отпуска">
            <h4 className="catalog__section-title">Отпуска</h4>
            {plan.unavailability.length === 0 && (
              <p className="task-editor__preview">Периодов недоступности нет.</p>
            )}
            <ul className="catalog__list">
              {plan.unavailability.map((absence) => (
                <li key={absence.id} className="catalog__row">
                  {editingAbsence?.id === absence.id ? (
                    <>
                      <select
                        value={editingAbsence.resourceId}
                        data-absence-edit="resource"
                        onChange={(event) =>
                          setEditingAbsence({
                            ...editingAbsence,
                            resourceId: event.target.value,
                          })
                        }
                      >
                        <option value="">Выберите ресурс</option>
                        {plan.resources.map((resource) => (
                          <option key={resource.id} value={resource.id}>
                            {resource.title}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={editingAbsence.start}
                        data-absence-edit="start"
                        onChange={(event) =>
                          setEditingAbsence({
                            ...editingAbsence,
                            start: event.target.value,
                          })
                        }
                      />
                      <input
                        type="date"
                        value={editingAbsence.end}
                        data-absence-edit="end"
                        onChange={(event) =>
                          setEditingAbsence({
                            ...editingAbsence,
                            end: event.target.value,
                          })
                        }
                      />
                      <button
                        type="button"
                        className="task-editor__button"
                        aria-label="Сохранить период"
                        onClick={submitAbsenceEdit}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="task-editor__button"
                        aria-label="Отменить изменение периода"
                        onClick={() => setEditingAbsence(null)}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="catalog__title">
                        {absenceTitle(absence.resourceId)}: {absence.start} —{' '}
                        {absence.end}
                      </span>
                      <button
                        type="button"
                        className="task-editor__button"
                        aria-label="Изменить период"
                        onClick={() => {
                          setEditingAbsence({
                            id: absence.id,
                            resourceId: absence.resourceId,
                            start: absence.start,
                            end: absence.end,
                          });
                          setRowError(null);
                        }}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="task-editor__button task-editor__button--danger"
                        aria-label="Удалить период"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Удалить отпуск «${absenceTitle(absence.resourceId)}: ${absence.start} — ${absence.end}»?`,
                            )
                          ) {
                            applyCommand({
                              type: 'deleteUnavailability',
                              unavailabilityId: absence.id,
                            });
                            setRowError(null);
                          }
                        }}
                      >
                        Удалить
                      </button>
                    </>
                  )}
                  {rowError?.id === absence.id && (
                    <span className="task-editor__error" role="alert">
                      {rowError.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="catalog__add">
              <select
                value={newAbsence.resourceId}
                data-absence-new="resource"
                onChange={(event) =>
                  setNewAbsence({
                    ...newAbsence,
                    resourceId: event.target.value,
                  })
                }
              >
                <option value="">Выберите ресурс</option>
                {plan.resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.title}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={newAbsence.start}
                data-absence-new="start"
                onChange={(event) =>
                  setNewAbsence({ ...newAbsence, start: event.target.value })
                }
              />
              <input
                type="date"
                value={newAbsence.end}
                data-absence-new="end"
                onChange={(event) =>
                  setNewAbsence({ ...newAbsence, end: event.target.value })
                }
              />
              <button
                type="button"
                className="task-editor__button"
                data-absence-add
                onClick={submitNewAbsence}
              >
                Добавить
              </button>
            </div>
            {absenceError !== null && (
              <p className="task-editor__error" role="alert" data-absence-error>
                {absenceError}
              </p>
            )}
          </section>
          <PlanCalendarSection
            calendar={plan.calendar}
            onApply={(workingDays, holidays, workingExceptions) =>
              applyCommand({
                type: 'updateCalendar',
                workingDays,
                holidays,
                workingExceptions,
              })
            }
          />
          {addError !== null && (
            <p className="task-editor__error" role="alert" data-catalog-error>
              {addError}
            </p>
          )}
        </div>
        <footer className="task-editor__foot">
          <div className="task-editor__foot-spacer" />
          <button
            type="button"
            className="task-editor__button"
            data-catalog-close
            onClick={onClose}
          >
            Готово
          </button>
        </footer>
      </section>
    </div>
  );
}
