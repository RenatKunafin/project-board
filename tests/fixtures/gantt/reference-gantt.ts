import type { FixturePlan } from './types.js';

/**
 * FIXTURES-ONLY: конвертер рабочего примера для тестовых нужд PBT-012.
 * Это НЕ полноценный продуктовый импорт .gantt — он появится в PBT-052
 * и не должен наследовать этот код без отдельного ревью.
 */

interface ReferenceTask {
  TaskID: number;
  TaskName: string;
  StartDate: string;
  EndDate: string;
  Duration: number;
  Predecessor?: string;
  resources?: Array<{ resourceId: string; unit?: number }>;
}

interface ReferenceFile {
  data: ReferenceTask[];
  resources: Array<{ resourceId: string; resourceName: string }>;
  projectStartDate?: string;
  projectEndDate?: string;
  advanced?: unknown;
}

const MOSCOW_TIMEZONE = 'Europe/Moscow';

/** UTC-метка исходного файла -> календарная дата YYYY-MM-DD в Europe/Moscow. */
export function referenceDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Некорректная метка времени: ${isoTimestamp}`);
  }
  return date.toLocaleDateString('sv-SE', { timeZone: MOSCOW_TIMEZONE });
}

/** Предшественник вида "7FS" или "7FS+14 days" -> { taskId, lagDays }. */
export function parsePredecessor(
  value: string,
): { taskId: string; lagDays: number } | null {
  const match = /^(\d+)FS(?:\+(\d+) ?days?)?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return { taskId: `t-${match[1]}`, lagDays: Number(match[2] ?? 0) };
}

export function convertReferenceGantt(
  fileContent: string,
  title = 'Рабочий пример (эталон)',
): FixturePlan {
  const reference = JSON.parse(fileContent) as ReferenceFile;

  const tasks = reference.data.map((task) => ({
    id: `t-${task.TaskID}`,
    title: task.TaskName,
    start: referenceDate(task.StartDate),
    end: referenceDate(task.EndDate),
    assigneeIds: (task.resources ?? []).map((resource) => resource.resourceId),
    workTypeIds: ['dev' as const],
  }));

  const dependencies = reference.data.flatMap((task) => {
    const predecessor = task.Predecessor
      ? parsePredecessor(task.Predecessor)
      : null;
    return predecessor
      ? [
          {
            fromTaskId: predecessor.taskId,
            toTaskId: `t-${task.TaskID}`,
            lagDays: predecessor.lagDays,
          },
        ]
      : [];
  });

  return {
    meta: {
      title,
      calendar: {
        workingDays: [1, 2, 3, 4, 5],
        // Праздник из наблюдений по рабочему примеру (решения, раздел 17).
        holidays: ['2026-11-04'],
      },
    },
    workTypes: [{ id: 'dev', title: 'Разработка', parallel: false }],
    resources: reference.resources.map((resource) => ({
      id: resource.resourceId,
      name: resource.resourceName,
      workTypeIds: ['dev' as const],
    })),
    groups: [],
    tasks,
    dependencies,
    unavailability: [],
  };
}
