import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import Timeline from 'react-calendar-timeline';
import type { DateHeaderProps, TimelineKeys } from 'react-calendar-timeline';
import { DateHeader, SidebarHeader, TimelineHeaders } from 'react-calendar-timeline';
import { Search, ZoomIn, ZoomOut } from 'lucide-react';
import 'react-calendar-timeline/dist/style.css';
import type { ManagedDocument, WidgetProps } from '@project-board/widget-sdk';
import {
  createPlanContent,
  parsePlanContent,
  type PlanContent,
  type PlanIssue,
} from './plan-document';
import { calendarView } from './calendar-view';
import { resourceConflicts } from './plan-conflicts';
import { moveTask, setTaskDates, updateTask } from './plan-commands';
import { addCalendarDays, calendarDaySpan } from './working-calendar';
import {
  planToTimelineGroups,
  planToTimelineItems,
  timelineConflictMarks,
  timelineDayIso,
  timelineDayStartMs,
  timelineRange,
  type TimelineGroup,
  type TimelineItem,
} from './resource-timeline-adapter';
import TaskEditorDialog from './TaskEditorDialog';
import { useTaskForm, type TaskEditorState } from './use-task-form';
import { TaskColorMenu, type TaskColorMenuState } from './task-color-picker';
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

/**
 * Инициалы ресурса для аватара сайдбара (PBT-074, по прототипу
 * groupRenderer): первые буквы слов названия, точки отбрасываются
 * («Иванов И.И.» → «ИИ»). Презентационная логика, без доменных правил.
 */
function resourceInitials(title: string): string {
  return title
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word[0])
    .join('')
    .replace(/\./g, '');
}

/** Строка дорожки сайдбара: аватар-инициалы + имя ресурса (PBT-074). */
function renderGroup({ group }: { group: TimelineGroup }) {
  return (
    <div className="resource-timeline__group" data-rt-group={group.id}>
      <span className="resource-timeline__avatar" aria-hidden="true">
        {resourceInitials(group.title)}
      </span>
      <span className="resource-timeline__group-name">{group.title}</span>
    </div>
  );
}

/**
 * Подписи шапки шкалы (PBT-074): дефолтные форматы беты латинские
 * («Mo 5», «August 2026») — задаю ru-RU явно. Primary-строка — «октябрь
 * 2026 г.» (годовая колонка в узких окнах — только год); вторичная —
 * число дня, неделя — дд.мм (бета укрупняет единицу при узкой ширине,
 * наблюдение PBT-047).
 */
type HeaderLabelFormat = NonNullable<DateHeaderProps<unknown>['labelFormat']>;

const primaryHeaderLabelFormat: HeaderLabelFormat = ([date], unit) =>
  date.toDate().toLocaleDateString(
    'ru-RU',
    unit === 'year'
      ? { year: 'numeric' }
      : { month: 'long', year: 'numeric' },
  );

const dayHeaderLabelFormat: HeaderLabelFormat = ([date], unit) => {
  const value = date.toDate();
  if (unit === 'day') {
    return String(value.getDate());
  }
  if (unit === 'week') {
    return value.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
    });
  }
  if (unit === 'month') {
    return value.toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });
  }
  return value.toLocaleDateString('ru-RU', { year: 'numeric' });
};

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
  settings,
  updateSettings,
}: WidgetProps) {
  const [document, setDocument] = useState<ManagedDocument | undefined>(
    undefined,
  );
  // Форма задачи (PBT-048): общий диалог с проектным видом.
  const [editor, setEditor] = useState<TaskEditorState | undefined>(undefined);
  const focusAnchorRef = useRef<HTMLElement | null>(null);

  // Фильтры представления (PBT-049): тулбар-контролы; изменение —
  // React-state + updateSettings (производное, документ не меняется).
  const [filterQuery, setFilterQuery] = useState<string>(
    typeof settings.filterQuery === 'string' ? settings.filterQuery : '',
  );
  const [filterResourceId, setFilterResourceId] = useState<string>(
    typeof settings.filterResourceId === 'string'
      ? settings.filterResourceId
      : '',
  );
  const applyFilters = useCallback(
    (query: string, resourceId: string) => {
      setFilterQuery(query);
      setFilterResourceId(resourceId);
      updateSettings?.({ filterQuery: query, filterResourceId: resourceId });
    },
    [updateSettings],
  );

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
    commitPlan,
    submitTaskForm,
    deleteCurrentTask,
  } = useTaskForm({
    documentId,
    documentService,
    document,
    onClose: closeEditor,
  });

  // ─── Быстрая смена цвета (PBT-084): правый клик на элементе дорожки ───
  const [colorMenu, setColorMenu] = useState<TaskColorMenuState | null>(null);
  const colorMenuTask = colorMenu === null
    ? undefined
    : plan?.tasks.find((task) => task.id === colorMenu.taskId);
  const applyQuickColor = useCallback(
    (color: string | undefined) => {
      const target = colorMenu?.taskId;
      setColorMenu(null);
      if (target === undefined) return;
      commitPlan((latest) => {
        const parsed = parsePlanContent(latest.content);
        if (!parsed.ok) return undefined;
        const result = updateTask(parsed.plan, target, { color });
        return result.ok ? result.plan : undefined;
      });
    },
    [colorMenu, commitPlan],
  );
  const onChartContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const node = event.target instanceof Element
        ? event.target.closest('[data-rt-task]')
        : null;
      const id = node?.getAttribute('data-rt-task') ?? '';
      if (!id || !plan?.tasks.some((task) => task.id === id)) return;
      event.preventDefault();
      setColorMenu({ x: event.clientX, y: event.clientY, taskId: id });
    },
    [plan],
  );

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
          documentService.update(
            documentId,
            latest.revision,
            result.plan,
          );
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
  // записей не создаёт. Все ревизии обновляют items/groups через props
  // существующего Timeline, сохраняя его канву и прокрутку.
  // Фильтры (PBT-049): производные от полного плана — конфликты/метки
  // считаются по нему же, фильтр только скрывает. Фильтр ресурса —
  // одна дорожка; текст — скрывает элементы и опустевшие дорожки.
  const query = filterQuery.trim().toLowerCase();
  const filterActive = filterQuery.trim() !== '' || filterResourceId !== '';
  const items = useMemo<TimelineItem[]>(() => {
    if (!plan) {
      return [];
    }
    const all = planToTimelineItems(
      plan,
      timelineConflictMarks(resourceConflicts(plan)),
    );
    return all.filter((item) => {
      if (filterResourceId !== '' && item.group !== filterResourceId) {
        return false;
      }
      if (query !== '' && !item.title.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [plan, filterQuery, filterResourceId]);
  const groups = useMemo<TimelineGroup[]>(() => {
    const all = plan ? planToTimelineGroups(plan) : [];
    if (filterResourceId !== '') {
      return all.filter((group) => group.id === filterResourceId);
    }
    if (query !== '') {
      // Текстовый фильтр: дорожки без видимых элементов задач скрыты.
      const withVisible = new Set(
        items
          .filter((item) => !item.id.startsWith('u-'))
          .map((item) => item.group),
      );
      return all.filter((group) => withVisible.has(group.id));
    }
    return all;
  }, [plan, filterResourceId, query, items]);
  const range = useMemo(
    () => timelineRange(plan ?? createPlanContent()),
    [plan],
  );

  // ─── Слой нерабочих дней (уточнение владельца 2026-10-15) ───────────────  // verticalLineClassNamesForTime зависит от единицы шкалы беты: в узких
  // окнах RCT укрупняет колонки до недели/месяца, и подсветка отдельных
  // дней пропадает. Собственный слой рисует колонки дней в canvas-
  // координатах (те же, что у элементов) независимо от единицы.
  //
  // Ревью PR#52 (замечание «окраска при зуме»): onBoundsChange беты врёт
  // по end (canvasStart + 3×visibleSpan — а фактическая ширина канвы
  // зависит от clientWidth), и слой растягивался при зуме. Масштаб теперь
  // берём фактический: видимая ширина ↔ видимый диапазон; начало канвы —
  // canvasTimeStart из onBoundsChange (гистерезис беты меняет только
  // видимую область, канва стабильна), до первого события — формула беты
  // (canvasStart = visibleStart − span, buffer 3).
  const [scrollHost, setScrollHost] = useState<HTMLDivElement | null>(null);
  const [canvasTimeStart, setCanvasTimeStart] = useState<number | undefined>(
    undefined,
  );
  // Замороженное начало канвы до первого onBoundsChange: коллбэк беты
  // приходит только при ИЗМЕНЕНИИ canvasTimeStart (скролл внутри буфера
  // канву не трогает), а пересчёт fallback от текущей видимой области
  // «плавал» колонками при скролле до первого зума (баг ревью PR#52).
  const canvasStartRef = useRef<number | null>(null);
  // Ширина хоста — через ResizeObserver: clientWidth меняется при
  // развороте/ресайзе окна, а useMemo слоя не зависит от DOM-узла сам
  // (замороженный clientWidth давал растянутые колонки — ревью PR#52).
  const [hostWidth, setHostWidth] = useState(0);
  useEffect(() => {
    if (!scrollHost) {
      return;
    }
    const update = () => setHostWidth(scrollHost.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scrollHost);
    return () => observer.disconnect();
  }, [scrollHost]);

  // ─── Масштаб: контролируемая видимая область (PBT-049) ──────────────────
  // Восстановление — из настроек экземпляра; изменение (кнопки, колесо,
  // перетаскивание через onTimeChange) сохраняется с дебаунсом 500 мс.
  const [visibleRange, setVisibleRange] = useState<
    { readonly start: number; readonly end: number } | undefined
  >(
    typeof settings.zoomStart === 'number' &&
      typeof settings.zoomEnd === 'number'
      ? { start: settings.zoomStart, end: settings.zoomEnd }
      : undefined,
  );
  const zoomSaveTimerRef = useRef<number | null>(null);
  const applyVisible = useCallback(
    (start: number, end: number, immediateSave: boolean) => {
      setVisibleRange({ start, end });
      if (zoomSaveTimerRef.current !== null) {
        window.clearTimeout(zoomSaveTimerRef.current);
      }
      const save = () => {
        zoomSaveTimerRef.current = null;
        updateSettings?.({ zoomStart: start, zoomEnd: end });
      };
      if (immediateSave) {
        save();
      } else {
        zoomSaveTimerRef.current = window.setTimeout(save, 500);
      }
    },
    [updateSettings],
  );
  const handleTimeChange = useCallback(
    (
      start: number,
      end: number,
      updateScrollCanvas: (start: number, end: number) => void,
    ) => {
      updateScrollCanvas(start, end);
      applyVisible(start, end, false);
    },
    [applyVisible],
  );
  const zoomBy = useCallback(
    (factor: number) => {
      setVisibleRange((previous) => {
        const current =
          previous ?? { start: range.start, end: range.end };
        const center = (current.start + current.end) / 2;
        const span = Math.min(
          Math.max((current.end - current.start) * factor, 7 * DAY_MS),
          730 * DAY_MS,
        );
        const next = {
          start: Math.round(center - span / 2),
          end: Math.round(center + span / 2),
        };
        applyVisible(next.start, next.end, true);
        return next;
      });
    },
    [range, applyVisible],
  );
  const visibleStart = visibleRange?.start ?? range.start;
  const visibleEnd = visibleRange?.end ?? range.end;
  const effectiveVisible = useMemo(
    () => ({ start: visibleStart, end: visibleEnd }),
    [visibleStart, visibleEnd],
  );
  const calendar = plan ? calendarView(plan.calendar) : undefined;

  const dayLayer = useMemo(() => {
    if (!scrollHost || hostWidth === 0 || calendar === undefined) {
      return null;
    }
    const visibleSpan = effectiveVisible.end - effectiveVisible.start;
    const pxPerMs = hostWidth / visibleSpan;
    if (!(pxPerMs > 0)) {
      return null;
    }
    // Начало канвы: фактическое из onBoundsChange (после зума/ресайза);
    // до первого события — замороженное. Вычисляется один раз: точная
    // привязка по позиции полосы (style.left беты — canvas-координата
    // известной даты задачи); без полос — оценка формулой беты
    // (canvasStart = visibleStart − span, buffer 3).
    let canvasStart = canvasTimeStart;
    if (canvasStart === undefined && canvasStartRef.current !== null) {
      canvasStart = canvasStartRef.current;
    }
    if (canvasStart === undefined) {
      const bar = scrollHost.querySelector<HTMLElement>(
        '[data-rt-task], [data-rt-unavailability]',
      );
      const taskId = bar?.getAttribute('data-rt-task') ?? null;
      const task =
        taskId !== null
          ? planRef.current?.tasks.find((entry) => entry.id === taskId)
          : undefined;
      const barLeft =
        bar !== null && task !== undefined
          ? Number.parseFloat(bar.style.left)
          : Number.NaN;
      canvasStartRef.current =
        task !== undefined && Number.isFinite(barLeft)
          ? timelineDayStartMs(task.start) - barLeft / pxPerMs
          : effectiveVisible.start - visibleSpan;
      canvasStart = canvasStartRef.current;
    }
    // Канва шире видимой области (буфер беты ~2–3 span): колонки — на
    // всю канву, чтобы подсветка не обрывалась при скролле внутри буфера.
    const canvasEnd = canvasStart + scrollHost.scrollWidth / pxPerMs + DAY_MS;
    const columns: Array<{
      readonly key: number;
      readonly iso: string;
      readonly left: number;
      readonly width: number;
      readonly kind: 'weekend' | 'holiday';
    }> = [];
    for (
      let dayMs = new Date(canvasStart).setHours(0, 0, 0, 0);
      dayMs < canvasEnd;
      dayMs += DAY_MS
    ) {
      const iso = timelineDayIso(dayMs);
      const kind = calendar.dayKind(iso);
      if (kind !== undefined) {
        columns.push({
          key: dayMs,
          iso,
          left: (dayMs - canvasStart) * pxPerMs,
          width: DAY_MS * pxPerMs + 0.5, // перекрытие стыков округления
          kind,
        });
      }
    }
    if (columns.length === 0) {
      return null;
    }
    // Канва: контейнер, в котором RCT позиционирует строки/элементы —
    // координатное пространство слоя совпадает с элементами.
    const canvas = scrollHost.querySelector('.rct-vertical-lines')?.parentElement;
    if (canvas === null || canvas === undefined) {
      return null;
    }
    return createPortal(
      <div className="rt-day-layer" aria-hidden>
        {columns.map((column) => (
          <div
            key={column.key}
            data-day={column.iso}
            className={`rt-day-col rt-day--${column.kind}`}
            style={{ left: column.left, width: column.width }}
          />
        ))}
      </div>,
      canvas,
    );
    // Задачи не меняют календарный слой. Новая канва, её геометрия или
    // новое определение календаря явно инвалидируют портал.
  }, [scrollHost, hostWidth, canvasTimeStart, effectiveVisible, calendar]);

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
      <div className="resource-timeline__toolbar">
        <div className="resource-timeline__filter-field">
          <Search aria-hidden="true" />
          <input
            type="search"
            className="resource-timeline__filter-input"
            data-rt-filter-query
            placeholder="Фильтр: задача"
            value={filterQuery}
            onChange={(event) =>
              applyFilters(event.target.value, filterResourceId)
            }
          />
        </div>
        <select
          className="resource-timeline__filter-select"
          data-rt-filter-resource
          value={filterResourceId}
          onChange={(event) =>
            applyFilters(filterQuery, event.target.value)
          }
        >
          <option value="">Все ресурсы</option>
          {(plan?.resources ?? []).map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="resource-timeline__zoom-button"
          data-rt-zoom-in
          aria-label="Крупнее"
          title="Крупнее"
          onClick={() => zoomBy(0.6)}
        >
          <ZoomIn aria-hidden="true" />
        </button>
        <button
          type="button"
          className="resource-timeline__zoom-button"
          data-rt-zoom-out
          aria-label="Мельче"
          title="Мельче"
          onClick={() => zoomBy(1.6)}
        >
          <ZoomOut aria-hidden="true" />
        </button>
      </div>
      {visible === false ? (
        <p className="resource-timeline__hint">
          Просмотр приостановлен: окно скрыто, документ обновляется в фоне.
        </p>
      ) : filterActive && items.length === 0 ? (
        // Фильтр-пусто раньше «нет ресурсов»: текстовый фильтр скрывает
        // и дорожки (DoD-4 PBT-049).
        <p className="resource-timeline__hint" data-rt-filter-empty>
          Ничего не найдено по фильтру. Задачи документа не изменены.
        </p>
      ) : groups.length === 0 ? (
        <p className="resource-timeline__hint" data-rt-empty>
          В плане нет ресурсов: добавьте их в настройках плана.
        </p>
      ) : (
        <div className="resource-timeline__chart" data-rt-chart onContextMenu={onChartContextMenu}>
          {colorMenu && colorMenuTask !== undefined && (
            <TaskColorMenu
              state={colorMenu}
              value={colorMenuTask.color}
              onPick={applyQuickColor}
              onClose={() => setColorMenu(null)}
            />
          )}
          {dayLayer}
          {/* Новый документ создаёт новую канву; обновления документа
              проходят через items/groups без ремоунта (PBT-080). */}
          <Timeline<TimelineItem, TimelineGroup>
            key={document.id}
            groups={groups}
            items={items}
            keys={TIMELINE_KEYS}
            defaultTimeStart={range.start}
            defaultTimeEnd={range.end}
            visibleTimeStart={effectiveVisible.start}
            visibleTimeEnd={effectiveVisible.end}
            onTimeChange={handleTimeChange}
            sidebarWidth={150}
            rightSidebarWidth={0}
            lineHeight={42}
            itemHeightRatio={0.7}
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
            scrollRef={setScrollHost}
            onBoundsChange={(start) => setCanvasTimeStart(start)}
            groupRenderer={renderGroup}
            dragSnap={DAY_MS}
          >
            {/* Шапки шкалы по прототипу (PBT-074): primaryHeader — месяц
                год (chrome), вторичная — дни (mono из css, D2). */}
            <TimelineHeaders>
              <SidebarHeader>
                {({ getRootProps }) => (
                  <div
                    {...getRootProps()}
                    className="resource-timeline__sidebar-header"
                  >
                    Исполнитель
                  </div>
                )}
              </SidebarHeader>
              <DateHeader
                unit="primaryHeader"
                height={28}
                labelFormat={primaryHeaderLabelFormat}
              />
              <DateHeader height={28} labelFormat={dayHeaderLabelFormat} />
            </TimelineHeaders>
          </Timeline>
        </div>
      )}
      {visible !== false &&
        !(filterActive && items.length === 0) &&
        groups.length > 0 && (
          // Легенда (PBT-074): свотчи полос + mono-диапазон видимой
          // области; производное отображения — записей не создаёт.
          <div className="resource-timeline__legend" data-rt-legend>
            <span className="resource-timeline__legend-item">
              <span
                className="resource-timeline__swatch resource-timeline__swatch--task"
                aria-hidden="true"
              />
              Задачи
            </span>
            <span className="resource-timeline__legend-item">
              <span
                className="resource-timeline__swatch resource-timeline__swatch--unavailability"
                aria-hidden="true"
              />
              Отсутствия
            </span>
            <span className="resource-timeline__legend-item">
              <span
                className="resource-timeline__swatch resource-timeline__swatch--conflict"
                aria-hidden="true"
              />
              Конфликты
            </span>
            <span
              className="resource-timeline__legend-range"
              data-rt-visible-range
            >
              {timelineDayIso(effectiveVisible.start)} —{' '}
              {timelineDayIso(effectiveVisible.end)}
            </span>
          </div>
        )}
      {/* Строка состояния виджета (PBT-074, паттерн PBT-073): название
          документа; без role=status — в ресурсном виде нет действий,
          порождающих статусы. */}
      <footer className="resource-timeline__footer">
        <span className="resource-timeline__footer-title">
          {document.title}
        </span>
      </footer>
      {editor !== undefined && editor.mode === 'edit' && plan !== undefined && (
        <TaskEditorDialog
          owner={{ id: `${widgetInstanceId}:${documentId}`, title: document.title, visible }}
          plan={plan}
          revision={document.revision}
          mode="edit"
          task={plan.tasks.find((task) => task.id === editor.taskId)}
          onSubmit={submitTaskForm}
          onDelete={deleteCurrentTask}
          onClose={closeEditor}
        />
      )}
    </section>
  );
}
