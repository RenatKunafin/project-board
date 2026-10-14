import { describe, expect, it } from 'vitest';
import { createPlanContent, parsePlanContent, type PlanContent } from './plan-document';
import {
  applyPlanCommand,
  createTask,
  deleteTask,
  moveTask,
  setTaskDates,
  setTaskDuration,
  updateTask,
  type PlanCommandResult,
} from './plan-commands';

function buildPlan(): PlanContent {
  const plan = createPlanContent('Тестовый план');
  return {
    ...plan,
    workTypes: [
      { id: 'wt-dev', title: 'Разработка', allowsParallel: false },
      { id: 'wt-psi', title: 'ПСИ', allowsParallel: true },
    ],
    resources: [
      { id: 'r-qa', title: 'QA' },
      { id: 'r-qa2', title: 'QA2' },
    ],
    groups: [{ id: 'g-ios', title: 'iOS' }],
    tasks: [
      {
        id: 't-a',
        title: 'Анализ',
        groupId: 'g-ios',
        start: '2026-10-12',
        end: '2026-10-16',
        assigneeIds: ['r-qa'],
        workTypeIds: ['wt-dev'],
      },
      { id: 't-b', title: 'Разработка', start: '2026-10-19', end: '2026-10-23' },
    ],
    dependencies: [{ id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 }],
    unavailability: [
      { id: 'u-1', resourceId: 'r-qa2', start: '2026-10-20', end: '2026-10-21' },
    ],
  };
}

function expectOk(result: PlanCommandResult): PlanContent {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('ожидался успешный результат');
  }
  return result.plan;
}

function expectError(
  result: PlanCommandResult,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('ожидалось отклонение');
  }
  expect(result.error.code).toBe(code);
  expect(result.error.message).not.toBe('');
}

describe('createTask', () => {
  it('создаёт задачу с уникальным id, соседние задачи и зависимости не изменены', () => {
    const plan = buildPlan();
    const result = createTask(plan, {
      title: 'ИФТ',
      start: '2026-10-26',
      end: '2026-10-28',
      assigneeIds: ['r-qa2'],
    });
    const next = expectOk(result);
    expect(next.tasks).toHaveLength(3);
    const created = next.tasks[2];
    expect(created.title).toBe('ИФТ');
    expect(created.id).not.toBe('');
    expect(created.id).not.toBe('t-a');
    expect(created.id).not.toBe('t-b');
    expect(next.tasks[0]).toEqual(plan.tasks[0]);
    expect(next.tasks[1]).toEqual(plan.tasks[1]);
    expect(next.dependencies).toEqual(plan.dependencies);
  });

  it('перевёрнутый интервал отклоняется целиком', () => {
    const plan = buildPlan();
    const result = createTask(plan, {
      title: 'ПСИ',
      start: '2026-10-16',
      end: '2026-10-12',
    });
    expectError(result, 'inverted-interval');
    expect(plan).toEqual(buildPlan());
  });

  it('неизвестные ссылки отклоняются по кодам', () => {
    const plan = buildPlan();
    expectError(
      createTask(plan, { title: 'X', start: '2026-10-12', end: '2026-10-12', groupId: 'g-404' }),
      'unknown-group',
    );
    expectError(
      createTask(plan, { title: 'X', start: '2026-10-12', end: '2026-10-12', assigneeIds: ['r-404'] }),
      'unknown-resource',
    );
    expectError(
      createTask(plan, { title: 'X', start: '2026-10-12', end: '2026-10-12', workTypeIds: ['wt-404'] }),
      'unknown-work-type',
    );
  });
});

describe('updateTask', () => {
  it('патч заменяет присутствующие поля, id и даты не меняются', () => {
    const plan = buildPlan();
    const next = expectOk(
      updateTask(plan, 't-a', { title: 'Анализ 2', assigneeIds: [] }),
    );
    const task = next.tasks.find((entry) => entry.id === 't-a');
    expect(task?.title).toBe('Анализ 2');
    expect(task?.assigneeIds).toEqual([]);
    expect(task?.id).toBe('t-a');
    expect(task?.start).toBe('2026-10-12');
    expect(task?.end).toBe('2026-10-16');
  });

  it('отсутствующие свойства патча не меняют поля', () => {
    const plan = buildPlan();
    const next = expectOk(updateTask(plan, 't-a', { title: 'Новое название' }));
    const task = next.tasks.find((entry) => entry.id === 't-a');
    expect(task?.groupId).toBe('g-ios');
    expect(task?.assigneeIds).toEqual(['r-qa']);
    expect(task?.workTypeIds).toEqual(['wt-dev']);
  });

  it('groupId: undefined выводит задачу из группы', () => {
    const plan = buildPlan();
    const next = expectOk(updateTask(plan, 't-a', { groupId: undefined }));
    const task = next.tasks.find((entry) => entry.id === 't-a');
    expect(task?.groupId).toBeUndefined();
    expect('groupId' in (task as object)).toBe(false);
  });

  it('неизвестная задача отклоняется, план не изменён', () => {
    const plan = buildPlan();
    expectError(updateTask(plan, 't-404', { title: 'X' }), 'unknown-task');
    expect(plan).toEqual(buildPlan());
  });

  it('неизвестные ссылки в патче отклоняются целиком', () => {
    const plan = buildPlan();
    expectError(
      updateTask(plan, 't-a', { title: 'X', groupId: 'g-404' }),
      'unknown-group',
    );
    expect(plan).toEqual(buildPlan());
  });
});

describe('deleteTask', () => {
  it('удаляет задачу и все зависимости с её участием', () => {
    const plan = buildPlan();
    const next = expectOk(deleteTask(plan, 't-a'));
    expect(next.tasks.map((task) => task.id)).toEqual(['t-b']);
    expect(next.dependencies).toEqual([]);
  });

  it('удаляет последователя цепочки вместе с его зависимостью', () => {
    const plan = buildPlan();
    const next = expectOk(deleteTask(plan, 't-b'));
    expect(next.tasks.map((task) => task.id)).toEqual(['t-a']);
    expect(next.dependencies).toEqual([]);
  });

  it('справочники и недоступности не затрагиваются', () => {
    const plan = buildPlan();
    const next = expectOk(deleteTask(plan, 't-a'));
    expect(next.groups).toEqual(plan.groups);
    expect(next.resources).toEqual(plan.resources);
    expect(next.workTypes).toEqual(plan.workTypes);
    expect(next.unavailability).toEqual(plan.unavailability);
  });

  it('неизвестная задача отклоняется', () => {
    const plan = buildPlan();
    expectError(deleteTask(plan, 't-404'), 'unknown-task');
  });
});

describe('setTaskDates — ручной ввод (A3/A6)', () => {
  it('ввод выходного интервала сохраняется как введён, рабочая длительность 0', () => {
    const plan = buildPlan();
    const next = expectOk(
      setTaskDates(plan, 't-a', { start: '2026-10-17', end: '2026-10-18' }),
    );
    const task = next.tasks.find((entry) => entry.id === 't-a');
    expect(task?.start).toBe('2026-10-17');
    expect(task?.end).toBe('2026-10-18');
  });

  it('праздник внутри интервала даёт длительность 4 без изменения дат', () => {
    const plan = buildPlan();
    const calendarPlan = expectOk(
      setTaskDates(plan, 't-a', { start: '2026-10-12', end: '2026-10-16' }),
    );
    const task = calendarPlan.tasks.find((entry) => entry.id === 't-a');
    expect(task?.start).toBe('2026-10-12');
    expect(task?.end).toBe('2026-10-16');
  });

  it('перевёрнутый интервал отклоняется целиком', () => {
    const plan = buildPlan();
    expectError(
      setTaskDates(plan, 't-a', { start: '2026-10-16', end: '2026-10-12' }),
      'inverted-interval',
    );
    expect(plan).toEqual(buildPlan());
  });

  it('неизвестная задача отклоняется', () => {
    const plan = buildPlan();
    expectError(
      setTaskDates(plan, 't-404', { start: '2026-10-12', end: '2026-10-16' }),
      'unknown-task',
    );
  });
});

describe('moveTask — перенос (A2)', () => {
  it('перенос недели вперёд сохраняет рабочую длительность', () => {
    const plan = buildPlan();
    const next = expectOk(moveTask(plan, 't-a', '2026-10-19'));
    const task = next.tasks.find((entry) => entry.id === 't-a');
    expect(task?.start).toBe('2026-10-19');
    expect(task?.end).toBe('2026-10-23');
  });

  it('перенос начала на воскресенье привязывает к понедельнику', () => {
    const plan = buildPlan();
    const next = expectOk(moveTask(plan, 't-a', '2026-10-18'));
    const task = next.tasks.find((entry) => entry.id === 't-a');
    expect(task?.start).toBe('2026-10-19');
    expect(task?.end).toBe('2026-10-23');
  });

  it('перенос назад на субботу привязывает к пятнице', () => {
    const plan = buildPlan();
    const next = expectOk(moveTask(plan, 't-b', '2026-10-17'));
    const task = next.tasks.find((entry) => entry.id === 't-b');
    expect(task?.start).toBe('2026-10-16');
    expect(task?.end).toBe('2026-10-22');
  });

  it('перенос однодневной задачи сохраняет длительность 1 (особый случай addWorkingDays(x,0))', () => {
    // Регрессия PBT-039: пн 12–пн 12 (1 раб. день) → пн 19 должно
    // остаться 19–19, а не 19–20.
    const oneDay = parsePlanContent({
      title: 'Однодневная',
      calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], workingExceptions: [] },
      workTypes: [],
      resources: [],
      groups: [],
      tasks: [{ id: 't-1', title: 'День', start: '2026-10-12', end: '2026-10-12' }],
      dependencies: [],
      unavailability: [],
    });
    if (!oneDay.ok) {
      throw new Error('фикстура не прошла валидацию');
    }
    const next = expectOk(moveTask(oneDay.plan, 't-1', '2026-10-19'));
    const task = next.tasks.find((entry) => entry.id === 't-1');
    expect(task?.start).toBe('2026-10-19');
    expect(task?.end).toBe('2026-10-19');
  });

  it('связанная задача не сдвигается', () => {
    const plan = buildPlan();
    const next = expectOk(moveTask(plan, 't-a', '2026-11-02'));
    const follower = next.tasks.find((entry) => entry.id === 't-b');
    expect(follower?.start).toBe('2026-10-19');
    expect(follower?.end).toBe('2026-10-23');
  });

  it('задача с нулевой длительностью переносится с календарной длиной (вариант A)', () => {
    let plan = expectOk(
      setTaskDates(buildPlan(), 't-a', { start: '2026-10-17', end: '2026-10-18' }),
    );
    plan = expectOk(moveTask(plan, 't-a', '2026-10-26'));
    const task = plan.tasks.find((entry) => entry.id === 't-a');
    expect(task?.start).toBe('2026-10-26');
    expect(task?.end).toBe('2026-10-27');
  });

  it('перенос на текущее начало не меняет план', () => {
    const plan = buildPlan();
    const next = expectOk(moveTask(plan, 't-a', '2026-10-12'));
    expect(next).toEqual(plan);
  });

  it('неизвестная задача отклоняется', () => {
    const plan = buildPlan();
    expectError(moveTask(plan, 't-404', '2026-10-19'), 'unknown-task');
  });
});

describe('setTaskDuration — ввод длительности (A4)', () => {
  it('семь рабочих дней от пн 12.10 дают окончание вт 20.10', () => {
    const plan = buildPlan();
    const next = expectOk(setTaskDuration(plan, 't-a', 7));
    const task = next.tasks.find((entry) => entry.id === 't-a');
    expect(task?.start).toBe('2026-10-12');
    expect(task?.end).toBe('2026-10-20');
  });

  it('длительность 1 при рабочем начале оставляет тот же день', () => {
    const plan = buildPlan();
    const next = expectOk(setTaskDuration(plan, 't-a', 1));
    const task = next.tasks.find((entry) => entry.id === 't-a');
    expect(task?.start).toBe('2026-10-12');
    expect(task?.end).toBe('2026-10-12');
  });

  it('длительность 1 при нерабочем начале даёт первый рабочий день', () => {
    let plan = expectOk(
      setTaskDates(buildPlan(), 't-a', { start: '2026-10-17', end: '2026-10-18' }),
    );
    plan = expectOk(setTaskDuration(plan, 't-a', 1));
    const task = plan.tasks.find((entry) => entry.id === 't-a');
    expect(task?.start).toBe('2026-10-17');
    expect(task?.end).toBe('2026-10-19');
  });

  it('ноль, отрицательное и дробное отклоняются целиком', () => {
    const plan = buildPlan();
    expectError(setTaskDuration(plan, 't-a', 0), 'invalid-duration');
    expectError(setTaskDuration(plan, 't-a', -2), 'invalid-duration');
    expectError(setTaskDuration(plan, 't-a', 1.5), 'invalid-duration');
    expect(plan).toEqual(buildPlan());
  });

  it('неизвестная задача отклоняется', () => {
    const plan = buildPlan();
    expectError(setTaskDuration(plan, 't-404', 3), 'unknown-task');
  });
});

describe('applyPlanCommand — единый путь команд', () => {
  it('применяет каждую команду через диспетчер', () => {
    const plan = buildPlan();
    const created = expectOk(
      applyPlanCommand(plan, {
        type: 'createTask',
        input: { title: 'ПСИ', start: '2026-10-26', end: '2026-10-30' },
      }),
    );
    expect(created.tasks).toHaveLength(3);
    const updated = expectOk(
      applyPlanCommand(created, {
        type: 'updateTask',
        taskId: 't-b',
        patch: { title: 'Разработка 2' },
      }),
    );
    expect(
      updated.tasks.find((task) => task.id === 't-b')?.title,
    ).toBe('Разработка 2');
    const moved = expectOk(
      applyPlanCommand(updated, {
        type: 'moveTask',
        taskId: 't-a',
        newStart: '2026-10-19',
      }),
    );
    expect(
      moved.tasks.find((task) => task.id === 't-a')?.end,
    ).toBe('2026-10-23');
    const dated = expectOk(
      applyPlanCommand(moved, {
        type: 'setTaskDates',
        taskId: 't-b',
        start: '2026-10-19',
        end: '2026-10-21',
      }),
    );
    expect(
      dated.tasks.find((task) => task.id === 't-b')?.end,
    ).toBe('2026-10-21');
    const shortened = expectOk(
      applyPlanCommand(dated, {
        type: 'setTaskDuration',
        taskId: 't-b',
        durationDays: 1,
      }),
    );
    expect(
      shortened.tasks.find((task) => task.id === 't-b')?.end,
    ).toBe('2026-10-19');
    const deleted = expectOk(
      applyPlanCommand(shortened, { type: 'deleteTask', taskId: 't-a' }),
    );
    expect(deleted.tasks).toHaveLength(2);
    expect(deleted.tasks.find((task) => task.id === 't-a')).toBeUndefined();
    expect(deleted.dependencies).toEqual([]);
  });

  it('отклонённая команда не меняет план', () => {
    const plan = buildPlan();
    const result = applyPlanCommand(plan, {
      type: 'deleteTask',
      taskId: 't-404',
    });
    expectError(result, 'unknown-task');
    expect(plan).toEqual(buildPlan());
  });
});
