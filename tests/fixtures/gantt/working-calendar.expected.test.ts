// Ожидания E1–E8 из small-plan-expected.md прогоняются на чистых функциях
// календаря (PBT-013). Файл вне tsconfig пакетов: работает только через Vitest.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWorkingCalendar } from '../../../packages/gantt/src/working-calendar';
import type { FixturePlan } from './generate-plan';

const smallPlan = JSON.parse(
  readFileSync('tests/fixtures/gantt/small-plan.json', 'utf8'),
) as FixturePlan;

const calendar = createWorkingCalendar({
  workingDays: smallPlan.meta.calendar.workingDays,
  holidays: smallPlan.meta.calendar.holidays,
});

function task(id: string): {
  start: string;
  end: string;
  assigneeIds: readonly string[];
  workTypeIds: readonly string[];
} {
  const found = smallPlan.tasks.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Задача ${id} не найдена в фикстуре`);
  }
  return found;
}

const workTypeParallel = (id: string): boolean =>
  smallPlan.workTypes.find((workType) => workType.id === id)?.parallel ?? false;

function overlapDays(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): number {
  return calendar.workingDaysBetween(
    aStart > bStart ? aStart : bStart,
    aEnd < bEnd ? aEnd : bEnd,
  );
}

describe('малый контрольный набор — ожидания E1-E8 (ADR PBT-003)', () => {
  it('E1: задача A с праздником 14.10 внутри — рабочая длительность 4', () => {
    const taskA = task('t-a');
    expect(calendar.workingDaysBetween(taskA.start, taskA.end)).toBe(4);
  });

  it('E2: зависимость A→B с лагом 0 не нарушена (B с ближайшего рабочего дня)', () => {
    const taskA = task('t-a');
    const taskB = task('t-b');
    const earliestStart = calendar.addWorkingDays(taskA.end, 0);
    expect(earliestStart).toBe('2026-10-19');
    expect(taskB.start >= earliestStart).toBe(true);
  });

  it('E3: задача C — рабочая длительность 5', () => {
    const taskC = task('t-c');
    expect(calendar.workingDaysBetween(taskC.start, taskC.end)).toBe(5);
  });

  it('E4: задача D — рабочая длительность 2', () => {
    const taskD = task('t-d');
    expect(calendar.workingDaysBetween(taskD.start, taskD.end)).toBe(2);
  });

  it('E5: ПСИ × Разработка у R1 — допустимо (ПСИ параллелизуемая)', () => {
    const taskB = task('t-b'); // ПСИ 19-20
    const taskC = task('t-c'); // Разработка 19-23
    const overlap = overlapDays(taskB.start, taskB.end, taskC.start, taskC.end);
    expect(overlap).toBeGreaterThan(0);
    const bParallel = taskB.workTypeIds.some((id) => workTypeParallel(id));
    const cParallel = taskC.workTypeIds.some((id) => workTypeParallel(id));
    expect(overlap > 0 && !bParallel && !cParallel).toBe(false);
  });

  it('E6: Разработка × Разработка у R1 — конфликт', () => {
    const taskC = task('t-c'); // Разработка 19-23
    const taskD = task('t-d'); // Разработка 20-21
    const overlap = overlapDays(taskC.start, taskC.end, taskD.start, taskD.end);
    expect(overlap).toBeGreaterThan(0);
    const conflict =
      overlap > 0 &&
      !taskC.workTypeIds.some((id) => workTypeParallel(id)) &&
      !taskD.workTypeIds.some((id) => workTypeParallel(id));
    expect(conflict).toBe(true);
  });

  it('E7: отпуск R1 26-27 × задача E (26-28) — конфликт по рабочим дням', () => {
    const taskE = task('t-e');
    const vacation = smallPlan.unavailability.find(
      (item) => item.id === 'u-r1',
    );
    expect(vacation).toBeDefined();
    expect(
      calendar.workingDaysBetween(vacation!.start, vacation!.end),
    ).toBe(2);
    expect(
      overlapDays(vacation!.start, vacation!.end, taskE.start, taskE.end),
    ).toBe(2);
    expect(taskE.assigneeIds).toContain('r1');
  });

  it('E8: праздник 14.10 не даёт занятости — конфликта с ним нет', () => {
    expect(calendar.isWorkingDay('2026-10-14')).toBe(false);
  });
});
