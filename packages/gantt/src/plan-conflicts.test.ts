import { describe, expect, it } from 'vitest';
import {
  createPlanContent,
  parsePlanContent,
  type PlanContent,
  type PlanTask,
} from './plan-document';
import type { PlanCommandResult } from './plan-commands';
import { resourceConflicts } from './plan-conflicts';
import {
  assignResource,
  unassignResource,
} from './plan-assignments';
import { updateWorkType } from './plan-catalogs';

function expectOk(result: PlanCommandResult): PlanContent {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('ожидался успешный результат');
  }
  return result.plan;
}

function buildPlan(): PlanContent {
  const plan = createPlanContent('Конфликты');
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
  };
}

interface TaskSpec {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly assigneeIds?: readonly string[];
  readonly workTypeIds?: readonly string[];
}

function planWith(tasks: readonly TaskSpec[]): PlanContent {
  return {
    ...buildPlan(),
    tasks: tasks.map((task): PlanTask => ({
      id: task.id,
      title: task.id.toUpperCase(),
      start: task.start,
      end: task.end,
      ...(task.assigneeIds !== undefined
        ? { assigneeIds: task.assigneeIds }
        : {}),
      ...(task.workTypeIds !== undefined
        ? { workTypeIds: task.workTypeIds }
        : {}),
    })),
  };
}

function conflictsBetween(
  plan: PlanContent,
  firstTaskId: string,
  secondTaskId: string,
): readonly { readonly intervalStart: string; readonly intervalEnd: string }[] {
  return resourceConflicts(plan).filter(
    (conflict) =>
      conflict.kind === 'parallel-work' &&
      conflict.firstTaskId === firstTaskId &&
      conflict.secondTaskId === secondTaskId,
  );
}

describe('матрица сочетаний типов (11.3, D4, вариант A)', () => {
  it.each([
    ['Разработка + Разработка', ['wt-dev'], ['wt-dev'], 1],
    ['Разработка + ПСИ', ['wt-dev'], ['wt-psi'], 0],
    ['ПСИ + Разработка', ['wt-psi'], ['wt-dev'], 0],
    ['ПСИ + ПСИ', ['wt-psi'], ['wt-psi'], 0],
    ['без типа + без типа', undefined, undefined, 1],
    ['без типа + Разработка', undefined, ['wt-dev'], 1],
    ['без типа + ПСИ', undefined, ['wt-psi'], 0],
    ['[Разработка, ПСИ] + Разработка', ['wt-dev', 'wt-psi'], ['wt-dev'], 1],
    ['[Разработка, ПСИ] + ПСИ', ['wt-dev', 'wt-psi'], ['wt-psi'], 0],
  ])(
    '%s',
    (
      _label: string,
      typesA: readonly string[] | undefined,
      typesB: readonly string[] | undefined,
      expectedConflicts: number,
    ) => {
      const plan = planWith([
        { id: 't-1', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: typesA },
        { id: 't-2', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: typesB },
      ]);
      const conflicts = conflictsBetween(plan, 't-1', 't-2');
      expect(conflicts).toHaveLength(expectedConflicts);
      expect(parsePlanContent(plan).ok).toBe(true);
    },
  );
});

describe('ресурсы (D1/D2)', () => {
  it('разные ресурсы не конфликтуют из-за совпадающих сроков', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
      { id: 't-2', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa2'], workTypeIds: ['wt-dev'] },
    ]);
    expect(resourceConflicts(plan)).toEqual([]);
  });

  it('конфликт проверяется по каждому ресурсу назначений задачи', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa', 'r-qa2'], workTypeIds: ['wt-dev'] },
      { id: 't-2', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa2'], workTypeIds: ['wt-dev'] },
    ]);
    const conflicts = resourceConflicts(plan);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe('parallel-work');
    if (conflicts[0].kind === 'parallel-work') {
      expect(conflicts[0].resourceId).toBe('r-qa2');
    }
  });

  it('задачи без назначений не участвуют', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16', workTypeIds: ['wt-dev'] },
      { id: 't-2', start: '2026-10-12', end: '2026-10-16', workTypeIds: ['wt-dev'] },
    ]);
    expect(resourceConflicts(plan)).toEqual([]);
  });
});

describe('отпуска и граничные дни (D6)', () => {
  it('работа пересекается с отпуском — конфликт', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
    ]);
    const withVacation = {
      ...plan,
      unavailability: [
        { id: 'u-1', resourceId: 'r-qa', start: '2026-10-14', end: '2026-10-15' },
      ],
    };
    const conflicts = resourceConflicts(withVacation);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe('unavailability');
    if (conflicts[0].kind === 'unavailability') {
      expect(conflicts[0].taskId).toBe('t-1');
      expect(conflicts[0].resourceId).toBe('r-qa');
      expect(conflicts[0].intervalStart).toBe('2026-10-14');
      expect(conflicts[0].intervalEnd).toBe('2026-10-15');
    }
  });

  it('конфликт с отпуском действует и для ПСИ', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-psi'] },
    ]);
    const withVacation = {
      ...plan,
      unavailability: [
        { id: 'u-1', resourceId: 'r-qa', start: '2026-10-14', end: '2026-10-15' },
      ],
    };
    expect(resourceConflicts(withVacation)).toHaveLength(1);
  });

  it('отпуск целиком в нерабочих днях конфликта не даёт', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
    ]);
    const withWeekendVacation = {
      ...plan,
      unavailability: [
        { id: 'u-1', resourceId: 'r-qa', start: '2026-10-17', end: '2026-10-18' },
      ],
    };
    expect(resourceConflicts(withWeekendVacation)).toEqual([]);
  });

  it('пересечение без общего рабочего дня конфликта не даёт', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-13', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
      { id: 't-2', start: '2026-10-14', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
    ]);
    expect(resourceConflicts(plan)).toEqual([]);
  });

  it('общий граничный день даёт конфликт с интервалом в один день', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-14', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
      { id: 't-2', start: '2026-10-14', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
    ]);
    const conflicts = conflictsBetween(plan, 't-1', 't-2');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].intervalStart).toBe('2026-10-14');
    expect(conflicts[0].intervalEnd).toBe('2026-10-14');
  });
});

describe('диагностика и неприкосновенность дат (DoD-4/5)', () => {
  it('состав записи без дублей пар', () => {
    let plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16' },
      { id: 't-2', start: '2026-10-12', end: '2026-10-16' },
    ]);
    plan = expectOk(assignResource(plan, 't-1', 'r-qa'));
    plan = expectOk(assignResource(plan, 't-2', 'r-qa'));
    const conflicts = resourceConflicts(plan);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict.kind).toBe('parallel-work');
    if (conflict.kind === 'parallel-work') {
      expect(conflict.resourceId).toBe('r-qa');
      expect(conflict.firstTaskId).toBe('t-1');
      expect(conflict.secondTaskId).toBe('t-2');
      expect(conflict.intervalStart).toBe('2026-10-12');
      expect(conflict.intervalEnd).toBe('2026-10-16');
      expect(conflict.message).toContain('t-1'.toUpperCase());
      expect(conflict.message).toContain('параллельное');
    }
    expect(parsePlanContent(plan).ok).toBe(true);
  });

  it('диагностика не изменяет план и повторяема', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
      { id: 't-2', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
    ]);
    const snapshot = plan;
    const firstPass = resourceConflicts(plan);
    const secondPass = resourceConflicts(plan);
    expect(firstPass).toEqual(secondPass);
    expect(plan).toEqual(snapshot);
  });

  it('смена типа на параллельный устраняет конфликт при тех же датах', () => {
    let plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
      { id: 't-2', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
    ]);
    expect(resourceConflicts(plan)).toHaveLength(1);
    plan = expectOk(updateWorkType(plan, 'wt-dev', { allowsParallel: true }));
    expect(resourceConflicts(plan)).toEqual([]);
    expect(plan.tasks[0].start).toBe('2026-10-12');
    expect(plan.tasks[1].end).toBe('2026-10-16');
  });

  it('правка календаря меняет результат при тех же датах', () => {
    const plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-12', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
      { id: 't-2', start: '2026-10-12', end: '2026-10-13', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
    ]);
    // Контакт только в пн 12.10.
    expect(resourceConflicts(plan)).toHaveLength(1);
    // Пн объявлен праздником: рабочих дней контакта не осталось.
    const withHoliday: PlanContent = {
      ...plan,
      calendar: {
        workingDays: [1, 2, 3, 4, 5],
        holidays: ['2026-10-12'],
        workingExceptions: [],
      },
    };
    expect(resourceConflicts(withHoliday)).toEqual([]);
    expect(withHoliday.tasks[0].start).toBe('2026-10-12');
    expect(withHoliday.tasks[1].end).toBe('2026-10-13');
  });

  it('снятие назначения устраняет конфликт при тех же датах', () => {
    let plan = planWith([
      { id: 't-1', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
      { id: 't-2', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r-qa'], workTypeIds: ['wt-dev'] },
    ]);
    expect(resourceConflicts(plan)).toHaveLength(1);
    plan = expectOk(unassignResource(plan, 't-2', 'r-qa'));
    expect(resourceConflicts(plan)).toEqual([]);
    expect(plan.tasks[0].start).toBe('2026-10-12');
    expect(plan.tasks[1].end).toBe('2026-10-16');
  });
});
