import { describe, expect, it } from 'vitest';
import { availableParentOptions, validateGroupForm } from './group-editor';
import { createPlanContent, parsePlanContent } from './plan-document';

function plan() {
  const validation = parsePlanContent({
    ...createPlanContent('Тест'),
    calendar: {
      workingDays: [1, 2, 3, 4, 5],
      holidays: [],
      workingExceptions: [],
    },
    groups: [
      { id: 'g-1', title: 'Направление' },
      { id: 'g-2', title: 'Платформа', parentId: 'g-1' },
    ],
  });
  if (!validation.ok) {
    throw new Error('фикстура не прошла валидацию');
  }
  return validation.plan;
}

describe('validateGroupForm', () => {
  it('пустое название отклоняется по полю title', () => {
    const issue = validateGroupForm({ title: '   ' }, plan());
    expect(issue).toEqual({
      field: 'title',
      message: 'Название не может быть пустым.',
    });
  });

  it('несуществующий родитель отклоняется по полю parent', () => {
    const issue = validateGroupForm({ title: 'Группа', parentId: 'g-404' }, plan());
    expect(issue?.field).toBe('parent');
  });

  it('корень (без родителя) и существующий родитель проходят', () => {
    expect(validateGroupForm({ title: 'Группа' }, plan())).toBeUndefined();
    expect(
      validateGroupForm({ title: 'Группа', parentId: 'g-1' }, plan()),
    ).toBeUndefined();
  });

  it('цикл вложенности форма не проверяет — его отклоняет ядро', () => {
    // Перенос g-1 в собственного потомка g-2: клиентская валидация
    // пропускает, сообщение покажется из ошибки ядра (DoD PBT-040).
    expect(
      validateGroupForm({ title: 'Направление', parentId: 'g-2' }, plan()),
    ).toBeUndefined();
  });
});

describe('availableParentOptions', () => {
  it('редактируемая группа исключается, остальные и порядок сохраняются', () => {
    const options = availableParentOptions(plan(), 'g-1');
    expect(options.map((group) => group.id)).toEqual(['g-2']);
  });

  it('без исключения возвращаются все группы', () => {
    expect(availableParentOptions(plan()).length).toBe(2);
  });
});
