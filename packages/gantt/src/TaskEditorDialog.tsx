import { useEffect, useRef, useState } from 'react';
import type { PlanContent, PlanTask } from './plan-document';
import { buildTaskDates, type TaskFormIssue } from './task-editor';
import { taskDuration, type TaskEditorSubmit, type TaskFormSession } from './task-form-draft';
import { TaskColorSwatches } from './task-color-picker';
import PlanDialog, { type PlanDialogOwner } from './PlanDialog';
import './task-editor.css';

interface TaskEditorDialogProps {
  readonly owner: PlanDialogOwner;
  readonly plan: PlanContent;
  readonly revision: number;
  readonly mode: 'create' | 'edit';
  readonly task?: PlanTask;
  readonly onSubmit: (submit: TaskEditorSubmit, session: TaskFormSession) => TaskFormIssue | undefined;
  readonly onDelete?: (session: TaskFormSession) => string | undefined;
  readonly onConvertToAbsence?: (session: TaskFormSession) => void;
  readonly onClose: () => void;
}

/** Снимок обновляется только явным перечитыванием; props не затирают ввод. */
export default function TaskEditorDialog(props: TaskEditorDialogProps) {
  const [session, setSession] = useState<TaskFormSession>(() => ({
    plan: props.plan, revision: props.revision,
    ...(props.mode === 'edit' ? { taskId: props.task?.id ?? '' } : {}),
  }));
  const missing = props.mode === 'edit' && !props.plan.tasks.some(task => task.id === session.taskId);
  const conflict = missing ? 'Исходная задача удалена. Закройте форму.' :
    props.revision !== session.revision ? 'План изменён в другом представлении. Перечитайте план.' : undefined;
  return <TaskEditorForm {...props} key={session.revision} session={session} conflict={conflict}
    onReload={missing ? undefined : () => setSession({ ...session, plan: props.plan, revision: props.revision })} />;
}

function TaskEditorForm({ owner, mode, onSubmit, onDelete, onConvertToAbsence, onClose,
  session, conflict, onReload,
}: TaskEditorDialogProps & { session: TaskFormSession; conflict?: string; onReload?: () => void }) {
  const plan = session.plan;
  const task = plan.tasks.find(entry => entry.id === session.taskId);
  const initialDuration = task ? String(taskDuration(task, plan)) : '1';
  const initial = {
    title: task?.title ?? '', groupId: task?.groupId ?? '', start: task?.start ?? '', duration: initialDuration,
    color: task?.color,
    assigneeIds: [...(task?.assigneeIds ?? [])], workTypeIds: [...(task?.workTypeIds ?? [])],
    predecessors: plan.dependencies.filter(dep => dep.toTaskId === session.taskId)
      .map(dep => ({ fromTaskId: dep.fromTaskId, lagDays: dep.lagDays })),
  };
  const [draft, setDraft] = useState(initial);
  const [issue, setIssue] = useState<TaskFormIssue>();
  const [newDepFrom, setNewDepFrom] = useState('');
  const [newDepLag, setNewDepLag] = useState('0');
  const [editingDep, setEditingDep] = useState<{ id: string; lag: string } | null>(null);
  const [depSearch, setDepSearch] = useState('');
  const formRef = useRef<HTMLDivElement>(null);
  const patch = (value: Partial<typeof draft>) => setDraft(current => ({ ...current, ...value }));
  const pending = newDepFrom !== '' || newDepLag !== '0' || editingDep !== null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || pending;
  const allowDiscard = () => !dirty || window.confirm('Отбросить несохранённые изменения задачи?');
  const close = () => { if (allowDiscard()) onClose(); };
  useEffect(() => { formRef.current?.querySelector<HTMLInputElement>('[data-task-field="title"]')?.focus(); }, []);
  useEffect(() => {
    if (!issue) return;
    const selector = issue.field === 'dependencies' ? '[data-dep-lag-input], [data-dep-new-from]' :
      issue.field === 'document' ? '[data-task-document-error]' :
      issue.field === 'assignments' ? '[data-task-assignees] input, [data-task-worktypes] input' :
      `[data-task-field="${issue.field}"]`;
    const element = formRef.current?.querySelector<HTMLElement>(selector);
    element?.focus();
    element?.scrollIntoView({ block: 'nearest' });
  }, [issue]);
  const showError = (field: TaskFormIssue['field'], message: string) => setIssue({ field, message });
  const depError = (message: string) => showError('dependencies', message);
  const parseLag = (value: string) => value.trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
  const addDependency = () => {
    if (!newDepFrom) { depError('Выберите задачу-предшественника.'); return; }
    const lagDays = parseLag(newDepLag);
    if (lagDays === undefined) { depError('Лаг — целое число рабочих дней не меньше нуля.'); return; }
    if (draft.predecessors.some(dep => dep.fromTaskId === newDepFrom)) { depError('Предшественник уже выбран. Измените лаг существующей связи.'); return; }
    patch({ predecessors: [...draft.predecessors, { fromTaskId: newDepFrom, lagDays }] });
    setNewDepFrom(''); setNewDepLag('0'); setIssue(undefined);
  };
  const saveLag = () => {
    if (!editingDep) return;
    const lagDays = parseLag(editingDep.lag);
    if (lagDays === undefined) { depError('Лаг — целое число рабочих дней не меньше нуля.'); return; }
    patch({ predecessors: draft.predecessors.map(dep => dep.fromTaskId === editingDep.id ? { ...dep, lagDays } : dep) });
    setEditingDep(null); setIssue(undefined);
  };
  let endPreview = task?.end;
  const datesChanged = draft.start !== initial.start || draft.duration !== initial.duration;
  if (!task || datesChanged) {
    try { endPreview = draft.start && draft.duration.trim() && Number.isInteger(Number(draft.duration)) && Number(draft.duration) >= 1 ?
      buildTaskDates({ start: draft.start, durationDays: Number(draft.duration) }, plan).end : undefined;
    } catch { endPreview = undefined; }
  }
  const submit = () => {
    if (conflict) { showError('document', conflict); return; }
    if (pending) { depError('Завершите добавление/изменение связи или очистите ввод перед сохранением.'); return; }
    const result = onSubmit({
      title: draft.title, ...(draft.groupId ? { groupId: draft.groupId } : {}),
      start: draft.start, durationDays: draft.duration.trim() ? Number(draft.duration) : NaN,
      color: draft.color,
      assigneeIds: draft.assigneeIds, workTypeIds: draft.workTypeIds, predecessors: draft.predecessors,
    }, session);
    setIssue(result);
  };
  const error = (field: TaskFormIssue['field']) => issue?.field === field ?
    <span className="task-editor__error" role="alert">{issue.message}</span> : null;
  const toggle = (field: 'assigneeIds' | 'workTypeIds', id: string) => patch({ [field]: draft[field].includes(id) ? draft[field].filter(entry => entry !== id) : [...draft[field], id] });
  const depCandidates = plan.tasks.filter(entry => entry.title.toLocaleLowerCase().includes(depSearch.toLocaleLowerCase()));
  return <PlanDialog owner={owner} title={mode === 'create' ? 'Новая задача' : 'Редактирование задачи'}
    description="Изменения сохраняются вместе. Даты других задач не переносятся."
    closeLabel="Закрыть форму" className="task-editor" onClose={onClose} onBeforeClose={allowDiscard}>
    <div ref={formRef} className="task-editor__body plan-dialog__body" onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement &&
          event.target.dataset.taskField !== undefined) { event.preventDefault(); submit(); }
    }}>
      {(conflict || issue?.field === 'document') && <div tabIndex={-1} data-task-document-error className="task-editor__error" role="alert">
        {conflict ?? issue?.message}
        {conflict && onReload && <button type="button" className="task-editor__button" onClick={() => { if (allowDiscard()) onReload(); }}>Перечитать план</button>}
      </div>}
      <section className="task-editor__section" aria-label="Основное">
        <h4>Основное</h4>
        <label className="task-editor__field"><span className="task-editor__label">Название</span>
          <input type="text" value={draft.title} data-task-field="title" aria-invalid={issue?.field === 'title'} onChange={e => patch({ title: e.target.value })} />{error('title')}
        </label>
        <label className="task-editor__field"><span className="task-editor__label">Группа</span>
          <select value={draft.groupId} data-task-field="group" onChange={e => patch({ groupId: e.target.value })}>
            <option value="">Без группы</option>{plan.groups.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}
          </select>{error('group')}
        </label>
        <fieldset className="task-editor__field task-editor__color">
          <legend className="task-editor__label">Цвет</legend>
          <TaskColorSwatches value={draft.color} onPick={color => patch({ color })} />
        </fieldset>
      </section>
      <section className="task-editor__section" aria-label="Сроки">
        <h4>Сроки</h4>
        <div className="task-editor__row">
          <label className="task-editor__field"><span className="task-editor__label">Дата начала</span>
            <input type="date" value={draft.start} data-task-field="start" aria-invalid={issue?.field === 'start'} onChange={e => patch({ start: e.target.value })} />{error('start')}
          </label>
          <label className="task-editor__field"><span className="task-editor__label">Раб. дни</span>
            <input type="number" min={1} step={1} value={draft.duration} data-task-field="duration" aria-invalid={issue?.field === 'duration'} onChange={e => patch({ duration: e.target.value })} />{error('duration')}
          </label>
        </div>
        <p className="task-editor__preview" data-task-end-preview>Окончание (включительно): {endPreview ?? '—'}</p>
      </section>
      <section className="task-editor__section" aria-label="Назначения">
        <h4>Назначения</h4>
        <div className="task-editor__row">
          <AssignmentList title="Исполнители" entries={plan.resources} selected={draft.assigneeIds} kind="assignee" onToggle={id => toggle('assigneeIds', id)} />
          <AssignmentList title="Типы работы" entries={plan.workTypes} selected={draft.workTypeIds} kind="worktype" onToggle={id => toggle('workTypeIds', id)} />
        </div>{error('assignments')}
      </section>
      <section className="task-editor__section" aria-label="Зависимости">
        <h4>Зависимости</h4>
        <span className="task-editor__label">Предшественники (FS) · Выбрано: {draft.predecessors.length}</span>
        {!draft.predecessors.length && <p className="task-editor__preview">Нет предшественников.</p>}
        <ul className="task-editor__dependencies catalog__list" data-dep-list>
          {draft.predecessors.map(dep => {
            const from = plan.tasks.find(entry => entry.id === dep.fromTaskId);
            return <li key={dep.fromTaskId} className="catalog__row">
              <span className="catalog__title">{from?.title ?? '—'}{editingDep?.id === dep.fromTaskId ? '' : ` · лаг ${dep.lagDays} дн.`}</span>
              {editingDep?.id === dep.fromTaskId ? <>
                <input aria-label={`Лаг от ${from?.title}`} type="number" min={0} step={1} value={editingDep.lag} data-dep-lag-input
                  onChange={e => setEditingDep({ ...editingDep, lag: e.target.value })} onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); saveLag(); }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingDep(null); setIssue(undefined); }
                  }} />
                <button type="button" className="task-editor__button" aria-label="Сохранить лаг" onClick={saveLag}>✓</button>
                <button type="button" className="task-editor__button" aria-label="Отменить изменение лага" onClick={() => { setEditingDep(null); setIssue(undefined); }}>×</button>
              </> : <>
                <button type="button" className="task-editor__button" aria-label="Изменить лаг" onClick={() => { setEditingDep({ id: dep.fromTaskId, lag: String(dep.lagDays) }); setIssue(undefined); }}>Изменить</button>
                <button type="button" className="task-editor__button task-editor__button--danger" aria-label={`Удалить связь от ${from?.title ?? ''}`} onClick={() => patch({ predecessors: draft.predecessors.filter(entry => entry.fromTaskId !== dep.fromTaskId) })}>Удалить</button>
              </>}
            </li>;
          })}
        </ul>
        <label className="task-editor__field"><span className="task-editor__label">Поиск предшественников</span>
          <input type="search" value={depSearch} onChange={e => setDepSearch(e.target.value)} />
        </label>
        {!plan.tasks.length ? <p className="task-editor__preview">В плане пока нет задач-предшественников.</p> : <>
          {!depCandidates.length && <p className="task-editor__preview">Предшественники не найдены.</p>}
          <label className="task-editor__field"><span className="task-editor__label">Задача-предшественник</span>
            <select size={4} value={newDepFrom} data-dep-new-from onChange={e => setNewDepFrom(e.target.value)}>
              <option value="">Выберите задачу</option>
              {newDepFrom && !depCandidates.some(entry => entry.id === newDepFrom) && <option value={newDepFrom}>{plan.tasks.find(entry => entry.id === newDepFrom)?.title}</option>}
              {depCandidates.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
            </select>
          </label>
          <div className="task-editor__row task-editor__dependency-add">
            <label className="task-editor__field"><span className="task-editor__label">Лаг, рабочих дней</span>
              <input type="number" min={0} step={1} value={newDepLag} data-dep-new-lag onChange={e => setNewDepLag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDependency(); } }} />
            </label>
            <button type="button" className="task-editor__button" data-dep-add onClick={addDependency}>Добавить</button>
            <button type="button" className="task-editor__button" onClick={() => { setNewDepFrom(''); setNewDepLag('0'); setIssue(undefined); }}>Очистить ввод</button>
          </div>
        </>}
        {issue?.field === 'dependencies' && <p className="task-editor__error" role="alert" data-dep-error>{issue.message}</p>}
      </section>
    </div>
    <footer className="task-editor__foot">
      {mode === 'edit' && onDelete && <button type="button" className="task-editor__button task-editor__button--danger" data-task-delete disabled={!!conflict} onClick={() => {
        if (!window.confirm(`Удалить задачу «${task?.title}» вместе с назначениями и зависимостями?${dirty ? ' Несохранённые изменения будут отброшены.' : ''}`)) return;
        const failure = onDelete(session); if (failure) showError('document', failure);
      }}>Удалить</button>}
      {mode === 'edit' && onConvertToAbsence && <button type="button" className="task-editor__button" data-task-to-absence disabled={!!conflict} onClick={() => {
        if (!allowDiscard()) return;
        setDraft(initial); setNewDepFrom(''); setNewDepLag('0'); setEditingDep(null); setIssue(undefined);
        onConvertToAbsence(session);
      }}>В отпуск…</button>}
      <div className="task-editor__foot-spacer" />
      <button type="button" className="task-editor__button" data-task-cancel onClick={close}>Отмена</button>
      <button type="button" className="task-editor__button task-editor__button--primary" data-task-save disabled={!!conflict} onClick={submit}>Сохранить</button>
    </footer>
  </PlanDialog>;
}

function AssignmentList({ title, entries, selected, kind, onToggle }: {
  title: string; entries: readonly { id: string; title: string }[]; selected: readonly string[];
  kind: 'assignee' | 'worktype'; onToggle: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const matching = entries.filter(entry => entry.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <fieldset className="task-editor__field task-editor__assignment">
    <legend className="task-editor__label">{title} · Выбрано: {selected.length}</legend>
    <label className="task-editor__field"><span className="task-editor__label">Поиск: {title.toLocaleLowerCase()}</span>
      <input type="search" value={search} onChange={e => setSearch(e.target.value)} />
    </label>
    {!entries.length ? <p className="task-editor__preview">Справочник пуст — добавьте в «Настройках плана».</p> : <>
      <div className="task-editor__selected" aria-label={`Выбрано: ${title.toLocaleLowerCase()}`}>
        {entries.filter(entry => selected.includes(entry.id)).map(entry => <button type="button" className="task-editor__chip" key={entry.id} aria-label={`Снять выбор: ${entry.title}`} onClick={() => onToggle(entry.id)}>{entry.title} ×</button>)}
      </div>
      <div className="task-editor__checks" {...(kind === 'assignee' ? { 'data-task-assignees': '' } : { 'data-task-worktypes': '' })}>
        {!matching.length && <p className="task-editor__preview">Ничего не найдено.</p>}
        {matching.map(entry => <label key={entry.id} className="task-editor__check">
          <input type="checkbox" checked={selected.includes(entry.id)} {...(kind === 'assignee' ? { 'data-task-assignee': entry.title } : { 'data-task-worktype': entry.title })} onChange={() => onToggle(entry.id)} />{entry.title}
        </label>)}
      </div>
    </>}
  </fieldset>;
}
