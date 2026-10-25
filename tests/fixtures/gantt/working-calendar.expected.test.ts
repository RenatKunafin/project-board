// Ожидания эталона проверяются продуктовым календарём и диагностикой ядра.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWorkingCalendar } from '../../../packages/gantt/src/working-calendar';
import { parsePlanContent } from '../../../packages/gantt/src/plan-document';
import { dependencyViolations } from '../../../packages/gantt/src/plan-dependencies';
import { resourceConflicts } from '../../../packages/gantt/src/plan-conflicts';
import type { FixturePlan } from './generate-plan';

const smallPlan = JSON.parse(
  readFileSync('tests/fixtures/gantt/small-plan.json', 'utf8'),
) as FixturePlan;

// Преобразуется только старый формат фикстуры, правила конфликтов не повторяются.
const parsed = parsePlanContent({
  title: smallPlan.meta.title,
  calendar: { ...smallPlan.meta.calendar, workingExceptions: [] },
  tasks: smallPlan.tasks,
  groups: smallPlan.groups,
  resources: smallPlan.resources.map(resource => ({ id: resource.id, title: resource.name })),
  workTypes: smallPlan.workTypes.map(type => ({ id: type.id, title: type.title, allowsParallel: type.parallel })),
  dependencies: smallPlan.dependencies.map((dependency, index) => ({ id: `fixture-dep-${index}`, ...dependency })),
  unavailability: smallPlan.unavailability,
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const plan = parsed.plan;
const calendar = createWorkingCalendar(plan.calendar);

function task(id: string) {
  const found = plan.tasks.find(item => item.id === id);
  if (!found) throw new Error(`Задача ${id} не найдена в фикстуре`);
  return found;
}

describe('малый контрольный набор — ожидания E1-E8 (ADR PBT-003)', () => {
  it('E1: задача A с праздником 14.10 внутри — рабочая длительность 4', () => {
    const taskA = task('t-a');
    expect(calendar.workingDaysBetween(taskA.start, taskA.end)).toBe(4);
  });

  it('E2: зависимость A→B с лагом 0 не нарушена, раннее начало отклоняется диагностикой', () => {
    expect(dependencyViolations(plan)).toEqual([]);
    const early = { ...plan, tasks: plan.tasks.map(item => item.id === 't-b' ? { ...item, start: '2026-10-16' } : item) };
    expect(dependencyViolations(early)).toEqual([
      expect.objectContaining({ fromTaskId: 't-a', toTaskId: 't-b', expectedStart: '2026-10-19' }),
    ]);
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
    const pair = { ...plan, tasks: [task('t-b'), task('t-c')] };
    expect(resourceConflicts(pair)).toEqual([]);
    // Проверка чувствительна к политике типа: без параллельности конфликт появляется.
    const serial = { ...pair, workTypes: pair.workTypes.map(type => ({ ...type, allowsParallel: false })) };
    expect(resourceConflicts(serial)).toEqual([
      expect.objectContaining({ kind: 'parallel-work', resourceId: 'r1', firstTaskId: 't-b', secondTaskId: 't-c' }),
    ]);
  });

  it('E6: Разработка × Разработка у R1 — конфликт', () => {
    const pair = { ...plan, tasks: [task('t-c'), task('t-d')] };
    expect(resourceConflicts(pair)).toEqual([
      expect.objectContaining({
        kind: 'parallel-work', resourceId: 'r1', firstTaskId: 't-c', secondTaskId: 't-d',
        intervalStart: '2026-10-20', intervalEnd: '2026-10-21',
      }),
    ]);
  });

  it('E7: отпуск R1 26-27 × задача E — конфликт по рабочим дням', () => {
    expect(resourceConflicts({ ...plan, tasks: [task('t-e')] })).toEqual([
      expect.objectContaining({
        kind: 'unavailability', resourceId: 'r1', taskId: 't-e', unavailabilityId: 'u-r1',
        intervalStart: '2026-10-26', intervalEnd: '2026-10-27',
      }),
    ]);
  });

  it('E8: отпуск в праздник 14.10 не конфликтует с задачей A', () => {
    const holidayAbsence = {
      ...plan, tasks: [task('t-a')],
      unavailability: [{ id: 'holiday-absence', resourceId: 'r1', start: '2026-10-14', end: '2026-10-14' }],
    };
    expect(resourceConflicts(holidayAbsence)).toEqual([]);
    const workingHoliday = { ...holidayAbsence, calendar: { ...plan.calendar, workingExceptions: ['2026-10-14'] } };
    expect(resourceConflicts(workingHoliday)).toEqual([
      expect.objectContaining({ kind: 'unavailability', taskId: 't-a', unavailabilityId: 'holiday-absence' }),
    ]);
  });
});
