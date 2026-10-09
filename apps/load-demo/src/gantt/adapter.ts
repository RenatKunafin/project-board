import type { ILink, ITask } from '@svar-ui/react-gantt';
import { addCalendarDaysIso, isoToDate, type SpikePlan } from '../plan-core';

// FS-зависимость «окончание -> начало» в терминах SVAR.
const FS: ILink['type'] = 'e2s';

/**
 * Фикстуры -> модель SVAR. Источник истины — план спайка (включительные
 * даты, A1). Внутренняя семантика SVAR всегда исключительная; inclusiveEnd
 * меняет только отображение и ввод, поэтому окончание передаётся как
 * «включительный end + 1 день» независимо от флага.
 */
export function toSvarTasks(plan: SpikePlan): ITask[] {
  const summaries: ITask[] = plan.groups.map((g) => ({
    id: g.id,
    text: g.title,
    type: 'summary',
    open: true,
  }));
  const tasks: ITask[] = plan.tasks.map((t) => ({
    id: t.id,
    text: t.title,
    type: 'task',
    start: isoToDate(t.start),
    end: isoToDate(addCalendarDaysIso(t.end, 1)),
    parent: t.groupId,
    progress: 0,
  }));
  return [...summaries, ...tasks];
}

export function toSvarLinks(plan: SpikePlan): ILink[] {
  return plan.dependencies.map((d, i) => ({
    id: `link-${i + 1}`,
    source: d.fromTaskId,
    target: d.toTaskId,
    type: FS,
    lag: d.lagDays,
  }));
}
