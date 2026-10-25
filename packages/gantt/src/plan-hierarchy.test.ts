import { describe, expect, it } from 'vitest';
import { createPlanContent, type PlanContent } from './plan-document';
import {
  applyPlanCommand,
  setTaskDates,
  updateTask,
  type PlanCommandResult,
} from './plan-commands';
import {
  childGroups,
  childTasks,
  createGroup,
  deleteGroup,
  groupSummaryBounds,
  updateGroup,
} from './plan-hierarchy';

function buildPlan(): PlanContent {
  const plan = createPlanContent('Иерархия');
  return {
    ...plan,
    groups: [
      { id: 'g-okad', title: 'ОКАД' },
      { id: 'g-ios', title: 'iOS', parentId: 'g-okad' },
      { id: 'g-android', title: 'Android', parentId: 'g-okad' },
      { id: 'g-dev', title: 'Разработка', parentId: 'g-ios' },
    ],
    tasks: [
      { id: 't-1', title: 'ИФТ', groupId: 'g-ios', start: '2026-10-12', end: '2026-10-16' },
      { id: 't-2', title: 'Разработка', groupId: 'g-android', start: '2026-10-19', end: '2026-10-23' },
      { id: 't-3', title: 'Анализ', groupId: 'g-dev', start: '2026-10-05', end: '2026-10-09' },
      { id: 't-4', title: 'Отчёт', groupId: 'g-okad', start: '2026-11-02', end: '2026-11-06' },
    ],
    dependencies: [{ id: 'd-1', fromTaskId: 't-3', toTaskId: 't-1', lagDays: 0 }],
  };
}

function expectOk(result: PlanCommandResult): PlanContent {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('ожидался успешный результат');
  }
  return result.plan;
}

function expectError(result: PlanCommandResult, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('ожидалось отклонение');
  }
  expect(result.error.code).toBe(code);
  expect(result.error.message).not.toBe('');
}

describe('createGroup', () => {
  it('создаёт подгруппу третьего уровня в конец массива', () => {
    const plan = buildPlan();
    const next = expectOk(createGroup(plan, { title: 'ИФТ', parentId: 'g-dev' }));
    expect(next.groups).toHaveLength(5);
    const created = next.groups[4];
    expect(created.title).toBe('ИФТ');
    expect(created.parentId).toBe('g-dev');
    expect(created.id).not.toBe('');
    expect(next.groups[0]).toEqual(plan.groups[0]);
    expect(next.tasks).toEqual(plan.tasks);
  });

  it('создаёт корневую группу без parentId', () => {
    const plan = buildPlan();
    const next = expectOk(createGroup(plan, { title: 'БЧ' }));
    const created = next.groups[4];
    expect(created.parentId).toBeUndefined();
    expect('parentId' in created).toBe(false);
  });

  it('неизвестный родитель отклоняется целиком', () => {
    const plan = buildPlan();
    expectError(createGroup(plan, { title: 'X', parentId: 'g-404' }), 'unknown-group');
    expect(plan).toEqual(buildPlan());
  });
});

describe('updateGroup', () => {
  it('переименование не трогает дочерние и порядок', () => {
    const plan = buildPlan();
    const next = expectOk(updateGroup(plan, 'g-ios', { title: 'iOS 2' }));
    expect(next.groups.map((group) => group.id)).toEqual([
      'g-okad',
      'g-ios',
      'g-android',
      'g-dev',
    ]);
    expect(next.groups[1].title).toBe('iOS 2');
    const dev = next.groups.find((group) => group.id === 'g-dev');
    expect(dev?.parentId).toBe('g-ios');
  });

  it('отсутствующие свойства патча не меняют поля', () => {
    const plan = buildPlan();
    const next = expectOk(updateGroup(plan, 'g-ios', { title: 'iOS 2' }));
    expect(next.groups[1].parentId).toBe('g-okad');
  });

  it('перенос подгруппы между группами ставит её в конец массива', () => {
    const plan = buildPlan();
    const next = expectOk(updateGroup(plan, 'g-dev', { parentId: 'g-android' }));
    expect(next.groups.map((group) => group.id)[3]).toBe('g-dev');
    const dev = next.groups.find((group) => group.id === 'g-dev');
    expect(dev?.parentId).toBe('g-android');
  });

  it('перенос задачи между группами ставит её в конец массива задач', () => {
    const plan = buildPlan();
    const next = expectOk(updateTask(plan, 't-1', { groupId: 'g-android' }));
    const task = next.tasks.find((entry) => entry.id === 't-1');
    expect(task?.groupId).toBe('g-android');
    expect(next.tasks).toHaveLength(4);
  });

  it('вынос группы на корень убирает parentId', () => {
    const plan = buildPlan();
    const next = expectOk(updateGroup(plan, 'g-ios', { parentId: undefined }));
    const ios = next.groups.find((group) => group.id === 'g-ios');
    expect(ios?.parentId).toBeUndefined();
    expect('parentId' in (ios as object)).toBe(false);
  });

  it('перенос группы в собственного потомка отклоняется без изменения документа', () => {
    const plan = buildPlan();
    expectError(updateGroup(plan, 'g-ios', { parentId: 'g-dev' }), 'circular-group');
    expect(plan).toEqual(buildPlan());
  });

  it('перенос группы в саму себя отклоняется', () => {
    const plan = buildPlan();
    expectError(updateGroup(plan, 'g-ios', { parentId: 'g-ios' }), 'circular-group');
  });

  it('перенос корня в подгруппу второго уровня отклоняется', () => {
    const plan = buildPlan();
    expectError(updateGroup(plan, 'g-okad', { parentId: 'g-dev' }), 'circular-group');
    expect(plan).toEqual(buildPlan());
  });

  it('неизвестная группа и неизвестный новый родитель отклоняются', () => {
    const plan = buildPlan();
    expectError(updateGroup(plan, 'g-404', { title: 'X' }), 'unknown-group');
    expectError(updateGroup(plan, 'g-ios', { parentId: 'g-404' }), 'unknown-group');
  });
});

describe('deleteGroup — вариант A: содержимое сохраняется', () => {
  it('прямые потомки группы переезжают к её родителю', () => {
    const plan = buildPlan();
    const next = expectOk(deleteGroup(plan, 'g-ios'));
    expect(next.groups.map((group) => group.id)).toEqual([
      'g-okad',
      'g-android',
      'g-dev',
    ]);
    const dev = next.groups.find((group) => group.id === 'g-dev');
    expect(dev?.parentId).toBe('g-okad');
    const task = next.tasks.find((entry) => entry.id === 't-1');
    expect(task?.groupId).toBe('g-okad');
    expect(next.dependencies).toEqual(plan.dependencies);
  });

  it('удаление подгруппы возвращает задачи группе верхнего уровня', () => {
    const plan = buildPlan();
    const next = expectOk(deleteGroup(plan, 'g-dev'));
    const task = next.tasks.find((entry) => entry.id === 't-3');
    expect(task?.groupId).toBe('g-ios');
    expect(next.dependencies).toEqual(plan.dependencies);
  });

  it('удаление корневой группы выносит прямых потомков в корень плана', () => {
    const plan = buildPlan();
    const next = expectOk(deleteGroup(plan, 'g-okad'));
    const ios = next.groups.find((group) => group.id === 'g-ios');
    const android = next.groups.find((group) => group.id === 'g-android');
    expect(ios?.parentId).toBeUndefined();
    expect(android?.parentId).toBeUndefined();
    expect('parentId' in (ios as object)).toBe(false);
    const report = next.tasks.find((entry) => entry.id === 't-4');
    expect(report?.groupId).toBeUndefined();
    expect('groupId' in (report as object)).toBe(false);
    expect(next.dependencies).toEqual(plan.dependencies);
  });

  it('удаление пустой группы меняет только коллекцию групп', () => {
    const plan = expectOk(createGroup(buildPlan(), { title: 'Пустая' }));
    const next = expectOk(deleteGroup(plan, plan.groups[4].id));
    expect(next.groups).toHaveLength(4);
    expect(next.tasks).toEqual(plan.tasks);
  });

  it('неизвестная группа отклоняется', () => {
    const plan = buildPlan();
    expectError(deleteGroup(plan, 'g-404'), 'unknown-group');
  });
});

describe('groupSummaryBounds — сводные сроки (B1/B2/B3)', () => {
  it('сводный интервал по крайним датам всех вложенных, включая подгруппы', () => {
    const plan = buildPlan();
    expect(groupSummaryBounds(plan, 'g-okad')).toEqual({
      start: '2026-10-05',
      end: '2026-11-06',
    });
    expect(groupSummaryBounds(plan, 'g-ios')).toEqual({
      start: '2026-10-05',
      end: '2026-10-16',
    });
    expect(groupSummaryBounds(plan, 'g-dev')).toEqual({
      start: '2026-10-05',
      end: '2026-10-09',
    });
  });

  it('пустая группа не имеет сводного интервала', () => {
    let plan = expectOk(createGroup(buildPlan(), { title: 'Пустая' }));
    const emptyId = plan.groups[4].id;
    expect(groupSummaryBounds(plan, emptyId)).toBeUndefined();
    plan = expectOk(deleteGroup(plan, emptyId));
    expect(groupSummaryBounds(plan, emptyId)).toBeUndefined();
  });

  it('сводные пересчитываются после изменения дат задачи', () => {
    const plan = expectOk(
      setTaskDates(buildPlan(), 't-2', { start: '2026-11-09', end: '2026-11-13' }),
    );
    expect(groupSummaryBounds(plan, 'g-okad')).toEqual({
      start: '2026-10-05',
      end: '2026-11-13',
    });
    expect(groupSummaryBounds(plan, 'g-android')).toEqual({
      start: '2026-11-09',
      end: '2026-11-13',
    });
  });

  it('сводные обеих групп пересчитываются после переноса задачи', () => {
    const plan = expectOk(updateTask(buildPlan(), 't-2', { groupId: 'g-ios' }));
    expect(groupSummaryBounds(plan, 'g-android')).toBeUndefined();
    expect(groupSummaryBounds(plan, 'g-ios')).toEqual({
      start: '2026-10-05',
      end: '2026-10-23',
    });
  });

  it('сводные пересчитываются после переноса подгруппы', () => {
    const plan = expectOk(updateGroup(buildPlan(), 'g-dev', { parentId: 'g-android' }));
    expect(groupSummaryBounds(plan, 'g-ios')).toEqual({
      start: '2026-10-12',
      end: '2026-10-16',
    });
    expect(groupSummaryBounds(plan, 'g-android')).toEqual({
      start: '2026-10-05',
      end: '2026-10-23',
    });
  });

  it('прямые потомки доступны помощниками', () => {
    const plan = buildPlan();
    expect(childGroups(plan, 'g-okad').map((group) => group.id)).toEqual([
      'g-ios',
      'g-android',
    ]);
    expect(childTasks(plan, 'g-ios').map((task) => task.id)).toEqual(['t-1']);
    expect(childTasks(plan, 'g-dev').map((task) => task.id)).toEqual(['t-3']);
  });

  it('сводные не хранятся в документе', () => {
    const plan = buildPlan();
    groupSummaryBounds(plan, 'g-okad');
    expect(plan).toEqual(buildPlan());
  });
});

describe('applyPlanCommand — групповые команды через единый путь', () => {
  it('применяет create → update → delete через диспетчер', () => {
    const plan = buildPlan();
    const created = expectOk(
      applyPlanCommand(plan, { type: 'createGroup', input: { title: 'ИФТ', parentId: 'g-ios' } }),
    );
    const createdId = created.groups[4].id;
    const renamed = expectOk(
      applyPlanCommand(created, {
        type: 'updateGroup',
        groupId: createdId,
        patch: { title: 'ИФТ 2' },
      }),
    );
    expect(renamed.groups[4].title).toBe('ИФТ 2');
    const moved = expectOk(
      applyPlanCommand(renamed, {
        type: 'updateGroup',
        groupId: createdId,
        patch: { parentId: 'g-android' },
      }),
    );
    expect(moved.groups[4].parentId).toBe('g-android');
    const deleted = expectOk(
      applyPlanCommand(moved, { type: 'deleteGroup', groupId: createdId }),
    );
    expect(deleted.groups).toHaveLength(4);
  });

  it('отклонённая групповая команда не меняет план', () => {
    const plan = buildPlan();
    const result = applyPlanCommand(plan, {
      type: 'updateGroup',
      groupId: 'g-ios',
      patch: { parentId: 'g-dev' },
    });
    expectError(result, 'circular-group');
    expect(plan).toEqual(buildPlan());
  });
});
