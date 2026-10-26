import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  Palmtree,
  Pencil,
  Plus,
  Tags,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { applyPlanCommand, type PlanCommand } from './plan-commands';
import type { PlanContent } from './plan-document';
import PlanCalendarSection, {
  EMPTY_CALENDAR_INPUTS,
} from './PlanCalendarSection';
import PlanDialog, { type PlanDialogOwner } from './PlanDialog';
import {
  prepareSettingsNames,
  type SettingsIssue,
  type SettingsSection,
} from './plan-settings-draft';
import './task-editor.css';
import './plan-settings.css';

export interface SettingsSaveError {
  readonly message: string;
  readonly kind: 'conflict' | 'missing' | 'invalid' | 'write';
}
interface Props {
  readonly owner: PlanDialogOwner;
  readonly plan: PlanContent;
  readonly revision: number;
  readonly onSave: (
    plan: PlanContent,
    expectedRevision: number,
  ) => SettingsSaveError | undefined;
  readonly onClose: () => void;
}
interface AbsenceInput {
  resourceId: string;
  start: string;
  end: string;
}
const emptyAbsence = (): AbsenceInput => ({
  resourceId: '',
  start: '',
  end: '',
});
const dateLabel = (date: string) => date.split('-').reverse().join('.');
const sections = [
  { id: 'resources', label: 'Исполнители', Icon: Users },
  { id: 'workTypes', label: 'Типы работ', Icon: Tags },
  { id: 'absences', label: 'Отсутствия', Icon: Palmtree },
  { id: 'calendar', label: 'Календарь', Icon: CalendarDays },
] as const;

/** Снимок меняется только по явному перечитыванию, не по подписке соседнего вида. */
export default function ResourceCatalogDialog(props: Props) {
  const [snapshot, setSnapshot] = useState({
    plan: props.plan,
    revision: props.revision,
  });
  return (
    <SettingsEditor
      {...props}
      key={snapshot.revision}
      initial={snapshot.plan}
      baseRevision={snapshot.revision}
      onReload={() =>
        setSnapshot({ plan: props.plan, revision: props.revision })
      }
    />
  );
}

function SettingsEditor({
  owner,
  initial,
  revision,
  baseRevision,
  onSave,
  onClose,
  onReload,
}: Props & {
  initial: PlanContent;
  baseRevision: number;
  onReload: () => void;
}) {
  const [plan, setPlan] = useState(initial);
  const [active, setActive] = useState<SettingsSection>('resources');
  const [resourceNames, setResourceNames] = useState(new Map<string, string>());
  const [workTypeNames, setWorkTypeNames] = useState(new Map<string, string>());
  const [newResource, setNewResource] = useState('');
  const [newWorkType, setNewWorkType] = useState('');
  const [newParallel, setNewParallel] = useState(false);
  const [newAbsence, setNewAbsence] = useState(emptyAbsence);
  const [editingAbsence, setEditingAbsence] = useState<
    (AbsenceInput & { id: string }) | null
  >(null);
  const [calendarInputs, setCalendarInputs] = useState(EMPTY_CALENDAR_INPUTS);
  const [issues, setIssues] = useState<
    Partial<Record<SettingsSection, SettingsIssue>>
  >({});
  const [saveError, setSaveError] = useState<SettingsSaveError>();
  const fields = useRef(new Map<string, HTMLInputElement>());
  const panels = useRef(new Map<SettingsSection, HTMLElement>());
  const stale = revision !== baseRevision || saveError?.kind === 'conflict';
  const calendarPending = Object.values(calendarInputs).some(Boolean);
  const hasChanges =
    JSON.stringify(plan) !== JSON.stringify(initial) ||
    plan.resources.some(
      (r) => resourceNames.has(r.id) && resourceNames.get(r.id) !== r.title,
    ) ||
    plan.workTypes.some(
      (w) => workTypeNames.has(w.id) && workTypeNames.get(w.id) !== w.title,
    ) ||
    !!newResource ||
    !!newWorkType ||
    newParallel ||
    Object.values(newAbsence).some(Boolean) ||
    editingAbsence !== null ||
    calendarPending;

  useEffect(() => {
    panels.current.get('resources')?.querySelector('input')?.focus();
  }, []);
  useEffect(() => {
    const issue = issues[active];
    if (issue)
      (
        fields.current.get(`${active}:${issue.id}`) ??
        panels.current.get(active)?.querySelector<HTMLInputElement>('input')
      )?.focus();
  }, [active, issues]);

  const clearIssue = (section: SettingsSection) =>
    setIssues((previous) => ({ ...previous, [section]: undefined }));
  const showIssue = (section: SettingsSection, id: string, message: string) => {
    setIssues((previous) => ({
      ...previous,
      [section]: { section, id, message },
    }));
    setActive(section);
  };
  const apply = (command: PlanCommand) => {
    const result = applyPlanCommand(plan, command);
    if (!result.ok) return result.error;
    setPlan(result.plan);
    if (
      editingAbsence &&
      !result.plan.unavailability.some((a) => a.id === editingAbsence.id)
    )
      setEditingAbsence(null);
    return undefined;
  };
  const resourceTitle = (id: string) =>
    resourceNames.get(id) ??
    plan.resources.find((r) => r.id === id)?.title ??
    '—';
  const confirmDiscard = () =>
    !hasChanges ||
    window.confirm(
      'Отменить изменения настроек? Несохранённые изменения и введённые значения будут потеряны.',
    );
  const cancel = () => {
    if (confirmDiscard()) onClose();
  };
  const addResource = () => {
    const error = apply({
      type: 'createResource',
      input: { title: newResource },
    });
    if (error) showIssue('resources', 'new', error.message);
    else {
      setNewResource('');
      clearIssue('resources');
    }
  };
  const addWorkType = () => {
    const error = apply({
      type: 'createWorkType',
      input: { title: newWorkType, allowsParallel: newParallel },
    });
    if (error) showIssue('workTypes', 'new', error.message);
    else {
      setNewWorkType('');
      setNewParallel(false);
      clearIssue('workTypes');
    }
  };
  const saveAbsence = (value: AbsenceInput, id?: string) => {
    const missing = !value.resourceId
      ? 'Выберите ресурс.'
      : !value.start || !value.end
        ? 'Укажите даты отпуска.'
        : undefined;
    const error =
      missing ??
      apply(
        id
          ? { type: 'updateUnavailability', unavailabilityId: id, patch: value }
          : { type: 'createUnavailability', input: value },
      )?.message;
    if (error) showIssue('absences', id ?? 'new', error);
    else {
      if (id) setEditingAbsence(null);
      else setNewAbsence(emptyAbsence());
      clearIssue('absences');
    }
  };
  const save = () => {
    if (stale) return;
    const prepared = prepareSettingsNames(plan, resourceNames, workTypeNames);
    if (!prepared.ok) {
      const issue = prepared.issue;
      showIssue(issue.section, issue.id, issue.message);
      return;
    }
    const pending: [SettingsSection, string, boolean][] = [
      ['resources', 'new', !!newResource],
      ['workTypes', 'new', !!newWorkType || newParallel],
      [
        'absences',
        editingAbsence?.id ?? 'new',
        editingAbsence !== null || Object.values(newAbsence).some(Boolean),
      ],
      ['calendar', 'pending', calendarPending],
    ];
    const unfinished = pending.find(([, , pending]) => pending);
    if (unfinished) {
      showIssue(
        unfinished[0],
        unfinished[1],
        'Завершите добавление или редактирование либо очистите введённые значения.',
      );
      return;
    }
    if (JSON.stringify(prepared.plan) === JSON.stringify(initial)) {
      onClose();
      return;
    }
    const error = onSave(prepared.plan, baseRevision);
    setSaveError(error);
    if (!error) onClose();
  };
  const issueText = (section: SettingsSection, id: string) =>
    issues[section]?.id === id ? (
      <p
        className="task-editor__error plan-settings__error"
        role="alert"
        data-settings-error
        data-catalog-error={
          section === 'resources' || section === 'workTypes' ? '' : undefined
        }
        data-absence-error={section === 'absences' ? '' : undefined}
      >
        {issues[section]?.message}
      </p>
    ) : null;
  const counts = {
    resources: plan.resources.length,
    workTypes: plan.workTypes.length,
    absences: plan.unavailability.length,
    calendar:
      plan.calendar.holidays.length + plan.calendar.workingExceptions.length,
  };
  const removeButton = (label: string, action: () => void) => (
    <button
      type="button"
      className="task-editor__button plan-settings__remove"
      aria-label={label}
      title={label}
      onClick={action}
    >
      <Trash2 size={16} aria-hidden="true" />
    </button>
  );

  return (
    <PlanDialog
      owner={owner}
      title="Настройки плана"
      description="Исполнители, типы работ, отсутствия и рабочий календарь."
      closeLabel="Закрыть настройки плана"
      className="task-editor catalog plan-settings"
      wide
      onClose={onClose}
      onBeforeClose={confirmDiscard}
    >
      {(stale || saveError) && (
        <div className="plan-settings__notice" role="alert">
          <p>
            {stale
              ? 'План изменён в другом окне. Перечитайте актуальную версию перед сохранением; ваш черновик пока сохранён в этом окне.'
              : saveError?.message}
          </p>
          {stale && (
            <button
              type="button"
              className="task-editor__button"
              data-settings-reload
              onClick={() => {
                if (
                  window.confirm(
                    'Перечитать актуальный план? Все несохранённые изменения настроек будут потеряны.',
                  )
                )
                  onReload();
              }}
            >
              Перечитать план
            </button>
          )}
        </div>
      )}
      <div className="plan-dialog__body plan-settings__layout">
        <nav className="plan-settings__nav" aria-label="Разделы настроек плана">
          {sections.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={active === id}
              data-settings-section={id}
              onClick={() => setActive(id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
              <span className="plan-settings__count">{counts[id]}</span>
            </button>
          ))}
        </nav>
        {sections.map(({ id, label }) => (
          <section
            key={id}
            ref={(el) => {
              if (el) panels.current.set(id, el);
              else panels.current.delete(id);
            }}
            className="plan-settings__panel"
            aria-label={label}
            hidden={active !== id}
          >
            <h4 className="plan-settings__heading">{label}</h4>
            {id === 'resources' && (
              <>
                {plan.resources.length === 0 && (
                  <p className="task-editor__preview">
                    Нет исполнителей — добавьте первого.
                  </p>
                )}
                <ul className="plan-settings__list">
                  {plan.resources.map((r, index) => (
                    <li
                      key={r.id}
                      className="plan-settings__item"
                      data-resource-row={r.id}
                    >
                      <input
                        type="text"
                        aria-label={`Имя исполнителя ${index + 1}`}
                        value={resourceNames.get(r.id) ?? r.title}
                        data-resource-title={r.id}
                        ref={(el) => {
                          if (el) fields.current.set(`resources:${r.id}`, el);
                          else fields.current.delete(`resources:${r.id}`);
                        }}
                        aria-invalid={issues.resources?.id === r.id}
                        onChange={(e) => {
                          setResourceNames(
                            new Map(resourceNames).set(r.id, e.target.value),
                          );
                          if (issues.resources?.id === r.id)
                            clearIssue('resources');
                        }}
                      />
                      {removeButton(`Удалить ${resourceTitle(r.id)}`, () => {
                        if (
                          window.confirm(
                            `Удалить исполнителя «${resourceTitle(r.id)}»? После сохранения задачи потеряют это назначение, периоды недоступности исполнителя будут удалены. Задачи, группы и даты сохранятся.`,
                          )
                        ) {
                          const error = apply({
                            type: 'deleteResource',
                            resourceId: r.id,
                          });
                          if (error)
                            showIssue('resources', r.id, error.message);
                          else clearIssue('resources');
                        }
                      })}
                      {issueText('resources', r.id)}
                    </li>
                  ))}
                </ul>
                <form
                  className="plan-settings__add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addResource();
                  }}
                >
                  <input
                    aria-label="Новый исполнитель"
                    placeholder="Новый исполнитель"
                    value={newResource}
                    data-catalog-new="resource"
                    ref={(el) => {
                      if (el) fields.current.set('resources:new', el);
                      else fields.current.delete('resources:new');
                    }}
                    onChange={(e) => {
                      setNewResource(e.target.value);
                      clearIssue('resources');
                    }}
                  />
                  <button
                    type="submit"
                    className="task-editor__button"
                    data-catalog-add="resource"
                    aria-label="Добавить исполнителя"
                    title="Добавить исполнителя"
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                  {issueText('resources', 'new')}
                </form>
              </>
            )}
            {id === 'workTypes' && (
              <>
                <p className="task-editor__preview">
                  Разработка — нельзя параллельно; ПСИ — можно. Две
                  непараллелизуемые работы одного исполнителя могут
                  конфликтовать.
                </p>
                {plan.workTypes.length === 0 && (
                  <p className="task-editor__preview">
                    Нет типов работ — добавьте первый.
                  </p>
                )}
                <ul className="plan-settings__list">
                  {plan.workTypes.map((w, index) => (
                    <li
                      key={w.id}
                      className="plan-settings__item"
                      data-work-type-row={w.id}
                    >
                      <input
                        type="text"
                        aria-label={`Название типа работ ${index + 1}`}
                        value={workTypeNames.get(w.id) ?? w.title}
                        data-work-type-title={w.id}
                        ref={(el) => {
                          if (el) fields.current.set(`workTypes:${w.id}`, el);
                          else fields.current.delete(`workTypes:${w.id}`);
                        }}
                        aria-invalid={issues.workTypes?.id === w.id}
                        onChange={(e) => {
                          setWorkTypeNames(
                            new Map(workTypeNames).set(w.id, e.target.value),
                          );
                          if (issues.workTypes?.id === w.id)
                            clearIssue('workTypes');
                        }}
                      />
                      <label className="plan-settings__flag">
                        <input
                          type="checkbox"
                          checked={w.allowsParallel}
                          data-catalog-parallel={w.id}
                          onChange={(e) => {
                            const error = apply({
                              type: 'updateWorkType',
                              workTypeId: w.id,
                              patch: { allowsParallel: e.target.checked },
                            });
                            if (error)
                              showIssue('workTypes', w.id, error.message);
                          }}
                        />
                        Можно параллельно
                      </label>
                      {removeButton(
                        `Удалить ${workTypeNames.get(w.id) ?? w.title}`,
                        () => {
                          if (
                            window.confirm(
                              `Удалить тип работы «${workTypeNames.get(w.id) ?? w.title}»? После сохранения задачи потеряют этот тип. Без типов работа считается непараллелизуемой. Задачи и их даты сохранятся.`,
                            )
                          ) {
                            const error = apply({
                              type: 'deleteWorkType',
                              workTypeId: w.id,
                            });
                            if (error)
                              showIssue('workTypes', w.id, error.message);
                            else clearIssue('workTypes');
                          }
                        },
                      )}
                      {issueText('workTypes', w.id)}
                    </li>
                  ))}
                </ul>
                <form
                  className="plan-settings__add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addWorkType();
                  }}
                >
                  <input
                    aria-label="Новый тип работы"
                    placeholder="Новый тип работы"
                    value={newWorkType}
                    data-catalog-new="workType"
                    ref={(el) => {
                      if (el) fields.current.set('workTypes:new', el);
                      else fields.current.delete('workTypes:new');
                    }}
                    onChange={(e) => {
                      setNewWorkType(e.target.value);
                      clearIssue('workTypes');
                    }}
                  />
                  <label className="plan-settings__flag">
                    <input
                      type="checkbox"
                      data-catalog-new-parallel
                      checked={newParallel}
                      onChange={(e) => setNewParallel(e.target.checked)}
                    />
                    Можно параллельно
                  </label>
                  <button
                    type="submit"
                    className="task-editor__button"
                    data-catalog-add="workType"
                    aria-label="Добавить тип работы"
                    title="Добавить тип работы"
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                  {issueText('workTypes', 'new')}
                </form>
              </>
            )}
            {id === 'absences' && (
              <>
                <p className="task-editor__preview">
                  Отпуска и другие периоды недоступности ресурса. Даты задач
                  сохраняются.
                </p>
                {plan.unavailability.length === 0 && (
                  <p className="task-editor__preview">
                    Периодов недоступности нет.
                  </p>
                )}
                <ul className="plan-settings__list">
                  {plan.unavailability.map((a) => (
                    <li
                      key={a.id}
                      className="plan-settings__item"
                      data-absence-row={a.id}
                    >
                      {editingAbsence?.id === a.id ? (
                        <div
                          className="plan-settings__absence-edit"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingAbsence(null);
                              clearIssue('absences');
                            }
                          }}
                        >
                          <AbsenceFields
                            value={editingAbsence}
                            onChange={(value) =>
                              setEditingAbsence({ ...value, id: a.id })
                            }
                            resources={plan.resources}
                            title={resourceTitle}
                            kind="edit"
                          />
                          <button
                            type="button"
                            className="task-editor__button"
                            aria-label="Сохранить период"
                            onClick={() => saveAbsence(editingAbsence, a.id)}
                          >
                            <Check size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="task-editor__button"
                            aria-label="Отменить изменение периода"
                            onClick={() => {
                              setEditingAbsence(null);
                              clearIssue('absences');
                            }}
                          >
                            <X size={16} aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="plan-settings__period">
                            <span>{resourceTitle(a.resourceId)}</span>
                            <span>
                              {dateLabel(a.start)} — {dateLabel(a.end)}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="task-editor__button plan-settings__remove"
                            aria-label="Изменить период"
                            title="Изменить период"
                            disabled={editingAbsence !== null}
                            onClick={() => {
                              setEditingAbsence({
                                id: a.id,
                                resourceId: a.resourceId,
                                start: a.start,
                                end: a.end,
                              });
                              clearIssue('absences');
                            }}
                          >
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                          {removeButton(
                            `Удалить период ${resourceTitle(a.resourceId)} ${dateLabel(a.start)} — ${dateLabel(a.end)}`,
                            () => {
                              if (
                                window.confirm(
                                  `Удалить период недоступности «${resourceTitle(a.resourceId)}: ${dateLabel(a.start)} — ${dateLabel(a.end)}» после сохранения настроек?`,
                                )
                              ) {
                                const error = apply({
                                  type: 'deleteUnavailability',
                                  unavailabilityId: a.id,
                                });
                                if (error)
                                  showIssue('absences', a.id, error.message);
                                else clearIssue('absences');
                              }
                            },
                          )}
                        </>
                      )}
                      {issueText('absences', a.id)}
                    </li>
                  ))}
                </ul>
                <form
                  className="plan-settings__absence-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveAbsence(newAbsence);
                  }}
                >
                  <AbsenceFields
                    value={newAbsence}
                    onChange={(value) => {
                      setNewAbsence(value);
                      clearIssue('absences');
                    }}
                    resources={plan.resources}
                    title={resourceTitle}
                    kind="new"
                  />
                  <button
                    type="submit"
                    className="task-editor__button"
                    data-absence-add
                  >
                    <Plus size={16} aria-hidden="true" />
                    Добавить отпуск
                  </button>
                  {issueText('absences', 'new')}
                </form>
              </>
            )}
            {id === 'calendar' && (
              <>
                {issueText('calendar', 'pending')}
                <PlanCalendarSection
                  calendar={plan.calendar}
                  inputs={calendarInputs}
                  onInputsChange={(value) => {
                    setCalendarInputs(value);
                    clearIssue('calendar');
                  }}
                  onApply={(workingDays, holidays, workingExceptions) =>
                    apply({
                      type: 'updateCalendar',
                      workingDays,
                      holidays,
                      workingExceptions,
                    })
                  }
                />
              </>
            )}
          </section>
        ))}
      </div>
      <footer className="task-editor__foot plan-settings__foot">
        <p className="task-editor__preview">
          {hasChanges ? 'Изменения пока не сохранены' : 'Настройки плана'}
        </p>
        <div className="task-editor__foot-spacer" />
        <button
          type="button"
          className="task-editor__button"
          data-catalog-close
          onClick={cancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className="task-editor__button task-editor__button--primary"
          data-catalog-save
          disabled={stale}
          onClick={save}
        >
          Сохранить настройки
        </button>
      </footer>
    </PlanDialog>
  );
}

function AbsenceFields({
  value,
  onChange,
  resources,
  title,
  kind,
}: {
  value: AbsenceInput;
  onChange: (value: AbsenceInput) => void;
  resources: PlanContent['resources'];
  title: (id: string) => string;
  kind: 'new' | 'edit';
}) {
  return (
    <div className="plan-settings__absence-fields">
      <label>
        Исполнитель
        <select
          value={value.resourceId}
          data-absence-new={kind === 'new' ? 'resource' : undefined}
          data-absence-edit={kind === 'edit' ? 'resource' : undefined}
          onChange={(e) => onChange({ ...value, resourceId: e.target.value })}
        >
          <option value="">Выберите ресурс</option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {title(r.id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        С
        <input
          type="date"
          value={value.start}
          data-absence-new={kind === 'new' ? 'start' : undefined}
          data-absence-edit={kind === 'edit' ? 'start' : undefined}
          onChange={(e) => onChange({ ...value, start: e.target.value })}
        />
      </label>
      <label>
        По
        <input
          type="date"
          value={value.end}
          data-absence-new={kind === 'new' ? 'end' : undefined}
          data-absence-edit={kind === 'edit' ? 'end' : undefined}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
        />
      </label>
    </div>
  );
}
