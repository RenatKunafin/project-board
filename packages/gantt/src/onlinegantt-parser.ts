import {
  type PlanContent,
  type PlanDependency,
  type PlanGroup,
  type PlanResource,
  type PlanTask,
  type Weekday,
} from './plan-document';
import { addCalendarDays, createWorkingCalendar } from './working-calendar';
import { taskColorIdByHex } from './task-colors';

/**
 * Разбор файлов OnlineGantt `.gantt` в содержимое плана (PBT-052).
 * Семантика формата подтверждена двумя рабочими примерами и сверкой
 * с оригинальным инструментом (design.md, Risks): UTC-метки с поясом
 * плана, включительное окончание, вложенность `subtasks` — контейнеры.
 */

export type OnlineGanttIssueCode = 'invalid-json' | 'invalid-structure';

export interface OnlineGanttIssue {
  readonly code: OnlineGanttIssueCode;
  readonly path: string;
  readonly message: string;
}

export type OnlineGanttWarningCode =
  | 'unknown-timezone'
  | 'invalid-calendar'
  | 'invalid-holiday'
  | 'invalid-entry'
  | 'duplicate-task-id'
  | 'duplicate-resource-id'
  | 'invalid-task-date'
  | 'inverted-interval'
  | 'unsupported-duration-unit'
  | 'duration-mismatch'
  | 'dropped-assignment'
  | 'group-assignments-dropped'
  | 'group-predecessor-dropped'
  | 'unsupported-dependency-type'
  | 'invalid-dependency-lag'
  | 'invalid-dependency'
  | 'unknown-predecessor'
  | 'duplicate-dependency-pair'
  | 'dropped-task-fields'
  | 'skipped-settings';

export interface OnlineGanttWarning {
  readonly code: OnlineGanttWarningCode;
  readonly path: string;
  readonly message: string;
}

export interface OnlineGanttImportSummary {
  readonly tasks: number;
  readonly groups: number;
  readonly resources: number;
  readonly dependencies: number;
  readonly unassignedTasks: number;
}

export interface OnlineGanttImportReport {
  readonly warnings: readonly OnlineGanttWarning[];
  readonly summary: OnlineGanttImportSummary;
}

/** Задача с дополнительными полями импорта (passthrough PBT-050, design D7). */
export type ImportedPlanTask = PlanTask & {
  readonly assigneeUnits?: Readonly<Record<string, number>>;
  readonly notes?: string;
};

export interface OnlineGanttPayload {
  readonly title: string;
  readonly content: PlanContent;
  readonly report: OnlineGanttImportReport;
}

export type OnlineGanttParseResult =
  | { readonly ok: true; readonly payload: OnlineGanttPayload }
  | { readonly ok: false; readonly issues: readonly OnlineGanttIssue[] };

export interface OnlineGanttParseOptions {
  readonly title?: string;
}

export const ONLINEGANTT_DEFAULT_TITLE = 'Импорт OnlineGantt';

const WEEKDAY_BY_NAME: Readonly<Record<string, Weekday>> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

interface WarningSink {
  readonly push: (warning: OnlineGanttWarning) => void;
}

function warn(
  sink: WarningSink,
  code: OnlineGanttWarningCode,
  path: string,
  message: string,
): void {
  sink.push({ code, path, message });
}

/** Декодирование базовых HTML-сущностей (design D7, мини-извлекатель). */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** HTML-примечание исходника → текст: теги вырезаются, блочные границы — перевод строки. */
export function htmlNotesToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|ul|ol|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Конвертер UTC-метки в календарную дату пояса плана (design D2):
 * имя IANA → числовой сдвиг файла → UTC (+ предупреждение).
 */
type DateConverter = (value: unknown) => string | null;

function utcDateOf(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function resolveDateConverter(
  advanced: Record<string, unknown>,
  sink: WarningSink,
): DateConverter {
  const timezone = advanced.timezone;
  if (typeof timezone === 'string' && timezone !== '') {
    try {
      const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return (value: unknown): string | null => {
        if (typeof value !== 'string') {
          return null;
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          return null;
        }
        return formatter.format(date);
      };
    } catch {
      warn(
        sink,
        'unknown-timezone',
        'advanced.timezone',
        `Часовой пояс «${timezone}» не распознан; даты преобразуются по UTC.`,
      );
    }
  }
  const offset = advanced.timezoneOffset;
  if (typeof offset === 'number' && Number.isInteger(offset) && Math.abs(offset) <= 1440) {
    return (value: unknown): string | null => {
      const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      // timezoneOffset в смысле JS: -180 = UTC+3 (дизайн D2).
      return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
    };
  }
  warn(
    sink,
    'unknown-timezone',
    'advanced',
    'Часовой пояс плана не задан; даты преобразуются по UTC.',
  );
  return utcDateOf;
}

interface CalendarResult {
  readonly workingDays: readonly Weekday[];
  readonly holidays: readonly string[];
}

function parseCalendar(
  advanced: Record<string, unknown>,
  toDate: DateConverter,
  sink: WarningSink,
): CalendarResult {
  const workingDays = new Set<Weekday>();
  const workWeek = advanced.workWeek;
  if (Array.isArray(workWeek)) {
    for (const name of workWeek) {
      if (typeof name === 'string' && WEEKDAY_BY_NAME[name] !== undefined) {
        workingDays.add(WEEKDAY_BY_NAME[name]);
      }
    }
  }
  const days = [...workingDays].sort((a, b) => a - b);
  if (days.length === 0) {
    warn(
      sink,
      'invalid-calendar',
      'advanced.workWeek',
      'Рабочая неделя файла не распознана; использована неделя по умолчанию (пн–пт).',
    );
    days.push(1, 2, 3, 4, 5);
  }

  const holidays = new Set<string>();
  const rawHolidays = advanced.holidays;
  if (Array.isArray(rawHolidays)) {
    rawHolidays.forEach((entry, index) => {
      const path = `advanced.holidays[${index}]`;
      if (!isRecord(entry)) {
        warn(sink, 'invalid-holiday', path, 'Праздник должен быть объектом с датами from/to.');
        return;
      }
      const from = toDate(entry.from);
      if (from === null) {
        warn(sink, 'invalid-holiday', `${path}.from`, 'Дата начала праздника некорректна.');
        return;
      }
      const to = toDate(entry.to);
      if (to === null) {
        warn(sink, 'invalid-holiday', `${path}.to`, 'Дата окончания праздника некорректна; взят один день.');
        holidays.add(from);
        return;
      }
      if (to < from) {
        warn(sink, 'invalid-holiday', path, 'Окончание праздника раньше начала; взят один день.');
        holidays.add(from);
        return;
      }
      for (let cursor = from; cursor <= to; cursor = addCalendarDays(cursor, 1)) {
        holidays.add(cursor);
      }
    });
  }

  return { workingDays: days, holidays: [...holidays].sort() };
}

interface ResourcesResult {
  readonly resources: readonly PlanResource[];
  readonly ids: ReadonlySet<string>;
}

function parseResources(
  raw: readonly unknown[],
  sink: WarningSink,
): ResourcesResult {
  const resources: PlanResource[] = [];
  const ids = new Set<string>();
  raw.forEach((entry, index) => {
    const path = `resources[${index}]`;
    if (!isRecord(entry) || !isId(entry.resourceId)) {
      warn(sink, 'invalid-entry', path, 'Ресурс должен быть объектом с непустым resourceId.');
      return;
    }
    const id = entry.resourceId;
    if (ids.has(id)) {
      warn(
        sink,
        'duplicate-resource-id',
        `${path}.resourceId`,
        `Повторяющийся ресурс «${id}» пропущен.`,
      );
      return;
    }
    const title =
      typeof entry.resourceName === 'string' && entry.resourceName !== ''
        ? entry.resourceName
        : id;
    ids.add(id);
    resources.push({ id, title });
  });
  return { resources, ids };
}

interface PredecessorRef {
  readonly path: string;
  readonly entryId: string;
  readonly value: string;
}

interface DurationRef {
  readonly path: string;
  readonly start: string;
  readonly end: string;
  readonly duration: unknown;
}

interface TaskIdCheck {
  readonly ok: boolean;
  readonly key: string;
}

function checkTaskId(value: unknown): TaskIdCheck {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return { ok: true, key: String(value) };
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return { ok: true, key: value };
  }
  return { ok: false, key: '' };
}

function walkEntries(
  entries: readonly unknown[],
  parentGroupId: string | undefined,
  path: string,
  toDate: DateConverter,
  resourceIds: ReadonlySet<string>,
  state: TreeState,
  sink: WarningSink,
): void {
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      warn(sink, 'invalid-entry', entryPath, 'Запись должна быть объектом.');
      return;
    }
    const idCheck = checkTaskId(entry.TaskID);
    if (!idCheck.ok) {
      warn(
        sink,
        'invalid-entry',
        `${entryPath}.TaskID`,
        'Идентификатор записи должен быть целым положительным числом.',
      );
      return;
    }
    const key = idCheck.key;
    if (state.seenIds.has(key)) {
      warn(
        sink,
        'duplicate-task-id',
        `${entryPath}.TaskID`,
        `Повторяющийся идентификатор «${key}»; запись с поддеревом пропущена.`,
      );
      return;
    }
    state.seenIds.add(key);

    const subtasks = entry.subtasks;
    if (Array.isArray(subtasks) && subtasks.length > 0) {
      const id = `g-${key}`;
      const title =
        typeof entry.TaskName === 'string' && entry.TaskName !== ''
          ? entry.TaskName
          : `Группа ${key}`;
      state.groups.push(
        parentGroupId === undefined ? { id, title } : { id, title, parentId: parentGroupId },
      );
      state.groupIds.add(key);
      if (Array.isArray(entry.resources) && entry.resources.length > 0) {
        warn(
          sink,
          'group-assignments-dropped',
          `${entryPath}.resources`,
          `Контейнер «${title}» становится группой: назначения контейнера не переносятся.`,
        );
      }
      if (typeof entry.Predecessor === 'string' && entry.Predecessor.trim() !== '') {
        warn(
          sink,
          'group-predecessor-dropped',
          `${entryPath}.Predecessor`,
          `Контейнер «${title}» становится группой: предшественники контейнера не переносятся.`,
        );
      }
      walkEntries(subtasks, id, `${entryPath}.subtasks`, toDate, resourceIds, state, sink);
      return;
    }

    const id = `t-${key}`;
    const start = toDate(entry.StartDate);
    const end = toDate(entry.EndDate);
    if (start === null || end === null) {
      warn(
        sink,
        'invalid-task-date',
        entryPath,
        `Даты записи «${String(entry.TaskName ?? key)}» некорректны; запись пропущена.`,
      );
      return;
    }
    if (end < start) {
      warn(
        sink,
        'inverted-interval',
        entryPath,
        `Окончание раньше начала у записи «${String(entry.TaskName ?? key)}»; запись пропущена.`,
      );
      return;
    }

    const title =
      typeof entry.TaskName === 'string' && entry.TaskName !== ''
        ? entry.TaskName
        : `Задача ${key}`;
    if (typeof entry.TaskName !== 'string' || entry.TaskName === '') {
      warn(
        sink,
        'invalid-entry',
        `${entryPath}.TaskName`,
        `Название записи не задано; подставлено «${title}».`,
      );
    }

    let assigneeIds: readonly string[] | undefined;
    let assigneeUnits: Readonly<Record<string, number>> | undefined;
    if (Array.isArray(entry.resources)) {
      const ids: string[] = [];
      const units: Record<string, number> = {};
      entry.resources.forEach((assignment, assignmentIndex) => {
        const assignmentPath = `${entryPath}.resources[${assignmentIndex}]`;
        if (!isRecord(assignment) || !isId(assignment.resourceId)) {
          warn(
            sink,
            'dropped-assignment',
            assignmentPath,
            'Назначение должно быть объектом с непустым resourceId.',
          );
          return;
        }
        const resourceId = assignment.resourceId;
        if (!resourceIds.has(resourceId)) {
          warn(
            sink,
            'dropped-assignment',
            assignmentPath,
            `Ресурс «${resourceId}» отсутствует в справочнике файла; назначение пропущено.`,
          );
          return;
        }
        if (!ids.includes(resourceId)) {
          ids.push(resourceId);
        }
        if (
          typeof assignment.unit === 'number' &&
          Number.isFinite(assignment.unit)
        ) {
          // ADR PBT-003 D3: загрузка сохраняется в данных, на проверки не влияет.
          units[resourceId] = assignment.unit;
        }
      });
      if (ids.length > 0) {
        assigneeIds = ids;
        if (Object.keys(units).length > 0) {
          assigneeUnits = units;
        }
      }
    } else if (entry.resources !== undefined && entry.resources !== null) {
      warn(
        sink,
        'dropped-assignment',
        `${entryPath}.resources`,
        'Назначения записи должны быть массивом; поле проигнорировано.',
      );
    }

    if (entry.DurationUnit !== undefined && entry.DurationUnit !== 'day') {
      warn(
        sink,
        'unsupported-duration-unit',
        `${entryPath}.DurationUnit`,
        `Единица длительности «${String(entry.DurationUnit)}» не поддерживается (ожидается day).`,
      );
    }

    let notes: string | undefined;
    const info = entry.info;
    if (typeof info === 'string' && info.trim() !== '') {
      const text = htmlNotesToText(info);
      if (text !== '') {
        notes = text;
      }
    }

    if (entry.Progress !== undefined && entry.Progress !== 0) {
      state.progressCount += 1;
    }

    if (typeof entry.Predecessor === 'string' && entry.Predecessor.trim() !== '') {
      state.predecessors.push({
        path: `${entryPath}.Predecessor`,
        entryId: key,
        value: entry.Predecessor,
      });
    }

    state.durations.push({
      path: `${entryPath}.Duration`,
      start,
      end,
      duration: entry.Duration,
    });
    state.taskIds.add(key);
    // PBT-084: hex записи, точно совпавший со значением палитры (регистр
    // нормализуется), переносится идентификатором; иначе — «Авто» (без поля).
    const color =
      typeof entry.color === 'string' && entry.color !== ''
        ? taskColorIdByHex(entry.color)
        : undefined;
    state.tasks.push({
      id,
      title,
      ...(parentGroupId === undefined ? {} : { groupId: parentGroupId }),
      start,
      end,
      ...(assigneeIds === undefined ? {} : { assigneeIds }),
      ...(assigneeUnits === undefined ? {} : { assigneeUnits }),
      ...(notes === undefined ? {} : { notes }),
      ...(color === undefined ? {} : { color }),
    });
  });
}

interface TreeState {
  readonly groups: PlanGroup[];
  readonly tasks: ImportedPlanTask[];
  readonly taskIds: Set<string>;
  readonly groupIds: Set<string>;
  readonly seenIds: Set<string>;
  readonly predecessors: PredecessorRef[];
  readonly durations: DurationRef[];
  progressCount: number;}

function parseDependencies(
  predecessors: readonly PredecessorRef[],
  taskIds: ReadonlySet<string>,
  groupIds: ReadonlySet<string>,
  sink: WarningSink,
): readonly PlanDependency[] {
  const dependencies: PlanDependency[] = [];
  const lagByPair = new Map<string, number>();
  for (const ref of predecessors) {
    const elements = ref.value
      .split(/[,;]/)
      .map((element) => element.trim())
      .filter((element) => element !== '');
    for (const element of elements) {
      const nonFs = /^(\d+)(SS|FF|SF)/.exec(element);
      if (nonFs !== null) {
        warn(
          sink,
          'unsupported-dependency-type',
          ref.path,
          `Тип связи «${element}» не поддерживается (только FS); зависимость не создана.`,
        );
        continue;
      }
      const zeroLag = /^(\d+)FS$/.exec(element);
      const dayLag = /^(\d+)FS\+(\d+) ?days?$/.exec(element);
      let fromKey: string | null = null;
      let lag: number | null = null;
      if (zeroLag !== null) {
        fromKey = zeroLag[1];
        lag = 0;
      } else if (dayLag !== null) {
        fromKey = dayLag[1];
        lag = Number(dayLag[2]);
      } else if (/^\d+FS[-+]/.test(element)) {
        warn(
          sink,
          'invalid-dependency-lag',
          ref.path,
          `Задержка «${element}» вне поддерживаемого диапазона: поддерживается только целое неотрицательное число дней.`,
        );
        continue;
      } else {
        warn(
          sink,
          'invalid-dependency',
          ref.path,
          `Строка предшественника «${element}» не распознана; зависимость не создана.`,
        );
        continue;
      }
      if (fromKey === ref.entryId) {
        warn(
          sink,
          'invalid-dependency',
          ref.path,
          `Ссылка «${element}» на саму задачу; зависимость не создана.`,
        );
        continue;
      }
      if (groupIds.has(fromKey)) {
        warn(
          sink,
          'unknown-predecessor',
          ref.path,
          `Ссылка «${element}» указывает на контейнер (группу); зависимости на группы не поддерживаются.`,
        );
        continue;
      }
      if (!taskIds.has(fromKey)) {
        warn(
          sink,
          'unknown-predecessor',
          ref.path,
          `Ссылка «${element}» указывает на отсутствующую задачу; зависимость не создана.`,
        );
        continue;
      }
      const fromTaskId = `t-${fromKey}`;
      const toTaskId = `t-${ref.entryId}`;
      const pairKey = `${fromTaskId}|${toTaskId}`;
      const previousLag = lagByPair.get(pairKey);
      if (previousLag !== undefined) {
        if (previousLag !== lag) {
          warn(
            sink,
            'duplicate-dependency-pair',
            ref.path,
            `Пара ${fromKey}FS → ${ref.entryId} уже создана с задержкой ${previousLag}; дубль с задержкой ${lag} пропущен.`,
          );
        }
        continue;
      }
      lagByPair.set(pairKey, lag);
      dependencies.push({
        id: `dep-${fromTaskId}-${toTaskId}`,
        fromTaskId,
        toTaskId,
        lagDays: lag,
      });
    }
  }
  return dependencies;
}

function reportSkippedSettings(
  advanced: Record<string, unknown>,
  sink: WarningSink,
): void {
  if (advanced.workTime !== undefined) {
    warn(
      sink,
      'skipped-settings',
      'advanced.workTime',
      'Почасовое рабочее время не переносится: модель плана работает днями (ADR PBT-003).',
    );
  }
  const displaySettings = (['columns', 'zoomLevel', 'dateFormat', 'timeFormat', 'firstDayOfWeek', 'dependencyConflict'] as const)
    .filter((name) => advanced[name] !== undefined);
  if (displaySettings.length > 0) {
    warn(
      sink,
      'skipped-settings',
      'advanced',
      `Настройки отображения исходника (${displaySettings.join(', ')}) не переносятся.`,
    );
  }
}

export function parseOnlineGanttFile(
  text: string,
  options?: OnlineGanttParseOptions,
): OnlineGanttParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issues: [
        {
          code: 'invalid-json',
          path: '',
          message: `Файл не является корректным JSON: ${message}`,
        },
      ],
    };
  }
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        { code: 'invalid-structure', path: '', message: 'Содержимое файла должно быть JSON-объектом.' },
      ],
    };
  }
  if (!Array.isArray(value.data)) {
    return {
      ok: false,
      issues: [
        { code: 'invalid-structure', path: 'data', message: 'Раздел data обязан быть массивом записей.' },
      ],
    };
  }
  if (!Array.isArray(value.resources)) {
    return {
      ok: false,
      issues: [
        { code: 'invalid-structure', path: 'resources', message: 'Раздел resources обязан быть массивом.' },
      ],
    };
  }

  const warnings: OnlineGanttWarning[] = [];
  const sink: WarningSink = { push: (warning) => warnings.push(warning) };

  const advanced = isRecord(value.advanced) ? value.advanced : {};
  if (!isRecord(value.advanced) && value.advanced !== undefined) {
    warn(sink, 'unknown-timezone', 'advanced', 'Настройки файла должны быть объектом; пояс взят по UTC.');
  }
  const toDate = resolveDateConverter(advanced, sink);
  const calendar = parseCalendar(advanced, toDate, sink);
  const resources = parseResources(value.resources, sink);

  const state: TreeState = {
    groups: [],
    tasks: [],
    taskIds: new Set(),
    groupIds: new Set(),
    seenIds: new Set(),
    predecessors: [],
    durations: [],
    progressCount: 0,  };
  walkEntries(value.data, undefined, 'data', toDate, resources.ids, state, sink);

  const dependencies = parseDependencies(
    state.predecessors,
    state.taskIds,
    state.groupIds,
    sink,
  );

  const workingCalendar = createWorkingCalendar({
    workingDays: [...calendar.workingDays],
    holidays: [...calendar.holidays],
  });
  for (const ref of state.durations) {
    if (
      typeof ref.duration !== 'number' ||
      !Number.isInteger(ref.duration) ||
      ref.duration < 0
    ) {
      continue;
    }
    const actual = workingCalendar.workingDaysBetween(ref.start, ref.end);
    if (actual !== ref.duration) {
      warn(
        sink,
        'duration-mismatch',
        ref.path,
        `Длительность исходника ${ref.duration} р.д. не сходится с датами (${actual} р.д.) — возможна иная семантика конца или сбитый пояс.`,
      );
    }
  }

  if (state.progressCount > 0) {
    warn(
      sink,
      'dropped-task-fields',
      'data',
      `Прогресс записей (${state.progressCount}) не переносится в план; цвет записи вне палитры получает автоматическое значение.`,
    );
  }
  reportSkippedSettings(advanced, sink);

  const content: PlanContent = {
    calendar: {
      workingDays: [...calendar.workingDays],
      holidays: [...calendar.holidays],
      workingExceptions: [],
    },
    workTypes: [],
    resources: [...resources.resources],
    groups: [...state.groups],
    tasks: [...state.tasks],
    dependencies: [...dependencies],
    unavailability: [],
  };

  return {
    ok: true,
    payload: {
      title: options?.title ?? ONLINEGANTT_DEFAULT_TITLE,
      content,
      report: {
        warnings,
        summary: {
          tasks: state.tasks.length,
          groups: state.groups.length,
          resources: resources.resources.length,
          dependencies: dependencies.length,
          unassignedTasks: state.tasks.filter(
            (task) => task.assigneeIds === undefined || task.assigneeIds.length === 0,
          ).length,
        },
      },
    },
  };
}
