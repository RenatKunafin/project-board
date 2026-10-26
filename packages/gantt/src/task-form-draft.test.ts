import { describe, expect, it, vi } from 'vitest';
import type { DocumentService, ManagedDocument } from '@project-board/widget-sdk';
import { createPlanContent, type PlanContent } from './plan-document';
import { prepareTaskForm, taskDuration, type TaskEditorSubmit } from './task-form-draft';
import { writeTaskSession } from './task-form-session';

const plan: PlanContent = {
  ...createPlanContent(),
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: ['2026-10-14'], workingExceptions: [] },
  resources: [{ id: 'r', title: 'QA' }], workTypes: [{ id: 'w', title: 'ПСИ', allowsParallel: true }],
  groups: [{ id: 'g', title: 'Группа' }],
  tasks: [
    { id: 'a', title: 'A', start: '2026-10-12', end: '2026-10-17' },
    { id: 'b', title: 'B', start: '2026-10-17', end: '2026-10-18', groupId: 'g', assigneeIds: ['r'], notes: 'Импорт' } as PlanContent['tasks'][number],
    { id: 'c', title: 'C', start: '2026-10-19', end: '2026-10-20' },
  ],
  dependencies: [{ id: 'ab', fromTaskId: 'a', toTaskId: 'b', lagDays: 0 }, { id: 'bc', fromTaskId: 'b', toTaskId: 'c', lagDays: 0 }],
};
const session = { plan, revision: 5, taskId: 'b' };
const input: TaskEditorSubmit = { title: 'B', groupId: 'g', start: '2026-10-17', durationDays: 0, assigneeIds: ['r'], workTypeIds: [], predecessors: [{ fromTaskId: 'a', lagDays: 0 }] };

describe('единый результат формы задачи', () => {
  it('поля, назначения и лаг одной задачей; ID связей, исходящие связи и импортные поля сохранены', () => {
    const result = prepareTaskForm(session, { ...input, title: 'Новое имя', groupId: undefined, workTypeIds: ['w'], predecessors: [{ fromTaskId: 'a', lagDays: 2 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[1]).toEqual({ ...plan.tasks[1], title: 'Новое имя', groupId: undefined, workTypeIds: ['w'] });
    expect(result.plan.tasks[0]).toEqual(plan.tasks[0]);
    expect(result.plan.tasks[2]).toEqual(plan.tasks[2]);
    expect(result.plan.dependencies).toEqual([{ ...plan.dependencies[0], lagDays: 2 }, plan.dependencies[1]]);
    expect(plan.tasks[1].title).toBe('B');
    expect(plan.dependencies[0].lagDays).toBe(0);
  });
  it('no-op сохраняет исходный план и нулевой ручной интервал', () => {
    expect(taskDuration(plan.tasks[1], plan)).toBe(0);
    expect(prepareTaskForm(session, input)).toEqual({ ok: true, plan });
    const result = prepareTaskForm(session, input);
    expect(result.ok && result.plan).toBe(plan);
  });
  it('переименование сохраняет нерабочее окончание', () => {
    const result = prepareTaskForm({ ...session, taskId: 'a' }, { ...input, groupId: undefined, title: 'Новое A', start: '2026-10-12', durationDays: 4, assigneeIds: [], predecessors: [] });
    expect(result.ok && result.plan.tasks[0]).toEqual({ ...plan.tasks[0], title: 'Новое A' });
  });
  it('изменение срока учитывает праздник, остальные даты не меняются', () => {
    const result = prepareTaskForm(session, { ...input, start: '2026-10-12', durationDays: 3 });
    expect(result.ok && result.plan.tasks[1]).toMatchObject({ start: '2026-10-12', end: '2026-10-15' });
  });
  it('создаёт задачу вместе с несколькими предшественниками', () => {
    const result = prepareTaskForm({ plan, revision: 5 }, { ...input, durationDays: 1, predecessors: [{ fromTaskId: 'a', lagDays: 0 }, { fromTaskId: 'c', lagDays: 2 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = result.plan.tasks[3];
    expect(result.plan.dependencies.slice(2)).toEqual([
      { id: expect.any(String), fromTaskId: 'a', toTaskId: task.id, lagDays: 0 },
      { id: expect.any(String), fromTaskId: 'c', toTaskId: task.id, lagDays: 2 },
    ]);
    expect(plan.tasks).toHaveLength(3);
  });
  it.each([
    { predecessors: [{ fromTaskId: 'c', lagDays: 0 }] },
    { predecessors: [{ fromTaskId: 'b', lagDays: 0 }] },
    { predecessors: [{ fromTaskId: 'a', lagDays: 1.5 }] },
    { predecessors: [{ fromTaskId: 'a', lagDays: -1 }] },
    { predecessors: [{ fromTaskId: 'missing', lagDays: 0 }] },
    { assigneeIds: ['missing'] },
    { workTypeIds: ['missing'] },
  ])('ошибка всего результата без промежуточной записи: %j', patch => {
    const before = structuredClone(plan);
    expect(prepareTaskForm(session, { ...input, title: 'Черновик', ...patch }).ok).toBe(false);
    expect(plan).toEqual(before);
  });
  it('удаление входящей связи сохраняет исходящую; отсутствующая задача не создаётся заново', () => {
    const result = prepareTaskForm(session, { ...input, predecessors: [] });
    expect(result.ok && result.plan.dependencies).toEqual([plan.dependencies[1]]);
    expect(prepareTaskForm({ ...session, taskId: 'missing' }, input)).toMatchObject({ ok: false, issue: { field: 'document' } });
  });
});

describe('запись снимка формы', () => {
  const latest = { id: 'doc', revision: 5, content: plan } as unknown as ManagedDocument;
  function service(value: ManagedDocument | undefined = latest) {
    return { get: vi.fn(() => value), update: vi.fn() } as unknown as Pick<DocumentService, 'get' | 'update'>;
  }
  it('успех — одна запись по исходной revision; no-op не пишет', () => {
    const sdk = service();
    expect(writeTaskSession(sdk, 'doc', session, () => ({ ok: true, plan }))).toBeUndefined();
    expect(sdk.update).not.toHaveBeenCalled();
    const next = { ...plan, title: 'Новый' };
    expect(writeTaskSession(sdk, 'doc', session, () => ({ ok: true, plan: next }))).toBeUndefined();
    expect(sdk.update).toHaveBeenCalledExactlyOnceWith('doc', 5, next);
  });
  it('конфликт и удаление останавливают подготовку без записи', () => {
    const mutate = vi.fn(() => ({ ok: true as const, plan }));
    for (const doc of [undefined, { ...latest, revision: 6 }, { ...latest, content: { ...plan, tasks: [] } }]) {
      const sdk = service(); vi.mocked(sdk.get).mockReturnValue(doc as ManagedDocument);
      expect(writeTaskSession(sdk, 'doc', session, mutate)).toBeTruthy();
      expect(sdk.update).not.toHaveBeenCalled();
    }
    expect(mutate).not.toHaveBeenCalled();
  });
  it('ошибка SDK возвращается без ретрая', () => {
    const sdk = service(); vi.mocked(sdk.update).mockImplementation(() => { throw new Error('Ошибка записи'); });
    expect(writeTaskSession(sdk, 'doc', session, () => ({ ok: true, plan: { ...plan } }))).toBe('Ошибка записи');
    expect(sdk.update).toHaveBeenCalledTimes(1);
  });
});
