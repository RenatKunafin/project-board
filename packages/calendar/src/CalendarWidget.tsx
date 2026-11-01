import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentService, ManagedDocument, WidgetProps } from '@project-board/widget-sdk';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  CalendarValidationError,
  parseCalendarContent,
  type CalendarContent,
  type CalendarEvent,
} from './model';
import {
  dateLabel,
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
  occurrencesForRange,
  type CalendarOccurrence,
  type CalendarDayCell,
  type CalendarSize,
  type CalendarViewSettings,
} from './view';
import {
  CalendarDayDialog,
  CalendarDayPanel,
  CalendarEventDialog,
  CalendarNonWorkingDialog,
  CalendarTypeDialog,
  type CalendarDocumentSnapshot,
} from './CalendarEditors';
import './calendar.css';
import { isNonWorkingDay } from './workday';

interface CalendarWidgetProps extends WidgetProps {
  readonly documentId: string;
  readonly documentService: DocumentService;
}

interface CalendarDocumentState {
  readonly document: ManagedDocument;
  readonly content: CalendarContent;
}

export function useCalendarDocument(documentId: string, documentService: DocumentService): CalendarDocumentState | CalendarValidationError | undefined {
  const [document, setDocument] = useState(() => documentService.get(documentId));
  useEffect(() => {
    setDocument(documentService.get(documentId));
    return documentService.subscribe(documentId, setDocument);
  }, [documentId, documentService]);
  return useMemo(() => {
    if (!document) return undefined;
    try {
      return { document, content: parseCalendarContent(document.content) };
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

export function useCalendarNow(visible: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!visible) return undefined;
    let timer: number | undefined;
    const refresh = () => setNow(new Date());
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const current = new Date();
      const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timer = window.setTimeout(() => { refresh(); schedule(); }, Math.max(1000, next.getTime() - current.getTime() + 50));
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') { refresh(); schedule(); } };
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
  return now;
}

function EventDots({ content, date }: { readonly content: CalendarContent; readonly date: string }) {
  const occurrences = occurrencesForRange(content, date, date);
  const limit = 3;
  return <span className="calendar-widget__dots" aria-hidden="true">{occurrences.slice(0, limit).map(({ event, key }) => { const type = content.types.find((item) => item.id === event.typeId); return <span key={key} className={`calendar-widget__dot calendar-color-${type?.color ?? 'blue'}`} />; })}{occurrences.length > limit && <span className="calendar-widget__overflow">+{occurrences.length - limit}</span>}</span>;
}

function WeekdayHeader() {
  return <div className="calendar-widget__weekdays" aria-hidden="true">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, index) => <span key={day} className={index > 4 ? 'is-weekend' : undefined}>{day}</span>)}</div>;
}

function MonthGrid({ month, content, occurrences, today, selectedDate, compact, onSelect }: { readonly month: string; readonly content: CalendarContent; readonly occurrences: readonly CalendarOccurrence[]; readonly today: string; readonly selectedDate: string | null; readonly compact?: boolean; readonly onSelect: (date: string) => void }) {
  return <section className={`calendar-month${compact ? ' calendar-month--compact' : ''}`} aria-label={monthLabel(month)}>{compact && <h3>{monthLabel(month)}</h3>}<WeekdayHeader /><div className="calendar-widget__grid">{monthGrid(month).map((cell, index) => <CalendarDay key={`${month}-${index}`} cell={cell} content={content} occurrences={occurrences} today={today} selectedDate={selectedDate} compact={compact} onSelect={onSelect} />)}</div></section>;
}

function CalendarDay({ cell, content, occurrences, today, selectedDate, compact, onSelect }: { readonly cell: CalendarDayCell; readonly content: CalendarContent; readonly occurrences: readonly CalendarOccurrence[]; readonly today: string; readonly selectedDate: string | null; readonly compact?: boolean; readonly onSelect: (date: string) => void }) {
  if (!cell.date) return <span className="calendar-widget__blank" aria-hidden="true" />;
  const events = occurrences.filter(({ date }) => date === cell.date);
  const manual = content.days.find((day) => day.date === cell.date);
  const nonWorking = isNonWorkingDay(content, cell.date);
  const selected = selectedDate === cell.date;
  const current = today === cell.date;
  const dayLabel = `${dateLabel(cell.date)}${nonWorking ? ', Нерабочий день' : ''}${events.length ? `, событий: ${events.length}` : ''}`;
  return <button type="button" className={`calendar-widget__day${compact ? ' is-compact' : ''}${selected ? ' is-selected' : ''}${current ? ' is-today' : ''}${nonWorking ? ' is-non-working' : ''}`} aria-label={dayLabel} aria-pressed={selected} title={manual?.name || (nonWorking ? 'Нерабочий день' : dateLabel(cell.date))} onClick={() => onSelect(cell.date as string)}><span>{cell.day}</span><span className="calendar-widget__dots" aria-hidden="true">{events.slice(0, 3).map(({ event, key }) => { const type = content.types.find((item) => item.id === event.typeId); return <span key={key} className={`calendar-widget__dot calendar-color-${type?.color ?? 'blue'}`} />; })}{events.length > 3 && <span className="calendar-widget__overflow">+{events.length - 3}</span>}</span></button>;
}

function readSize(size: CalendarSize | null): CalendarSize | null {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
  return size;
}

function CalendarPanel({ widgetInstanceId, documentId, documentService, settings, updateSettings, visible, maximized, onResize }: CalendarWidgetProps) {
  const [size, setSize] = useState<CalendarSize | null>(null);
  const [view, setView] = useState<CalendarViewSettings>(() => readCalendarViewSettings(settings));
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [nonWorkingEditor, setNonWorkingEditor] = useState<{ readonly date: string; readonly snapshot: CalendarDocumentSnapshot } | null>(null);
  const [eventEditor, setEventEditor] = useState<{ readonly date: string; readonly event: CalendarEvent | null; readonly snapshot: CalendarDocumentSnapshot } | null>(null);
  const documentState = useCalendarDocument(documentId, documentService);
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
  const snapshot = documentState instanceof CalendarValidationError || !documentState ? undefined : documentState;
  if (!snapshot) return <section className="calendar-widget" data-instance={widgetInstanceId} data-calendar-mode={mode} aria-label="Календарь"><p className="calendar-widget__error" role="alert">{documentState instanceof CalendarValidationError ? documentState.message : 'Документ календаря недоступен.'}</p></section>;

  const save = (nextContent: CalendarContent, source: CalendarDocumentSnapshot) => {
    try {
      documentService.update(documentId, source.document.revision, nextContent);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : 'Не удалось сохранить изменения.' };
    }
  };

  const selectDate = (date: string) => { updateView({ selectedDate: date, month: monthKey(parseMonthKey(date) ?? new Date()) }); if (mode !== 'year') setDialogDate(date); };
  const todayMonth = today.slice(0, 7);
  const goToday = () => updateView({ month: todayMonth, selectedDate: today });
  const movePeriod = (delta: number) => updateView({ month: shiftMonth(view.month, maximized ? delta * 12 : delta) });
  const closeDay = () => { setDialogDate(null); updateView({ selectedDate: null }); };
  const openNewEvent = (date: string) => { setDialogDate(null); setEventEditor({ date, event: null, snapshot }); };
  const openEvent = (event: CalendarEvent) => { setDialogDate(null); setEventEditor({ date: event.date, event, snapshot }); };
  const openTypes = () => setTypeDialogOpen(true);
  const openNonWorking = (date: string) => { setDialogDate(null); setNonWorkingEditor({ date, snapshot }); };
  const monthStart = `${view.month}-01`;
  const parsedMonth = parseMonthKey(view.month) ?? new Date();
  const monthEnd = `${parsedMonth.getFullYear()}-${String(parsedMonth.getMonth() + 1).padStart(2, '0')}-${String(new Date(parsedMonth.getFullYear(), parsedMonth.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  const rangeOccurrences = mode === 'year'
    ? occurrencesForRange(snapshot.content, `${parsedMonth.getFullYear()}-01-01`, `${parsedMonth.getFullYear()}-12-31`)
    : occurrencesForRange(snapshot.content, monthStart, monthEnd);
  return <section className="calendar-widget" data-instance={widgetInstanceId} data-calendar-mode={mode} aria-label="Календарь">
    {mode === 'small' ? <><button type="button" className="calendar-widget__today-card" aria-label="Открыть сегодняшний день" onClick={() => selectDate(today)}><span className="calendar-widget__today-weekday">{dateLabel(today).split(', ')[0] ?? dateLabel(today)}</span><strong>{Number(today.slice(8, 10))}</strong><span>{monthLabel(today.slice(0, 7))}</span><EventDots content={snapshot.content} date={today} /></button><div className="calendar-widget__small-actions"><button type="button" className="calendar-editor__secondary-button" onClick={openTypes}>Типы событий</button></div></> : <>
      <header className="calendar-widget__toolbar"><button type="button" aria-label="Предыдущий период" title="Предыдущий период" onClick={() => movePeriod(-1)}><ChevronLeft aria-hidden="true" /></button><h2>{maximized ? yearLabel(view.month) : monthLabel(view.month)}</h2><button type="button" aria-label="Следующий период" title="Следующий период" onClick={() => movePeriod(1)}><ChevronRight aria-hidden="true" /></button><button type="button" className="calendar-widget__today-button" onClick={goToday}>Сегодня</button><button type="button" className="calendar-widget__today-button" onClick={openTypes}>Типы</button></header>
      <div className="calendar-widget__body"><div className="calendar-widget__main">{maximized ? <div className="calendar-widget__year-grid">{yearMonths(view.month).map((month) => <MonthGrid key={month} month={month} content={snapshot.content} occurrences={rangeOccurrences} today={today} selectedDate={view.selectedDate} compact onSelect={selectDate} />)}</div> : <MonthGrid month={view.month} content={snapshot.content} occurrences={rangeOccurrences} today={today} selectedDate={view.selectedDate} onSelect={selectDate} />}</div>{maximized && view.selectedDate && <CalendarDayPanel snapshot={snapshot} date={view.selectedDate} today={today} onAdd={() => openNewEvent(view.selectedDate as string)} onEdit={openEvent} onManageTypes={openTypes} onManageNonWorking={() => openNonWorking(view.selectedDate as string)} onClose={closeDay} />}</div>
    </>}
    {dialogDate && mode !== 'year' && <CalendarDayDialog snapshot={snapshot} date={dialogDate} today={today} onAdd={() => openNewEvent(dialogDate)} onEdit={openEvent} onManageTypes={openTypes} onManageNonWorking={() => openNonWorking(dialogDate)} onClose={closeDay} />}
    {typeDialogOpen && <CalendarTypeDialog snapshot={snapshot} save={save} onClose={() => setTypeDialogOpen(false)} />}
    {nonWorkingEditor && <CalendarNonWorkingDialog snapshot={nonWorkingEditor.snapshot} date={nonWorkingEditor.date} save={save} onClose={() => setNonWorkingEditor(null)} />}
    {eventEditor && <CalendarEventDialog snapshot={eventEditor.snapshot} event={eventEditor.event} date={eventEditor.date} save={save} onClose={() => setEventEditor(null)} />}
  </section>;
}
export function CalendarWidget(props: WidgetProps) {
  if (!props.documentId || !props.documentService) {
    return <section className="calendar-widget" data-instance={props.widgetInstanceId} data-calendar-mode="month" aria-label="Календарь"><p className="calendar-widget__error" role="alert">Документ календаря недоступен.</p></section>;
  }
  return <CalendarPanel {...props} documentId={props.documentId} documentService={props.documentService} />;
}
