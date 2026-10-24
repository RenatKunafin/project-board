import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  generatePlan,
  mulberry32,
  type FixturePlan,
} from './generate-plan.js';

const SMALL_PLAN_PATH = 'tests/fixtures/gantt/small-plan.json';
const GOLDEN_PATH = 'tests/fixtures/gantt/plan-500.json';

describe('малый контрольный набор', () => {
  const smallPlan = JSON.parse(readFileSync(SMALL_PLAN_PATH, 'utf8')) as FixturePlan;

  it('структура согласована: ссылки id существуют', () => {
    const taskIds = new Set(smallPlan.tasks.map((task) => task.id));
    const groupIds = new Set(smallPlan.groups.map((group) => group.id));
    const resourceIds = new Set(smallPlan.resources.map((resource) => resource.id));

    expect(taskIds.size).toBe(smallPlan.tasks.length);
    expect(groupIds.size).toBe(smallPlan.groups.length);
    expect(resourceIds.size).toBe(smallPlan.resources.length);
    for (const task of smallPlan.tasks) {
      expect(groupIds.has(task.groupId!)).toBe(true);
      for (const assigneeId of task.assigneeIds) {
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

    expect(taskIds.size).toBe(plan.tasks.length);
    expect(groupIds.size).toBe(plan.groups.length);
    expect(resourceIds.size).toBe(plan.resources.length);
    expect(groupIds.size).toBeGreaterThan(0);
    for (const task of plan.tasks) {
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
