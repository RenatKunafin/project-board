import { describe, expect, it } from 'vitest';
import { createPlanContent, type PlanContent } from './plan-document';
import {
  filterPlanForView,
  planFilterActive,
} from './plan-view-filter';

function plan(): PlanContent {
  return {
    ...createPlanContent(),
    groups: [
      { id: 'g-root', title: 'ОКАД' },
      { id: 'g-ios', title: 'iOS', parentId: 'g-root' },
      { id: 'g-empty', title: 'Пустая' },
    ],
    resources: [
      { id: 'r-qa', title: 'QA' },
      { id: 'r-qa2', title: 'QA2' },
    ],
    tasks: [
      {
        id: 't-dev',
        title: 'Разработка iOS',
        groupId: 'g-ios',
        assigneeIds: ['r-qa'],
        start: '2026-10-12',
        end: '2026-10-16',
      },
      {
        id: 't-psi',
        title: 'ПСИ',
        assigneeIds: ['r-qa2'],
        start: '2026-10-19',
        end: '2026-10-20',
      },
    ],
  };
}

describe('filterPlanForView — фильтр представления (PBT-049)', () => {
  it('подстрока названия без учёта регистра; группы-предки видимы', () => {
    const filtered = filterPlanForView(plan(), { query: 'разработка' });
    expect(filtered.tasks.map((task) => task.id)).toEqual(['t-dev']);
    expect(filtered.groups.map((group) => group.id)).toEqual([
      'g-root',
      'g-ios',
    ]);
  });

  it('фильтр по ресурсу скрывает чужие задачи', () => {
    const filtered = filterPlanForView(plan(), { resourceId: 'r-qa' });
    expect(filtered.tasks.map((task) => task.id)).toEqual(['t-dev']);
  });

  it('неизвестный ресурс в фильтре — пусто (устаревший фильтр безопасен)', () => {
    const filtered = filterPlanForView(plan(), { resourceId: 'r-gone' });
    expect(filtered.tasks).toEqual([]);
    expect(filtered.groups).toEqual([]);
  });

  it('пустой результат: задачи и группы очищены, прочие разделы целы', () => {
    const filtered = filterPlanForView(plan(), { query: 'нет-такой' });
    expect(filtered.tasks).toEqual([]);
    expect(filtered.groups).toEqual([]);
    expect(filtered.resources).toEqual(plan().resources);
    expect(filtered.workTypes).toEqual(plan().workTypes);
    expect(filtered.unavailability).toEqual(plan().unavailability);
  });

  it('пустой фильтр возвращает исходный план (тот же объект)', () => {
    const source = plan();
    expect(filterPlanForView(source, {})).toBe(source);
    expect(filterPlanForView(source, { query: '  ' })).toBe(source);
  });

  it('скрытые задачи доступны в полном плане (фильтр — производное)', () => {
    const source = plan();
    filterPlanForView(source, { query: 'ПСИ' });
    expect(source.tasks).toHaveLength(2);
  });
});

describe('planFilterActive', () => {
  it('активен при непустой подстроке или ресурсе', () => {
    expect(planFilterActive({})).toBe(false);
    expect(planFilterActive({ query: '  ' })).toBe(false);
    expect(planFilterActive({ query: 'ПСИ' })).toBe(true);
    expect(planFilterActive({ resourceId: 'r-qa' })).toBe(true);
  });
});
