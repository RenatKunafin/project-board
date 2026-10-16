import { type PlanContent, type PlanTask } from './plan-document';
import { addCalendarDays, createWorkingCalendar } from './working-calendar';

/**
 * Генерация PlantUML Gantt для публикации плана (PBT-055).
 * Вид — по целевому примеру владельца (.context/examples/
 * plant-uml-example.plantuml): алиасы, requires/starts, палитра этапов,
 * отпуска разделом, выходные заливкой, language ru.
 * Целевая версия рендера — PlantUML 1.2026.9beta4 (design D6).
 */

export interface PlantUmlExportNote {
  readonly topic: string;
  readonly message: string;
}

export interface PlantUmlExportResult {
  readonly text: string;
  readonly report: readonly PlantUmlExportNote[];
}

interface PlantUmlExportPrivateResult {
  readonly text: string;
  readonly report: PlantUmlExportNote[];
}

/**
 * Палитра этапов целевого примера (design D3): маркер в названии → цвет.
 *
 * TODO (техдолг, владелец 2026-10-16 «слишком специфично, требует доработки»):
 * эвристика по маркерам названия временная. Направление доработки — цвет
 * из типа работы справочника плана (модельная связь вместо разбора названий);
 * требует наполнения workTypes у планов (после импорта — вручную).
 */
const STAGE_COLORS: readonly (readonly [string, string])[] = [
  ['АНЛ', 'LightSkyBlue'],
  ['ANL', 'LightSkyBlue'],
  ['DEV', 'MediumPurple'],
  ['ИФТ', 'Orange'],
  ['IFT', 'Orange'],
  ['ПСИ', 'Tomato'],
  ['PSI', 'Tomato'],
  ['ТРЖ', 'LightGreen'],
  ['TRJ', 'LightGreen'],
];

const VACATION_COLOR = 'DarkGreen';

const WEEKDAY_LINES: readonly (readonly [number, string])[] = [
  [1, 'monday are closed'],
  [2, 'tuesday are closed'],
  [3, 'wednesday are closed'],
  [4, 'thursday are closed'],
  [5, 'friday are closed'],
  [6, 'saturday are closed'],
  [7, 'sunday are closed'],
];

/** Кодирование названия (design D4): скобки ломают синтаксис целевого формата. */
export function encodePlantUmlTitle(title: string): string {
  return title
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/:/g, '—')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

function stageColor(title: string): string | undefined {
  const upper = title.toUpperCase();
  for (const [marker, color] of STAGE_COLORS) {
    if (upper.includes(marker.toUpperCase())) {
      return color;
    }
  }
  return undefined;
}

/** Дата целевого формата: 2026/07/10 (по образцу примера владельца). */
function pumlDate(iso: string): string {
  return iso.replaceAll('-', '/');
}

interface Horizon {
  readonly min: string;
  readonly max: string;
}

function planHorizon(plan: PlanContent): Horizon | undefined {
  const dates: string[] = [];
  for (const task of plan.tasks) {
    dates.push(task.start, task.end);
  }
  for (const entry of plan.unavailability) {
    dates.push(entry.start, entry.end);
  }
  if (dates.length === 0) {
    return undefined;
  }
  dates.sort();
  return { min: dates[0], max: dates[dates.length - 1] };
}

function datesInRange(from: string, to: string, dates: readonly string[]): string[] {
  return [...dates].filter((date) => date >= from && date <= to).sort();
}

/** Диапазоны соседних дат для заливки выходных (design D2: склейка по соседству). */
function groupConsecutive(dates: readonly string[]): readonly (readonly [string, string])[] {
  const ranges: [string, string][] = [];
  for (const date of dates) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && addCalendarDays(last[1], 1) === date) {
      last[1] = date;
    } else {
      ranges.push([date, date]);
    }
  }
  return ranges;
}

interface GroupSection {
  readonly path: string;
  readonly taskIndexes: number[];
}

function groupSections(plan: PlanContent): readonly GroupSection[] {
  const byParent = new Map<string | undefined, string[]>();
  for (const group of plan.groups) {
    const key = group.parentId ?? undefined;
    const list = byParent.get(key) ?? [];
    list.push(group.id);
    byParent.set(key, list);
  }
  const titleById = new Map(plan.groups.map((group) => [group.id, group.title]));

  const pathOf = (groupId: string): string => {
    const parts: string[] = [];
    let current: string | undefined = groupId;
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current) && titleById.has(current)) {
      seen.add(current);
      parts.unshift(titleById.get(current)!);
      current = plan.groups.find((group) => group.id === current)?.parentId;
    }
    return parts.join(' / ');
  };

  const sections: GroupSection[] = [];
  const walk = (parent: string | undefined): void => {
    for (const groupId of byParent.get(parent) ?? []) {
      const indexes = plan.tasks
        .map((task, index) => (task.groupId === groupId ? index : -1))
        .filter((index) => index >= 0);
      sections.push({ path: pathOf(groupId), taskIndexes: indexes });
      walk(groupId);
    }
  };
  walk(undefined);
  return sections;
}

function taskRequiresBlock(
  alias: string,
  title: string,
  start: string,
  workingDays: number,
  color: string | undefined,
): string[] {
  const lines: string[] = [];
  const encoded = encodePlantUmlTitle(title);
  if (workingDays === 0) {
    // A6 + решение владельца 2026-10-16: интервал без рабочих дней — веха.
    lines.push(`[${encoded}] as [${alias}] happens ${pumlDate(start)}`);
  } else {
    lines.push(`[${encoded}] as [${alias}] requires ${workingDays} days`);
    lines.push(`[${alias}] starts ${pumlDate(start)}`);
  }
  if (color !== undefined) {
    lines.push(`[${alias}] is colored in ${color}/${color}`);
  }
  return lines;
}

export function serializePlanToPlantUml(plan: PlanContent): PlantUmlExportResult {
  const internal = serialize(plan);
  return { text: internal.text, report: internal.report };
}

function serialize(plan: PlanContent): PlantUmlExportPrivateResult {
  const report: PlantUmlExportNote[] = [];
  const calendar = createWorkingCalendar({
    workingDays: [...plan.calendar.workingDays],
    holidays: [...plan.calendar.holidays],
    workingExceptions: [...plan.calendar.workingExceptions],
  });
  const horizon = planHorizon(plan);
  if (horizon === undefined) {
    report.push({
      topic: 'empty-plan',
      message: 'План не содержит задач и отпусков — диаграмма пуста.',
    });
  }
  const anchor = horizon?.min ?? plan.calendar.holidays.slice().sort()[0] ?? '2000-01-01';

  const lines: string[] = [];
  lines.push('@startgantt');
  lines.push(`title ${encodePlantUmlTitle(plan.title ?? 'План')}`);
  lines.push('language ru');
  lines.push('');
  lines.push(`Project starts ${pumlDate(anchor)}`);
  lines.push('');

  // Неделя: закрытые дни вне workingDays.
  const workingDays = new Set<number>(plan.calendar.workingDays);
  for (const [day, line] of WEEKDAY_LINES) {
    if (!workingDays.has(day)) {
      lines.push(line);
    }
  }

  // Календарь — только внутри горизонта плана (решение владельца 2026-10-16).
  if (horizon !== undefined) {
    for (const holiday of datesInRange(horizon.min, horizon.max, plan.calendar.holidays)) {
      lines.push(`${pumlDate(holiday)} is closed`);
    }
    for (const exception of datesInRange(horizon.min, horizon.max, plan.calendar.workingExceptions)) {
      // Рабочее исключение переносимо: is open (скилл-референс владельца).
      lines.push(`${pumlDate(exception)} is open`);
    }
  }

  lines.push('');
  lines.push("' ============================================================");
  lines.push("' Цветовая схема по этапам:");
  const legendColors = new Set<string>();
  for (const [marker, color] of STAGE_COLORS) {
    if (!legendColors.has(color)) {
      legendColors.add(color);
      lines.push(`'   ${marker} → ${color}`);
    }
  }
  lines.push(`'   Отпуск → ${VACATION_COLOR}`);
  lines.push("' ============================================================");
  lines.push('');

  const aliasByTaskId = new Map<string, string>();
  plan.tasks.forEach((task, index) => {
    aliasByTaskId.set(task.id, `T${index + 1}`);
  });

  const emitTask = (task: PlanTask, alias: string): void => {
    const workingDaysCount = calendar.workingDaysBetween(task.start, task.end);
    const block = taskRequiresBlock(alias, task.title, task.start, workingDaysCount, stageColor(task.title));
    lines.push(...block);
    lines.push('');
    if (
      workingDaysCount > 0 &&
      (!calendar.isWorkingDay(task.start) || !calendar.isWorkingDay(task.end))
    ) {
      report.push({
        topic: 'non-working-edge',
        message: `Задача «${task.title}»: дата на нерабочем дне — полоса в диаграмме может лечь иначе, даты плана сохранены (${task.start}–${task.end}).`,
      });
    }
  };

  // Задачи без группы (или с несуществующей), затем группы DFS
  // с полным путём (пустые — выводим, решение владельца 2026-10-16).
  for (let index = 0; index < plan.tasks.length; index += 1) {
    const task = plan.tasks[index];
    if (task.groupId === undefined || !plan.groups.some((g) => g.id === task.groupId)) {
      emitTask(task, `T${index + 1}`);
    }
  }
  for (const section of groupSections(plan)) {
    lines.push(`-- ${encodePlantUmlTitle(section.path)} --`);
    lines.push('');
    for (const index of section.taskIndexes) {
      emitTask(plan.tasks[index], `T${index + 1}`);
    }
  }

  // Отпуска отдельным разделом (целевой пример).
  if (plan.unavailability.length > 0) {
    lines.push('-- Отпуска --');
    lines.push('');
    const resourceTitle = new Map(plan.resources.map((r) => [r.id, r.title]));
    plan.unavailability.forEach((entry, index) => {
      const alias = `U${index + 1}`;
      const title = `Отпуск — ${resourceTitle.get(entry.resourceId) ?? entry.resourceId}`;
      const workingDaysCount = calendar.workingDaysBetween(entry.start, entry.end);
      const block = taskRequiresBlock(alias, title, entry.start, workingDaysCount, VACATION_COLOR);
      lines.push(...block);
      lines.push('');
      if (
        workingDaysCount > 0 &&
        (!calendar.isWorkingDay(entry.start) || !calendar.isWorkingDay(entry.end))
      ) {
        report.push({
          topic: 'non-working-edge',
          message: `Отпуск «${title}»: дата на нерабочем дне — полоса может лечь иначе (${entry.start}–${entry.end}).`,
        });
      }
    });
  }

  // FS-связи по алиасам; лаг стрелкой не выражается — отчёт.
  if (plan.dependencies.length > 0) {
    lines.push("' FS-зависимости (стрелки без задержек)");
    for (const dependency of plan.dependencies) {
      const from = aliasByTaskId.get(dependency.fromTaskId);
      const to = aliasByTaskId.get(dependency.toTaskId);
      if (from === undefined || to === undefined) {
        continue;
      }
      lines.push(`[${from}] -> [${to}]`);
    }
    const withLag = plan.dependencies.filter((d) => d.lagDays > 0);
    if (withLag.length > 0) {
      report.push({
        topic: 'lag',
        message: `Задержки ${withLag.length} связей не отображаются стрелками (целевой формат не поддерживает лаг) — даты задач несут расписание.`,
      });
    }
    lines.push('');
  }

  // Выходные — серые диапазоны по горизонту (целевой пример).
  if (horizon !== undefined) {
    const weekendDates: string[] = [];
    for (let cursor = horizon.min; cursor <= horizon.max; cursor = addCalendarDays(cursor, 1)) {
      const day = new Date(`${cursor}T00:00:00Z`).getUTCDay() || 7;
      if (!workingDays.has(day)) {
        weekendDates.push(cursor);
      }
    }
    if (weekendDates.length > 0) {
      lines.push("' Выходные — серые (перекрывают всё, идут последними)");
      for (const [from, to] of groupConsecutive(weekendDates)) {
        lines.push(
          from === to
            ? `${pumlDate(from)} is colored in lightgray`
            : `${pumlDate(from)} to ${pumlDate(to)} are colored in lightgray`,
        );
      }
      lines.push('');
    }
  }

  lines.push('printscale daily zoom 1');
  lines.push('@endgantt');

  // Непереносимая семантика (design D5) — только при наличии данных.
  if (plan.groups.length > 0) {
    report.push({
      topic: 'summary-bar',
      message: 'Сводная полоса групп не выражается целевым форматом: группы показаны разделителями.',
    });
  }
  if (plan.workTypes.length > 0) {
    report.push({
      topic: 'work-types',
      message: 'Типы работ и параллельность не переносятся в формат публикации.',
    });
  }
  const withUnits = plan.tasks.some((task) => (task as { assigneeUnits?: unknown }).assigneeUnits !== undefined);
  if (withUnits) {
    report.push({
      topic: 'unit',
      message: 'Загрузка назначений (unit) не влияет на публикацию и не отображается.',
    });
  }

  return { text: lines.join('\n') + '\n', report };
}
