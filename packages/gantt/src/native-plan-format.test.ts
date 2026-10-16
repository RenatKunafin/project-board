import { describe, expect, it } from 'vitest';
import { createPlanContent, type PlanContent } from './plan-document';
import {
  deserializePlanFile,
  type PlanFileDeserialize,
  type PlanFileIssue,
  PLAN_FILE_FORMAT,
  PLAN_FILE_FORMAT_VERSION,
  planFileName,
  serializePlanFile,
} from './native-plan-format';

function fullPlan(): PlanContent {
  return {
    ...createPlanContent(),
    calendar: {
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-10-14'],
      workingExceptions: [],
    },
    workTypes: [
      { id: 'dev', title: 'Разработка', allowsParallel: false },
      { id: 'psi', title: 'ПСИ', allowsParallel: true },
    ],
    resources: [
      { id: 'r1', title: 'Разработчик R1' },
      { id: 'r2', title: 'Разработчик R2' },
    ],
    groups: [{ id: 'g-phase-1', title: 'Фаза 1' }],
    tasks: [
      {
        id: 't-a',
        title: 'Задача A',
        groupId: 'g-phase-1',
        start: '2026-10-12',
        end: '2026-10-16',
        assigneeIds: ['r1'],
        workTypeIds: ['dev'],
      },
      {
        id: 't-b',
        title: 'Задача B (ПСИ)',
        groupId: 'g-phase-1',
        start: '2026-10-19',
        end: '2026-10-20',
        assigneeIds: ['r1'],
        workTypeIds: ['psi'],
      },
      {
        id: 't-c',
        title: 'Задача C',
        groupId: 'g-phase-1',
        start: '2026-10-19',
        end: '2026-10-23',
        assigneeIds: ['r1'],
        workTypeIds: ['dev'],
      },
      {
        id: 't-d',
        title: 'Задача D',
        groupId: 'g-phase-1',
        start: '2026-10-20',
        end: '2026-10-21',
        assigneeIds: ['r1'],
        workTypeIds: ['dev'],
      },
      {
        id: 't-e',
        title: 'Задача E',
        groupId: 'g-phase-1',
        start: '2026-10-26',
        end: '2026-10-28',
        assigneeIds: ['r1'],
        workTypeIds: ['dev'],
      },
    ],
    dependencies: [
      { id: 'd-1', fromTaskId: 't-a', toTaskId: 't-b', lagDays: 0 },
      { id: 'd-2', fromTaskId: 't-c', toTaskId: 't-e', lagDays: 1 },
    ],
    unavailability: [
      { id: 'u-r1', resourceId: 'r1', start: '2026-10-26', end: '2026-10-27' },
    ],
  };
}

function expectAccepted(
  result: PlanFileDeserialize,
): { title: string; content: PlanContent } {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(
      `Ожидался успешный результат, получены проблемы: ${JSON.stringify(result.issues)}`,
    );
  }
  return result.payload;
}

function expectRejected(result: PlanFileDeserialize): readonly PlanFileIssue[] {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Ожидался отказ, получен успешный результат');
  }
  return result.issues;
}

function envelopeWith(content: unknown, overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    format: PLAN_FILE_FORMAT,
    formatVersion: PLAN_FILE_FORMAT_VERSION,
    title: 'План',
    schemaVersion: 1,
    content,
    ...overrides,
  });
}

describe('serializePlanFile', () => {
  it('полный план переносится целиком: конверт и все разделы', () => {
    const plan = fullPlan();
    const result = serializePlanFile({
      title: 'Малый контрольный набор',
      content: plan,
    });
    expect(result.ok).toBe(true);
    const envelope = JSON.parse(result.json) as Record<string, unknown>;
    expect(envelope.format).toBe(PLAN_FILE_FORMAT);
    expect(envelope.formatVersion).toBe(PLAN_FILE_FORMAT_VERSION);
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.title).toBe('Малый контрольный набор');
    expect(envelope.content).toEqual(plan);
  });

  it('производные значения не попадают в файл', () => {
    const result = serializePlanFile({ title: 'План', content: fullPlan() });
    expect(result.ok).toBe(true);
    const envelope = JSON.parse(result.json) as {
      content: {
        tasks: Array<Record<string, unknown>>;
        groups: Array<Record<string, unknown>>;
      };
    };
    for (const task of envelope.content.tasks) {
      expect(task).not.toHaveProperty('duration');
      expect(task).not.toHaveProperty('workingDuration');
    }
    for (const group of envelope.content.groups) {
      expect(group).not.toHaveProperty('start');
      expect(group).not.toHaveProperty('end');
    }
  });

  it('файл — форматированный JSON (пригоден для чтения в редакторе)', () => {
    const result = serializePlanFile({ title: 'План', content: fullPlan() });
    expect(result.ok).toBe(true);
    expect(result.json).toContain('\n  "format"');
    expect(() => JSON.parse(result.json)).not.toThrow();
  });
});

describe('planFileName', () => {
  it('шаблон pb-plan-YYYY-MM-DD_HH-mm-ss.json', () => {
    expect(planFileName(new Date(2026, 9, 16, 9, 5, 3))).toBe(
      'pb-plan-2026-10-16_09-05-03.json',
    );
  });

  it('компоненты дополняются нулями', () => {
    expect(planFileName(new Date(2027, 0, 2, 13, 45, 59))).toBe(
      'pb-plan-2027-01-02_13-45-59.json',
    );
  });
});

describe('deserializePlanFile — диагностика конверта', () => {
  it('битый JSON даёт invalid-json', () => {
    const issues = expectRejected(
      deserializePlanFile('{"format": "project-board-plan"'),
    );
    expect(issues[0]).toMatchObject({ code: 'invalid-json', path: '' });
  });

  it('не-объект даёт invalid-envelope', () => {
    const issues = expectRejected(deserializePlanFile('[]'));
    expect(issues[0]).toMatchObject({ code: 'invalid-envelope', path: '' });
  });

  it('отсутствующий маркер формата даёт invalid-envelope по path format', () => {
    const issues = expectRejected(
      deserializePlanFile('{"title": "План"}'),
    );
    expect(issues[0]).toMatchObject({
      code: 'invalid-envelope',
      path: 'format',
    });
  });

  it('чужой формат даёт unknown-format', () => {
    const issues = expectRejected(
      deserializePlanFile(envelopeWith(fullPlan(), { format: 'online-gantt' })),
    );
    expect(issues[0]).toMatchObject({ code: 'unknown-format', path: 'format' });
  });

  it('некорректная formatVersion даёт invalid-envelope', () => {
    for (const bad of [0, 1.5, '1', null]) {
      const issues = expectRejected(
        deserializePlanFile(envelopeWith(fullPlan(), { formatVersion: bad })),
      );
      expect(issues[0]).toMatchObject({
        code: 'invalid-envelope',
        path: 'formatVersion',
      });
    }
  });

  it('будущая версия формата отклоняется без частичного плана', () => {
    const issues = expectRejected(
      deserializePlanFile(
        envelopeWith(fullPlan(), { formatVersion: PLAN_FILE_FORMAT_VERSION + 1 }),
      ),
    );
    expect(issues[0]).toMatchObject({
      code: 'unsupported-future-version',
      path: 'formatVersion',
    });
  });

  it('неподдерживаемая версия содержимого даёт invalid-envelope по path schemaVersion', () => {
    const issues = expectRejected(
      deserializePlanFile(envelopeWith(fullPlan(), { schemaVersion: 2 })),
    );
    expect(issues[0]).toMatchObject({
      code: 'invalid-envelope',
      path: 'schemaVersion',
    });
  });

  it('пустое или нестроковое название даёт invalid-envelope по path title', () => {
    for (const bad of ['', 5, null]) {
      const issues = expectRejected(
        deserializePlanFile(envelopeWith(fullPlan(), { title: bad })),
      );
      expect(issues[0]).toMatchObject({
        code: 'invalid-envelope',
        path: 'title',
      });
    }
  });

  it('отсутствующий content даёт invalid-envelope по path content', () => {
    const issues = expectRejected(
      deserializePlanFile(
        JSON.stringify({
          format: PLAN_FILE_FORMAT,
          formatVersion: 1,
          title: 'План',
          schemaVersion: 1,
        }),
      ),
    );
    expect(issues[0]).toMatchObject({
      code: 'invalid-envelope',
      path: 'content',
    });
  });
});

describe('deserializePlanFile — валидация содержимого', () => {
  it('битая ссылка и цикл групп дают plan-invalid с деталями', () => {
    const broken = {
      ...fullPlan(),
      tasks: [
        {
          id: 't-1',
          title: 'Задача 1',
          groupId: 'g-нет',
          start: '2026-10-12',
          end: '2026-10-13',
        },
      ],
      groups: [
        { id: 'g-a', title: 'A', parentId: 'g-b' },
        { id: 'g-b', title: 'B', parentId: 'g-a' },
      ],
    };
    const issues = expectRejected(deserializePlanFile(envelopeWith(broken)));
    expect(issues[0]).toMatchObject({ code: 'plan-invalid', path: 'content' });
    const codes = issues[0].details?.map((detail) => detail.code);
    expect(codes).toContain('unknown-reference');
    expect(codes).toContain('circular-group');
  });
});

describe('round-trip', () => {
  it('сериализация и десериализация восстанавливают название и все разделы', () => {
    const plan = fullPlan();
    const serialized = serializePlanFile({
      title: 'Малый контрольный набор',
      content: plan,
    });
    const payload = expectAccepted(deserializePlanFile(serialized.json));
    expect(payload.title).toBe('Малый контрольный набор');
    expect(payload.content).toEqual(plan);
  });

  it('дополнительное поле сущности проходит round-trip без потерь', () => {
    const serialized = serializePlanFile({ title: 'План', content: fullPlan() });
    const parsed = JSON.parse(serialized.json) as {
      content: { tasks: Array<Record<string, unknown>> };
    };
    parsed.content.tasks[0].customNote = 'примечание пользователя';
    const payload = expectAccepted(
      deserializePlanFile(JSON.stringify(parsed)),
    );
    expect(payload.content.tasks[0]).toHaveProperty(
      'customNote',
      'примечание пользователя',
    );
    const reserialized = serializePlanFile(payload);
    expect(reserialized.json).toContain('customNote');
  });
});

describe('политика идентификаторов — импорты независимы', () => {
  it('два чтения одного файла дают независимые планы с одинаковыми внутренними ID', () => {
    const serialized = serializePlanFile({
      title: 'План',
      content: fullPlan(),
    });
    const first = expectAccepted(deserializePlanFile(serialized.json));
    const second = expectAccepted(deserializePlanFile(serialized.json));
    // Каждый вызов строит собственный объектный граф: разделяемого
    // состояния между импортами нет, совпадение ID связей не создаёт.
    expect(first.content).not.toBe(second.content);
    expect(first.content.tasks).not.toBe(second.content.tasks);
    expect(first.content.resources).not.toBe(second.content.resources);
    expect(first.content).toEqual(second.content);
    expect(first.content.tasks[0].id).toBe(second.content.tasks[0].id);
  });
});
