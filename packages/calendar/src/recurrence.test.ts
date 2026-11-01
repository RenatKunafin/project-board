import { describe, expect, it } from 'vitest';
import { createEmptyCalendarContent, type CalendarEvent } from './model';
import { occurrencesForDate, occurrencesForRange } from './recurrence';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'series', title: 'Встреча', date: '2026-01-01', time: '09:30', typeId: '', description: '', repeat: 'none', until: '',
    ...overrides,
  };
}

describe('calendar recurrence adapter', () => {
  it('returns a single stored record as stable occurrences without materializing events', () => {
    const content = { ...createEmptyCalendarContent(), events: [event({ repeat: 'daily', until: '2026-01-03' })] };
    const occurrences = occurrencesForRange(content, '2026-01-01', '2026-01-05');
    expect(occurrences.map((item) => item.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(new Set(occurrences.map((item) => item.event)).size).toBe(1);
    expect(occurrences.map((item) => item.key)).toEqual(['series:2026-01-01', 'series:2026-01-02', 'series:2026-01-03']);
  });

  it('sorts by local date, time, title and id', () => {
    const content = {
      ...createEmptyCalendarContent(),
      events: [
        event({ id: 'late', title: 'Б', time: '14:00', date: '2026-01-02' }),
        event({ id: 'early', title: 'А', time: '09:00', date: '2026-01-02' }),
        event({ id: 'repeat', title: 'Повтор', time: '', date: '2026-01-01', repeat: 'daily', until: '2026-01-02' }),
      ],
    };
    expect(occurrencesForRange(content, '2026-01-01', '2026-01-02').map((item) => item.event.id)).toEqual(['repeat', 'repeat', 'early', 'late']);
  });

  it('skips invalid monthly and yearly calendar dates', () => {
    const content = {
      ...createEmptyCalendarContent(),
      events: [event({ id: 'month', date: '2026-01-31', repeat: 'monthly' }), event({ id: 'leap', date: '2028-02-29', repeat: 'yearly' })],
    };
    expect(occurrencesForRange(content, '2026-01-01', '2026-04-30').filter((item) => item.event.id === 'month').map((item) => item.date)).toEqual(['2026-01-31', '2026-03-31']);
    expect(occurrencesForRange(content, '2028-01-01', '2032-12-31').filter((item) => item.event.id === 'leap').map((item) => item.date)).toEqual(['2028-02-29', '2032-02-29']);
  });

  it('preserves local date and all-day time across DST boundaries', () => {
    const content = { ...createEmptyCalendarContent(), events: [event({ date: '2026-03-28', time: '', repeat: 'daily', until: '2026-03-30' })] };
    expect(occurrencesForRange(content, '2026-03-29', '2026-03-30').map((item) => [item.date, item.event.time])).toEqual([['2026-03-29', ''], ['2026-03-30', '']]);
  });

  it('includes range and until boundaries and returns no values for an inverted range', () => {
    const content = { ...createEmptyCalendarContent(), events: [event({ date: '2026-05-10', repeat: 'weekly', until: '2026-05-24' })] };
    expect(occurrencesForDate(content, '2026-05-10')).toHaveLength(1);
    expect(occurrencesForRange(content, '2026-05-10', '2026-05-24').map((item) => item.date)).toEqual(['2026-05-10', '2026-05-17', '2026-05-24']);
    expect(occurrencesForRange(content, '2026-05-25', '2026-05-24')).toEqual([]);
  });
});
