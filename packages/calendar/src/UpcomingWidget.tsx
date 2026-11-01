import { useEffect, useMemo, useState } from 'react';
import type { DocumentService, WidgetProps } from '@project-board/widget-sdk';
import { Repeat2 } from 'lucide-react';
import {
  CalendarEventDialog,
  type CalendarDocumentSnapshot,
  type CalendarSaveResult,
} from './CalendarEditors';
import { CalendarValidationError, type CalendarContent, type CalendarEvent } from './model';
import { dateLabel, todayDateKey } from './view';
import { CALENDAR_REPEAT_LABELS } from './recurrence';
import { groupUpcomingOccurrences, normalizeUpcomingTypeFilter, upcomingOccurrences } from './upcoming';
import { useCalendarDocument, useCalendarNow } from './CalendarWidget';
import './calendar.css';

interface UpcomingWidgetProps extends WidgetProps {
  readonly documentId: string;
  readonly documentService: DocumentService;
}

function UpcomingEventRow({ occurrence, content, onOpen }: { readonly occurrence: ReturnType<typeof upcomingOccurrences>[number]; readonly content: CalendarContent; readonly onOpen: (event: CalendarEvent) => void }) {
  const { event } = occurrence;
  const type = content.types.find((item) => item.id === event.typeId);
  const repeatLabel = event.repeat === 'none' ? '' : `, Повторяется: ${CALENDAR_REPEAT_LABELS[event.repeat]}`;
  return <button type="button" className="calendar-upcoming__event" aria-label={`${event.title}, ${event.time || 'Весь день'}, ${type?.name ?? 'Без типа'}${repeatLabel}`} onClick={() => onOpen(event)}>
    <span className={`calendar-widget__dot calendar-color-${type?.color ?? 'blue'}`} aria-hidden="true" />
    <span className="calendar-upcoming__event-content"><strong>{event.title}</strong><span>{event.time || 'Весь день'} · {type?.name ?? 'Без типа'}</span>{event.repeat !== 'none' && <span className="calendar-event-row__repeat"><Repeat2 aria-hidden="true" />{CALENDAR_REPEAT_LABELS[event.repeat]}</span>}</span>
  </button>;
}

function saveDocument(documentService: DocumentService, documentId: string, nextContent: CalendarContent, snapshot: CalendarDocumentSnapshot): CalendarSaveResult {
  try {
    documentService.update(documentId, snapshot.document.revision, nextContent);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Не удалось сохранить изменения.' };
  }
}

function UpcomingPanel({ widgetInstanceId, documentId, documentService, settings, updateSettings, visible }: UpcomingWidgetProps) {
  const documentState = useCalendarDocument(documentId, documentService);
  const now = useCalendarNow(visible);
  const [typeFilter, setTypeFilter] = useState(() => typeof settings.typeFilter === 'string' ? settings.typeFilter : 'all');
  const [eventEditor, setEventEditor] = useState<{ event: CalendarEvent; date: string; snapshot: CalendarDocumentSnapshot } | null>(null);
  const snapshot = documentState instanceof CalendarValidationError || !documentState ? undefined : documentState;

  useEffect(() => {
    if (!snapshot) return;
    const normalized = normalizeUpcomingTypeFilter(snapshot.content, settings.typeFilter);
    setTypeFilter(normalized);
    if (settings.typeFilter !== normalized) updateSettings?.({ typeFilter: normalized });
  }, [snapshot, settings.typeFilter, updateSettings]);

  const occurrences = useMemo(() => snapshot ? upcomingOccurrences(snapshot.content, now, typeFilter) : [], [snapshot, now, typeFilter]);
  const groups = useMemo(() => groupUpcomingOccurrences(occurrences), [occurrences]);
  const today = todayDateKey(now);
  const changeFilter = (value: string) => {
    setTypeFilter(value);
    updateSettings?.({ typeFilter: value });
  };

  if (!snapshot) return <section className="calendar-widget calendar-upcoming-widget" data-instance={widgetInstanceId} aria-label="Ближайшие события"><p className="calendar-widget__error" role="alert">{documentState instanceof CalendarValidationError ? documentState.message : 'Документ календаря недоступен.'}</p></section>;

  return <section className="calendar-widget calendar-upcoming-widget" data-instance={widgetInstanceId} aria-label="Ближайшие события">
    <header className="calendar-upcoming__header"><div><strong>Ближайшие события</strong><span>{snapshot.document.title}</span></div><label><span className="sr-only">Фильтр типа события</span><select aria-label="Фильтр типа события" className="calendar-editor__input" value={normalizeUpcomingTypeFilter(snapshot.content, typeFilter)} onChange={(event) => changeFilter(event.target.value)}><option value="all">Все типы</option>{snapshot.content.types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label></header>
    <div className="calendar-upcoming__list" role="list" aria-label="Список ближайших событий">
      {groups.length === 0 ? <p className="calendar-widget__empty">Ближайших событий нет</p> : groups.map((group) => <section className="calendar-upcoming__group" key={group.date} aria-label={group.date === today ? 'Сегодня' : dateLabel(group.date)}><h3>{group.date === today ? 'Сегодня' : dateLabel(group.date)}</h3>{group.occurrences.map((occurrence) => <UpcomingEventRow key={occurrence.key} occurrence={occurrence} content={snapshot.content} onOpen={(event) => setEventEditor({ event, date: occurrence.date, snapshot })} />)}</section>)}
    </div>
    <footer className="calendar-upcoming__footer">Ближайшие 12 месяцев · {occurrences.length} {occurrences.length === 1 ? 'событие' : 'событий'}</footer>
    {eventEditor && <CalendarEventDialog snapshot={eventEditor.snapshot} event={eventEditor.event} date={eventEditor.date} save={(next, source) => saveDocument(documentService, documentId, next, source)} onClose={() => setEventEditor(null)} />}
  </section>;
}

export function UpcomingWidget(props: WidgetProps) {
  if (!props.documentId || !props.documentService) return <section className="calendar-widget calendar-upcoming-widget" data-instance={props.widgetInstanceId} aria-label="Ближайшие события"><p className="calendar-widget__error" role="alert">Документ календаря недоступен.</p></section>;
  return <UpcomingPanel {...props} documentId={props.documentId} documentService={props.documentService} />;
}
