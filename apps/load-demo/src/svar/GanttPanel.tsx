import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IApi } from '@svar-ui/react-gantt';
import { Gantt, Willow } from '@svar-ui/react-gantt';
import { toSvarLinks, toSvarTasks } from '../gantt/adapter';
import {
  createWorkingCalendar,
  dragTaskTo,
  formatIso,
  resizeTaskEnd,
  type SpikePlan,
} from '../plan-core';

interface Props {
  panelId: string;
  title: string;
  initialPlan: SpikePlan;
  onPlanChanged: (panelId: string, plan: SpikePlan) => void;
  onGestureMs: (panelId: string, ms: number) => void;
  onAddTaskMs: (panelId: string, ms: number) => void;
  onMounted: (panelId: string) => void;
}

/** SVAR-гантт в панельном режиме (по мотивам спайка PBT-014). */
export default function GanttPanel({
  panelId,
  title,
  initialPlan,
  onPlanChanged,
  onGestureMs,
  onAddTaskMs,
  onMounted,
}: Props) {
  const [plan, setPlan] = useState<SpikePlan>(initialPlan);
  const planRef = useRef(plan);
  planRef.current = plan;
  const apiRef = useRef<IApi | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const addCounter = useRef(0);

  const initialTasks = useMemo(() => toSvarTasks(plan), [plan]);
  const initialLinks = useMemo(() => toSvarLinks(plan), [plan]);
  const calendar = useMemo(() => createWorkingCalendar(plan.calendar), [plan.calendar]);

  const highlightTime = useCallback(
    (date: Date) => (calendar.isWorkingDay(formatIso(date)) ? '' : 'ld-holiday'),
    [calendar],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handler = () => {
      const instance = apiRef.current;
      if (!instance) return;
      const t0 = performance.now();
      // Факты берём из стора SVAR (payload'ы ненадёжны — урок PBT-014).
      setTimeout(() => {
        for (const task of planRef.current.tasks) {
          let stored: { start?: Date; end?: Date };
          try {
            stored = instance.getTask(task.id) as { start?: Date; end?: Date };
          } catch {
            continue;
          }
          if (!(stored.start instanceof Date) || !(stored.end instanceof Date)) continue;
          const storeStart = formatIso(stored.start);
          const storeEndInc = formatIso(new Date(stored.end.getTime() - 86400000));
          if (storeStart === task.start && storeEndInc === task.end) continue;
          let next: SpikePlan;
          if (storeStart !== task.start) {
            const direction = storeStart < task.start ? 'backward' : 'forward';
            next = dragTaskTo(planRef.current, task.id, storeStart, direction);
          } else {
            next = resizeTaskEnd(planRef.current, task.id, storeEndInc);
          }
          const updated = next.tasks.find((t) => t.id === task.id);
          if (!updated) continue;
          setPlan(next);
          onPlanChanged(panelId, next);
          requestAnimationFrame(() => onGestureMs(panelId, performance.now() - t0));
          break;
        }
      }, 60);
    };
    host.addEventListener('mouseup', handler);
    host.addEventListener('touchend', handler);
    return () => {
      host.removeEventListener('mouseup', handler);
      host.removeEventListener('touchend', handler);
    };
    // Обработчик навешивается один раз на время жизни панели.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initApi = (instance: IApi) => {
    apiRef.current = instance;
    const hooks = window as unknown as Record<string, unknown>;
    const apis = (hooks.__loadApi ?? {}) as Record<string, IApi>;
    apis[panelId] = instance;
    hooks.__loadApi = apis;
    onMounted(panelId);
  };

  // Нагрузочная операция «добавление задачи»: замер exec + перерисовки.
  const addTask = () => {
    const instance = apiRef.current;
    if (!instance) return;
    const n = (addCounter.current += 1);
    const t0 = performance.now();
    instance.exec('add-task', {
      id: `add-${panelId}-${n}`,
      task: {
        text: `Добавленная ${n}`,
        type: 'task',
        start: new Date(2026, 9, 12),
        end: new Date(2026, 9, 13),
        progress: 0,
      },
    });
    requestAnimationFrame(() => onAddTaskMs(panelId, performance.now() - t0));
  };

  return (
    <div className="ld-panel" data-panel={panelId}>
      <header className="ld-panel-head">
        <strong>{title}</strong>
        <button type="button" onClick={addTask}>
          + Задача
        </button>
      </header>
      <div className="ld-panel-body" ref={hostRef}>
        <Willow>
          <Gantt
            tasks={initialTasks}
            links={initialLinks}
            inclusiveEnd
            init={initApi}
            highlightTime={highlightTime}
          />
        </Willow>
      </div>
    </div>
  );
}
