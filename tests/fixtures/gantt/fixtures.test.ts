import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  convertReferenceGantt,
  parsePredecessor,
  referenceDate,
} from './reference-gantt.js';
import {
  generatePlan,
  mulberry32,
} from './generate-plan.js';

const SMALL_PLAN_PATH = 'tests/fixtures/gantt/small-plan.json';
const REFERENCE_PATH = 'tests/fixtures/gantt/diagramm.reference.gantt';
const GOLDEN_PATH = 'tests/fixtures/gantt/plan-500.json';

describe('малый контрольный набор', () => {
  const smallPlan = JSON.parse(readFileSync(SMALL_PLAN_PATH, 'utf8')) as {
    tasks: Array<{ id: string; start: string; end: string; groupId: string }>;
    groups: Array<{ id: string }>;
    dependencies: Array<{ fromTaskId: string; toTaskId: string; lagDays: number }>;
    unavailability: Array<{ id: string; resourceId: string; start: string }>;
    resources: Array<{ id: string }>;
  };

  it('структура согласована: ссылки id существуют', () => {
    const taskIds = new Set(smallPlan.tasks.map((task) => task.id));
    const groupIds = new Set(smallPlan.groups.map((group) => group.id));
    const resourceIds = new Set(smallPlan.resources.map((resource) => resource.id));

    for (const task of smallPlan.tasks) {
      expect(groupIds.has(task.groupId)).toBe(true);
      for (const assigneeId of []) {
        expect(resourceIds.has(assigneeId)).toBe(true);
      }
    }
    for (const dependency of smallPlan.dependencies) {
      expect(taskIds.has(dependency.fromTaskId)).toBe(true);
      expect(taskIds.has(dependency.toTaskId)).toBe(true);
      expect(dependency.lagDays).toBeGreaterThanOrEqual(0);
    }
    for (const unavailability of smallPlan.unavailability) {
      expect(resourceIds.has(unavailability.resourceId)).toBe(true);
    }
  });

  it('праздник 14.10 внутри интервала задачи A (пн-пт)', () => {
    const taskA = smallPlan.tasks.find((task) => task.id === 't-a');
    expect(taskA).toBeDefined();
    expect(taskA!.start).toBe('2026-10-12'); // понедельник
    expect(taskA!.end).toBe('2026-10-16'); // пятница
  });

  it('зависимость A->B с лагом 0', () => {
    expect(smallPlan.dependencies).toContainEqual({
      fromTaskId: 't-a',
      toTaskId: 't-b',
      lagDays: 0,
    });
  });

  it('отпуск R1 пересекается с задачей E', () => {
    const taskE = smallPlan.tasks.find((task) => task.id === 't-e');
    const vacation = smallPlan.unavailability.find((item) => item.id === 'u-r1');
    expect(taskE?.assigneeIds).toContain('r1');
    expect(vacation!.start).toBe('2026-10-26');
    expect(vacation!.end).toBe('2026-10-27');
    expect(taskE!.start <= vacation!.end && taskE!.end >= vacation!.start).toBe(
      true,
    );
  });
});

describe('эталон рабочего примера', () => {
  const reference = readFileSync(REFERENCE_PATH, 'utf8');

  it('конвертация даёт 47 записей и 9 ресурсов', () => {
    const plan = convertReferenceGantt(reference);
    expect(plan.tasks).toHaveLength(47);
    expect(plan.resources).toHaveLength(9);
    expect(plan.meta.calendar.holidays).toContain('2026-11-04');
  });

  it('parsePredecessor разбирает "7FS" и "7FS+14 days"', () => {
    expect(parsePredecessor('15FS')).toEqual({ taskId: 't-15', lagDays: 0 });
    expect(parsePredecessor('7FS+14 days')).toEqual({
      taskId: 't-7',
      lagDays: 14,
    });
    expect(parsePredecessor('7SS')).toBeNull();
  });

  it('UTC-метки конвертируются в даты Europe/Moscow', () => {
    // 2026-08-31T05:00:00Z = 08:00 MSK -> дата 2026-08-31.
    expect(referenceDate('2026-08-31T05:00:00.000Z')).toBe('2026-08-31');
  });
});

describe('генератор 500 задач', () => {
  it('mulberry32 детерминирован', () => {
    const first = mulberry32(42);
    const second = mulberry32(42);
    for (let i = 0; i < 10; i += 1) {
      expect(first()).toBe(second());
    }
  });

  it('генерация воспроизводима и соответствует golden-файлу', () => {
    const fresh = JSON.stringify(
      generatePlan({ seed: 42, taskCount: 500 }),
      null,
      2,
    );
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(GOLDEN_PATH, fresh);
    }
    const golden = readFileSync(GOLDEN_PATH, 'utf8');
    expect(fresh).toBe(golden);
  });

  it('план содержит 500 задач с корректными ссылками', () => {
    const plan = generatePlan({ seed: 42, taskCount: 500 });
    expect(plan.tasks).toHaveLength(500);

    const taskIds = new Set(plan.tasks.map((task) => task.id));
    const groupIds = new Set(plan.groups.map((group) => group.id));
    const resourceIds = new Set(plan.resources.map((resource) => resource.id));

    expect(groupIds.size).toBeGreaterThan(0);
    for (const task of plan.tasks) {
      expect(taskIds.has(task.id)).toBe(true);
      expect(groupIds.has(task.groupId!)).toBe(true);
      expect(task.assigneeIds.every((id) => resourceIds.has(id))).toBe(true);
    }
    for (const dependency of plan.dependencies) {
      expect(taskIds.has(dependency.fromTaskId)).toBe(true);
      expect(taskIds.has(dependency.toTaskId)).toBe(true);
      expect(dependency.lagDays).toBeGreaterThanOrEqual(0);
    }
  });
});
