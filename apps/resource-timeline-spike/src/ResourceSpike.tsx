import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Timeline, { type TimelineKeys } from 'react-calendar-timeline';
import {
  busyIntervals,
  createWorkingCalendar,
  dragTaskTo,
  formatIso,
  resizeTaskEnd,
  resizeTaskStart,
  workingDuration,
  type SpikePlan,
} from './plan';
import { isoToMs, msToIso, type SpikeGroup, type SpikeItem } from './rct-types';

const DAY_MS = 86400000;

const TIMELINE_KEYS: TimelineKeys = {
  groupIdKey: 'id',
  groupTitleKey: 'title',
  groupLabelKey: 'title',
  groupRightTitleKey: 'rightTitle',
  itemIdKey: 'id',
  itemTitleKey: 'title',
  itemDivTitleKey: 'title',
  itemGroupKey: 'group',
  itemTimeStartKey: 'start_time',
  itemTimeEndKey: 'end_time',
};

interface Props {
  initialPlan: SpikePlan;
  periodStart: string;
  periodEnd: string;
}

export default function ResourceSpike({ initialPlan, periodStart, periodEnd }: Props) {
  const [plan, setPlan] = useState<SpikePlan>(initialPlan);
  const [log, setLog] = useState<string[]>([]);
  const planRef = useRef(plan);
  planRef.current = plan;
  const ganttHostRef = useRef<HTMLDivElement | null>(null);

  const appendLog = (line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 40));
  };

  const calendar = useMemo(
    () => createWorkingCalendar(plan.calendar),
    [plan.calendar],
  );

  const groups = useMemo<SpikeGroup[]>(
    () => plan.resources.map((r) => ({ id: r.id, title: r.name })),
    [plan.resources],
  );

  const items = useMemo<SpikeItem[]>(() => {
    const result: SpikeItem[] = [];
    // Лента занятости ресурса: union непрерывных интервалов назначений (D8).
    for (const resource of plan.resources) {
      for (const [i, busy] of busyIntervals(plan, resource.id).entries()) {
        result.push({
          id: `busy:${resource.id}:${i}`,
          group: resource.id,
          title: 'занят',
          start_time: isoToMs(busy.start),
          end_time: isoToMs(busy.end) + DAY_MS,
          className: 'spike-busy-item',
          canMove: false,
          canResize: false,
          itemProps: { 'data-kind': 'busy' } as React.HTMLProps<HTMLDivElement>,
        });
      }
    }
    // Задачи: элемент на дорожке каждого назначенного ресурса (D1).
    for (const task of plan.tasks) {
      for (const resourceId of task.assigneeIds) {
        if (!plan.resources.some((r) => r.id === resourceId)) continue;
        result.push({
          id: `task:${task.id}@${resourceId}`,
          group: resourceId,
          title: task.title,
          start_time: isoToMs(task.start),
          end_time: isoToMs(task.end) + DAY_MS,
          className: 'spike-task-item',
          canMove: true,
          canResize: 'both',
          itemProps: { 'data-kind': 'task', 'data-task-id': task.id } as React.HTMLProps<HTMLDivElement>,
        });
      }
    }
    // Отпуск: недоступность конкретного ресурса, не двигается (D6-визуал).
    for (const unavail of plan.unavailability) {
      result.push({
        id: `unavail:${unavail.id}`,
        group: unavail.resourceId,
        title: unavail.title ?? 'недоступен',
        start_time: isoToMs(unavail.start),
        end_time: isoToMs(unavail.end) + DAY_MS,
        className: 'spike-unavail-item',
        canMove: false,
        canResize: false,
        itemProps: { 'data-kind': 'unavail' } as React.HTMLProps<HTMLDivElement>,
      });
    }
    return result;
  }, [plan]);

  const applyRule = useCallback(
    (taskId: string, gesture: 'move' | 'resize-left' | 'resize-right', edgeMs: number) => {
      const task = planRef.current.tasks.find((t) => t.id === taskId);
      if (!task) return;
      // Время жеста снапится к ближайшей локальной полуночи (день-точность).
      const snapped = new Date(edgeMs);
      if (snapped.getHours() >= 12) snapped.setDate(snapped.getDate() + 1);
      snapped.setHours(0, 0, 0, 0);
      const edgeIso = formatIso(snapped);
      let next: SpikePlan;
      let kind: string;
      if (gesture === 'move') {
        // Перетаскивание всей задачи: рабочая длительность сохраняется,
        // начало привязывается к рабочему дню в сторону переноса (A2).
        const direction = edgeIso > task.start ? 'forward' : 'backward';
        next = dragTaskTo(planRef.current, taskId, edgeIso, direction);
        kind = 'drag (A2)';
      } else if (gesture === 'resize-left') {
        // Ресайз левой границы: ручной ввод начала (A3).
        next = resizeTaskStart(planRef.current, taskId, edgeIso);
        kind = 'resize-left (A3)';
      } else {
        // Ресайз правой границы: ручной ввод окончания (A3/A4).
        next = resizeTaskEnd(planRef.current, taskId, edgeIso);
        kind = 'resize-right (A3)';
      }
      const updated = next.tasks.find((t) => t.id === taskId);
      if (!updated) return;
      if (updated.start === task.start && updated.end === task.end) return;
      setPlan(next);
      appendLog(`${kind} ${taskId}: ${task.start}..${task.end} -> ${updated.start}..${updated.end} (wd=${workingDuration(next, updated)})`);
    },
    [],
  );

  // В 0.30.0-beta.19 onItemMove/onItemResize при жестах не эмитятся —
  // работает только onItemDrag (событие на каждый кадр). Факт жеста
  // запоминаем, применяем правила после mouseup по проверенной схеме
  // PBT-014 («стор -> правила -> стор»).
  const pendingDragRef = useRef<null | {
    itemId: string;
    gesture: 'move' | 'resize-left' | 'resize-right';
    edgeMs: number;
  }>(null);

  const onItemDrag = useCallback((ev: { eventType?: string; itemId: string | number; time: number; edge?: string }) => {
    const id = String(ev.itemId);
    if (!id.startsWith('task:')) return;
    const gesture = ev.eventType === 'move' ? 'move' : ev.edge === 'left' ? 'resize-left' : 'resize-right';
    pendingDragRef.current = { itemId: id, gesture, edgeMs: ev.time };
  }, []);

  useEffect(() => {
    const host = ganttHostRef.current;
    if (!host) return;
    const handler = () => {
      const pending = pendingDragRef.current;
      pendingDragRef.current = null;
      if (!pending) return;
      setTimeout(() => {
        const id = pending.itemId;
        const taskId = id.slice('task:'.length).split('@')[0];
        applyRule(taskId, pending.gesture, pending.edgeMs);
      }, 60);
    };
    host.addEventListener('mouseup', handler);
    host.addEventListener('touchend', handler);
    return () => {
      host.removeEventListener('mouseup', handler);
      host.removeEventListener('touchend', handler);
    };
  }, [applyRule]);

  // Подсветка вертикальных колонок: праздник — акцентный класс.
  const verticalLineClassNamesForTime = useCallback(
    (start: number) => {
      const iso = msToIso(start);
      return plan.calendar.holidays.includes(iso) ? ['spike-vl-holiday'] : [];
    },
    [plan.calendar.holidays],
  );

  // Панель загрузки: занятые интервалы и окна по каждому ресурсу.
  const loadRows = useMemo(
    () =>
      plan.resources.map((r) => {
        const busy = busyIntervals(plan, r.id)
          .map((b) => `${b.start}..${b.end}`)
          .join(', ');
        const free = calendar.workingDaysBetween(periodStart, periodEnd)
          - plan.tasks
            .filter((t) => t.assigneeIds.includes(r.id))
            .reduce((sum, t) => sum + workingDuration(plan, t), 0);
        return { resource: r, busy: busy || '—', free };
      }),
    [plan, calendar, periodStart, periodEnd],
  );

  return (
    <div className="spike">
      <header className="spike-toolbar">
        <strong>PBT-015 · спайк ресурсных дорожек (React Calendar Timeline)</strong>
        <span className="spike-legend">
          <span>
            <span className="swatch" style={{ background: '#e3e7ec' }} />
            выходной
          </span>
          <span>
            <span className="swatch" style={{ background: '#f8d3d3' }} />
            праздник
          </span>
          <span>
            <span className="swatch" style={{ background: '#455a64' }} />
            занятость ресурса
          </span>
        </span>
      </header>

      <div className="spike-gantt" ref={ganttHostRef}>
        <Timeline
          groups={groups}
          items={items}
          keys={TIMELINE_KEYS}
          defaultTimeStart={isoToMs(periodStart)}
          defaultTimeEnd={isoToMs(periodEnd) + DAY_MS}
          sidebarWidth={200}
          lineHeight={40}
          itemHeightRatio={0.72}
          stackItems
          canMove
          canResize="both"
          useResizeHandle
          canChangeGroup={false}
          timeSteps={{ day: 1, hour: 1, minute: 1, second: 1, month: 1, year: 1 }}
          onItemDrag={onItemDrag}
          onItemSelect={(id) => appendLog(`select: ${String(id)}`)}
          onItemClick={(id) => appendLog(`click: ${String(id)}`)}
          verticalLineClassNamesForTime={verticalLineClassNamesForTime}
        />
      </div>

      <section className="spike-load">
        <table>
          <thead>
            <tr>
              <th>Ресурс</th>
              <th>Занят (интервалы задач)</th>
              <th>Рабочие дни, свободные в периоде</th>
            </tr>
          </thead>
          <tbody>
            {loadRows.map((r) => (
              <tr key={r.resource.id}>
                <td>{r.resource.name}</td>
                <td>{r.busy}</td>
                <td>{r.free}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <aside className="spike-log">
        <strong>Лог правил</strong>
        <ul>
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
