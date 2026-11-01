import { describe, expect, it } from 'vitest';
import { addCalendarEvent, createEmptyCalendarContent } from './model';
import {
  dateKey,
  eventsForDate,
  monthGrid,
  millisecondsToNextLocalMidnight,
  readCalendarViewSettings,
  shiftMonth,
  viewMode,
  yearMonths,
} from './view';

describe('calendar view helpers', () => {
  it('uses explicit maximize before content thresholds', () => {
    expect(viewMode({ width: 120, height: 120 }, false)).toBe('small');
    expect(viewMode({ width: 400, height: 300 }, false)).toBe('month');
    expect(viewMode({ width: 120, height: 120 }, true)).toBe('year');
  });

  it('builds a Monday-first six-row month grid', () => {
    const cells = monthGrid('2026-11');
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ date: null, day: null });
    expect(cells[6]).toEqual({ date: '2026-11-01', day: 1 });
  });

  it('shifts periods and enumerates all months of a year', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(yearMonths('2027-05')).toEqual([
      '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06',
      '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12',
    ]);
  });

  it('schedules the next local midnight without a fixed hidden-window interval', () => {
    expect(millisecondsToNextLocalMidnight(new Date(2026, 10, 3, 23, 59, 30))).toBe(30_000);
  });

  it('normalizes invalid window settings without changing the document', () => {
    const settings = readCalendarViewSettings({ calendarMonth: '2026-02-31', calendarSelectedDate: '2026-02-30' }, new Date(2026, 4, 12));
    expect(settings).toEqual({ month: '2026-05', selectedDate: null });
  });

  it('shows single and recurring events and sorts markers by time and title', () => {
    let content = createEmptyCalendarContent();
    content = addCalendarEvent(content, {
      id: 'late', title: 'Б', date: '2026-11-03', time: '14:00', typeId: '', description: '', repeat: 'none', until: '',
    });
    content = addCalendarEvent(content, {
      id: 'early', title: 'А', date: '2026-11-03', time: '09:00', typeId: '', description: '', repeat: 'none', until: '',
    });
    content = addCalendarEvent(content, {
      id: 'repeat', title: 'Повтор', date: '2026-11-03', time: '', typeId: '', description: '', repeat: 'daily', until: '',
    });
    expect(eventsForDate(content, '2026-11-03').map((event) => event.id)).toEqual(['repeat', 'early', 'late']);
    expect(dateKey(new Date(2026, 10, 3))).toBe('2026-11-03');
  });
});
