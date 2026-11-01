import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentService, WidgetProps } from '@project-board/widget-sdk';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  CalendarValidationError,
  parseCalendarContent,
  type CalendarContent,
  type CalendarEvent,
} from './model';
import {
  dateLabel,
  eventsForDate,
  monthGrid,
  monthKey,
  monthLabel,
  millisecondsToNextLocalMidnight,
  parseMonthKey,
  readCalendarViewSettings,
  shiftMonth,
  todayDateKey,
  viewMode,
  yearLabel,
  yearMonths,
  type CalendarDayCell,
  type CalendarSize,
  type CalendarViewSettings,
} from './view';
import './calendar.css';

interface CalendarWidgetProps extends WidgetProps {
  readonly documentId: string;
  readonly documentService: DocumentService;
}

function useCalendarDocument(documentId: string, documentService: DocumentService): CalendarContent | CalendarValidationError | undefined {
  const [document, setDocument] = useState(() => documentService.get(documentId));
  useEffect(() => {
    setDocument(documentService.get(documentId));
    return documentService.subscribe(documentId, setDocument);
  }, [documentId, documentService]);
  return useMemo(() => {
    if (!document) return undefined;
    try {
      return parseCalendarContent(document.content);
    } catch (error) {
      return error instanceof CalendarValidationError
        ? error
        : new CalendarValidationError([{ path: '$', message: 'не удалось прочитать содержимое' }], document.content);
    }
  }, [document]);
}

function useToday(visible: boolean): string {
  const [today, setToday] = useState(() => todayDateKey());
  useEffect(() => {
    if (!visible) return undefined;
    let timer: number | undefined;
    const refresh = () => setToday(todayDateKey());
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        refresh();
        schedule();
      }, Math.max(1000, millisecondsToNextLocalMidnight() + 50));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        schedule();
      }
    };
    refresh();
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, [visible]);
  return today;
}

function CalendarDialog({ date, content, onClose }: { readonly date: string; readonly content: CalendarContent; readonly onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const events = eventsForDate(content, date);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="calendar-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="calendar-dialog__header">
        <div>
          <h3 id="calendar-dialog-title">События дня</h3>
          <p>{dateLabel(date)}</p>
        </div>
        <button type="button" aria-label="Закрыть день" onClick={onClose}><X aria-hidden="true" /></button>
      </header>
      <div className="calendar-dialog__body">
        {events.length === 0 ? <p className="calendar-widget__empty">Событий нет</p> : events.map((event) => <CalendarEventRow key={event.id} event={event} content={content} />)}
      </div>
    </dialog>
  );
}

function CalendarEventRow({ event, content }: { readonly event: CalendarEvent; readonly content: CalendarContent }) {
  const type = content.types.find((item) => item.id === event.typeId);
  return <div className="calendar-event-row"><span className={`calendar-widget__dot calendar-color-${type?.color ?? 'blue'}`} aria-hidden="true" /><div><strong>{event.title}</strong><span>{event.time || 'Весь день'} · {type?.name ?? 'Без типа'}</span></div></div>;
}

function EventDots({ content, date, compact = false }: { readonly content: CalendarContent; readonly date: string; readonly compact?: boolean }) {
  const events = eventsForDate(content, date);
  const limit = compact ? 6 : 3;
  return <span className="calendar-widget__dots" aria-hidden="true">{events.slice(0, limit).map((event) => { const type = content.types.find((item) => item.id === event.typeId); return <span key={event.id} className={`calendar-widget__dot calendar-color-${type?.color ?? 'blue'}`} />; })}{events.length > limit && <span className="calendar-widget__overflow">+{events.length - limit}</span>}</span>;
}

function WeekdayHeader() {
  return <div className="calendar-widget__weekdays" aria-hidden="true">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, index) => <span key={day} className={index > 4 ? 'is-weekend' : undefined}>{day}</span>)}</div>;
}

function MonthGrid({ month, content, today, selectedDate, compact, onSelect }: { readonly month: string; readonly content: CalendarContent; readonly today: string; readonly selectedDate: string | null; readonly compact?: boolean; readonly onSelect: (date: string) => void }) {
  return <section className={`calendar-month${compact ? ' calendar-month--compact' : ''}`} aria-label={monthLabel(month)}>{compact && <h3>{monthLabel(month)}</h3>}<WeekdayHeader /><div className="calendar-widget__grid">{monthGrid(month).map((cell, index) => <CalendarDay key={`${month}-${index}`} cell={cell} content={content} today={today} selectedDate={selectedDate} compact={compact} onSelect={onSelect} />)}</div></section>;
}

function CalendarDay({ cell, content, today, selectedDate, compact, onSelect }: { readonly cell: CalendarDayCell; readonly content: CalendarContent; readonly today: string; readonly selectedDate: string | null; readonly compact?: boolean; readonly onSelect: (date: string) => void }) {
  if (!cell.date) return <span className="calendar-widget__blank" aria-hidden="true" />;
  const events = eventsForDate(content, cell.date);
  const selected = selectedDate === cell.date;
  const current = today === cell.date;
  return <button type="button" className={`calendar-widget__day${compact ? ' is-compact' : ''}${selected ? ' is-selected' : ''}${current ? ' is-today' : ''}`} aria-label={`${dateLabel(cell.date)}${events.length ? `, событий: ${events.length}` : ''}`} aria-pressed={selected} title={dateLabel(cell.date)} onClick={() => onSelect(cell.date as string)}><span>{cell.day}</span><EventDots content={content} date={cell.date} compact={compact} /></button>;
}

function readSize(size: CalendarSize | null): CalendarSize | null {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
  return size;
}

function CalendarPanel({ widgetInstanceId, documentId, documentService, settings, updateSettings, visible, maximized, onResize }: CalendarWidgetProps) {
  const [size, setSize] = useState<CalendarSize | null>(null);
  const [view, setView] = useState<CalendarViewSettings>(() => readCalendarViewSettings(settings));
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const content = useCalendarDocument(documentId, documentService);
  const today = useToday(visible);
  const settingsUpdate = useRef(updateSettings);
  const pendingSettings = useRef<CalendarViewSettings | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  settingsUpdate.current = updateSettings;

  useEffect(() => onResize?.((next) => setSize(readSize(next))), [onResize]);
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      const pending = pendingSettings.current;
      pendingSettings.current = null;
      if (pending) settingsUpdate.current?.({ calendarMonth: pending.month, calendarSelectedDate: pending.selectedDate });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);

  const persistView = (next: CalendarViewSettings) => {
    pendingSettings.current = next;
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { saveTimer.current = undefined; const pending = pendingSettings.current; pendingSettings.current = null; if (pending) settingsUpdate.current?.({ calendarMonth: pending.month, calendarSelectedDate: pending.selectedDate }); }, 80);
  };
  const updateView = (patch: Partial<CalendarViewSettings>) => setView((current) => { const next = { ...current, ...patch }; persistView(next); return next; });
  const mode = viewMode(size, maximized);
  const documentContent = content instanceof CalendarValidationError ? undefined : content;
  if (!documentContent) return <section className="calendar-widget" data-instance={widgetInstanceId} data-calendar-mode={mode} aria-label="Календарь"><p className="calendar-widget__error" role="alert">{content instanceof CalendarValidationError ? content.message : 'Документ календаря недоступен.'}</p></section>;

  const selectDate = (date: string) => { updateView({ selectedDate: date, month: monthKey(parseMonthKey(date) ?? new Date()) }); if (mode !== 'year') setDialogDate(date); };
  const todayMonth = today.slice(0, 7);
  const goToday = () => updateView({ month: todayMonth, selectedDate: today });
  const movePeriod = (delta: number) => updateView({ month: shiftMonth(view.month, maximized ? delta * 12 : delta) });
  const closeDay = () => { setDialogDate(null); updateView({ selectedDate: null }); };
  return <section className="calendar-widget" data-instance={widgetInstanceId} data-calendar-mode={mode} aria-label="Календарь">
    {mode === 'small' ? <button type="button" className="calendar-widget__today-card" aria-label="Открыть сегодняшний день" onClick={() => selectDate(today)}><span className="calendar-widget__today-weekday">{dateLabel(today).split(', ')[0] ?? dateLabel(today)}</span><strong>{Number(today.slice(8, 10))}</strong><span>{monthLabel(today.slice(0, 7))}</span><EventDots content={documentContent} date={today} compact /></button> : <>
      <header className="calendar-widget__toolbar"><button type="button" aria-label="Предыдущий период" title="Предыдущий период" onClick={() => movePeriod(-1)}><ChevronLeft aria-hidden="true" /></button><h2>{maximized ? yearLabel(view.month) : monthLabel(view.month)}</h2><button type="button" aria-label="Следующий период" title="Следующий период" onClick={() => movePeriod(1)}><ChevronRight aria-hidden="true" /></button><button type="button" className="calendar-widget__today-button" onClick={goToday}>Сегодня</button></header>
      <div className="calendar-widget__body"><div className="calendar-widget__main">{maximized ? <div className="calendar-widget__year-grid">{yearMonths(view.month).map((month) => <MonthGrid key={month} month={month} content={documentContent} today={today} selectedDate={view.selectedDate} compact onSelect={selectDate} />)}</div> : <MonthGrid month={view.month} content={documentContent} today={today} selectedDate={view.selectedDate} onSelect={selectDate} />}</div>{maximized && view.selectedDate && <aside className="calendar-widget__day-panel"><DayPanel date={view.selectedDate} content={documentContent} onClose={closeDay} /></aside>}</div>
    </>}
    {dialogDate && mode !== 'year' && <CalendarDialog date={dialogDate} content={documentContent} onClose={closeDay} />}
  </section>;
}

export function CalendarWidget(props: WidgetProps) {
  if (!props.documentId || !props.documentService) {
    return <section className="calendar-widget" data-instance={props.widgetInstanceId} data-calendar-mode="month" aria-label="Календарь"><p className="calendar-widget__error" role="alert">Документ календаря недоступен.</p></section>;
  }
  return <CalendarPanel {...props} documentId={props.documentId} documentService={props.documentService} />;
}

function DayPanel({ date, content, onClose }: { readonly date: string; readonly content: CalendarContent; readonly onClose: () => void }) {
  const events = eventsForDate(content, date);
  return <><header className="calendar-widget__day-panel-header"><div><strong>{dateLabel(date)}</strong><span>{events.length ? `${events.length} событий` : 'Событий нет'}</span></div><button type="button" aria-label="Закрыть день" onClick={onClose}><X aria-hidden="true" /></button></header>{events.map((event) => <CalendarEventRow key={event.id} event={event} content={content} />)}</>;
}
