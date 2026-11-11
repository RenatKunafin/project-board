import { describe, expect, it } from 'vitest';
import { createPlanContent } from './plan-document';
import { prepareSettingsNames } from './plan-settings-draft';
import { applyPlanCommand, type PlanCommandResult } from './plan-commands';

const plan = {
  ...createPlanContent(),
  resources: [{ id: 'r', title: 'QA' }],
  workTypes: [{ id: 'w', title: 'ПСИ', allowsParallel: true }],
  tasks: [{ id: 't', title: 'Работа', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r'], workTypeIds: ['w'] }],
};

function ok(result: PlanCommandResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.plan;
}

it('подготавливает имена вместе, сохраняя ID, назначения и исходный план', () => {
  const result = prepareSettingsNames(plan, new Map([['r', ' QA2 ']]), new Map([['w', ' Приёмка ']]));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.issue.message);
  expect(result.plan.resources).toEqual([{ id: 'r', title: 'QA2' }]);
  expect(result.plan.workTypes).toEqual([{ id: 'w', title: 'Приёмка', allowsParallel: true }]);
  expect(result.plan.tasks).toEqual(plan.tasks);
  expect(plan.resources[0].title).toBe('QA');
});

it('ошибка имени другого раздела не применяет предыдущие правки частично', () => {
  const result = prepareSettingsNames(plan, new Map([['r', 'QA2']]), new Map([['w', '   ']]));
  expect(result).toEqual({ ok: false, issue: { section: 'workTypes', id: 'w', message: 'Название не может быть пустым.' } });
  expect(plan.resources[0].title).toBe('QA');
  expect(plan.workTypes[0].title).toBe('ПСИ');
});

describe('черновик календаря — особые даты (PBT-141)', () => {
  it('метки накапливаются поверх календаря в одном черновике, исходный план не тронут', () => {
    let draft = ok(
      applyPlanCommand(plan, {
        type: 'updateCalendar',
        workingDays: [1, 2, 3, 4, 5],
        holidays: ['2026-10-14'],
        workingExceptions: [],
      }),
    );
    draft = ok(
      applyPlanCommand(draft, {
        type: 'updateDateMarks',
        marks: [{ date: '2026-10-14', color: 'coral' }],
      }),
    );
    draft = ok(
      applyPlanCommand(draft, {
        type: 'updateDateMarks',
        marks: [
          { date: '2026-10-14', color: 'coral' },
          { date: '2026-10-17', color: 'jade' },
        ],
      }),
    );
    expect(draft.calendar.holidays).toEqual(['2026-10-14']);
    expect(draft.dateMarks).toEqual([
      { date: '2026-10-14', color: 'coral' },
      { date: '2026-10-17', color: 'jade' },
    ]);
    // Отмена без сохранения: документ-источник остался без меток.
    expect('dateMarks' in plan).toBe(false);
    expect(plan.calendar.holidays).toEqual([]);
  });

  it('повторное добавление даты перекрашивает её (последний выбор выигрывает)', () => {
    const withMark = ok(
      applyPlanCommand(plan, {
        type: 'updateDateMarks',
        marks: [{ date: '2026-10-14', color: 'coral' }],
      }),
    );
    const recolored = ok(
      applyPlanCommand(withMark, {
        type: 'updateDateMarks',
        marks: [{ date: '2026-10-14', color: 'jade' }],
      }),
    );
    expect(recolored.dateMarks).toEqual([{ date: '2026-10-14', color: 'jade' }]);
  });
});
