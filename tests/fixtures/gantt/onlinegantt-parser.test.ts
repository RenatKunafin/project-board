// Эталоны формата OnlineGantt .gantt (PBT-052, design D9): два рабочих
// примера — плоский и иерархический. Файлы вне tsconfig пакетов:
// работают только через Vitest (паттерн native-plan-format.test.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOnlineGanttFile } from '../../../packages/gantt/src/onlinegantt-parser';
import { parsePlanContent } from '../../../packages/gantt/src/plan-document';

const FLAT_PATH = 'tests/fixtures/gantt/diagramm.reference.gantt';
const NESTED_PATH = 'tests/fixtures/gantt/onlinegantt-20261016.reference.gantt';

describe('эталон 1: плоский рабочий пример diagramm.gantt', () => {
  const result = parseOnlineGanttFile(readFileSync(FLAT_PATH, 'utf8'));

  it('даёт 47 задач, 9 ресурсов и 21 зависимость без групп', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.issues));
    }
    expect(result.payload.report.summary).toEqual({
      tasks: 47,
      groups: 0,
      resources: 9,
      dependencies: 21,
      unassignedTasks: 16,
    });
  });

  it('результат проходит валидацию плана', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(parsePlanContent(result.payload.content).ok).toBe(true);
    }
  });

  it('даты не сдвигаются из-за UTC: включительный конец', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      // ОТПУСК-РЕНАТ: 2026-08-31T05:00Z — 2026-09-11T14:00Z (Europe/Moscow).
      const task = result.payload.content.tasks.find((task) => task.id === 't-49');
      expect(task).toMatchObject({ start: '2026-08-31', end: '2026-09-11' });
    }
  });

  it('праздник попадает на 4 ноября, рабочая неделя пн–пт', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.content.calendar.holidays).toEqual(['2026-11-04']);
      expect(result.payload.content.calendar.workingDays).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('лаги: 15FS → 0, 7FS+14 days → 14, 9FS+1 day → 1', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      const deps = result.payload.content.dependencies;
      expect(deps).toContainEqual({
        id: 'dep-t-15-t-18',
        fromTaskId: 't-15',
        toTaskId: 't-18',
        lagDays: 0,
      });
      expect(deps).toContainEqual({
        id: 'dep-t-7-t-8',
        fromTaskId: 't-7',
        toTaskId: 't-8',
        lagDays: 14,
      });
      expect(deps).toContainEqual({
        id: 'dep-t-9-t-10',
        fromTaskId: 't-9',
        toTaskId: 't-10',
        lagDays: 1,
      });
    }
  });

  it('назначения с unit сохраняются; примечания — текстом', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      // ОКАД-АНЛ-ЕФС [6] назначен на «Аналитик», unit 100.
      const assigned = result.payload.content.tasks.find((task) => task.id === 't-6');
      expect(assigned!.assigneeIds).toEqual(['Аналитик']);
      expect(assigned!.assigneeUnits).toEqual({ Аналитик: 100 });

      const notes14 = result.payload.content.tasks.find((task) => task.id === 't-14');
      expect(notes14!.notes).toBe('17.12');
      const noted = result.payload.content.tasks.filter((task) => task.notes !== undefined);
      expect(noted).toHaveLength(2);
    }
  });

  it('16 строк без назначений остались обычными задачами', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      const unassigned = result.payload.content.tasks.filter(
        (task) => task.assigneeIds === undefined,
      );
      expect(unassigned).toHaveLength(16);
      // Отпуска не распознаются по имени (D7): это просто задачи без назначений.
      expect(unassigned.every((task) => task.title.startsWith('ОТПУСК'))).toBe(true);
    }
  });

  it('отчёт без предупреждений о данных — только настройки (цвет вне палитры — Авто)', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      // PBT-084: 41 запись с color вне палитры получают «Авто» без
      // предупреждения; прогресса в эталоне нет — dropped-task-fields
      // не появляется. Предупреждений о датах, ссылках и назначениях нет.
      const codes = new Set(
        result.payload.report.warnings.map((warning) => warning.code),
      );
      expect([...codes].sort()).toEqual(['skipped-settings']);
      expect(
        result.payload.content.tasks.every((task) => task.color === undefined),
      ).toBe(true);
    }
  });
});

describe('эталон 2: иерархический пример Online Gantt 20261016.gantt', () => {
  const result = parseOnlineGanttFile(readFileSync(NESTED_PATH, 'utf8'));

  it('контейнеры становятся группами, листья — задачами групп', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.issues));
    }
    expect(result.payload.content.groups).toEqual([
      { id: 'g-69', title: 'Отпуск' },
      { id: 'g-70', title: 'ОКАД' },
    ]);
    expect(result.payload.report.summary).toEqual({
      tasks: 47,
      groups: 2,
      resources: 9,
      dependencies: 21,
      unassignedTasks: 16,
    });

    const inVacation = result.payload.content.tasks.filter(
      (task) => task.groupId === 'g-69',
    );
    const inOkad = result.payload.content.tasks.filter(
      (task) => task.groupId === 'g-70',
    );
    expect(inVacation).toHaveLength(16);
    expect(inOkad).toHaveLength(16);
  });

  it('результат проходит валидацию плана', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(parsePlanContent(result.payload.content).ok).toBe(true);
    }
  });

  it('даты контейнеров не переносились: задач с датами охвата нет', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Сводный охват «Отпуска» 27.07–30.12 не должен появиться задачей.
      const span = result.payload.content.tasks.find(
        (task) => task.start === '2026-07-27' && task.end === '2026-12-30',
      );
      expect(span).toBeUndefined();
      const task49 = result.payload.content.tasks.find((task) => task.id === 't-49');
      expect(task49).toMatchObject({
        groupId: 'g-69',
        start: '2026-07-27',
        end: '2026-07-31',
      });
    }
  });

  it('зависимость через границу контейнеров создана', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      // БЧ-АНЛ-ANDR [55] (корень) → ОКАД-АНЛ-iOS [17] (внутри «ОКАД»), лаг 25.
      expect(result.payload.content.dependencies).toContainEqual({
        id: 'dep-t-17-t-55',
        fromTaskId: 't-17',
        toTaskId: 't-55',
        lagDays: 25,
      });
    }
  });

  it('сверка Duration по всем записям сходится — предупреждений о датах нет', () => {
    expect(result.ok).toBe(true);
    if (result.ok) {
      const codes = result.payload.report.warnings.map((warning) => warning.code);
      expect(codes).not.toContain('duration-mismatch');
      expect(codes).not.toContain('invalid-task-date');
    }
  });
});
