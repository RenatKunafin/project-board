import { describe, expect, it } from 'vitest';
import { createPlanContent, type PlanContent } from './plan-document';
import { resourceConflicts } from './plan-conflicts';
import {
  planToTimelineGroups,
  planToTimelineItems,
  timelineConflictMarks,
  timelineDayIso,
  timelineDayStartMs,
  timelineRange,
} from './resource-timeline-adapter';

function expectLocalDay(ms: number, isoDate: string): void {
  // Локальная полночь: проверяем локальные компоненты даты.
  const date = new Date(ms);
  expect(date.getFullYear()).toBe(Number(isoDate.slice(0, 4)));
  expect(date.getMonth() + 1).toBe(Number(isoDate.slice(5, 7)));
  expect(date.getDate()).toBe(Number(isoDate.slice(8, 10)));
  expect(date.getHours()).toBe(0);
}

describe('planToTimelineGroups — дорожки ресурсов', () => {
  it('ресурсы в порядке массива документа', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      resources: [
        { id: 'r-qa', title: 'QA' },
        { id: 'r-qa2', title: 'QA2' },
      ],
    };
    expect(planToTimelineGroups(plan)).toEqual([
      { id: 'r-qa', title: 'QA' },
      { id: 'r-qa2', title: 'QA2' },
    ]);
  });

  it('пустой справочник — пустой список групп', () => {
    expect(planToTimelineGroups(createPlanContent())).toEqual([]);
  });
});

describe('planToTimelineItems — назначения и границы (ADR-4)', () => {
  it('задача на дорожке каждого назначенного ресурса (D1)', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      resources: [
        { id: 'r-qa', title: 'QA' },
        { id: 'r-qa2', title: 'QA2' },
      ],
      tasks: [
        {
          id: 't-1',
          title: 'Согласование',
          start: '2026-10-12',
          end: '2026-10-13',
          assigneeIds: ['r-qa', 'r-qa2'],
        },
      ],
    };
    const items = planToTimelineItems(plan);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('t-1:r-qa');
    expect(items[0].group).toBe('r-qa');
    expect(items[1].id).toBe('t-1:r-qa2');
    expect(items[1].group).toBe('r-qa2');
    expect(items[0].title).toBe('Согласование');
  });

  it('неназначенная задача не отображается (D2)', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      resources: [{ id: 'r-qa', title: 'QA' }],
      tasks: [
        { id: 't-1', title: 'Без ресурса', start: '2026-10-12', end: '2026-10-13' },
        {
          id: 't-2',
          title: 'С ресурсом',
          start: '2026-10-12',
          end: '2026-10-13',
          assigneeIds: ['r-qa'],
        },
      ],
    };
    const items = planToTimelineItems(plan);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('t-2:r-qa');
  });

  it('включительное окончание → полночь следующего дня (A1), локальные полночи', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      resources: [{ id: 'r-qa', title: 'QA' }],
      tasks: [
        {
          id: 't-1',
          title: 'Неделя',
          start: '2026-10-12',
          end: '2026-10-16',
          assigneeIds: ['r-qa'],
        },
      ],
    };
    const [item] = planToTimelineItems(plan);
    expectLocalDay(item.start_time, '2026-10-12');
    expectLocalDay(item.end_time, '2026-10-17');
    expect(item.end_time - item.start_time).toBe(5 * 86_400_000);
  });

  it('задачи жестовые (PBT-048): canMove + canResize both; недоступность — нет', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      resources: [{ id: 'r-qa', title: 'QA' }],
      tasks: [
        {
          id: 't-1',
          title: 'Работа',
          start: '2026-10-12',
          end: '2026-10-13',
          assigneeIds: ['r-qa'],
        },
      ],
      unavailability: [
        { id: 'u-1', resourceId: 'r-qa', start: '2026-10-26', end: '2026-10-27' },
      ],
    };
    const items = planToTimelineItems(plan);
    expect(items[0].canMove).toBe(true);
    expect(items[0].canResize).toBe('both');
    expect(items[1].canMove).toBe(false);
    expect(items[1].canResize).toBe(false);
    expect(items[0].className).toBeUndefined();
  });

  it('стили задач — токены accent; data-атрибуты для e2e-локаторов', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      resources: [{ id: 'r-qa', title: 'QA' }],
      tasks: [
        {
          id: 't-1',
          title: 'Работа',
          start: '2026-10-12',
          end: '2026-10-13',
          assigneeIds: ['r-qa'],
        },
      ],
    };
    const [item] = planToTimelineItems(plan);
    // Стиль — в itemProps.style: дефолтный itemRenderer беты мерджит
    // только itemProps (поле item.style игнорирует).
    expect(item.itemProps?.style).toMatchObject({
      background: 'var(--color-accent)',
      // бордер темнее фона — стык соседних задач не сливается
      borderColor: 'var(--color-rt-task-border)',
    });
    expect(item.itemProps).toMatchObject({ 'data-rt-task': 't-1' });
  });

  it('недоступность — элемент у своего ресурса без жестов, отличен от задач', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      resources: [
        { id: 'r-qa', title: 'QA' },
        { id: 'r-qa2', title: 'QA2' },
      ],
      unavailability: [
        { id: 'u-1', resourceId: 'r-qa', start: '2026-10-26', end: '2026-10-27' },
      ],
    };
    const items = planToTimelineItems(plan);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('u-u-1');
    expect(items[0].group).toBe('r-qa');
    expectLocalDay(items[0].start_time, '2026-10-26');
    expectLocalDay(items[0].end_time, '2026-10-28');
    expect(items[0].className).toBe('rtl-item--unavailability');
    expect(items[0].canMove).toBe(false);
    expect(items[0].itemProps?.style).toMatchObject({
      background: 'var(--color-rt-unavailability-bg)',
    });
    expect(items[0].itemProps).toMatchObject({
      'data-rt-unavailability': 'u-1',
    });
  });
});

describe('timelineConflictMarks — отметки конфликтов ядра (PBT-036)', () => {
  function conflictedPlan(): PlanContent {
    return {
      ...createPlanContent(),
      workTypes: [
        { id: 'wt-dev', title: 'Разработка', allowsParallel: false },
        { id: 'wt-psi', title: 'ПСИ', allowsParallel: true },
      ],
      resources: [{ id: 'r-qa', title: 'QA' }],
      tasks: [
        {
          id: 't-dev',
          title: 'Разработка',
          start: '2026-10-12',
          end: '2026-10-16',
          assigneeIds: ['r-qa'],
          workTypeIds: ['wt-dev'],
        },
        {
          id: 't-infra',
          title: 'Инфраструктура',
          start: '2026-10-15',
          end: '2026-10-19',
          assigneeIds: ['r-qa'],
          workTypeIds: ['wt-dev'],
        },
        {
          id: 't-psi',
          title: 'ПСИ',
          start: '2026-10-13',
          end: '2026-10-14',
          assigneeIds: ['r-qa'],
          workTypeIds: ['wt-psi'],
        },
      ],
      unavailability: [
        { id: 'u-1', resourceId: 'r-qa', start: '2026-10-13', end: '2026-10-14' },
      ],
    };
  }

  it('пара конфликтных работ отмечается, допустимое пересечение — нет', () => {
    const plan = conflictedPlan();
    const marks = timelineConflictMarks(resourceConflicts(plan));
    expect(marks.taskIds.has('t-dev')).toBe(true);
    expect(marks.taskIds.has('t-infra')).toBe(true);
    expect(marks.taskIds.has('t-psi')).toBe(true); // ПСИ в отпуске (D6)
    expect(marks.unavailabilityIds.has('u-1')).toBe(true);
    // Отдельная задача ПСИ (пересечение с Разработкой допустимо) — не отмечена:
    // отметка только по диагностике ядра.
    const conflictOnlyDev = timelineConflictMarks(
      resourceConflicts({ ...plan, unavailability: [] }),
    );
    expect(conflictOnlyDev.taskIds.has('t-psi')).toBe(false);
    expect(conflictOnlyDev.unavailabilityIds.size).toBe(0);
  });

  it('конфликтные элементы получают className rtl-item--conflict', () => {
    const plan = conflictedPlan();
    const items = planToTimelineItems(
      plan,
      timelineConflictMarks(resourceConflicts(plan)),
    );
    const byId = new Map(items.map((item) => [item.id, item] as const));
    expect(byId.get('t-dev:r-qa')?.className).toBe('rtl-item--conflict');
    expect(byId.get('t-infra:r-qa')?.className).toBe('rtl-item--conflict');
    expect(byId.get('t-psi:r-qa')?.className).toBe('rtl-item--conflict');
    expect(byId.get('u-u-1')?.className).toBe(
      'rtl-item--unavailability rtl-item--conflict',
    );
  });
});

describe('timelineRange — диапазон шкалы (D7)', () => {
  it('запас −5/+25 дней от min/max задач и недоступностей', () => {
    const plan: PlanContent = {
      ...createPlanContent(),
      tasks: [
        { id: 't-1', title: 'A', start: '2026-10-12', end: '2026-10-16' },
        { id: 't-2', title: 'B', start: '2026-11-02', end: '2026-11-06' },
      ],
      unavailability: [
        { id: 'u-1', resourceId: 'r', start: '2026-10-26', end: '2026-10-27' },
      ],
    };
    const range = timelineRange(plan);
    expectLocalDay(range.start, '2026-10-07'); // 2026-10-12 − 5 дней
    expectLocalDay(range.end, '2026-12-01'); // 2026-11-06 + 25 дней
  });

  it('пустой план — соседние месяцы текущей даты', () => {
    const range = timelineRange(createPlanContent());
    const start = new Date(range.start);
    const end = new Date(range.end);
    const now = new Date();
    expect(start.getFullYear()).toBe(now.getFullYear());
    expect(start.getMonth()).toBe(now.getMonth() - 1);
    expect(end.getTime()).toBeGreaterThan(range.start);
  });
});

describe('timelineDayIso / timelineDayStartMs — подсветка дней', () => {
  it('мс локального времени дают ISO дня колонки', () => {
    const localNoon = new Date(2026, 9, 14, 12, 0, 0).getTime();
    expect(timelineDayIso(localNoon)).toBe('2026-10-14');
  });

  it('обратимость ISO → мс → ISO', () => {
    expect(timelineDayIso(timelineDayStartMs('2026-10-14'))).toBe('2026-10-14');
  });
});
