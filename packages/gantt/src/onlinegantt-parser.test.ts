import { describe, expect, it } from 'vitest';
import { parsePlanContent } from './plan-document';
import {
  htmlNotesToText,
  ONLINEGANTT_DEFAULT_TITLE,
  parseOnlineGanttFile,
  type ImportedPlanTask,
  type OnlineGanttWarning,
} from './onlinegantt-parser';

function warningCodes(result: ReturnType<typeof parseOnlineGanttFile>): string[] {
  if (!result.ok) {
    return [];
  }
  return result.payload.report.warnings.map((warning) => warning.code);
}

function findWarning(
  result: ReturnType<typeof parseOnlineGanttFile>,
  code: OnlineGanttWarning['code'],
): OnlineGanttWarning | undefined {
  if (!result.ok) {
    return undefined;
  }
  return result.payload.report.warnings.find((warning) => warning.code === code);
}

/** Минимальный корректный файл с настроенным поясом Europe/Moscow. */
function ganttFile(overrides?: {
  data?: unknown;
  resources?: unknown;
  advanced?: unknown;
}): string {
  return JSON.stringify({
    data: overrides?.data ?? [
      {
        TaskID: 1,
        TaskName: 'Задача 1',
        StartDate: '2026-08-31T05:00:00.000Z',
        EndDate: '2026-09-11T14:00:00.000Z',
        Duration: 10,
        Progress: 0,
        color: '',
        Predecessor: '',
        resources: [],
        info: '<p><br></p>',
        DurationUnit: 'day',
      },
    ],
    resources: overrides?.resources ?? [
      { resourceId: 'QA', resourceName: 'QA' },
    ],
    advanced:
      overrides?.advanced === undefined
        ? {
            timezone: 'Europe/Moscow',
            timezoneOffset: -180,
            workWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            workTime: [{ from: 8, to: 12 }],
            holidays: [
              { from: '2026-11-03T21:00:00.000Z', to: '2026-11-03T21:00:00.000Z' },
            ],
          }
        : overrides?.advanced,
  });
}

describe('фатальная диагностика', () => {
  it('не-JSON даёт отказ без плана', () => {
    const result = parseOnlineGanttFile('{"data": [');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('invalid-json');
    }
  });

  it('не-объект даёт отказ', () => {
    const result = parseOnlineGanttFile('[1, 2]');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].code).toBe('invalid-structure');
    }
  });

  it('data не массив даёт отказ', () => {
    const result = parseOnlineGanttFile(JSON.stringify({ data: {}, resources: [] }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].path).toBe('data');
    }
  });

  it('resources не массив даёт отказ', () => {
    const result = parseOnlineGanttFile(JSON.stringify({ data: [], resources: {} }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].path).toBe('resources');
    }
  });

  it('вход не изменяется', () => {
    const text = ganttFile();
    const snapshot = text;

    parseOnlineGanttFile(text);

    expect(text).toBe(snapshot);
  });
});

describe('конвертация дат и календарь', () => {
  it('UTC-метки преобразуются в даты Europe/Moscow с включительным концом', () => {
    const result = parseOnlineGanttFile(ganttFile());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.tasks[0].start).toBe('2026-08-31');
      expect(result.payload.content.tasks[0].end).toBe('2026-09-11');
    }
  });

  it('праздник попадает в календарную дату пояса (4 ноября)', () => {
    const result = parseOnlineGanttFile(ganttFile());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.calendar.holidays).toEqual(['2026-11-04']);
    }
  });

  it('отсутствие пояса даёт UTC и предупреждение', () => {
    const result = parseOnlineGanttFile(
      ganttFile({ advanced: { workWeek: ['Monday'] } }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // 2026-08-31T05:00Z в UTC — та же дата.
      expect(result.payload.content.tasks[0].start).toBe('2026-08-31');
      expect(findWarning(result, 'unknown-timezone')).toBeDefined();
    }
  });

  it('невалидное имя пояса — UTC и предупреждение', () => {
    const result = parseOnlineGanttFile(
      ganttFile({ advanced: { timezone: 'Mars/Olympus' } }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.tasks[0].start).toBe('2026-08-31');
      expect(findWarning(result, 'unknown-timezone')).toBeDefined();
    }
  });

  it('числовой сдвиг файла используется без имени пояса', () => {
    // UTC+11: 2026-08-31T20:00Z → местная дата уже 2026-09-01.
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Задача 1',
            StartDate: '2026-08-31T20:00:00.000Z',
            EndDate: '2026-09-05T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
          },
        ],
        advanced: { timezoneOffset: -660 },
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.tasks[0].start).toBe('2026-09-01');
      expect(warningCodes(result)).not.toContain('unknown-timezone');
    }
  });

  it('рабочая неделя переносится; нерасознанная — пн–пт с предупреждением', () => {
    const result = parseOnlineGanttFile(ganttFile());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.calendar.workingDays).toEqual([1, 2, 3, 4, 5]);
      expect(findWarning(result, 'invalid-calendar')).toBeUndefined();

      const fallback = parseOnlineGanttFile(
        ganttFile({ advanced: { workWeek: ['Soonday'] } }),
      );
      expect(fallback.ok).toBe(true);
      if (fallback.ok) {
        expect(fallback.payload.content.calendar.workingDays).toEqual([1, 2, 3, 4, 5]);
        expect(findWarning(fallback, 'invalid-calendar')).toBeDefined();
      }
    }
  });

  it('диапазон праздника разворачивается в даты', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        advanced: {
          timezone: 'Europe/Moscow',
          holidays: [
            { from: '2026-11-03T21:00:00.000Z', to: '2026-11-05T21:00:00.000Z' },
          ],
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.calendar.holidays).toEqual([
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
      ]);
    }
  });

  it('почасовое рабочее время и настройки отображения перечислены в отчёте', () => {
    const result = parseOnlineGanttFile(ganttFile());

    expect(result.ok).toBe(true);
    if (result.ok) {
      const settings = result.payload.report.warnings.filter(
        (warning) => warning.code === 'skipped-settings',
      );
      expect(settings.map((warning) => warning.path)).toContain('advanced.workTime');
      expect(
        settings.some((warning) => warning.message.includes('dependencyConflict')),
      ).toBe(false);
    }
  });
});

describe('иерархия subtasks', () => {
  it('контейнер становится группой, вложенные записи — задачами группы', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 10,
            TaskName: 'Фаза',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-11T14:00:00.000Z',
            Duration: 10,
            Predecessor: null,
            resources: [],
            DurationUnit: 'day',
            subtasks: [
              {
                TaskID: 11,
                TaskName: 'Задача А',
                StartDate: '2026-08-31T05:00:00.000Z',
                EndDate: '2026-09-04T14:00:00.000Z',
                Duration: 5,
                Predecessor: '',
                resources: [],
                DurationUnit: 'day',
              },
            ],
          },
          {
            TaskID: 12,
            TaskName: 'Корневая задача',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.groups).toEqual([
        { id: 'g-10', title: 'Фаза' },
      ]);
      expect(result.payload.content.tasks).toHaveLength(2);
      expect(result.payload.content.tasks[0]).toMatchObject({
        id: 't-11',
        groupId: 'g-10',
      });
      expect(result.payload.content.tasks[1].id).toBe('t-12');
      expect(result.payload.content.tasks[1].groupId).toBeUndefined();
      expect(result.payload.report.summary.groups).toBe(1);
    }
  });

  it('вложенность произвольной глубины: группа в группе', () => {
    const leaf = {
      TaskID: 3,
      TaskName: 'Лист',
      StartDate: '2026-08-31T05:00:00.000Z',
      EndDate: '2026-09-04T14:00:00.000Z',
      Duration: 5,
      Predecessor: '',
      resources: [],
      DurationUnit: 'day',
    };
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Верх',
            subtasks: [
              {
                TaskID: 2,
                TaskName: 'Середина',
                subtasks: [leaf],
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.groups).toEqual([
        { id: 'g-1', title: 'Верх' },
        { id: 'g-2', title: 'Середина', parentId: 'g-1' },
      ]);
      expect(result.payload.content.tasks[0]).toMatchObject({
        id: 't-3',
        groupId: 'g-2',
      });
    }
  });

  it('subtasks: [] не создаёт группу — запись импортируется задачей', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Пустой контейнер',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
            subtasks: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.groups).toEqual([]);
      expect(result.payload.content.tasks).toHaveLength(1);
    }
  });

  it('назначения и предшественники контейнера не переносятся молча', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Контейнер',
            Predecessor: '2FS',
            resources: [{ resourceId: 'QA', unit: 100 }],
            subtasks: [
              {
                TaskID: 2,
                TaskName: 'Задача',
                StartDate: '2026-08-31T05:00:00.000Z',
                EndDate: '2026-09-04T14:00:00.000Z',
                Duration: 5,
                Predecessor: '',
                resources: [],
                DurationUnit: 'day',
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(findWarning(result, 'group-assignments-dropped')).toBeDefined();
      expect(findWarning(result, 'group-predecessor-dropped')).toBeDefined();
    }
  });

  it('повторный TaskID на любом уровне пропускается с поддеревом', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Первая',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
          },
          {
            TaskID: 1,
            TaskName: 'Дубль',
            subtasks: [
              {
                TaskID: 2,
                TaskName: 'Потерянная подзадача',
                StartDate: '2026-08-31T05:00:00.000Z',
                EndDate: '2026-09-04T14:00:00.000Z',
                Duration: 5,
                Predecessor: '',
                resources: [],
                DurationUnit: 'day',
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.tasks).toHaveLength(1);
      expect(result.payload.content.groups).toEqual([]);
      expect(findWarning(result, 'duplicate-task-id')).toBeDefined();
    }
  });
});

describe('записи и назначения', () => {
  it('невалидная дата записи пропускает запись с предупреждением', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Битая дата',
            StartDate: 'не-дата',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.tasks).toEqual([]);
      expect(findWarning(result, 'invalid-task-date')).toBeDefined();
    }
  });

  it('перевёрнутый интервал пропускает запись', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Инвертирована',
            StartDate: '2026-09-10T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.tasks).toEqual([]);
      expect(findWarning(result, 'inverted-interval')).toBeDefined();
    }
  });

  it('расхождение Duration с датами даёт предупреждение duration-mismatch', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Сбитая длительность',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-11T14:00:00.000Z',
            Duration: 99,
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const warning = findWarning(result, 'duration-mismatch');
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('99');
    }
  });

  it('назначение с unit сохраняется в assigneeUnits', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Задача с загрузкой',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [{ resourceId: 'QA', unit: 50 }],
            DurationUnit: 'day',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.tasks[0].assigneeIds).toEqual(['QA']);
      expect((result.payload.content.tasks[0] as ImportedPlanTask).assigneeUnits).toEqual({ QA: 50 });
    }
  });

  it('назначение на отсутствующий ресурс отбрасывается с предупреждением', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Задача',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [{ resourceId: 'Призрак', unit: 100 }],
            DurationUnit: 'day',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.tasks[0].assigneeIds).toBeUndefined();
      expect(findWarning(result, 'dropped-assignment')).toBeDefined();
      // Инвариант: назначений на отсутствующие ресурсы в плане нет.
      const validation = parsePlanContent(result.payload.content);
      expect(validation.ok).toBe(true);
    }
  });

  it('дубли ресурсов пропускаются с предупреждением', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        resources: [
          { resourceId: 'QA', resourceName: 'QA' },
          { resourceId: 'QA', resourceName: 'QA2' },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.resources).toEqual([{ id: 'QA', title: 'QA' }]);
      expect(findWarning(result, 'duplicate-resource-id')).toBeDefined();
    }
  });

  it('примечание HTML сохраняется текстом', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Задача',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            info: '<ul><li>раз</li><li>два</li></ul>',
            DurationUnit: 'day',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.payload.content.tasks[0] as ImportedPlanTask).notes).toBe('раз\nдва');
    }
  });

  it('пустое примечание не создаёт поле notes', () => {
    const result = parseOnlineGanttFile(ganttFile());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.payload.content.tasks[0] as ImportedPlanTask).notes).toBeUndefined();
    }
  });

  it('color и Progress перечислены в отчёте как непереносимые', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Задача',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Progress: 40,
            color: '181',
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const warning = findWarning(result, 'dropped-task-fields');
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('color (1)');
      expect(warning!.message).toContain('Progress (1)');
    }
  });

  it('unsupported DurationUnit даёт предупреждение, запись остаётся', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Часовая задача',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            DurationUnit: 'hour',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.tasks).toHaveLength(1);
      expect(findWarning(result, 'unsupported-duration-unit')).toBeDefined();
    }
  });
});

describe('зависимости Predecessor', () => {
  function twoTasks(predecessor: unknown): string {
    return ganttFile({
      data: [
        {
          TaskID: 1,
          TaskName: 'Предшественник',
          StartDate: '2026-08-31T05:00:00.000Z',
          EndDate: '2026-09-04T14:00:00.000Z',
          Duration: 5,
          Predecessor: '',
          resources: [],
          DurationUnit: 'day',
        },
        {
          TaskID: 2,
          TaskName: 'Последователь',
          StartDate: '2026-09-07T05:00:00.000Z',
          EndDate: '2026-09-11T14:00:00.000Z',
          Duration: 5,
          Predecessor: predecessor,
          resources: [],
          DurationUnit: 'day',
        },
      ],
    });
  }

  it('лаг 0 и ненулевой лаг; null и пустая строка — нет зависимости', () => {
    const zero = parseOnlineGanttFile(twoTasks('1FS'));
    expect(zero.ok).toBe(true);
    if (zero.ok) {
      expect(zero.payload.content.dependencies).toEqual([
        { id: 'dep-t-1-t-2', fromTaskId: 't-1', toTaskId: 't-2', lagDays: 0 },
      ]);
    }

    const lagged = parseOnlineGanttFile(twoTasks('1FS+14 days'));
    expect(lagged.ok).toBe(true);
    if (lagged.ok) {
      expect(lagged.payload.content.dependencies[0].lagDays).toBe(14);
    }

    const singular = parseOnlineGanttFile(twoTasks('1FS+1 day'));
    expect(singular.ok).toBe(true);
    if (singular.ok) {
      expect(singular.payload.content.dependencies[0].lagDays).toBe(1);
    }

    for (const empty of [null, '']) {
      const none = parseOnlineGanttFile(twoTasks(empty));
      expect(none.ok).toBe(true);
      if (none.ok) {
        expect(none.payload.content.dependencies).toEqual([]);
      }
    }
  });

  it('несколько предшественников дают по зависимости на каждого', () => {
    const result = parseOnlineGanttFile(twoTasks('1FS, 1FS'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Дубль одинаковой пары идемпотентен — одна зависимость.
      expect(result.payload.content.dependencies).toHaveLength(1);
    }

    const result2 = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'A',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
          },
          {
            TaskID: 2,
            TaskName: 'B',
            StartDate: '2026-08-31T05:00:00.000Z',
            EndDate: '2026-09-04T14:00:00.000Z',
            Duration: 5,
            Predecessor: '',
            resources: [],
            DurationUnit: 'day',
          },
          {
            TaskID: 3,
            TaskName: 'C',
            StartDate: '2026-09-07T05:00:00.000Z',
            EndDate: '2026-09-11T14:00:00.000Z',
            Duration: 5,
            Predecessor: '1FS;2FS+3 days',
            resources: [],
            DurationUnit: 'day',
          },
        ],
      }),
    );

    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.payload.content.dependencies).toEqual([
        { id: 'dep-t-1-t-3', fromTaskId: 't-1', toTaskId: 't-3', lagDays: 0 },
        { id: 'dep-t-2-t-3', fromTaskId: 't-2', toTaskId: 't-3', lagDays: 3 },
      ]);
    }
  });

  it('неподдержанный тип связи, плохой лаг и битые ссылки дают предупреждения', () => {
    const ss = parseOnlineGanttFile(twoTasks('1SS'));
    expect(ss.ok).toBe(true);
    if (ss.ok) {
      expect(ss.payload.content.dependencies).toEqual([]);
      expect(findWarning(ss, 'unsupported-dependency-type')).toBeDefined();
    }

    const negative = parseOnlineGanttFile(twoTasks('1FS-3 days'));
    expect(negative.ok).toBe(true);
    if (negative.ok) {
      expect(findWarning(negative, 'invalid-dependency-lag')).toBeDefined();
    }

    const fractional = parseOnlineGanttFile(twoTasks('1FS+2.5 days'));
    expect(fractional.ok).toBe(true);
    if (fractional.ok) {
      expect(findWarning(fractional, 'invalid-dependency-lag')).toBeDefined();
    }

    const hours = parseOnlineGanttFile(twoTasks('1FS+6 hours'));
    expect(hours.ok).toBe(true);
    if (hours.ok) {
      expect(findWarning(hours, 'invalid-dependency-lag')).toBeDefined();
    }

    const unknown = parseOnlineGanttFile(twoTasks('99FS'));
    expect(unknown.ok).toBe(true);
    if (unknown.ok) {
      expect(findWarning(unknown, 'unknown-predecessor')).toBeDefined();
    }

    const self = parseOnlineGanttFile(twoTasks('2FS'));
    expect(self.ok).toBe(true);
    if (self.ok) {
      expect(findWarning(self, 'invalid-dependency')).toBeDefined();
    }

    const garbage = parseOnlineGanttFile(twoTasks('смех'));
    expect(garbage.ok).toBe(true);
    if (garbage.ok) {
      expect(findWarning(garbage, 'invalid-dependency')).toBeDefined();
    }
  });

  it('ссылка на контейнер даёт unknown-predecessor', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Группа',
            subtasks: [
              {
                TaskID: 2,
                TaskName: 'Задача',
                StartDate: '2026-08-31T05:00:00.000Z',
                EndDate: '2026-09-04T14:00:00.000Z',
                Duration: 5,
                Predecessor: '1FS',
                resources: [],
                DurationUnit: 'day',
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.dependencies).toEqual([]);
      expect(findWarning(result, 'unknown-predecessor')).toBeDefined();
    }
  });

  it('дубль пары с другим лагом даёт duplicate-dependency-pair', () => {
    const result = parseOnlineGanttFile(twoTasks('1FS, 1FS+2 days'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.dependencies).toHaveLength(1);
      expect(result.payload.content.dependencies[0].lagDays).toBe(0);
      expect(findWarning(result, 'duplicate-dependency-pair')).toBeDefined();
    }
  });
});

describe('инварианты и сводка', () => {
  it('название по умолчанию и из options', () => {
    const result = parseOnlineGanttFile(ganttFile());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.title).toBe(ONLINEGANTT_DEFAULT_TITLE);
    }

    const titled = parseOnlineGanttFile(ganttFile(), { title: 'ОКАД' });
    expect(titled.ok).toBe(true);
    if (titled.ok) {
      expect(titled.payload.title).toBe('ОКАД');
    }
  });

  it('результат проходит валидацию плана (инвариант D1)', () => {
    const result = parseOnlineGanttFile(
      ganttFile({
        data: [
          {
            TaskID: 1,
            TaskName: 'Группа',
            subtasks: [
              {
                TaskID: 2,
                TaskName: 'Задача с назначением',
                StartDate: '2026-08-31T05:00:00.000Z',
                EndDate: '2026-09-04T14:00:00.000Z',
                Duration: 5,
                Predecessor: '',
                resources: [{ resourceId: 'QA', unit: 100 }],
                info: '<p>примечание</p>',
                DurationUnit: 'day',
              },
              {
                TaskID: 3,
                TaskName: 'Задача без назначения',
                StartDate: '2026-09-07T05:00:00.000Z',
                EndDate: '2026-09-11T14:00:00.000Z',
                Duration: 5,
                Predecessor: '2FS+1 day',
                resources: [],
                DurationUnit: 'day',
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const validation = parsePlanContent(result.payload.content);
      expect(validation.ok).toBe(true);
      expect(result.payload.report.summary).toEqual({
        tasks: 2,
        groups: 1,
        resources: 1,
        dependencies: 1,
        unassignedTasks: 1,
      });
    }
  });
});

describe('htmlNotesToText', () => {
  it('вырезает теги, сохраняет переводы строк и декодирует сущности', () => {
    expect(htmlNotesToText('<p>17.12</p>')).toBe('17.12');
    expect(htmlNotesToText('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
    expect(htmlNotesToText('<div>раз<br>два</div>')).toBe('раз\nдва');
    expect(htmlNotesToText('<p><br></p>')).toBe('');
  });
});
