import { describe, expect, it } from 'vitest';
import {
  createPlanContent,
  parsePlanContent,
  type PlanContent,
} from './plan-document';
import {
  applyPlanCommand,
  deleteTask,
  type PlanCommandResult,
} from './plan-commands';
import { deleteResource } from './plan-catalogs';
import {
  assignResource,
  assignWorkType,
  createUnavailability,
  deleteUnavailability,
  unassignResource,
  unassignWorkType,
  updateUnavailability,
} from './plan-assignments';

function buildPlan(): PlanContent {
  const plan = createPlanContent('Назначения');
  return {
    ...plan,
    resources: [
      { id: 'r-qa', title: 'QA' },
      { id: 'r-qa2', title: 'QA2' },
    ],
    workTypes: [
      { id: 'wt-dev', title: 'Разработка', allowsParallel: false },
      { id: 'wt-psi', title: 'ПСИ', allowsParallel: true },
    ],
    tasks: [
      { id: 't-1', title: 'Анализ', start: '2026-10-12', end: '2026-10-16' },
      { id: 't-2', title: 'Разработка', start: '2026-10-19', end: '2026-10-23' },
    ],
    dependencies: [{ id: 'd-1', fromTaskId: 't-1', toTaskId: 't-2', lagDays: 0 }],
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

function expectError(result: PlanCommandResult, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('ожидалось отклонение');
  }
  expect(result.error.code).toBe(code);
  expect(result.error.message).not.toBe('');
}

function taskOf(plan: PlanContent, taskId: string): PlanContent['tasks'][number] {
  const task = plan.tasks.find((entry) => entry.id === taskId);
  if (task === undefined) {
    throw new Error(`задача ${taskId} не найдена`);
  }
  return task;
}

describe('assignResource — назначения ресурсов (D1 ADR PBT-003)', () => {
  it('назначает несколько ресурсов задаче, добавляя в конец списка', () => {
    let plan = buildPlan();
    plan = expectOk(assignResource(plan, 't-1', 'r-qa'));
    plan = expectOk(assignResource(plan, 't-1', 'r-qa2'));
    expect(taskOf(plan, 't-1').assigneeIds).toEqual(['r-qa', 'r-qa2']);
    expect(taskOf(plan, 't-2').assigneeIds).toBeUndefined();
  });

  it('повторное назначение не дублирует связь', () => {
    let plan = expectOk(assignResource(buildPlan(), 't-1', 'r-qa'));
    const afterFirst = plan;
    plan = expectOk(assignResource(plan, 't-1', 'r-qa'));
    expect(taskOf(plan, 't-1').assigneeIds).toEqual(['r-qa']);
    expect(plan).toEqual(afterFirst);
  });

  it('снятие убирает только целевой ресурс, опустевший массив исчезает', () => {
    let plan = expectOk(assignResource(buildPlan(), 't-1', 'r-qa'));
    plan = expectOk(assignResource(plan, 't-1', 'r-qa2'));
    plan = expectOk(unassignResource(plan, 't-1', 'r-qa'));
    expect(taskOf(plan, 't-1').assigneeIds).toEqual(['r-qa2']);
    plan = expectOk(unassignResource(plan, 't-1', 'r-qa2'));
    const task = taskOf(plan, 't-1');
    expect(task.assigneeIds).toBeUndefined();
    expect('assigneeIds' in task).toBe(false);
  });

  it('снятие отсутствующего назначения — noop', () => {
    const plan = buildPlan();
    const next = expectOk(unassignResource(plan, 't-1', 'r-qa'));
    expect(next).toEqual(plan);
  });

  it('назначение и снятие не меняют даты и длительность задачи', () => {
    let plan = expectOk(assignResource(buildPlan(), 't-1', 'r-qa'));
    expect(taskOf(plan, 't-1').start).toBe('2026-10-12');
    expect(taskOf(plan, 't-1').end).toBe('2026-10-16');
    plan = expectOk(unassignResource(plan, 't-1', 'r-qa'));
    expect(taskOf(plan, 't-1').start).toBe('2026-10-12');
    expect(taskOf(plan, 't-1').end).toBe('2026-10-16');
  });

  it('ресурс другого плана отклоняется как неизвестный', () => {
    const planA = buildPlan();
    const planB: PlanContent = {
      ...createPlanContent('Другой план'),
      resources: [{ id: 'r-external', title: 'Чужой' }],
    };
    expect(planB.resources.map((resource) => resource.id)).toEqual([
      'r-external',
    ]);
    expectError(assignResource(planA, 't-1', 'r-external'), 'unknown-resource');
    expect(planA).toEqual(buildPlan());
  });

  it('неизвестные задача и ресурс отклоняются целиком', () => {
    const plan = buildPlan();
    expectError(assignResource(plan, 't-404', 'r-qa'), 'unknown-task');
    expectError(assignResource(plan, 't-1', 'r-404'), 'unknown-resource');
    expect(plan).toEqual(buildPlan());
  });
});

describe('assignWorkType / unassignWorkType', () => {
  it('назначает и снимает тип работы, идемпотентно', () => {
    let plan = expectOk(assignWorkType(buildPlan(), 't-1', 'wt-dev'));
    expect(taskOf(plan, 't-1').workTypeIds).toEqual(['wt-dev']);
    const unchanged = expectOk(assignWorkType(plan, 't-1', 'wt-dev'));
    expect(unchanged).toEqual(plan);
    plan = expectOk(unassignWorkType(plan, 't-1', 'wt-dev'));
    expect('workTypeIds' in taskOf(plan, 't-1')).toBe(false);
  });

  it('снятие типа не трогает назначения ресурсов', () => {
    let plan = expectOk(assignResource(buildPlan(), 't-1', 'r-qa'));
    plan = expectOk(assignWorkType(plan, 't-1', 'wt-psi'));
    plan = expectOk(unassignWorkType(plan, 't-1', 'wt-psi'));
    expect(taskOf(plan, 't-1').assigneeIds).toEqual(['r-qa']);
  });

  it('неизвестный тип отклоняется', () => {
    const plan = buildPlan();
    expectError(assignWorkType(plan, 't-1', 'wt-404'), 'unknown-work-type');
    expectError(unassignWorkType(plan, 't-1', 'wt-404'), 'unknown-work-type');
  });
});

describe('createUnavailability — создание недоступности', () => {
  it('создаёт отпуск ресурса с границами в конец массива', () => {
    const plan = buildPlan();
    const next = expectOk(
      createUnavailability(plan, {
        resourceId: 'r-qa',
        start: '2026-10-20',
        end: '2026-10-21',
      }),
    );
    expect(next.unavailability).toHaveLength(2);
    const created = next.unavailability[1];
    expect(created.resourceId).toBe('r-qa');
    expect(created.start).toBe('2026-10-20');
    expect(created.end).toBe('2026-10-21');
    expect(created.id).not.toBe('');
  });

  it('перевёрнутый интервал отклоняется целиком', () => {
    const plan = buildPlan();
    expectError(
      createUnavailability(plan, {
        resourceId: 'r-qa',
        start: '2026-10-21',
        end: '2026-10-20',
      }),
      'inverted-interval',
    );
    expect(plan).toEqual(buildPlan());
  });

  it('неизвестный ресурс отклоняется', () => {
    const plan = buildPlan();
    expectError(
      createUnavailability(plan, {
        resourceId: 'r-404',
        start: '2026-10-20',
        end: '2026-10-21',
      }),
      'unknown-resource',
    );
  });
});

describe('updateUnavailability — изменение по итоговому состоянию', () => {
  it('смена окончания при прежних ресурсе и начале', () => {
    const plan = buildPlan();
    const next = expectOk(
      updateUnavailability(plan, 'u-1', { end: '2026-10-24' }),
    );
    const entry = next.unavailability.find((item) => item.id === 'u-1');
    expect(entry).toEqual({
      id: 'u-1',
      resourceId: 'r-qa2',
      start: '2026-10-20',
      end: '2026-10-24',
    });
  });

  it('смена ресурса валидирует существование', () => {
    const plan = buildPlan();
    const next = expectOk(
      updateUnavailability(plan, 'u-1', { resourceId: 'r-qa' }),
    );
    expect(
      next.unavailability.find((item) => item.id === 'u-1')?.resourceId,
    ).toBe('r-qa');
    expectError(
      updateUnavailability(plan, 'u-1', { resourceId: 'r-404' }),
      'unknown-resource',
    );
  });

  it('итоговый интервал проверяется: сокращение начала за окончание отклоняется', () => {
    const plan = buildPlan();
    expectError(
      updateUnavailability(plan, 'u-1', { start: '2026-10-22' }),
      'inverted-interval',
    );
    expect(plan).toEqual(buildPlan());
  });

  it('неизвестный период отклоняется', () => {
    const plan = buildPlan();
    expectError(
      updateUnavailability(plan, 'u-404', { end: '2026-10-24' }),
      'unknown-unavailability',
    );
  });
});

describe('deleteUnavailability — удаление периода', () => {
  it('удаляет только целевой период', () => {
    const plan = expectOk(
      createUnavailability(buildPlan(), {
        resourceId: 'r-qa',
        start: '2026-10-22',
        end: '2026-10-23',
      }),
    );
    const createdId = plan.unavailability[1].id;
    const next = expectOk(deleteUnavailability(plan, createdId));
    expect(next.unavailability.map((item) => item.id)).toEqual(['u-1']);
  });

  it('неизвестный период отклоняется', () => {
    const plan = buildPlan();
    expectError(deleteUnavailability(plan, 'u-404'), 'unknown-unavailability');
  });
});

describe('ссылочная целостность при удалениях (DoD-5)', () => {
  it('удаление ресурса вычищает назначения и его недоступности, план валиден', () => {
    let plan = buildPlan();
    plan = expectOk(assignResource(plan, 't-1', 'r-qa'));
    plan = expectOk(assignResource(plan, 't-2', 'r-qa2'));
    plan = expectOk(
      createUnavailability(plan, {
        resourceId: 'r-qa',
        start: '2026-10-22',
        end: '2026-10-23',
      }),
    );
    const next = expectOk(deleteResource(plan, 'r-qa'));
    expect(taskOf(next, 't-1').assigneeIds).toBeUndefined();
    expect(taskOf(next, 't-2').assigneeIds).toEqual(['r-qa2']);
    expect(next.unavailability.map((item) => item.resourceId)).toEqual([
      'r-qa2',
    ]);
    expect(parsePlanContent(next).ok).toBe(true);
  });

  it('удаление задачи чистит зависимости, недоступности ресурсов не тронуты', () => {
    let plan = buildPlan();
    plan = expectOk(assignResource(plan, 't-1', 'r-qa'));
    const next = expectOk(deleteTask(plan, 't-1'));
    expect(next.tasks.map((task) => task.id)).toEqual(['t-2']);
    expect(next.dependencies).toEqual([]);
    expect(next.unavailability).toEqual(plan.unavailability);
    expect(parsePlanContent(next).ok).toBe(true);
  });
});

describe('applyPlanCommand — назначения и недоступности через единый путь', () => {
  it('применяет каждую команду через диспетчер', () => {
    let plan = expectOk(
      applyPlanCommand(buildPlan(), {
        type: 'assignResource',
        taskId: 't-1',
        resourceId: 'r-qa',
      }),
    );
    plan = expectOk(
      applyPlanCommand(plan, {
        type: 'assignWorkType',
        taskId: 't-1',
        workTypeId: 'wt-dev',
      }),
    );
    plan = expectOk(
      applyPlanCommand(plan, {
        type: 'unassignWorkType',
        taskId: 't-1',
        workTypeId: 'wt-dev',
      }),
    );
    const withUnavailability = expectOk(
      applyPlanCommand(plan, {
        type: 'createUnavailability',
        input: { resourceId: 'r-qa', start: '2026-10-22', end: '2026-10-23' },
      }),
    );
    const createdId = withUnavailability.unavailability[1].id;
    plan = expectOk(
      applyPlanCommand(withUnavailability, {
        type: 'updateUnavailability',
        unavailabilityId: createdId,
        patch: { end: '2026-10-24' },
      }),
    );
    plan = expectOk(
      applyPlanCommand(plan, {
        type: 'unassignResource',
        taskId: 't-1',
        resourceId: 'r-qa',
      }),
    );
    plan = expectOk(
      applyPlanCommand(plan, {
        type: 'deleteUnavailability',
        unavailabilityId: createdId,
      }),
    );
    expect(plan.unavailability.map((item) => item.id)).toEqual(['u-1']);
    expect(parsePlanContent(plan).ok).toBe(true);
  });

  it('отклонённая команда не меняет план', () => {
    const plan = buildPlan();
    const result = applyPlanCommand(plan, {
      type: 'createUnavailability',
      input: { resourceId: 'r-404', start: '2026-10-20', end: '2026-10-21' },
    });
    expectError(result, 'unknown-resource');
    expect(plan).toEqual(buildPlan());
  });
});
