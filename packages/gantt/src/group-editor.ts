import type { PlanContent, PlanGroup } from './plan-document';

/** Поля формы группы — источник доменных ошибок по коду поля. */
export type GroupFormField = 'title' | 'parent';

export interface GroupFormIssue {
  readonly field: GroupFormField;
  readonly message: string;
}

export interface GroupFormInput {
  readonly title: string;
  /** Пустая строка/undefined — корень плана. */
  readonly parentId?: string;
}

/**
 * Клиентская валидация формы группы: непустое название, родитель —
 * существующая группа. Циклы вложенности проверяет только ядро
 * (перенос в собственного потомка) — их ошибка показывается из ядра.
 */
export function validateGroupForm(
  input: GroupFormInput,
  plan: PlanContent,
): GroupFormIssue | undefined {
  if (input.title.trim() === '') {
    return { field: 'title', message: 'Название не может быть пустым.' };
  }
  if (
    input.parentId !== undefined &&
    !plan.groups.some((group) => group.id === input.parentId)
  ) {
    return { field: 'parent', message: 'Выбранная группа не существует.' };
  }
  return undefined;
}

/**
 * Варианты родителя для формы: все группы, кроме редактируемой
 * (самоперенос бессмыслен); подгруппы не исключаются — перенос в
 * собственного потомка отклоняет ядро с объяснением (DoD PBT-040).
 */
export function availableParentOptions(
  plan: PlanContent,
  excludeGroupId?: string,
): readonly PlanGroup[] {
  return plan.groups.filter((group) => group.id !== excludeGroupId);
}
