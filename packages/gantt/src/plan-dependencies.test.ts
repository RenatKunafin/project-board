import { describe, expect, it } from 'vitest';
import { createPlanContent, type PlanContent } from './plan-document';
import {
  applyPlanCommand,
  type PlanCommandResult,
} from './plan-commands';
import {
  createDependency,
  deleteDependency,
  dependencyViolations,
  updateDependency,
} from './plan-dependencies';

function buildPlan(): PlanContent {
  const plan = createPlanContent('Зависимости');
  return {
    ...plan,
    tasks: [
      { id: 't-a', title: 'Анализ', start: '2026-10-12', end: '2026-10-16' },
      { id: 't-b', title: 'Разработка', start: '2026-10-19', end: '2026-10-23' },
      { id: 't-c', title: 'ИФТ', start: '2026-10-26', end: '2026-10-30' },
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

function violationOf(
  plan: PlanContent,
): ReturnType<typeof dependencyViolations>[number] {
  const violations = dependencyViolations(plan);
  expect(violations).toHaveLength(1);
  return violations[0];
}

describe('createDependency — создание FS-зависимости', () => {
  it('создаёт ребро с уникальным id в конец массива, соседи целы', () => {
    const plan = buildPlan();
    const next = expectOk(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 }),
    );
    expect(next.dependencies).toHaveLength(1);
    const created = next.dependencies[0];
    expect(created.fromTaskId).toBe('t-a');
    expect(created.toTaskId).toBe('t-b');
    expect(created.lagDays).toBe(0);
    expect(created.id).not.toBe('');
    expect(next.tasks).toEqual(plan.tasks);
  });

  it('отрицательный и дробный лаг отклоняются', () => {
    const plan = buildPlan();
    expectError(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-b', lagDays: -3 }),
      'invalid-lag',
    );
    expectError(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 1.5 }),
      'invalid-lag',
    );
    expect(plan).toEqual(buildPlan());
  });

  it('неизвестная задача отклоняется', () => {
    const plan = buildPlan();
    expectError(
      createDependency(plan, { fromTaskId: 't-404', toTaskId: 't-b', lagDays: 0 }),
      'unknown-task',
    );
    expectError(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-404', lagDays: 0 }),
      'unknown-task',
    );
  });

  it('повтор с тем же лагом не дублирует ребро', () => {
    let plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 1 }),
    );
    const afterFirst = plan;
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 1 }),
    );
    expect(plan.dependencies).toHaveLength(1);
    expect(plan).toEqual(afterFirst);
  });

  it('то же ребро с другим лагом отклоняется как дубликат', () => {
    const plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 1 }),
    );
    expectError(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 3 }),
      'duplicate-dependency',
    );
    expect(plan.dependencies).toHaveLength(1);
  });
});

describe('структурная защита графа (C4)', () => {
  it('самоссылка отклоняется', () => {
    const plan = buildPlan();
    expectError(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-a', lagDays: 0 }),
      'circular-dependency',
    );
    expect(plan).toEqual(buildPlan());
  });

  it('косвенный цикл отклоняется без изменения документа', () => {
    let plan = buildPlan();
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 }),
    );
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-b', toTaskId: 't-c', lagDays: 0 }),
    );
    expectError(
      createDependency(plan, { fromTaskId: 't-c', toTaskId: 't-a', lagDays: 0 }),
      'circular-dependency',
    );
    expect(plan.dependencies).toHaveLength(2);
  });

  it('ветвление допустимо: один предшественник, два последователя', () => {
    let plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 }),
    );
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-c', lagDays: 0 }),
    );
    expect(plan.dependencies).toHaveLength(2);
  });

  it('два предшественника у одной задачи допустимы', () => {
    let plan = buildPlan();
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-c', lagDays: 0 }),
    );
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-b', toTaskId: 't-c', lagDays: 0 }),
    );
    const predecessors = plan.dependencies.filter(
      (dependency) => dependency.toTaskId === 't-c',
    );
    expect(predecessors).toHaveLength(2);
  });
});

describe('updateDependency / deleteDependency', () => {
  it('смена лага меняет только лаг', () => {
    let plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 }),
    );
    const dependencyId = plan.dependencies[0].id;
    plan = expectOk(updateDependency(plan, dependencyId, { lagDays: 2 }));
    expect(plan.dependencies[0].lagDays).toBe(2);
    expect(plan.dependencies[0].fromTaskId).toBe('t-a');
    expect(plan.dependencies[0].toTaskId).toBe('t-b');
  });

  it('тот же лаг — noop, неизвестная зависимость и плохой лаг отклоняются', () => {
    const plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 1 }),
    );
    const dependencyId = plan.dependencies[0].id;
    const unchanged = expectOk(updateDependency(plan, dependencyId, { lagDays: 1 }));
    expect(unchanged).toEqual(plan);
    expectError(updateDependency(plan, 'd-404', { lagDays: 2 }), 'unknown-dependency');
    expectError(updateDependency(plan, dependencyId, { lagDays: -1 }), 'invalid-lag');
  });

  it('удаление ребра чистит список, порядок остальных стабилен', () => {
    let plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 }),
    );
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-b', toTaskId: 't-c', lagDays: 1 }),
    );
    const next = expectOk(deleteDependency(plan, plan.dependencies[0].id));
    expect(next.dependencies).toHaveLength(1);
    expect(next.dependencies[0].fromTaskId).toBe('t-b');
    expectError(deleteDependency(next, 'd-404'), 'unknown-dependency');
  });
});

describe('dependencyViolations — диагностика нарушений (C1/C5)', () => {
  it('цепочка с лагом 0 на ближайшем рабочем дне без нарушений', () => {
    let plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 }),
    );
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-b', toTaskId: 't-c', lagDays: 0 }),
    );
    expect(dependencyViolations(plan)).toEqual([]);
  });

  it('лаг 0 допускает начало в следующий рабочий день', () => {
    const plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 }),
    );
    expect(dependencyViolations(plan)).toEqual([]);
    // Нарушение: последователь начинается в пятницу окончания предшественника.
    const tight: PlanContent = {
      ...plan,
      tasks: [
        { id: 't-a', title: 'Анализ', start: '2026-10-12', end: '2026-10-16' },
        { id: 't-b', title: 'Разработка', start: '2026-10-16', end: '2026-10-16' },
      ],
    };
    const violation = violationOf(tight);
    expect(violation.expectedStart).toBe('2026-10-19');
    expect(violation.actualStart).toBe('2026-10-16');
  });

  it('лаг 1 пропускает ещё один рабочий день', () => {
    const plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 1 }),
    );
    // t-b начинается в пн 19.10, ожидание при лаге 1 — вт 20.10 → нарушение.
    const violation = violationOf(plan);
    expect(violation.expectedStart).toBe('2026-10-20');
    expect(violation.actualStart).toBe('2026-10-19');
    // Сдвиг начала на вт 20.10 снимает нарушение при тех же датах предшественника.
    const shifted: PlanContent = {
      ...plan,
      tasks: [
        { id: 't-a', title: 'Анализ', start: '2026-10-12', end: '2026-10-16' },
        { id: 't-b', title: 'Разработка', start: '2026-10-20', end: '2026-10-23' },
      ],
    };
    expect(dependencyViolations(shifted)).toEqual([]);
  });

  it('праздник внутри задержки сдвигает ожидание при тех же датах', () => {
    const withHoliday: PlanContent = {
      ...buildPlan(),
      calendar: {
        workingDays: [1, 2, 3, 4, 5],
        holidays: ['2026-10-20'],
        workingExceptions: [],
      },
    };
    const plan = expectOk(
      createDependency(withHoliday, { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 1 }),
    );
    // Без праздника лаг 1 ожидает вт 20.10; с праздником — ср 21.10.
    // Начало t-b пн 19.10 нарушает оба варианта, ожидание различается.
    const violation = violationOf(plan);
    expect(violation.expectedStart).toBe('2026-10-21');
    expect(violation.actualStart).toBe('2026-10-19');
  });

  it('два предшественника: нарушение только по ребру с поздним ожиданием', () => {
    let plan: PlanContent = {
      ...buildPlan(),
      tasks: [
        { id: 't-a', title: 'Анализ', start: '2026-10-12', end: '2026-10-16' },
        { id: 't-b', title: 'Разработка', start: '2026-10-19', end: '2026-10-20' },
        { id: 't-c', title: 'ИФТ', start: '2026-10-19', end: '2026-10-23' },
      ],
    };
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-a', toTaskId: 't-c', lagDays: 0 }),
    );
    plan = expectOk(
      createDependency(plan, { fromTaskId: 't-b', toTaskId: 't-c', lagDays: 0 }),
    );
    const violations = dependencyViolations(plan);
    expect(violations).toHaveLength(1);
    expect(violations[0].fromTaskId).toBe('t-b');
    expect(violations[0].expectedStart).toBe('2026-10-21');
  });

  it('нарушение выдаёт IDs и объяснение, даты не изменяются (C5)', () => {
    const before = buildPlan();
    const plan = expectOk(
      createDependency(before, { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 2 }),
    );
    const violation = violationOf(plan);
    expect(violation.dependencyId).toBe(plan.dependencies[0].id);
    expect(violation.fromTaskId).toBe('t-a');
    expect(violation.toTaskId).toBe('t-b');
    expect(violation.expectedStart).toBe('2026-10-21');
    expect(violation.message).toContain('2026-10-21');
    expect(violation.actualStart).toBe('2026-10-19');
    // Диагностика — чистая функция: задачи с прежними датами, план не изменён.
    expect(plan.tasks).toEqual(before.tasks);
  });

  it('позднее начало нарушением не является', () => {
    const plan = expectOk(
      createDependency(buildPlan(), { fromTaskId: 't-a', toTaskId: 't-c', lagDays: 0 }),
    );
    // t-c начинается через неделю после допустимого — люфт ручного плана.
    expect(dependencyViolations(plan)).toEqual([]);
  });

  it('рёбра с отсутствующими задачами пропускаются защитно', () => {
    const plan: PlanContent = {
      ...buildPlan(),
      dependencies: [
        {
          id: 'd-broken',
          fromTaskId: 't-a',
          toTaskId: 't-404',
          lagDays: 0,
        },
      ],
    };
    expect(() => dependencyViolations(plan)).not.toThrow();
    expect(dependencyViolations(plan)).toEqual([]);
  });
});

describe('applyPlanCommand — зависимости через единый путь', () => {
  it('применяет create → update → delete через диспетчер', () => {
    const plan = buildPlan();
    const created = expectOk(
      applyPlanCommand(plan, {
        type: 'createDependency',
        input: { fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 },
      }),
    );
    const dependencyId = created.dependencies[0].id;
    const updated = expectOk(
      applyPlanCommand(created, {
        type: 'updateDependency',
        dependencyId,
        patch: { lagDays: 3 },
      }),
    );
    expect(updated.dependencies[0].lagDays).toBe(3);
    const deleted = expectOk(
      applyPlanCommand(updated, { type: 'deleteDependency', dependencyId }),
    );
    expect(deleted.dependencies).toEqual([]);
  });

  it('отклонённая команда зависимостей не меняет план', () => {
    const plan = buildPlan();
    const result = applyPlanCommand(plan, {
      type: 'createDependency',
      input: { fromTaskId: 't-a', toTaskId: 't-a', lagDays: 0 },
    });
    expectError(result, 'circular-dependency');
    expect(plan).toEqual(buildPlan());
  });
});
