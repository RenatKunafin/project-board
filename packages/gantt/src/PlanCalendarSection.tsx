import { useState } from 'react';
import type { PlanCommandError } from './plan-commands';
import type { PlanContent, Weekday } from './plan-document';
import { addCalendarDays } from './working-calendar';

const WEEKDAYS: readonly { value: Weekday; label: string }[] = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 7, label: 'Вс' },
];

interface PlanCalendarSectionProps {
  readonly calendar: PlanContent['calendar'];
  /** Применяет полную замену календаря; возвращает ошибку ядра по месту. */
  readonly onApply: (
    workingDays: readonly number[],
    holidays: readonly string[],
    workingExceptions: readonly string[],
  ) => PlanCommandError | undefined;
}

/**
 * Секция «Календарь» (PBT-044): рабочие дни недели, праздники (день или
 * диапазон), рабочие исключения. Добавление праздника убирает дату из
 * исключений и наоборот — дата не может быть в обоих списках.
 */
export default function PlanCalendarSection({
  calendar,
  onApply,
}: PlanCalendarSectionProps) {
  const [holidayFrom, setHolidayFrom] = useState('');
  const [holidayTo, setHolidayTo] = useState('');
  const [exceptionFrom, setExceptionFrom] = useState('');
  const [exceptionTo, setExceptionTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = (
    workingDays: readonly number[],
    holidays: readonly string[],
    workingExceptions: readonly string[],
  ): boolean => {
    const error = onApply(workingDays, holidays, workingExceptions);
    if (error !== undefined) {
      setError(error.message);
      return false;
    }
    setError(null);
    return true;
  };

  const toggleWeekday = (day: Weekday, checked: boolean) => {
    const workingDays = checked
      ? [...calendar.workingDays, day].sort((a, b) => a - b)
      : calendar.workingDays.filter((entry) => entry !== day);
    apply(workingDays, calendar.holidays, calendar.workingExceptions);
  };

  /** Раскладывает диапазон (или одну дату) на отсортированный список дат. */
  const expandRange = (from: string, to: string): string[] | null => {
    if (to !== '' && to < from) {
      setError('Дата окончания диапазона раньше начала.');
      return null;
    }
    const last = to === '' ? from : to;
    const dates: string[] = [];
    let cursor = from;
    while (cursor <= last) {
      dates.push(cursor);
      cursor = addCalendarDays(cursor, 1);
    }
    return dates;
  };

  const addHolidays = () => {
    if (holidayFrom === '') {
      setError('Укажите дату праздника.');
      return;
    }
    const dates = expandRange(holidayFrom, holidayTo);
    if (dates === null) {
      return;
    }
    const holidays = [
      ...calendar.holidays.filter((date) => !dates.includes(date)),
      ...dates.filter((date) => !calendar.holidays.includes(date)),
    ].sort();
    // Дата не может быть праздником и исключением одновременно.
    const exceptions = calendar.workingExceptions.filter(
      (date) => !dates.includes(date),
    );
    if (apply(calendar.workingDays, holidays, exceptions)) {
      setHolidayFrom('');
      setHolidayTo('');
    }
  };

  const addExceptions = () => {
    if (exceptionFrom === '') {
      setError('Укажите дату рабочего исключения.');
      return;
    }
    const dates = expandRange(exceptionFrom, exceptionTo);
    if (dates === null) {
      return;
    }
    const exceptions = [
      ...calendar.workingExceptions.filter((date) => !dates.includes(date)),
      ...dates.filter((date) => !calendar.workingExceptions.includes(date)),
    ].sort();
    const holidays = calendar.holidays.filter((date) => !dates.includes(date));
    if (apply(calendar.workingDays, holidays, exceptions)) {
      setExceptionFrom('');
      setExceptionTo('');
    }
  };

  return (
    <section aria-label="Календарь">
      <h4 className="catalog__section-title">Календарь</h4>
      <div className="catalog__week" data-calendar-week>
        {WEEKDAYS.map((weekday) => (
          <label key={weekday.value} className="catalog__week-day">
            <input
              type="checkbox"
              checked={calendar.workingDays.includes(weekday.value)}
              data-calendar-day={weekday.label}
              onChange={(event) =>
                toggleWeekday(weekday.value, event.target.checked)
              }
            />
            {weekday.label}
          </label>
        ))}
      </div>
      <div className="catalog__sub">
        <span className="task-editor__label">Праздники</span>
        <ul className="catalog__list">
          {calendar.holidays.map((date) => (
            <li key={date} className="catalog__row">
              <span className="catalog__title">{date}</span>
              <button
                type="button"
                className="task-editor__button"
                aria-label={`Удалить праздник ${date}`}
                data-calendar-remove-holiday={date}
                onClick={() =>
                  apply(
                    calendar.workingDays,
                    calendar.holidays.filter((entry) => entry !== date),
                    calendar.workingExceptions,
                  )
                }
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
        <div className="catalog__add">
          <input
            type="date"
            value={holidayFrom}
            data-calendar-holiday-from
            onChange={(event) => setHolidayFrom(event.target.value)}
          />
          <input
            type="date"
            value={holidayTo}
            data-calendar-holiday-to
            title="По (необязательно — диапазон)"
            onChange={(event) => setHolidayTo(event.target.value)}
          />
          <button
            type="button"
            className="task-editor__button"
            data-calendar-add-holiday
            onClick={addHolidays}
          >
            Добавить праздник
          </button>
        </div>
      </div>
      <div className="catalog__sub">
        <span className="task-editor__label">Рабочие исключения</span>
        {calendar.workingExceptions.length === 0 && (
          <p className="task-editor__preview">Исключений нет.</p>
        )}
        <ul className="catalog__list">
          {calendar.workingExceptions.map((date) => (
            <li key={date} className="catalog__row">
              <span className="catalog__title">{date}</span>
              <button
                type="button"
                className="task-editor__button"
                aria-label={`Удалить исключение ${date}`}
                data-calendar-remove-exception={date}
                onClick={() =>
                  apply(
                    calendar.workingDays,
                    calendar.holidays,
                    calendar.workingExceptions.filter(
                      (entry) => entry !== date,
                    ),
                  )
                }
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
        <div className="catalog__add">
          <input
            type="date"
            value={exceptionFrom}
            data-calendar-exception-from
            onChange={(event) => setExceptionFrom(event.target.value)}
          />
          <input
            type="date"
            value={exceptionTo}
            data-calendar-exception-to
            title="По (необязательно — диапазон)"
            onChange={(event) => setExceptionTo(event.target.value)}
          />
          <button
            type="button"
            className="task-editor__button"
            data-calendar-add-exception
            onClick={addExceptions}
          >
            Сделать рабочим
          </button>
        </div>
      </div>
      {error !== null && (
        <p className="task-editor__error" role="alert" data-calendar-error>
          {error}
        </p>
      )}
    </section>
  );
}
