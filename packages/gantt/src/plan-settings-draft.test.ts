import { expect, it } from 'vitest';
import { createPlanContent } from './plan-document';
import { prepareSettingsNames } from './plan-settings-draft';

const plan = {
  ...createPlanContent(),
  resources: [{ id: 'r', title: 'QA' }],
  workTypes: [{ id: 'w', title: 'ПСИ', allowsParallel: true }],
  tasks: [{ id: 't', title: 'Работа', start: '2026-10-12', end: '2026-10-16', assigneeIds: ['r'], workTypeIds: ['w'] }],
};

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
