import type { CSSProperties, HTMLProps } from 'react';
import type { PlanContent } from './plan-document';
import { addCalendarDays } from './working-calendar';
import type { ResourceConflict } from './plan-conflicts';

/**
 * Локальный контракт данных RCT (минимальный, без протекания типов
 * библиотеки). Поля start_time/end_time — числа-мс локальных полночей
 * (контракт 0.30.0-beta.19, спайк PBT-015); день-точность — A1.
 */
export interface TimelineGroup {
  readonly id: string;
  readonly title: string;
}

export interface TimelineItem {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  readonly start_time: number;
  readonly end_time: number;
  readonly canMove: boolean;
  readonly canResize: boolean | 'left' | 'right' | 'both';
  readonly className?: string;
  /**
   * itemProps — единственный путь стилей в дефолтном itemRenderer
   * 0.30.0-beta.19 (getItemStyle мерджит itemProps.style поверх
   * дефолтных синих/жёлтых; поле item.style бета игнорирует).
   */
  readonly itemProps?: HTMLProps<HTMLDivElement>;
}

/**
 * Стили полос через токены :root: инлайн-стили дефолтного itemRenderer
 * RCT (синий/жёлтый) перекрываются полем item.style (Object.assign
 * дефолтов и item.style в Item). className остаётся для e2e-локаторов.
 */
const taskStyle: CSSProperties = {
  background: 'var(--color-accent)',
  // Бордер темнее фона: стык соседних задач читается как граница,
  // полосы не сливаются (правка владельца).
  borderColor: 'var(--color-rt-task-border)',
  color: 'var(--color-on-accent)',
  fontSize: 12,
};
const conflictTaskStyle: CSSProperties = {
  background: 'var(--color-rt-conflict-bg)',
  borderColor: 'var(--color-danger)',
  color: 'var(--color-danger)',
  fontSize: 12,
};
const unavailabilityStyle: CSSProperties = {
  background: 'var(--color-rt-unavailability-bg)',
  borderColor: 'var(--color-rt-unavailability-border)',
  color: 'var(--color-danger)',
  fontSize: 11,
};

/**
 * Отметки конфликтных элементов из диагностики ядра (PBT-036):
 * пары работ и работа × недоступность.
 */
export interface TimelineConflictMarks {
  readonly taskIds: ReadonlySet<string>;
  readonly unavailabilityIds: ReadonlySet<string>;
}

/** ISO (включительный день) → мс локальной полночи. */
export function timelineDayStartMs(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

/** Мс локального времени → ISO дня (подсветка вертикальных линий). */
export function timelineDayIso(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Ресурсы в порядке массива документа → группы дорожек. */
export function planToTimelineGroups(plan: PlanContent): TimelineGroup[] {
  return plan.resources.map((resource) => ({
    id: resource.id,
    title: resource.title,
  }));
}

/**
 * Диагностика ядра → множества конфликтных задач/недоступностей.
 * parallel-work отмечает обе работы пары; unavailability — работу
 * и сам период недоступности (D6).
 */
export function timelineConflictMarks(
  conflicts: readonly ResourceConflict[],
): TimelineConflictMarks {
  const taskIds = new Set<string>();
  const unavailabilityIds = new Set<string>();
  for (const conflict of conflicts) {
    if (conflict.kind === 'parallel-work') {
      taskIds.add(conflict.firstTaskId);
      taskIds.add(conflict.secondTaskId);
    } else {
      taskIds.add(conflict.taskId);
      unavailabilityIds.add(conflict.unavailabilityId);
    }
  }
  return { taskIds, unavailabilityIds };
}

/**
 * План → элементы дорожек (ADR-4 PBT-017): назначения — на дорожке
 * каждого ресурса (D1), неназначенные задачи не отображаются (D2),
 * недоступность — элемент у своего ресурса без жестов. Включительное
 * окончание → полночь дня после окончания (A1). Задачи редактируются
 * жестами (PBT-048: drag/resize после клика-выделения, ADR-5);
 * недоступность — только чтение.
 */
export function planToTimelineItems(
  plan: PlanContent,
  marks?: TimelineConflictMarks,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const knownResources = new Set(plan.resources.map((resource) => resource.id));
  for (const task of plan.tasks) {
    for (const resourceId of task.assigneeIds ?? []) {
      if (!knownResources.has(resourceId)) {
        continue;
      }
      const conflict = marks?.taskIds.has(task.id) ?? false;
      items.push({
        id: `${task.id}:${resourceId}`,
        group: resourceId,
        title: task.title,
        start_time: timelineDayStartMs(task.start),
        end_time: timelineDayStartMs(addCalendarDays(task.end, 1)),
        canMove: true,
        canResize: 'both',
        ...(conflict
          ? { className: 'rtl-item--conflict' }
          : {}),
        itemProps: {
          style: conflict ? conflictTaskStyle : taskStyle,
          'data-rt-task': task.id,
        } as HTMLProps<HTMLDivElement>,
      });
    }
  }
  for (const unavailability of plan.unavailability) {
    if (!knownResources.has(unavailability.resourceId)) {
      continue;
    }
    const conflict = marks?.unavailabilityIds.has(unavailability.id) ?? false;
    items.push({
      id: `u-${unavailability.id}`,
      group: unavailability.resourceId,
      title: 'Недоступен',
      start_time: timelineDayStartMs(unavailability.start),
      end_time: timelineDayStartMs(addCalendarDays(unavailability.end, 1)),
      canMove: false,
      canResize: false,
      className: conflict
        ? 'rtl-item--unavailability rtl-item--conflict'
        : 'rtl-item--unavailability',
      itemProps: {
        style: conflict
          ? { ...unavailabilityStyle, borderColor: 'var(--color-danger)' }
          : unavailabilityStyle,
        'data-rt-unavailability': unavailability.id,
      } as HTMLProps<HTMLDivElement>,
    });
  }
  return items;
}

/**
 * Диапазон шкалы (мс) с небольшим запасом от задач и недоступностей:
 * широкий запас даёт полосы в пару пикселей на ширине окна виджета
 * (наблюдение PBT-047), зум RCT доступен пользователю (minZoom/maxZoom).
 * Пустой план — соседние месяцы текущего. RCT применяет default-диапазон
 * при монтировании, скролл — свой.
 */
export function timelineRange(
  plan: PlanContent,
): { start: number; end: number } {
  let min: string | undefined;
  let max: string | undefined;
  for (const task of plan.tasks) {
    if (min === undefined || task.start < min) {
      min = task.start;
    }
    if (max === undefined || task.end > max) {
      max = task.end;
    }
  }
  for (const unavailability of plan.unavailability) {
    if (min === undefined || unavailability.start < min) {
      min = unavailability.start;
    }
    if (max === undefined || unavailability.end > max) {
      max = unavailability.end;
    }
  }
  if (min === undefined || max === undefined) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return { start: start.getTime(), end: end.getTime() };
  }
  return {
    start: timelineDayStartMs(addCalendarDays(min, -5)),
    end: timelineDayStartMs(addCalendarDays(max, 25)),
  };
}
