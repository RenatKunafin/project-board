import { describe, expect, it } from 'vitest';
import { createPlanContent, type PlanContent } from './plan-document';
import {
  ISSUE_KIND_LABEL,
  ISSUE_KIND_ORDER,
  buildPlanIssues,
  filterPlanIssues,
  issueDateLabel,
  issueKindCounts,
} from './plan-issues';

/**
 * Контрольный план (PBT-088): по одной проблеме каждого вида.
 * FS: b начинается раньше окончания a; работы: c и d одного ресурса
 * с непараллельным типом пересекаются; отпуск: e назначена r-dev,
 * пересекается с недоступностью r-dev.
 */
function controlPlan(): PlanContent {
  const base = createPlanContent('Проблемы');
  return {
    ...base,
    resources: [
      { id: 'r-dev', title: 'Разработчик Один' },
      { id: 'r-qa', title: 'QA Ведущий' },
    ],
    workTypes: [{ id: 'wt-dev', title: 'Разработка', allowsParallel: false }],
    tasks: [
      { id: 'a', title: 'Подготовка стенда с очень длинным названием задачи', start: '2026-10-12', end: '2026-10-16' },
      { id: 'b', title: 'Приёмка', start: '2026-10-14', end: '2026-10-16', assigneeIds: ['r-qa'] },
      { id: 'c', title: 'Ядро первая работа', start: '2026-10-19', end: '2026-10-22', assigneeIds: ['r-dev'], workTypeIds: ['wt-dev'] },
      { id: 'd', title: 'Ядро вторая работа', start: '2026-10-21', end: '2026-10-23', assigneeIds: ['r-dev'], workTypeIds: ['wt-dev'] },
      { id: 'e', title: 'Отпускная задача', start: '2026-11-09', end: '2026-11-10', assigneeIds: ['r-dev'] },
    ],
    dependencies: [{ id: 'ab', fromTaskId: 'a', toTaskId: 'b', lagDays: 0 }],
    unavailability: [{ id: 'u1', resourceId: 'r-dev', start: '2026-11-09', end: '2026-11-10' }],
  };
}

describe('buildPlanIssues — структура из полей ядра', () => {
  const issues = buildPlanIssues(controlPlan());

  it('три вида в порядке FS → работы → отпуск, без изменения числа', () => {
    expect(issues.map((issue) => issue.kind)).toEqual([
      'dependency',
      'parallel-work',
      'unavailability',
    ]);
    expect(ISSUE_KIND_ORDER).toEqual(['dependency', 'parallel-work', 'unavailability']);
  });

  it('нарушение FS: участники обе задачи, ожидание и факт', () => {
    const fs = issues[0];
    expect(fs.taskId).toBe('b');
    expect(fs.taskIds).toEqual(['a', 'b']);
    expect(fs.expectedStart).toBe('2026-10-19');
    expect(fs.actualStart).toBe('2026-10-14');
    expect(fs.message).toBeTruthy();
  });

  it('конфликт работ: участники, ресурс и интервал пересечения', () => {
    const work = issues[1];
    expect(work.taskId).toBe('c');
    expect(work.taskIds).toEqual(['c', 'd']);
    expect(work.resourceId).toBe('r-dev');
    expect(work.intervalStart).toBe('2026-10-21');
    expect(work.intervalEnd).toBe('2026-10-22');
  });

  it('отпуск: задача, ресурс и интервал', () => {
    const vacation = issues[2];
    expect(vacation.taskId).toBe('e');
    expect(vacation.taskIds).toEqual(['e']);
    expect(vacation.resourceId).toBe('r-dev');
    expect(vacation.intervalStart).toBe('2026-11-09');
  });

  it('чистый план — пустой список', () => {
    expect(buildPlanIssues(createPlanContent('Пустой'))).toEqual([]);
  });
});

describe('фильтры и поиск', () => {
  const plan = controlPlan();
  const issues = buildPlanIssues(plan);

  it('счётчики по полному ядру', () => {
    expect(issueKindCounts(issues)).toEqual({
      dependency: 1,
      'parallel-work': 1,
      unavailability: 1,
    });
  });

  it('фильтр типа скрывает прочие записи', () => {
    expect(
      filterPlanIssues(issues, plan, 'parallel-work', '').map((issue) => issue.kind),
    ).toEqual(['parallel-work']);
    expect(filterPlanIssues(issues, plan, 'all', '')).toHaveLength(3);
  });

  it('поиск по названию задачи-участника', () => {
    expect(filterPlanIssues(issues, plan, 'all', 'приёмка')).toHaveLength(1);
    // Участник FS-записи «a» находится поиском, цель — «b».
    expect(filterPlanIssues(issues, plan, 'all', 'стенда')[0].taskId).toBe('b');
  });

  it('поиск по исполнителю назначений и ресурсу пересечения', () => {
    expect(filterPlanIssues(issues, plan, 'all', 'QA Ведущий')).toHaveLength(1);
    expect(filterPlanIssues(issues, plan, 'all', 'разработчик')[0].kind).toBe('parallel-work');
  });

  it('фильтр и поиск комбинируются; пустой результат различим', () => {
    expect(filterPlanIssues(issues, plan, 'dependency', 'отпускная')).toHaveLength(0);
    expect(filterPlanIssues(issues, plan, 'all', 'несуществующее')).toHaveLength(0);
  });
});

describe('issueDateLabel', () => {
  it('ISO → дд.ММ.гггг', () => {
    expect(issueDateLabel('2026-10-21')).toBe('21.10.2026');
    expect(ISSUE_KIND_LABEL.dependency).toBe('Нарушение FS');
  });
});
