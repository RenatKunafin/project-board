import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Timeline, { type TimelineKeys } from 'react-calendar-timeline';
import {
  busyIntervals,
  dragTaskTo,
  formatIso,
  msToIso,
  resizeTaskEnd,
  resizeTaskStart,
  type SpikePlan,
} from '../plan-core';
import { isoToMs, type SpikeGroup, type SpikeItem } from '../rct-types';

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

const DAY_MS = 86400000;

interface Props {
  panelId: string;
  title: string;
  initialPlan: SpikePlan;
  onPlanChanged: (panelId: string, plan: SpikePlan) => void;
  onGestureMs: (panelId: string, ms: number) => void;
  onMounted: (panelId: string) => void;
}

/** Ресурсные дорожки в панельном режиме (по мотивам спайка PBT-015). */
export default function ResourcePanel({
  panelId,
  title,
  initialPlan,
  onPlanChanged,
  onGestureMs,
  onMounted,
}: Props) {
  const [plan, setPlan] = useState<SpikePlan>(initialPlan);
  const planRef = useRef(plan);
  planRef.current = plan;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<null | {
    taskId: string;
    gesture: 'move' | 'resize-left' | 'resize-right';
    edgeMs: number;
  }>(null);
  const t0Ref = useRef(0);

  const groups = useMemo<SpikeGroup[]>(
    () => plan.resources.map((r) => ({ id: r.id, title: r.name })),
    [plan.resources],
  );

  const items = useMemo<SpikeItem[]>(() => {
    const result: SpikeItem[] = [];
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
        });
      }
    }
    for (const task of plan.tasks) {
      for (const resourceId of task.assigneeIds) {
        result.push({
          id: `task:${task.id}@${resourceId}`,
          group: resourceId,
          title: task.title,
          start_time: isoToMs(task.start),
          end_time: isoToMs(task.end) + DAY_MS,
          className: 'spike-task-item',
          canMove: true,
          canResize: 'both',
        });
      }
    }
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
      });
    }
    return result;
  }, [plan]);

  const applyRule = useCallback(
    (taskId: string, gesture: 'move' | 'resize-left' | 'resize-right', edgeMs: number) => {
      const task = planRef.current.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const snapped = new Date(edgeMs);
      if (snapped.getHours() >= 12) snapped.setDate(snapped.getDate() + 1);
      snapped.setHours(0, 0, 0, 0);
      const edgeIso = formatIso(snapped);
      let next: SpikePlan;
      if (gesture === 'move') {
        const direction = edgeIso > task.start ? 'forward' : 'backward';
        next = dragTaskTo(planRef.current, taskId, edgeIso, direction);
      } else if (gesture === 'resize-left') {
        next = resizeTaskStart(planRef.current, taskId, edgeIso);
      } else {
        next = resizeTaskEnd(planRef.current, taskId, edgeIso);
      }
      const updated = next.tasks.find((t) => t.id === taskId);
      if (!updated) return;
      if (updated.start === task.start && updated.end === task.end) return;
      setPlan(next);
      onPlanChanged(panelId, next);
      requestAnimationFrame(() => onGestureMs(panelId, performance.now() - t0Ref.current));
    },
    [panelId, onPlanChanged, onGestureMs],
  );

  // Жесты RCT: только onItemDrag (бета), факт — на каждый кадр; правила
  // применяются после mouseup.
  const onItemDrag = useCallback((ev: { eventType?: string; itemId: string | number; time: number; edge?: string }) => {
    const id = String(ev.itemId);
    if (!id.startsWith('task:')) return;
    const gesture = ev.eventType === 'move' ? 'move' : ev.edge === 'left' ? 'resize-left' : 'resize-right';
    pendingRef.current = {
      taskId: id.slice('task:'.length).split('@')[0],
      gesture,
      edgeMs: ev.time,
    };
  }, []);

  useEffect(() => {
    onMounted(panelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handler = () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;
      t0Ref.current = performance.now();
      setTimeout(() => {
        applyRule(pending.taskId, pending.gesture, pending.edgeMs);
      }, 60);
    };
    host.addEventListener('mouseup', handler);
    host.addEventListener('touchend', handler);
    return () => {
      host.removeEventListener('mouseup', handler);
      host.removeEventListener('touchend', handler);
    };
  }, [applyRule]);

  const verticalLineClassNamesForTime = useCallback(
    (start: number) => {
      const iso = msToIso(start);
      return plan.calendar.holidays.includes(iso) ? ['ld-vl-holiday'] : [];
    },
    [plan.calendar.holidays],
  );

  return (
    <div className="ld-panel" data-panel={panelId}>
      <header className="ld-panel-head">
        <strong>{title}</strong>
      </header>
      <div className="ld-panel-body" ref={hostRef}>
        <Timeline
          groups={groups}
          items={items}
          keys={TIMELINE_KEYS}
          defaultTimeStart={isoToMs('2026-10-11')}
          defaultTimeEnd={isoToMs('2026-11-05')}
          sidebarWidth={150}
          lineHeight={38}
          itemHeightRatio={0.72}
          stackItems
          canResize="both"
          useResizeHandle
          canChangeGroup={false}
          timeSteps={{ day: 1, hour: 1, minute: 1, second: 1, month: 1, year: 1 }}
          onItemDrag={onItemDrag}
          verticalLineClassNamesForTime={verticalLineClassNamesForTime}
        />
      </div>
    </div>
  );
}
