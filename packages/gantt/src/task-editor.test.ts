import { describe, expect, it } from 'vitest';
import { buildTaskDates, validateTaskForm } from './task-editor';
import { createPlanContent, parsePlanContent } from './plan-document';

function plan() {
  const validation = parsePlanContent({
    ...createPlanContent('Тест'),
    calendar: {
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-10-14'],
      workingExceptions: [],
    },
    groups: [{ id: 'g-1', title: 'Направление', parentGroupId: undefined }],
  });
  if (!validation.ok) {
    throw new Error('фикстура не прошла валидацию');
  }
  return validation.plan;
}

describe('validateTaskForm', () => {
  const base = { title: 'Задача', start: '2026-10-12', durationDays: 3 };

  it('пустое название отклоняется по полю title', () => {
    const issue = validateTaskForm({ ...base, title: '   ' }, plan());
    expect(issue).toEqual({
      field: 'title',
      message: 'Название не может быть пустым.',
    });
  });

  it('не-ISO дата начала отклоняется по полю start', () => {
    const issue = validateTaskForm({ ...base, start: '12.10.2026' }, plan());
    expect(issue?.field).toBe('start');
  });

  it('нулевая и дробная длительность отклоняются по полю duration', () => {
    expect(validateTaskForm({ ...base, durationDays: 0 }, plan())?.field).toBe(
      'duration',
    );
    expect(
      validateTaskForm({ ...base, durationDays: 1.5 }, plan())?.field,
    ).toBe('duration');
  });

  it('несуществующая группа отклоняется по полю group', () => {
    const issue = validateTaskForm({ ...base, groupId: 'g-404' }, plan());
    expect(issue?.field).toBe('group');
  });

  it('корректный ввод и известная группа проходят', () => {
    expect(validateTaskForm({ ...base, groupId: 'g-1' }, plan())).toBeUndefined();
  });
});

describe('buildTaskDates', () => {
  it('окончание вычисляется включительно по рабочим дням (праздник в середине)', () => {
    expect(buildTaskDates({ start: '2026-10-12', durationDays: 3 }, plan())).toEqual({
      start: '2026-10-12',
      end: '2026-10-15',
    });
  });

  it('праздник в середине растягивает окончание (среда 14.10 — праздник)', () => {
    expect(buildTaskDates({ start: '2026-10-13', durationDays: 3 }, plan())).toEqual({
      start: '2026-10-13',
      end: '2026-10-16',
    });
  });

  it('длительность 1 при рабочем начале — окончание совпадает с началом', () => {
    expect(buildTaskDates({ start: '2026-10-12', durationDays: 1 }, plan())).toEqual({
      start: '2026-10-12',
      end: '2026-10-12',
    });
  });

  it('нерабочее начало сдвигает окончание к следующему рабочему дню', () => {
    expect(buildTaskDates({ start: '2026-10-17', durationDays: 1 }, plan())).toEqual({
      start: '2026-10-17',
      end: '2026-10-19',
    });
  });
});
