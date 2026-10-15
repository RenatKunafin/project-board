import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Timeline from 'react-calendar-timeline';
import type { TimelineKeys } from 'react-calendar-timeline';
import 'react-calendar-timeline/dist/style.css';
import type { ManagedDocument, WidgetProps } from '@project-board/widget-sdk';
import {
  createPlanContent,
  parsePlanContent,
  type PlanContent,
  type PlanIssue,
} from './plan-document';
import { nonWorkingDayKind } from './svar-adapter';
import { resourceConflicts } from './plan-conflicts';
import { moveTask, setTaskDates } from './plan-commands';
import { addCalendarDays, calendarDaySpan } from './working-calendar';
import {
  planToTimelineGroups,
  planToTimelineItems,
  timelineConflictMarks,
  timelineDayIso,
  timelineRange,
  type TimelineGroup,
  type TimelineItem,
} from './resource-timeline-adapter';
import TaskEditorDialog from './TaskEditorDialog';
import { useTaskForm, type TaskEditorState } from './use-task-form';
import './resource-timeline.css';
import './task-editor.css';

/**
 * Ключи данных RCT 0.30.0-beta.19 (спайк PBT-015): поля item —
 * start_time/end_time, дефолтные имена contract совпадают с адаптером.
 */
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

const DAY_MS = 86_400_000;

/** Мс жеста → ISO ближайшей локальной полуночи (полуденное правило спайка PBT-015). */
function snapToDayIso(ms: number): string {
  const date = new Date(ms);
  if (date.getHours() >= 12) {
    date.setDate(date.getDate() + 1);
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

interface PendingGesture {
  readonly eventType: 'move' | 'resize';
  readonly taskId: string;
  readonly time: number;
  readonly edge?: string;
  /** Пиксельная база resize (факт resize беты масштабно врёт). */
  readonly startX?: number;
  readonly dayPx?: number;
}

/**
 * Ресурсное представление документа плана (PBT-047): компактные дорожки
 * исполнителей на React Calendar Timeline. Редактирование сроков —
 * PBT-048: drag/resize по схеме ADR-5 («факт → правила ядра → применение»),
 * форма задачи по двойному клику; переназначение ресурса жестом исключено.
 */
export default function ResourceTimelineWidget({
  widgetInstanceId,
  documentId,
  documentService,
  visible,
}: WidgetProps) {
  const [document, setDocument] = useState<ManagedDocument | undefined>(
    undefined,
  );
  // Форма задачи (PBT-048): общий диалог с проектным видом.
  const [editor, setEditor] = useState<TaskEditorState | undefined>(undefined);
  const focusAnchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!documentId || !documentService) {
      return;
    }
    const current = documentService.get(documentId);
    if (current) {
      setDocument(current);
    }
    // Подписка сохраняется при hidden: возврат показывает актуальный документ.
    const unsubscribe = documentService.subscribe(documentId, (updated) => {
      setDocument(updated);
    });
    return unsubscribe;
  }, [documentId, documentService]);

  const validation = useMemo(
    () => (document ? parsePlanContent(document.content) : undefined),
    [document],
  );
  const plan: PlanContent | undefined = validation?.ok
    ? validation.plan
    : undefined;
  const planRef = useRef(plan);
  planRef.current = plan;
  const documentRef = useRef(document);
  documentRef.current = document;

  const openEditor = useCallback((next: TaskEditorState) => {
    focusAnchorRef.current =
      window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
    setEditor(next);
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(undefined);
    focusAnchorRef.current?.focus();
    focusAnchorRef.current = null;
  }, []);

  const {
    submitTaskForm,
    deleteCurrentTask,
    applyDependencyCommand,
  } = useTaskForm({
    documentId,
    documentService,
    document,
    plan,
    editor,
    onClose: closeEditor,
  });

  // Производные представления данных (D2/D4 PBT-047): пересчёт при
  // рендере, записей не создаёт. Своя запись жеста не пересобирает
  // дорожки (D5 PBT-048): прокрутка сохраняется, данные идут через props.
  const localRevisionRef = useRef<number | null>(null);
  const remountKeyRef = useRef<string>('init');
  const ownWrite =
    document !== undefined &&
    localRevisionRef.current !== null &&
    document.revision === localRevisionRef.current;

  // ─── Жесты drag/resize (PBT-048, ADR-5: «факт → правила → применение») ──
  // Бета эмитит только onItemDrag (каждый кадр, после клика-выделения).
  // Перенос использует time события (проверено: точное время указателя).
  // Resize-факт беты масштабно врёт (мышь +2 дня → time +45 дней, находка
  // отладки 2026-10-15), поэтому дата края считается по пиксельной дельте
  // указателя: день = ширина полосы / календарная длительность задачи.
  // mouseup (capture на document — жест может закончиться вне чарта)
  // применяет правила ядра; холостая ревизия и отклонение — без записи.
  const pendingRef = useRef<PendingGesture | null>(null);
  const gestureExpectedRef = useRef<Map<string, { start: string; end: string }>>(
    new Map(),
  );
  const pointerXRef = useRef<number | null>(null);

  useEffect(() => {
    const track = (event: MouseEvent | TouchEvent) => {
      pointerXRef.current =
        'clientX' in event ? event.clientX : (event.touches[0]?.clientX ?? null);
    };
    window.document.addEventListener('mousemove', track, true);
    window.document.addEventListener('touchmove', track, true);
    return () => {
      window.document.removeEventListener('mousemove', track, true);
      window.document.removeEventListener('touchmove', track, true);
    };
  }, []);

  const onItemDrag = useCallback(
    (ev: {
      eventType?: 'move' | 'resize';
      itemId: string | number;
      time: number;
      edge?: string;
    }) => {
      const itemId = String(ev.itemId);
      if (itemId.startsWith('u-')) {
        return; // недоступность не редактируется (D6 PBT-047)
      }
      const taskId = itemId.split(':')[0];
      const planNow = planRef.current;
      const task = planNow?.tasks.find((entry) => entry.id === taskId);
      if (task === undefined) {
        return;
      }
      if (pendingRef.current === null) {
        // Первый факт нового жеста: база сравнения — текущий документ;
        // для resize фиксируются точка указателя и день в пикселях.
        gestureExpectedRef.current.clear();
        gestureExpectedRef.current.set(taskId, {
          start: task.start,
          end: task.end,
        });
        const startX = pointerXRef.current;
        const itemWidth = window.document.querySelector(
          `[data-rt-task="${taskId}"]`,
        )?.getBoundingClientRect().width;
        const spanDays = calendarDaySpan(task.start, task.end) + 1;
        const resizeMeasurable =
          ev.eventType === 'resize' &&
          startX !== null &&
          itemWidth !== undefined &&
          itemWidth > 0 &&
          spanDays > 0;
        pendingRef.current = {
          eventType: ev.eventType ?? 'move',
          taskId,
          time: ev.time,
          edge: ev.edge,
          ...(resizeMeasurable ? { startX, dayPx: itemWidth / spanDays } : {}),
        };
        return;
      }
      pendingRef.current = {
        ...pendingRef.current,
        time: ev.time,
        edge: ev.edge ?? pendingRef.current.edge,
      };
    },
    [],
  );

  const applyGesture = useCallback(
    (pending: PendingGesture) => {
      if (!documentId || !documentService) {
        return;
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const latest =
          documentService.get(documentId) ?? documentRef.current;
        if (latest === undefined) {
          return;
        }
        const parsed = parsePlanContent(latest.content);
        if (!parsed.ok) {
          return;
        }
        const task = parsed.plan.tasks.find(
          (entry) => entry.id === pending.taskId,
        );
        if (task === undefined) {
          return;
        }
        const base =
          gestureExpectedRef.current.get(pending.taskId) ??
          { start: task.start, end: task.end };
        // Классификация (A2/A3, схема PBT-039): сдвиг обоих краёв — перенос
        // с сохранением рабочей длительности; один край — ручной ввод даты.
        // Перенос: время указателя события (A2-привязка делает снап ядром).
        // Resize: пиксельная дельта указателя от старта жеста (сырой time
        // ресайза беты масштабно врёт); край — дата как введена, даже
        // нерабочая (A3).
        const result =
          pending.eventType === 'move'
            ? (() => {
                const snapIso = snapToDayIso(pending.time);
                return snapIso !== base.start
                  ? moveTask(parsed.plan, pending.taskId, snapIso)
                  : undefined;
              })()
            : (() => {
                if (
                  pending.startX === undefined ||
                  pending.dayPx === undefined
                ) {
                  return undefined;
                }
                const currentX = pointerXRef.current ?? pending.startX;
                const deltaDays = Math.round(
                  (currentX - pending.startX) / pending.dayPx,
                );
                if (deltaDays === 0) {
                  return undefined;
                }
                return pending.edge === 'left'
                  ? (() => {
                      const newStart = addCalendarDays(base.start, deltaDays);
                      return newStart !== base.start
                        ? setTaskDates(parsed.plan, pending.taskId, {
                            start: newStart,
                            end: base.end,
                          })
                        : undefined;
                    })()
                  : (() => {
                      const newEnd = addCalendarDays(base.end, deltaDays);
                      return newEnd !== base.end
                        ? setTaskDates(parsed.plan, pending.taskId, {
                            start: base.start,
                            end: newEnd,
                          })
                        : undefined;
                    })();
              })();
        if (result === undefined) {
          return; // холостая жеста: правила не меняют даты
        }
        if (!result.ok) {
          return; // отклонение ядром: без записи, полоса вернётся из props
        }
        const next = result.plan.tasks.find(
          (entry) => entry.id === pending.taskId,
        );
        if (next === undefined) {
          return;
        }
        if (next.start === task.start && next.end === task.end) {
          gestureExpectedRef.current.set(pending.taskId, {
            start: next.start,
            end: next.end,
          });
          return; // правила вернули даты документа — холостая ревизия исключена
        }
        try {
          const saved = documentService.update(
            documentId,
            latest.revision,
            result.plan,
          );
          // Своя запись не пересобирает дорожки (прокрутка сохраняется).
          localRevisionRef.current = saved.revision;
          gestureExpectedRef.current.set(pending.taskId, {
            start: next.start,
            end: next.end,
          });
          return;
        } catch {
          // Конфликт ревизии (записал второй экземпляр) — повтор.
        }
      }
    },
    [documentId, documentService],
  );

  useEffect(() => {
    // interactjs завершает жест после mouseup — применение с задержкой
    // 60 мс (прецедент спайка PBT-015). Capture: жест может закончиться
    // вне чарта (прецедент PBT-039).
    const handler = () => {
      const pending = pendingRef.current;
      if (pending === null) {
        return;
      }
      pendingRef.current = null;
      window.setTimeout(() => applyGesture(pending), 60);
    };
    window.document.addEventListener('mouseup', handler, true);
    window.document.addEventListener('touchend', handler, true);
    return () => {
      window.document.removeEventListener('mouseup', handler, true);
      window.document.removeEventListener('touchend', handler, true);
    };
  }, [applyGesture]);

  const onItemDoubleClick = useCallback(
    (itemId: string | number) => {
      const taskId = String(itemId).split(':')[0];
      if (planRef.current?.tasks.some((entry) => entry.id === taskId)) {
        openEditor({ mode: 'edit', taskId });
      }
    },
    [openEditor],
  );

  // Производные представления данных (D2/D4): пересчёт при рендере,
  // записей не создаёт. Ремоунт по ревизии (D7) обновляет дорожки при
  // внешних изменениях; собственная запись жеста — без ремоунта.
  const groups = useMemo<TimelineGroup[]>(
    () => (plan ? planToTimelineGroups(plan) : []),
    [plan],
  );
  const items = useMemo<TimelineItem[]>(() => {
    if (!plan) {
      return [];
    }
    return planToTimelineItems(
      plan,
      timelineConflictMarks(resourceConflicts(plan)),
    );
  }, [plan]);
  const range = useMemo(
    () => timelineRange(plan ?? createPlanContent()),
    [plan],
  );
  const dayClassNames = useCallback((startMs: number): string[] => {
    if (plan === undefined) {
      return [];
    }
    const kind = nonWorkingDayKind(plan, timelineDayIso(startMs));
    if (kind === 'holiday') {
      return ['rtl-day--holiday'];
    }
    return kind === 'weekend' ? ['rtl-day--weekend'] : [];
    // План читается через замыкание: классы считаются на текущий рендер.
  }, [plan]);
  // Подсветка ведётся по началу дневного интервала шкалы (колонка дня).
  const verticalLineClassNamesForTime = useCallback(
    (startMs: number): string[] => dayClassNames(startMs),
    [dayClassNames],
  );

  if (!documentId || !documentService) {
    return (
      <section
        className="resource-timeline"
        data-widget-instance={widgetInstanceId}
      >
        <p className="resource-timeline__hint">План: документ не выбран.</p>
      </section>
    );
  }

  if (document === undefined) {
    return (
      <section
        className="resource-timeline"
        data-widget-instance={widgetInstanceId}
      >
        <p className="resource-timeline__hint">Загрузка плана…</p>
      </section>
    );
  }

  if (validation !== undefined && !validation.ok) {
    return (
      <section
        className="resource-timeline resource-timeline--error"
        data-widget-instance={widgetInstanceId}
      >
        <p className="resource-timeline__hint">
          Документ плана повреждён, отображение недоступно:
        </p>
        <ul className="resource-timeline__issues">
          {validation.issues.map((issue: PlanIssue, index) => (
            <li key={`${issue.path}-${issue.code}-${index}`}>
              <span data-plan-issue-code={issue.code}>
                {issue.path ? `${issue.path}: ` : ''}
                {issue.message}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section
      className="resource-timeline"
      data-widget-instance={widgetInstanceId}
      data-plan-title={document.title}
    >
      {visible === false ? (
        <p className="resource-timeline__hint">
          Просмотр приостановлен: окно скрыто, документ обновляется в фоне.
        </p>
      ) : groups.length === 0 ? (
        <p className="resource-timeline__hint" data-rt-empty>
          В плане нет ресурсов: добавьте их в настройках плана.
        </p>
      ) : (
        <div className="resource-timeline__chart" data-rt-chart>
          {/* Ключ по ревизии: внешние изменения (второй вид, формы)
              пересобирают дорожки; собственная запись жеста подавляет
              ремоунт — прокрутка сохраняется (design D5 PBT-048). */}
          <Timeline<TimelineItem, TimelineGroup>
            key={
              ownWrite ? remountKeyRef.current : String(document.revision)
            }
            groups={groups}
            items={items}
            keys={TIMELINE_KEYS}
            defaultTimeStart={range.start}
            defaultTimeEnd={range.end}
            sidebarWidth={150}
            rightSidebarWidth={0}
            lineHeight={34}
            itemHeightRatio={0.72}
            minZoom={7 * DAY_MS}
            maxZoom={730 * DAY_MS}
            timeSteps={{
              second: 1,
              minute: 1,
              hour: 1,
              day: 1,
              month: 1,
              year: 1,
            }}
            stackItems
            canMove
            canChangeGroup={false}
            canResize="both"
            useResizeHandle
            onItemDrag={onItemDrag}
            onItemDoubleClick={onItemDoubleClick}
            verticalLineClassNamesForTime={verticalLineClassNamesForTime}
          />
        </div>
      )}
      {editor !== undefined && editor.mode === 'edit' && plan !== undefined && (
        <TaskEditorDialog
          plan={plan}
          mode="edit"
          task={plan.tasks.find((task) => task.id === editor.taskId)}
          onSubmit={submitTaskForm}
          applyDependencyCommand={applyDependencyCommand}
          onDelete={deleteCurrentTask}
          onClose={closeEditor}
        />
      )}
    </section>
  );
}
