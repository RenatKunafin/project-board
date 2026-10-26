import { describe, expect, it } from 'vitest';
import {
  createPlanContent,
  parsePlanContent,
  type PlanContent,
} from './plan-document';
import {
  applyPlanCommand,
  type PlanCommandResult,
} from './plan-commands';
import {
  createResource,
  createWorkType,
  deleteResource,
  deleteWorkType,
  updateResource,
  updateWorkType,
} from './plan-catalogs';

function buildPlan(): PlanContent {
  const plan = createPlanContent('Каталоги');
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
      {
        id: 't-1',
        title: 'Анализ',
        start: '2026-10-12',
        end: '2026-10-16',
        assigneeIds: ['r-qa'],
        workTypeIds: ['wt-dev'],
      },
      {
        id: 't-2',
        title: 'Разработка',
        start: '2026-10-19',
        end: '2026-10-23',
        assigneeIds: ['r-qa', 'r-qa2'],
      },
      {
        id: 't-3',
        title: 'ПСИ',
        start: '2026-10-19',
        end: '2026-10-23',
        workTypeIds: ['wt-psi', 'wt-dev'],
      },
    ],
    dependencies: [{ id: 'd-1', fromTaskId: 't-1', toTaskId: 't-2', lagDays: 0 }],
    unavailability: [
      { id: 'u-1', resourceId: 'r-qa', start: '2026-10-20', end: '2026-10-21' },
      { id: 'u-2', resourceId: 'r-qa2', start: '2026-10-22', end: '2026-10-23' },
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

describe('createResource', () => {
  it('создаёт ресурс с уникальным id и обрезанным названием в конец', () => {
    const plan = buildPlan();
    const next = expectOk(createResource(plan, { title: '  Аналитик  ' }));
    expect(next.resources).toHaveLength(3);
    expect(next.resources[2].title).toBe('Аналитик');
    expect(next.resources[2].id).not.toBe('');
    expect(next.resources[0]).toEqual(plan.resources[0]);
    expect(next.tasks).toEqual(plan.tasks);
  });

  it('пустое и пробельное название отклоняется целиком', () => {
    const plan = buildPlan();
    expectError(createResource(plan, { title: '' }), 'invalid-title');
    expectError(createResource(plan, { title: '   ' }), 'invalid-title');
    expect(plan).toEqual(buildPlan());
  });
});

describe('updateResource', () => {
  it('переименование по id не трогает ссылки задач и даты', () => {
    const plan = buildPlan();
    const next = expectOk(
      updateResource(plan, 'r-qa', { title: 'QA senior' }),
    );
    expect(next.resources.map((resource) => resource.title)).toEqual([
      'QA senior',
      'QA2',
    ]);
    const task = next.tasks.find((entry) => entry.id === 't-2');
    expect(task?.assigneeIds).toEqual(['r-qa', 'r-qa2']);
    expect(task?.start).toBe('2026-10-19');
    expect(task?.end).toBe('2026-10-23');
  });

  it('пустое название при переименовании отклоняется', () => {
    const plan = buildPlan();
    expectError(updateResource(plan, 'r-qa', { title: '  ' }), 'invalid-title');
    expect(plan).toEqual(buildPlan());
  });

  it('неизвестный ресурс отклоняется', () => {
    const plan = buildPlan();
    expectError(updateResource(plan, 'r-404', { title: 'X' }), 'unknown-resource');
  });
});

describe('deleteResource — вариант A: чистка ссылок', () => {
  it('вычищает назначения и недоступности, задачи и зависимости целы', () => {
    const plan = buildPlan();
    const next = expectOk(deleteResource(plan, 'r-qa'));
    expect(next.resources.map((resource) => resource.id)).toEqual(['r-qa2']);
    const first = next.tasks.find((entry) => entry.id === 't-1');
    expect(first?.assigneeIds).toBeUndefined();
    expect('assigneeIds' in (first as object)).toBe(false);
    const second = next.tasks.find((entry) => entry.id === 't-2');
    expect(second?.assigneeIds).toEqual(['r-qa2']);
    expect(next.unavailability.map((entry) => entry.id)).toEqual(['u-2']);
    expect(next.dependencies).toEqual(plan.dependencies);
    expect(parsePlanContent(next).ok).toBe(true);
  });

  it('задачи без назначений на удаляемый ресурс не изменяются', () => {
    const plan = buildPlan();
    const next = expectOk(deleteResource(plan, 'r-qa'));
    const third = next.tasks.find((entry) => entry.id === 't-3');
    expect(third).toEqual(plan.tasks[2]);
  });

  it('удаление неиспользуемого ресурса меняет только справочник', () => {
    const plan = expectOk(createResource(buildPlan(), { title: 'Delivery' }));
    const unusedId = plan.resources[2].id;
    const next = expectOk(deleteResource(plan, unusedId));
    expect(next.resources).toHaveLength(2);
    expect(next.tasks).toEqual(plan.tasks);
    expect(next.unavailability).toEqual(plan.unavailability);
  });

  it('неизвестный ресурс отклоняется', () => {
    const plan = buildPlan();
    expectError(deleteResource(plan, 'r-404'), 'unknown-resource');
  });
});

describe('createWorkType', () => {
  it('создаёт типы с признаками, хранящимися в документе', () => {
    const plan = buildPlan();
    const next = expectOk(
      createWorkType(plan, { title: 'Аналитика', allowsParallel: true }),
    );
    expect(next.workTypes).toHaveLength(3);
    expect(next.workTypes[2].title).toBe('Аналитика');
    expect(next.workTypes[2].allowsParallel).toBe(true);
    expect(next.workTypes[0]).toEqual({
      id: 'wt-dev',
      title: 'Разработка',
      allowsParallel: false,
    });
    expect(next.workTypes[1]).toEqual({
      id: 'wt-psi',
      title: 'ПСИ',
      allowsParallel: true,
    });
  });

  it('пустое название отклоняется', () => {
    const plan = buildPlan();
    expectError(
      createWorkType(plan, { title: '', allowsParallel: true }),
      'invalid-title',
    );
  });
});

describe('updateWorkType', () => {
  it('смена параллельности не трогает название и задачи', () => {
    const plan = buildPlan();
    const next = expectOk(
      updateWorkType(plan, 'wt-dev', { allowsParallel: true }),
    );
    const dev = next.workTypes.find((entry) => entry.id === 'wt-dev');
    expect(dev?.allowsParallel).toBe(true);
    expect(dev?.title).toBe('Разработка');
    expect(next.tasks).toEqual(plan.tasks);
  });

  it('переименование не трогает признак', () => {
    const plan = buildPlan();
    const next = expectOk(
      updateWorkType(plan, 'wt-dev', { title: 'Разработка 2' }),
    );
    const dev = next.workTypes.find((entry) => entry.id === 'wt-dev');
    expect(dev?.title).toBe('Разработка 2');
    expect(dev?.allowsParallel).toBe(false);
  });

  it('неизвестный тип отклоняется', () => {
    const plan = buildPlan();
    expectError(
      updateWorkType(plan, 'wt-404', { allowsParallel: true }),
      'unknown-work-type',
    );
  });
});

describe('deleteWorkType — вариант A: чистка ссылок', () => {
  it('вычищает тип из задач, задачи и даты целы', () => {
    const plan = buildPlan();
    const next = expectOk(deleteWorkType(plan, 'wt-dev'));
    expect(next.workTypes.map((entry) => entry.id)).toEqual(['wt-psi']);
    const first = next.tasks.find((entry) => entry.id === 't-1');
    expect(first?.workTypeIds).toBeUndefined();
    expect('workTypeIds' in (first as object)).toBe(false);
    const third = next.tasks.find((entry) => entry.id === 't-3');
    expect(third?.workTypeIds).toEqual(['wt-psi']);
    expect(parsePlanContent(next).ok).toBe(true);
  });

  it('задачи без удаляемого типа не изменяются', () => {
    const plan = buildPlan();
    const next = expectOk(deleteWorkType(plan, 'wt-dev'));
    const second = next.tasks.find((entry) => entry.id === 't-2');
    expect(second).toEqual(plan.tasks[1]);
  });

  it('неизвестный тип отклоняется', () => {
    const plan = buildPlan();
    expectError(deleteWorkType(plan, 'wt-404'), 'unknown-work-type');
  });
});

it.each(['resource', 'workType'] as const)('удаление %s сохраняет группу и расширения назначенной задачи', (kind) => {
  const base = buildPlan();
  const originalTask = { ...base.tasks[0], groupId: 'g', notes: 'Примечание импорта', extension: { source: 'native' } };
  const plan = { ...base, groups: [{ id: 'g', title: 'Группа' }], tasks: [originalTask, ...base.tasks.slice(1)] };
  const next = expectOk(kind === 'resource' ? deleteResource(plan, 'r-qa') : deleteWorkType(plan, 'wt-dev'));
  const expected = { ...originalTask };
  if (kind === 'resource') delete expected.assigneeIds;
  else delete expected.workTypeIds;
  expect(next.tasks[0]).toEqual(expected);
  expect(plan.tasks[0]).toEqual(originalTask);
  expect(parsePlanContent(next).ok).toBe(true);
});

describe('независимость планов', () => {
  it('переименование ресурса в одном плане не меняет второй план', () => {
    const planA = buildPlan();
    const planB = buildPlan();
    expectOk(updateResource(planA, 'r-qa', { title: 'QA новый' }));
    expect(planB).toEqual(buildPlan());
  });

  it('тёзки в одном плане остаются независимыми записями', () => {
    const plan = expectOk(createResource(buildPlan(), { title: 'QA' }));
    const records = plan.resources.filter(
      (resource) => resource.title === 'QA',
    );
    expect(records).toHaveLength(2);
    expect(records[0].id).not.toBe(records[1].id);
    expect(parsePlanContent(plan).ok).toBe(true);
  });
});

describe('applyPlanCommand — команды справочников через единый путь', () => {
  it('применяет create → update → delete для ресурса и типа', () => {
    const plan = buildPlan();
    const withResource = expectOk(
      applyPlanCommand(plan, { type: 'createResource', input: { title: 'Delivery' } }),
    );
    const resourceId = withResource.resources[2].id;
    const renamed = expectOk(
      applyPlanCommand(withResource, {
        type: 'updateResource',
        resourceId,
        patch: { title: 'Delivery 2' },
      }),
    );
    expect(renamed.resources[2].title).toBe('Delivery 2');
    const withoutResource = expectOk(
      applyPlanCommand(renamed, { type: 'deleteResource', resourceId }),
    );
    expect(withoutResource.resources).toHaveLength(2);

    const withType = expectOk(
      applyPlanCommand(withoutResource, {
        type: 'createWorkType',
        input: { title: 'Аналитика', allowsParallel: true },
      }),
    );
    const workTypeId = withType.workTypes[2].id;
    const flipped = expectOk(
      applyPlanCommand(withType, {
        type: 'updateWorkType',
        workTypeId,
        patch: { allowsParallel: false },
      }),
    );
    expect(flipped.workTypes[2].allowsParallel).toBe(false);
    const withoutType = expectOk(
      applyPlanCommand(flipped, { type: 'deleteWorkType', workTypeId }),
    );
    expect(withoutType.workTypes).toHaveLength(2);
  });

  it('отклонённая команда справочника не меняет план', () => {
    const plan = buildPlan();
    const result = applyPlanCommand(plan, {
      type: 'createResource',
      input: { title: ' ' },
    });
    expectError(result, 'invalid-title');
    expect(plan).toEqual(buildPlan());
  });
});
