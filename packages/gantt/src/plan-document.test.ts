import { describe, expect, it } from 'vitest';
import {
  createPlanContent,
  parsePlanContent,
  planTitle,
  type PlanContent,
} from './plan-document';

function validPlan(): PlanContent {
  const plan = createPlanContent('ОКАД');
  return {
    ...plan,
    workTypes: [{ id: 'wt-dev', title: 'Разработка', allowsParallel: false }],
    resources: [
      { id: 'r-qa', title: 'QA' },
      { id: 'r-qa2', title: 'QA2' },
    ],
    groups: [
      { id: 'g-ios', title: 'iOS' },
      { id: 'g-okad', title: 'ОКАД', parentId: 'g-ios' },
    ],
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
      {
        id: 't-b',
        title: 'Разработка',
        start: '2026-10-19',
        end: '2026-10-23',
      },
    ],
    dependencies: [
      { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 },
    ],
    unavailability: [{ id: 'u-1', resourceId: 'r-qa', start: '2026-10-26', end: '2026-10-27' }],
  };
}

describe('createPlanContent', () => {
  it('создаёт пустой план с календарём пн–пт', () => {
    const plan = createPlanContent();
    expect(plan.title).toBeUndefined();
    expect(plan.calendar).toEqual({
      workingDays: [1, 2, 3, 4, 5],
      holidays: [],
      workingExceptions: [],
    });
    expect(plan.workTypes).toEqual([]);
    expect(plan.resources).toEqual([]);
    expect(plan.groups).toEqual([]);
    expect(plan.tasks).toEqual([]);
    expect(plan.dependencies).toEqual([]);
    expect(plan.unavailability).toEqual([]);
  });

  it('сохраняет переданное название', () => {
    expect(createPlanContent('ОКАД').title).toBe('ОКАД');
  });

  it('планы не разделяют коллекции', () => {
    const first = createPlanContent('Первый');
    const second = createPlanContent('Второй');
    expect(first.resources).not.toBe(second.resources);
    expect(first.calendar).not.toBe(second.calendar);

    const withResources: PlanContent = {
      ...first,
      resources: [{ id: 'r-qa', title: 'QA' }],
    };
    expect(second.resources).toEqual([]);
    expect(withResources.resources).toHaveLength(1);
  });

  it('planTitle возвращает название или заглушку', () => {
    expect(planTitle(createPlanContent('План'))).toBe('План');
    expect(planTitle({})).toBe('Без названия');
  });
});

describe('parsePlanContent — корректные документы', () => {
  it('заполненный план проходит валидацию', () => {
    const result = parsePlanContent(validPlan());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.tasks).toHaveLength(2);
      expect(result.plan.title).toBe('ОКАД');
    }
  });

  it('рабочее исключение спасает календарь без рабочих дней недели', () => {
    const plan = {
      ...createPlanContent(),
      calendar: {
        workingDays: [],
        holidays: [],
        workingExceptions: ['2026-10-17'],
      },
    };
    expect(parsePlanContent(plan).ok).toBe(true);
  });
});

describe('parsePlanContent — повреждённые документы', () => {
  it('не-объект отклоняется с диагностикой структуры', () => {
    const result = parsePlanContent('нет');
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'invalid-structure',
          path: '',
          message: 'Содержимое плана должно быть объектом.',
        },
      ],
    });
  });

  it('неверная дата даёт invalid-date', () => {
    const plan = validPlan();
    const broken = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === 't-a' ? { ...task, start: '2026-13-40' } : task,
      ),
    };
    const result = parsePlanContent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'invalid-date')).toBe(true);
    }
  });

  it('неверный день недели даёт invalid-weekday', () => {
    const plan = createPlanContent();
    const broken = {
      ...plan,
      calendar: { ...plan.calendar, workingDays: [1, 9] },
    };
    const result = parsePlanContent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'invalid-weekday' }),
      ]);
    }
  });

  it('отрицательный и дробный лаг дают invalid-lag', () => {
    const base = validPlan();
    for (const lagDays of [-3, 1.5]) {
      const broken = {
        ...base,
        dependencies: base.dependencies.map((dependency) => ({
          ...dependency,
          lagDays,
        })),
      };
      const result = parsePlanContent(broken);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.issues.some((issue) => issue.code === 'invalid-lag'),
        ).toBe(true);
      }
    }
  });

  it('дубликат идентификатора задачи даёт duplicate-id', () => {
    const plan = validPlan();
    const broken = {
      ...plan,
      tasks: [
        ...plan.tasks,
        { ...plan.tasks[0], title: 'Дубль' },
      ],
    };
    const result = parsePlanContent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((issue) => issue.code === 'duplicate-id'),
      ).toBe(true);
    }
  });

  it('битые ссылки дают unknown-reference с указанием пути', () => {
    const plan = validPlan();
    const broken: PlanContent = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === 't-a'
          ? { ...task, groupId: 'g-нет', assigneeIds: ['r-нет'] }
          : task,
      ),
      dependencies: [
        { id: 'd-1', fromTaskId: 't-нет', toTaskId: 't-b', lagDays: 0 },
      ],
      unavailability: [
        { id: 'u-1', resourceId: 'r-нет', start: '2026-10-26', end: '2026-10-27' },
      ],
      groups: plan.groups.map((group) =>
        group.id === 'g-okad' ? { ...group, parentId: 'g-нет' } : group,
      ),
    };
    const result = parsePlanContent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues
        .filter((issue) => issue.code === 'unknown-reference')
        .map((issue) => issue.path);
      expect(paths).toEqual([
        'groups[1].parentId',
        'tasks[0].groupId',
        'tasks[0].assigneeIds',
        'dependencies[0].fromTaskId',
        'unavailability[0].resourceId',
      ]);
    }
  });

  it('цикл групп и само-родительство дают circular-group', () => {
    const plan = createPlanContent();
    const selfCycle = {
      ...plan,
      groups: [{ id: 'g-a', title: 'A', parentId: 'g-a' }],
    };
    const mutual = {
      ...plan,
      groups: [
        { id: 'g-a', title: 'A', parentId: 'g-b' },
        { id: 'g-b', title: 'B', parentId: 'g-a' },
      ],
    };
    for (const broken of [selfCycle, mutual]) {
      const result = parsePlanContent(broken);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.issues.some((issue) => issue.code === 'circular-group'),
        ).toBe(true);
      }
    }
  });

  it('перевёрнутый интервал задачи и недоступности даёт inverted-interval', () => {
    const plan = validPlan();
    const broken = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === 't-b'
          ? { ...task, start: '2026-10-30', end: '2026-10-20' }
          : task,
      ),
      unavailability: [
        { id: 'u-1', resourceId: 'r-qa', start: '2026-10-28', end: '2026-10-27' },
      ],
    };
    const result = parsePlanContent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.filter((issue) => issue.code === 'inverted-interval'),
      ).toHaveLength(2);
    }
  });

  it('пустой календарь отклоняется', () => {
    const plan = {
      ...createPlanContent(),
      calendar: { workingDays: [], holidays: [], workingExceptions: [] },
    };
    const result = parsePlanContent(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toEqual({
        code: 'empty-calendar',
        path: 'calendar',
        message: 'Календарь без рабочих дней и рабочих исключений недопустим.',
      });
    }
  });

  it('повреждённый документ не становится рабочим планом', () => {
    const plan = validPlan();
    const broken = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === 't-a' ? { ...task, end: 'не дата' } : task,
      ),
    };
    const result = parsePlanContent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect('plan' in result).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});
