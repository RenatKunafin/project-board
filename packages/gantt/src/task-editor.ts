import { createWorkingCalendar } from './working-calendar';
import type { PlanContent } from './plan-document';

/** Поля формы задачи — источник доменных ошибок по коду поля. */
export type TaskFormField = 'title' | 'group' | 'start' | 'duration' | 'assignments';

export interface TaskFormIssue {
  readonly field: TaskFormField;
  readonly message: string;
}

export interface TaskFormInput {
  readonly title: string;
  readonly groupId?: string;
  readonly start: string;
  readonly durationDays: number;
}

export interface TaskDates {
  readonly start: string;
  readonly end: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Клиентская валидация формы: правило домена одно — непустое название,
 * ISO-дата начала, целая рабочая длительность ≥ 1. Остальные ошибки
 * (неизвестная группа, перевёрнутый интервал) возвращает ядро команд.
 */
export function validateTaskForm(
  input: TaskFormInput,
  plan: PlanContent,
): TaskFormIssue | undefined {
  if (input.title.trim() === '') {
    return { field: 'title', message: 'Название не может быть пустым.' };
  }
  if (!ISO_DATE.test(input.start)) {
    return {
      field: 'start',
      message: 'Дата начала должна быть в формате ГГГГ-ММ-ДД.',
    };
  }
  if (!Number.isInteger(input.durationDays) || input.durationDays < 1) {
    return {
      field: 'duration',
      message: 'Рабочая длительность — целое число дней, не меньше 1.',
    };
  }
  if (
    input.groupId !== undefined &&
    !plan.groups.some((group) => group.id === input.groupId)
  ) {
    return { field: 'group', message: 'Выбранная группа не существует.' };
  }
  return undefined;
}

/**
 * A4-семантика формы (PBT-003): начало + рабочая длительность →
 * включительное окончание по календарю плана. Особый случай ядра:
 * длительность 1 при рабочем начале — окончание совпадает с началом
 * (addWorkingDays(x, 0) всегда даёт следующий рабочий день).
 */
export function buildTaskDates(
  input: Pick<TaskFormInput, 'start' | 'durationDays'>,
  plan: PlanContent,
): TaskDates {
  const calendar = createWorkingCalendar(plan.calendar);
  const end =
    input.durationDays === 1 && calendar.isWorkingDay(input.start)
      ? input.start
      : calendar.addWorkingDays(input.start, input.durationDays - 1);
  return { start: input.start, end };
}
