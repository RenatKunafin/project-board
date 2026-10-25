import { describe, expect, it } from 'vitest';
import { createPlanContent, type PlanContent } from './plan-document';
import {
  ganttDayIso,
  nonWorkingDayKind,
  planToGanttLinks,
  planToGanttTasks,
} from './svar-adapter';

function expectGanttDay(date: Date, isoDate: string): void {
  // Локальная полночь: проверяем локальные компоненты даты.
  expect(ganttDayIso(date)).toBe(isoDate);
}

describe('planToGanttTasks — конвертация дат (ADR-4)', () => {
  it('включительное окончание передаётся исключительным (+1 день)', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      tasks: [
        { id: 't-1', title: 'Неделя', start: '2026-10-12', end: '2026-10-16' },
      ],
    };
    const [task] = planToGanttTasks(plan);
    expect(task.type).toBe('task');
    expectGanttDay(task.start as Date, '2026-10-12');
    expectGanttDay(task.end as Date, '2026-10-17');
  });

  it('даты — локальные полночи (SVAR оперирует локальными Date)', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      tasks: [
        { id: 't-1', title: 'День', start: '2026-10-12', end: '2026-10-12' },
      ],
    };
    const [task] = planToGanttTasks(plan);
    const start = task.start as Date;
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(9);
    expect(start.getDate()).toBe(12);
    expect(start.getHours()).toBe(0);
  });
});

describe('planToGanttTasks — дерево групп', () => {
  it('группы любого порядка массива идут родителем перед детьми (3 уровня)', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      groups: [
        { id: 'g-leaf', title: 'Разработка', parentId: 'g-mid' },
        { id: 'g-root', title: 'ОКАД' },
        { id: 'g-mid', title: 'iOS', parentId: 'g-root' },
      ],
    };
    const tasks = planToGanttTasks(plan);
    expect(tasks.map((task) => task.id)).toEqual([
      'g-root',
      'g-mid',
      'g-leaf',
    ]);
    expect(tasks[0].type).toBe('summary');
    expect(tasks[0].open).toBe(true);
    expect(tasks[1].parent).toBe('g-root');
    expect(tasks[2].parent).toBe('g-mid');
  });

  it('задачи получают parent группы и идут после групп', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      groups: [{ id: 'g-1', title: 'Фаза 1' }],
      tasks: [
        {
          id: 't-1',
          title: 'Задача',
          groupId: 'g-1',
          start: '2026-10-12',
          end: '2026-10-13',
        },
      ],
    };
    const tasks = planToGanttTasks(plan);
    expect(tasks[0].id).toBe('g-1');
    expect(tasks[1].parent).toBe('g-1');
  });

  it('задача без группы не имеет parent', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      tasks: [
        { id: 't-1', title: 'Свободная', start: '2026-10-12', end: '2026-10-13' },
      ],
    };
    const [task] = planToGanttTasks(plan);
    expect('parent' in task).toBe(false);
  });

  it('пустой план даёт пустой список', () => {
    expect(planToGanttTasks(createPlanContent())).toEqual([]);
    expect(planToGanttLinks(createPlanContent())).toEqual([]);
  });
});

describe('planToGanttLinks — FS-связи', () => {
  it('e2s с лагом из документа и id зависимости', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      tasks: [
        { id: 't-a', title: 'A', start: '2026-10-12', end: '2026-10-16' },
        { id: 't-b', title: 'B', start: '2026-10-19', end: '2026-10-20' },
      ],
      dependencies: [
        { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 2 },
      ],
    };
    expect(planToGanttLinks(plan)).toEqual([
      { id: 'd-1', source: 't-a', target: 't-b', type: 'e2s', lag: 2 },
    ]);
  });
});

describe('golden: контрольный набор PBT-012 (small-plan)', () => {
  // Перенос контрольного набора в тесты адаптера (design D1 PBT-030):
  // формат v1 эквивалентен фикстуре по смыслу (meta → calendar,
  // parallel → allowsParallel, name → title).
  function smallPlan(): PlanContent {
    return {
      title: 'Малый контрольный набор',
      calendar: {
        workingDays: [1, 2, 3, 4, 5],
        holidays: ['2026-10-14'],
        workingExceptions: [],
      },
      workTypes: [
        { id: 'dev', title: 'Разработка', allowsParallel: false },
        { id: 'psi', title: 'ПСИ', allowsParallel: true },
      ],
      resources: [
        { id: 'r1', title: 'Разработчик R1' },
        { id: 'r2', title: 'Разработчик R2' },
      ],
      groups: [{ id: 'g-phase-1', title: 'Фаза 1' }],
      tasks: [
        {
          id: 't-a',
          title: 'Задача A',
          groupId: 'g-phase-1',
          start: '2026-10-12',
          end: '2026-10-16',
          assigneeIds: ['r1'],
          workTypeIds: ['dev'],
        },
        {
          id: 't-b',
          title: 'Задача B (ПСИ)',
          groupId: 'g-phase-1',
          start: '2026-10-19',
          end: '2026-10-20',
          assigneeIds: ['r1'],
          workTypeIds: ['psi'],
        },
        {
          id: 't-c',
          title: 'Задача C',
          groupId: 'g-phase-1',
          start: '2026-10-19',
          end: '2026-10-23',
          assigneeIds: ['r1'],
          workTypeIds: ['dev'],
        },
        {
          id: 't-d',
          title: 'Задача D',
          groupId: 'g-phase-1',
          start: '2026-10-20',
          end: '2026-10-21',
          assigneeIds: ['r1'],
          workTypeIds: ['dev'],
        },
        {
          id: 't-e',
          title: 'Задача E',
          groupId: 'g-phase-1',
          start: '2026-10-26',
          end: '2026-10-28',
          assigneeIds: ['r1'],
          workTypeIds: ['dev'],
        },
      ],
      dependencies: [
        { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 },
      ],
      unavailability: [
        { id: 'u-r1', resourceId: 'r1', start: '2026-10-26', end: '2026-10-27' },
      ],
    };
  }

  it('адаптер даёт сводную, пять задач с +1 днём и FS-связь', () => {
    const tasks = planToGanttTasks(smallPlan());
    expect(tasks).toHaveLength(6);
    const [summary, ...rest] = tasks;
    expect(summary).toEqual({
      id: 'g-phase-1',
      text: 'Фаза 1',
      type: 'summary',
      open: true,
    });
    expect(rest.map((task) => task.id)).toEqual([
      't-a',
      't-b',
      't-c',
      't-d',
      't-e',
    ]);
    expect(rest.every((task) => task.parent === 'g-phase-1')).toBe(true);
    expectGanttDay(rest[0].end as Date, '2026-10-17');
    expectGanttDay(rest[1].end as Date, '2026-10-21');
    expectGanttDay(rest[4].end as Date, '2026-10-29');
    expect(planToGanttLinks(smallPlan())).toEqual([
      { id: 'd-1', source: 't-a', target: 't-b', type: 'e2s', lag: 0 },
    ]);
  });
});

describe('nonWorkingDayKind — подсветка нерабочих дней', () => {
  const plan: PlanContent = {
    ...createPlanContent(),
    calendar: {
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-10-14'],
      workingExceptions: ['2026-10-17'],
    },
  };

  it('суббота и воскресенье — weekend', () => {
    expect(nonWorkingDayKind(plan, '2026-10-17')).toBeUndefined(); // рабочее исключение
    const weekendPlan: PlanContent = {
      ...plan,
      calendar: {
        workingDays: [1, 2, 3, 4, 5],
        holidays: ['2026-10-14'],
        workingExceptions: [],
      },
    };
    expect(nonWorkingDayKind(weekendPlan, '2026-10-17')).toBe('weekend');
    expect(nonWorkingDayKind(weekendPlan, '2026-10-18')).toBe('weekend');
  });

  it('праздник различим среди выходных', () => {
    expect(nonWorkingDayKind(plan, '2026-10-14')).toBe('holiday');
  });

  it('рабочий день не подсвечивается', () => {
    expect(nonWorkingDayKind(plan, '2026-10-12')).toBeUndefined();
  });
});

describe('ganttDayIso — чтение дней подсветки', () => {
  it('локальные компоненты Date дают ISO дня колонки', () => {
    const localNoon = new Date(2026, 9, 14, 12, 0, 0);
    expect(ganttDayIso(localNoon)).toBe('2026-10-14');
  });
});
