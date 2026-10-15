import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  planToTimelineGroups,
  planToTimelineItems,
  timelineConflictMarks,
  timelineDayIso,
  timelineRange,
  type TimelineGroup,
  type TimelineItem,
} from './resource-timeline-adapter';
import './resource-timeline.css';

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

/**
 * Ресурсное представление документа плана (PBT-047): компактные дорожки
 * исполнителей на React Calendar Timeline, read-only v1 (жесты — PBT-048).
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

  // Производные представления данных (D2/D4): пересчёт при рендере,
  // записей не создаёт. Ремоунт по ревизии (D7) обновляет дорожки.
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
          {/* Ключ по ревизии: обновление документа (второй вид, формы)
              пересобирает дорожки с новым диапазоном; сброс прокрутки
              для v1 допустим (design D7). */}
          <Timeline<TimelineItem, TimelineGroup>
            key={document.revision}
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
            canMove={false}
            canChangeGroup={false}
            canResize={false}
            useResizeHandle={false}
            verticalLineClassNamesForTime={verticalLineClassNamesForTime}
          />
        </div>
      )}
    </section>
  );
}
