export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PlanCalendar {
  readonly workingDays: readonly Weekday[];
  readonly holidays: readonly string[];
  readonly workingExceptions: readonly string[];
}

export interface PlanWorkType {
  readonly id: string;
  readonly title: string;
  readonly allowsParallel: boolean;
}

export interface PlanResource {
  readonly id: string;
  readonly title: string;
}

export interface PlanGroup {
  readonly id: string;
  readonly title: string;
  readonly parentId?: string;
}

export interface PlanTask {
  readonly id: string;
  readonly title: string;
  readonly groupId?: string;
  readonly start: string;
  readonly end: string;
  readonly assigneeIds?: readonly string[];
  readonly workTypeIds?: readonly string[];
}

export interface PlanDependency {
  readonly id: string;
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly lagDays: number;
}

export interface PlanUnavailability {
  readonly id: string;
  readonly resourceId: string;
  readonly start: string;
  readonly end: string;
}

export interface PlanContent {
  readonly title?: string;
  readonly calendar: PlanCalendar;
  readonly workTypes: readonly PlanWorkType[];
  readonly resources: readonly PlanResource[];
  readonly groups: readonly PlanGroup[];
  readonly tasks: readonly PlanTask[];
  readonly dependencies: readonly PlanDependency[];
  readonly unavailability: readonly PlanUnavailability[];
}

export const PLAN_MODULE_ID = 'gantt';
export const PLAN_DOCUMENT_TYPE = 'plan';
export const PLAN_SCHEMA_VERSION = 1;

export function createPlanContent(title?: string): PlanContent {
  return {
    ...(title === undefined ? {} : { title }),
    calendar: {
      workingDays: [1, 2, 3, 4, 5],
      holidays: [],
      workingExceptions: [],
    },
    workTypes: [],
    resources: [],
    groups: [],
    tasks: [],
    dependencies: [],
    unavailability: [],
  };
}

export function planTitle(value: unknown): string {
  if (
    isRecord(value) &&
    typeof value.title === 'string' &&
    value.title !== ''
  ) {
    return value.title;
  }
  return 'Без названия';
}

export type PlanIssueCode =
  | 'invalid-structure'
  | 'invalid-date'
  | 'invalid-weekday'
  | 'invalid-lag'
  | 'duplicate-id'
  | 'unknown-reference'
  | 'circular-group'
  | 'inverted-interval'
  | 'empty-calendar';

export interface PlanIssue {
  readonly code: PlanIssueCode;
  readonly path: string;
  readonly message: string;
}

export type PlanValidation =
  | { readonly ok: true; readonly plan: PlanContent }
  | { readonly ok: false; readonly issues: readonly PlanIssue[] };

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isWeekday(value: unknown): value is Weekday {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 7
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0
  );
}

type FieldCheck = (value: unknown, path: string, issues: PlanIssue[]) => void;

interface FieldChecks {
  readonly required: Record<string, FieldCheck>;
  readonly optional?: Record<string, FieldCheck>;
}

interface SectionIds {
  readonly valid: boolean;
  readonly ids: readonly string[];
}

function requireString(message: string): FieldCheck {
  return (value, path, issues) => {
    if (typeof value !== 'string') {
      issues.push({ code: 'invalid-structure', path, message });
    }
  };
}

function requireIsoDate(message: string): FieldCheck {
  return (value, path, issues) => {
    if (!isIsoDate(value)) {
      issues.push({ code: 'invalid-date', path, message });
    }
  };
}

function optionalId(message: string): FieldCheck {
  return (value, path, issues) => {
    if (!isId(value)) {
      issues.push({ code: 'invalid-structure', path, message });
    }
  };
}

function optionalStringArray(message: string): FieldCheck {
  return (value, path, issues) => {
    if (!isStringArray(value)) {
      issues.push({ code: 'invalid-structure', path, message });
    }
  };
}

function validateSection(
  section: unknown,
  path: string,
  checks: FieldChecks,
  issues: PlanIssue[],
): SectionIds {
  if (!Array.isArray(section)) {
    issues.push({
      code: 'invalid-structure',
      path,
      message: 'Раздел должен быть массивом.',
    });
    return { valid: false, ids: [] };
  }
  const ids: string[] = [];
  let valid = true;
  section.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({
        code: 'invalid-structure',
        path: entryPath,
        message: 'Элемент раздела должен быть объектом.',
      });
      valid = false;
      return;
    }
    if (!isId(entry.id)) {
      issues.push({
        code: 'invalid-structure',
        path: `${entryPath}.id`,
        message: 'Идентификатор должен быть непустой строкой.',
      });
      valid = false;
    } else {
      ids.push(entry.id);
    }
    for (const [field, check] of Object.entries(checks.required)) {
      check(entry[field], `${entryPath}.${field}`, issues);
    }    for (const [field, check] of Object.entries(checks.optional ?? {})) {
      if (entry[field] !== undefined) {
        check(entry[field], `${entryPath}.${field}`, issues);
      }
    }
  });
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
    issues.push({
      code: 'duplicate-id',
      path,
      message: `Повторяющийся идентификатор «${id}».`,
    });
  }
  return { valid, ids };
}

function titleCheck(message = 'Название должно быть строкой.'): FieldCheck {
  return requireString(message);
}

export function parsePlanContent(value: unknown): PlanValidation {
  const issues: PlanIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid-structure',
          path: '',
          message: 'Содержимое плана должно быть объектом.',
        },
      ],
    };
  }
  if (value.title !== undefined && (typeof value.title !== 'string' || value.title === '')) {
    issues.push({
      code: 'invalid-structure',
      path: 'title',
      message: 'Название плана должно быть непустой строкой.',
    });
  }

  const calendar = value.calendar;
  if (!isRecord(calendar)) {
    issues.push({
      code: 'invalid-structure',
      path: 'calendar',
      message: 'Календарь плана обязателен.',
    });
  } else {
    const workingDays = calendar.workingDays;
    if (!Array.isArray(workingDays) || !workingDays.every(isWeekday)) {
      issues.push({
        code: 'invalid-weekday',
        path: 'calendar.workingDays',
        message: 'Рабочие дни недели задаются целыми числами 1–7 (пн–вс).',
      });
    }
    for (const field of ['holidays', 'workingExceptions'] as const) {
      const list = calendar[field];
      if (!isStringArray(list) || !list.every(isIsoDate)) {
        issues.push({
          code: 'invalid-date',
          path: `calendar.${field}`,
          message: 'Даты календаря задаются в формате ISO YYYY-MM-DD.',
        });
      }
    }
    const days = Array.isArray(workingDays) ? workingDays : [];
    const exceptions = isStringArray(calendar.workingExceptions)
      ? calendar.workingExceptions
      : [];
    if (days.length === 0 && exceptions.length === 0) {
      issues.push({
        code: 'empty-calendar',
        path: 'calendar',
        message: 'Календарь без рабочих дней и рабочих исключений недопустим.',
      });
    }
  }

  const workTypes = validateSection(
    value.workTypes,
    'workTypes',
    {
      required: {
        title: titleCheck('Название типа работы должно быть строкой.'),
        allowsParallel: (field, path, issueList) => {
          if (typeof field !== 'boolean') {
            issueList.push({
              code: 'invalid-structure',
              path,
              message: 'Признак параллельности должен быть boolean.',
            });
          }
        },
      },
    },
    issues,
  );

  const resources = validateSection(
    value.resources,
    'resources',
    { required: { title: titleCheck('Название ресурса должно быть строкой.') } },
    issues,
  );

  const groups = validateSection(
    value.groups,
    'groups',
    {
      required: { title: titleCheck('Название группы должно быть строкой.') },
      optional: {
        parentId: optionalId(
          'Идентификатор родительской группы должен быть непустой строкой.',
        ),
      },
    },
    issues,
  );

  const tasks = validateSection(
    value.tasks,
    'tasks',
    {
      required: {
        title: titleCheck('Название задачи должно быть строкой.'),
        start: requireIsoDate('Дата начала должна быть в формате ISO YYYY-MM-DD.'),
        end: requireIsoDate('Дата окончания должна быть в формате ISO YYYY-MM-DD.'),
      },
      optional: {
        groupId: optionalId('Идентификатор группы должен быть непустой строкой.'),
        assigneeIds: optionalStringArray(
          'Назначения задаются массивом идентификаторов ресурсов.',
        ),
        workTypeIds: optionalStringArray(
          'Типы работ задаются массивом идентификаторов.',
        ),
      },
    },
    issues,
  );

  const dependencies = validateSection(
    value.dependencies,
    'dependencies',
    {
      required: {
        fromTaskId: requireString(
          'Предшественник должен быть идентификатором задачи.',
        ),
        toTaskId: requireString(
          'Последователь должен быть идентификатором задачи.',
        ),
        lagDays: (field, path, issueList) => {
          if (!isNonNegativeInteger(field)) {
            issueList.push({
              code: 'invalid-lag',
              path,
              message: 'Лаг зависимости — целое число рабочих дней не меньше нуля.',
            });
          }
        },
      },
    },
    issues,
  );

  const unavailability = validateSection(
    value.unavailability,
    'unavailability',
    {
      required: {
        resourceId: requireString(
          'Недоступность должна ссылаться на идентификатор ресурса.',
        ),
        start: requireIsoDate('Дата начала должна быть в формате ISO YYYY-MM-DD.'),
        end: requireIsoDate('Дата окончания должна быть в формате ISO YYYY-MM-DD.'),
      },
    },
    issues,
  );

  const checkIntervals = (
    section: unknown,
    path: string,
  ) => {
    if (!Array.isArray(section)) {
      return;
    }
    section.forEach((entry, index) => {
      if (!isRecord(entry) || !isIsoDate(entry.start) || !isIsoDate(entry.end)) {
        return;
      }
      if (entry.start > entry.end) {
        issues.push({
          code: 'inverted-interval',
          path: `${path}[${index}]`,
          message: 'Окончание раньше начала.',
        });
      }
    });
  };
  checkIntervals(value.tasks, 'tasks');
  checkIntervals(value.unavailability, 'unavailability');

  const groupIds = new Set(groups.ids);
  const resourceIds = new Set(resources.ids);
  const workTypeIds = new Set(workTypes.ids);
  const taskIds = new Set(tasks.ids);

  if (groups.valid && Array.isArray(value.groups)) {
    const parentById = new Map<string, string>();
    value.groups.forEach((entry, index) => {
      if (!isRecord(entry)) {
        return;
      }
      const { id, parentId } = entry as { id?: unknown; parentId?: unknown };
      if (!isId(parentId)) {
        return;
      }
      if (parentId === id) {
        issues.push({
          code: 'circular-group',
          path: `groups[${index}].parentId`,
          message: 'Группа не может быть родителем самой себя.',
        });
      } else if (!groupIds.has(parentId)) {
        issues.push({
          code: 'unknown-reference',
          path: `groups[${index}].parentId`,
          message: `Родительская группа «${parentId}» не существует.`,
        });
      } else {
        parentById.set(String(id), parentId);
      }
    });
    for (const id of groupIds) {
      const seen = new Set<string>([id]);
      let current = parentById.get(id);
      while (current !== undefined) {
        if (seen.has(current)) {
          issues.push({
            code: 'circular-group',
            path: 'groups',
            message: `Цикл вложенности групп через «${id}».`,
          });
          break;
        }
        seen.add(current);
        current = parentById.get(current);
      }
    }
  }

  if (tasks.valid && Array.isArray(value.tasks)) {
    value.tasks.forEach((entry, index) => {
      if (!isRecord(entry)) {
        return;
      }
      const { groupId, assigneeIds, workTypeIds: taskWorkTypes } = entry as {
        groupId?: unknown;
        assigneeIds?: unknown;
        workTypeIds?: unknown;
      };
      if (isId(groupId) && !groupIds.has(groupId)) {
        issues.push({
          code: 'unknown-reference',
          path: `tasks[${index}].groupId`,
          message: `Группа «${groupId}» не существует.`,
        });
      }
      if (isStringArray(assigneeIds)) {
        for (const resourceId of assigneeIds) {
          if (!resourceIds.has(resourceId)) {
            issues.push({
              code: 'unknown-reference',
              path: `tasks[${index}].assigneeIds`,
              message: `Ресурс «${resourceId}» не существует.`,
            });
          }
        }
      }
      if (isStringArray(taskWorkTypes)) {
        for (const workTypeId of taskWorkTypes) {
          if (!workTypeIds.has(workTypeId)) {
            issues.push({
              code: 'unknown-reference',
              path: `tasks[${index}].workTypeIds`,
              message: `Тип работы «${workTypeId}» не существует.`,
            });
          }
        }
      }
    });
  }

  if (dependencies.valid && Array.isArray(value.dependencies)) {
    value.dependencies.forEach((entry, index) => {
      if (!isRecord(entry)) {
        return;
      }
      const { fromTaskId, toTaskId } = entry as {
        fromTaskId?: unknown;
        toTaskId?: unknown;
      };
      if (isId(fromTaskId) && !taskIds.has(fromTaskId)) {
        issues.push({
          code: 'unknown-reference',
          path: `dependencies[${index}].fromTaskId`,
          message: `Задача «${fromTaskId}» не существует.`,
        });
      }
      if (isId(toTaskId) && !taskIds.has(toTaskId)) {
        issues.push({
          code: 'unknown-reference',
          path: `dependencies[${index}].toTaskId`,
          message: `Задача «${toTaskId}» не существует.`,
        });
      }
    });
  }

  if (unavailability.valid && Array.isArray(value.unavailability)) {
    value.unavailability.forEach((entry, index) => {
      if (!isRecord(entry)) {
        return;
      }
      const { resourceId } = entry as { resourceId?: unknown };
      if (isId(resourceId) && !resourceIds.has(resourceId)) {
        issues.push({
          code: 'unknown-reference',
          path: `unavailability[${index}].resourceId`,
          message: `Ресурс «${resourceId}» не существует.`,
        });
      }
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, plan: value as unknown as PlanContent };
}
