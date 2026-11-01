import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ManagedDocument } from '@project-board/widget-sdk';
import {
  CALENDAR_COLORS,
  addCalendarEvent,
  createCalendarId,
  removeCalendarEvent,
  updateCalendarEvent,
  type CalendarColor,
  type CalendarContent,
  type CalendarEvent,
} from './model';
import { dateLabel } from './view';

export interface CalendarDocumentSnapshot {
  readonly document: ManagedDocument;
  readonly content: CalendarContent;
}

export type CalendarSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

interface DialogShellProps {
  readonly title: string;
  readonly description?: string;
  readonly labelledBy: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly closeLabel?: string;
}

function DialogShell({ title, description, labelledBy, onClose, children, className = '', closeLabel = 'Закрыть' }: DialogShellProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
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
      className={`calendar-dialog calendar-editor-dialog ${className}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="calendar-dialog__header">
        <div>
          <h3 id={labelledBy}>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        <button type="button" aria-label={closeLabel} onClick={onClose}><X aria-hidden="true" /></button>
      </header>
      {children}
    </dialog>
  );
}

const colorNames: Record<CalendarColor, string> = {
  blue: 'Синий',
  green: 'Зелёный',
  amber: 'Янтарный',
  pink: 'Розовый',
  orange: 'Оранжевый',
  teal: 'Бирюзовый',
};

const inputClass = 'calendar-editor__input';

export interface CalendarTypeDialogProps {
  readonly snapshot: CalendarDocumentSnapshot;
  readonly save: (nextContent: CalendarContent, snapshot: CalendarDocumentSnapshot) => CalendarSaveResult;
  readonly onClose: () => void;
}

export function CalendarTypeDialog({ snapshot, save, onClose }: CalendarTypeDialogProps) {
  const [types, setTypes] = useState(() => snapshot.content.types.map((type) => ({ ...type })));
  const [error, setError] = useState('');

  const submit = () => {
    const names = types.map((type) => type.name.trim().toLocaleLowerCase('ru-RU'));
    if (types.some((type) => type.name.trim() === '')) {
      setError('Введите названия всех типов.');
      return;
    }
    if (new Set(names).size !== names.length) {
      setError('Названия типов должны различаться.');
      return;
    }
    const nextTypes = types.map((type) => ({ ...type, name: type.name.trim() }));
    const nextTypeIds = new Set(nextTypes.map((type) => type.id));
    const nextContent: CalendarContent = {
      ...snapshot.content,
      types: nextTypes,
      events: snapshot.content.events.map((event) => nextTypeIds.has(event.typeId) ? { ...event } : { ...event, typeId: '' }),
    };
    const result = save(nextContent, snapshot);
    if (result.ok) onClose();
    else setError(result.message);
  };

  return (
    <DialogShell title="Типы событий" description="Названия и цвета в этом календаре" labelledBy="calendar-types-title" onClose={onClose}>
      <div className="calendar-editor__body">
        {types.length === 0 && <p className="calendar-widget__empty">Типов пока нет</p>}
        {types.map((type) => {
          const used = snapshot.content.events.some((event) => event.typeId === type.id);
          return (
            <div className="calendar-type-editor" key={type.id}>
              <div className="calendar-type-editor__row">
                <label className="calendar-editor__field calendar-editor__field--grow">
                  <span>Название типа</span>
                  <input aria-label="Название типа" className={inputClass} value={type.name} onChange={(event) => setTypes((current) => current.map((item) => item.id === type.id ? { ...item, name: event.target.value } : item))} />
                </label>
                <button type="button" className="calendar-editor__icon-button calendar-editor__danger" aria-label={`Удалить тип ${type.name || 'без названия'}`} title="Удалить тип" onClick={() => {
                  if (used && !window.confirm('События сохранятся без типа. Удалить тип?')) return;
                  setTypes((current) => current.filter((item) => item.id !== type.id));
                }}><Trash2 aria-hidden="true" /></button>
              </div>
              <div className="calendar-type-editor__colors" role="group" aria-label={`Цвет типа ${type.name || 'без названия'}`}>
                {CALENDAR_COLORS.map((color) => <button type="button" key={color} className={`calendar-editor__swatch calendar-color-${color}${type.color === color ? ' is-selected' : ''}`} aria-label={colorNames[color]} aria-pressed={type.color === color} title={colorNames[color]} onClick={() => setTypes((current) => current.map((item) => item.id === type.id ? { ...item, color } : item))}>{type.color === color && <Check aria-hidden="true" />}</button>)}
              </div>
            </div>
          );
        })}
        <button type="button" className="calendar-editor__secondary-button" onClick={() => setTypes((current) => [...current, { id: createCalendarId('type'), name: '', color: CALENDAR_COLORS[current.length % CALENDAR_COLORS.length] ?? 'blue' }])}><Plus aria-hidden="true" />Добавить тип</button>
        {error && <p className="calendar-editor__error" role="alert">{error}</p>}
      </div>
      <footer className="calendar-editor__footer"><button type="button" className="calendar-editor__secondary-button" onClick={onClose}>Отмена</button><button type="button" className="calendar-editor__primary-button" onClick={submit}>Сохранить</button></footer>
    </DialogShell>
  );
}

function emptyEvent(date: string): CalendarEvent {
  return { id: createCalendarId('event'), title: '', date, time: '', typeId: '', description: '', repeat: 'none', until: '' };
}

export interface CalendarEventDialogProps {
  readonly snapshot: CalendarDocumentSnapshot;
  readonly event: CalendarEvent | null;
  readonly date: string;
  readonly save: (nextContent: CalendarContent, snapshot: CalendarDocumentSnapshot) => CalendarSaveResult;
  readonly onClose: () => void;
}

export function CalendarEventDialog({ snapshot, event, date, save, onClose }: CalendarEventDialogProps) {
  const [draft, setDraft] = useState<CalendarEvent>(() => event ? { ...event } : emptyEvent(date));
  const [error, setError] = useState('');
  const exists = Boolean(event && snapshot.content.events.some((item) => item.id === event.id));
  const patch = (next: Partial<CalendarEvent>) => setDraft((current) => ({ ...current, ...next }));

  const submit = () => {
    if (draft.title.trim() === '') {
      setError('Введите название события.');
      return;
    }
    if (draft.date === '') {
      setError('Выберите дату события.');
      return;
    }
    try {
      const next = exists ? updateCalendarEvent(snapshot.content, { ...draft, title: draft.title.trim(), repeat: 'none', until: '' }) : addCalendarEvent(snapshot.content, { ...draft, title: draft.title.trim(), repeat: 'none', until: '' });
      const result = save(next, snapshot);
      if (result.ok) onClose();
      else setError(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Проверьте поля события.');
    }
  };

  const remove = () => {
    if (!exists || !window.confirm('Удалить событие?')) return;
    const result = save(removeCalendarEvent(snapshot.content, draft.id), snapshot);
    if (result.ok) onClose();
    else setError(result.message);
  };

  return (
    <DialogShell title={exists ? 'Изменить событие' : 'Новое событие'} description="Событие календаря" labelledBy="calendar-event-title" onClose={onClose}>
      <form className="calendar-editor__form" onSubmit={(eventSubmit) => { eventSubmit.preventDefault(); submit(); }}>
        <div className="calendar-editor__body">
          <label className="calendar-editor__field"><span>Название</span><input autoFocus required aria-label="Название события" className={inputClass} value={draft.title} onChange={(eventInput) => patch({ title: eventInput.target.value })} /></label>
          <div className="calendar-editor__columns">
            <label className="calendar-editor__field"><span>Дата</span><input required type="date" aria-label="Дата события" className={inputClass} value={draft.date} onChange={(eventInput) => patch({ date: eventInput.target.value })} /></label>
            <label className="calendar-editor__field"><span>Время</span><input type="time" aria-label="Время события" disabled={!draft.time} className={inputClass} value={draft.time} onChange={(eventInput) => patch({ time: eventInput.target.value })} /></label>
          </div>
          <label className="calendar-editor__checkbox"><input type="checkbox" checked={!draft.time} onChange={(eventInput) => patch({ time: eventInput.target.checked ? '' : '09:00' })} />Весь день</label>
          <label className="calendar-editor__field"><span>Тип события</span><select aria-label="Тип события" className={inputClass} value={draft.typeId || 'none'} onChange={(eventInput) => patch({ typeId: eventInput.target.value === 'none' ? '' : eventInput.target.value })}><option value="none">Без типа</option>{snapshot.content.types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
          <label className="calendar-editor__field"><span>Описание</span><textarea aria-label="Описание события" className={inputClass} rows={4} value={draft.description} onChange={(eventInput) => patch({ description: eventInput.target.value })} /></label>
          {error && <p className="calendar-editor__error" role="alert">{error}</p>}
        </div>
        <footer className="calendar-editor__footer">
          {exists && <button type="button" className="calendar-editor__secondary-button calendar-editor__danger" onClick={remove}><Trash2 aria-hidden="true" />Удалить</button>}
          <span className="calendar-editor__footer-spacer" />
          <button type="button" className="calendar-editor__secondary-button" onClick={onClose}>Отмена</button>
          <button type="submit" className="calendar-editor__primary-button">Сохранить</button>
        </footer>
      </form>
    </DialogShell>
  );
}

export interface CalendarEventRowProps {
  readonly event: CalendarEvent;
  readonly content: CalendarContent;
  readonly onEdit?: (event: CalendarEvent) => void;
}

export function CalendarEventRow({ event, content, onEdit }: CalendarEventRowProps) {
  const type = content.types.find((item) => item.id === event.typeId);
  return <div className="calendar-event-row"><span className={`calendar-widget__dot calendar-color-${type?.color ?? 'blue'}`} aria-hidden="true" /><div className="calendar-event-row__content"><strong>{event.title}</strong><span>{event.time || 'Весь день'} · {type?.name ?? 'Без типа'}</span>{event.description && <small>{event.description}</small>}</div>{onEdit && <button type="button" className="calendar-event-row__edit" aria-label={`Изменить событие ${event.title}`} onClick={() => onEdit(event)}><Pencil aria-hidden="true" /></button>}</div>;
}

export interface CalendarDayDialogProps {
  readonly snapshot: CalendarDocumentSnapshot;
  readonly date: string;
  readonly onAdd: () => void;
  readonly onEdit: (event: CalendarEvent) => void;
  readonly onManageTypes: () => void;
  readonly onClose: () => void;
}

export function CalendarDayDialog({ snapshot, date, onAdd, onEdit, onManageTypes, onClose }: CalendarDayDialogProps) {
  const events = snapshot.content.events.filter((event) => event.repeat === 'none' && event.date === date).sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  return <DialogShell title="События дня" description={dateLabel(date)} labelledBy="calendar-day-title" closeLabel="Закрыть день" onClose={onClose}>
    <div className="calendar-dialog__body calendar-day-dialog__body">
      {events.length === 0 ? <p className="calendar-widget__empty">Событий нет</p> : events.map((event) => <CalendarEventRow key={event.id} event={event} content={snapshot.content} onEdit={onEdit} />)}
    </div>
    <footer className="calendar-editor__footer"><button type="button" className="calendar-editor__secondary-button" onClick={onManageTypes}>Типы событий</button><span className="calendar-editor__footer-spacer" /><button type="button" className="calendar-editor__secondary-button" onClick={onClose}>Закрыть</button><button type="button" className="calendar-editor__primary-button" onClick={onAdd}><Plus aria-hidden="true" />Добавить событие</button></footer>
  </DialogShell>;
}

export interface CalendarDayPanelProps {
  readonly snapshot: CalendarDocumentSnapshot;
  readonly date: string;
  readonly onAdd: () => void;
  readonly onEdit: (event: CalendarEvent) => void;
  readonly onManageTypes: () => void;
  readonly onClose: () => void;
}

export function CalendarDayPanel({ snapshot, date, onAdd, onEdit, onManageTypes, onClose }: CalendarDayPanelProps) {
  const events = snapshot.content.events.filter((event) => event.repeat === 'none' && event.date === date).sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  return <aside className="calendar-widget__day-panel"><header className="calendar-widget__day-panel-header"><div><strong>{dateLabel(date)}</strong><span>{events.length ? `${events.length} событий` : 'Событий нет'}</span></div><button type="button" aria-label="Закрыть день" onClick={onClose}><X aria-hidden="true" /></button></header><div className="calendar-day-panel__actions"><button type="button" className="calendar-editor__secondary-button" onClick={onManageTypes}>Типы событий</button><button type="button" className="calendar-editor__primary-button" onClick={onAdd}><Plus aria-hidden="true" />Добавить</button></div>{events.map((event) => <CalendarEventRow key={event.id} event={event} content={snapshot.content} onEdit={onEdit} />)}</aside>;
}
