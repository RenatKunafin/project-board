import { describe, expect, it } from 'vitest';
import { createEmptyCalendarContent, setNonWorkingDay } from './model';
import { countdown, formatCountdown, isNonWorkingDay } from './workday';

describe('calendar workday rules', () => {
  it('marks weekends and manual dates without touching events', () => {
    const content = createEmptyCalendarContent();
    expect(isNonWorkingDay(content, '2026-10-31')).toBe(true);
    expect(isNonWorkingDay(content, '2026-11-01')).toBe(true);
    expect(isNonWorkingDay(content, '2026-11-04')).toBe(false);
    const marked = setNonWorkingDay(content, { date: '2026-11-04', kind: 'holiday', name: 'Праздник' });
    expect(isNonWorkingDay(marked, '2026-11-04')).toBe(true);
    expect(content.days).toEqual([]);
    expect(marked.events).toEqual([]);
  });

  it('counts future working days after today through target inclusively', () => {
    const content = createEmptyCalendarContent();
    expect(countdown(content, '2026-10-30', '2026-11-02')).toEqual({ days: 3, working: 1, weeks: 0, rest: 3, past: false });
    expect(formatCountdown(countdown(content, '2026-10-30', '2026-11-02'))).toBe('Через 3 дня · 1 рабочий день · меньше недели');
  });

  it('counts past working days through the day before today', () => {
    const content = createEmptyCalendarContent();
    expect(countdown(content, '2026-10-30', '2026-10-27')).toEqual({ days: 3, working: 3, weeks: 0, rest: 3, past: true });
    expect(formatCountdown(countdown(content, '2026-10-30', '2026-10-27'))).toBe('Прошло 3 дня · 3 рабочих дня · меньше недели');
  });

  it('excludes manual non-working dates and handles year boundaries', () => {
    const marked = setNonWorkingDay(createEmptyCalendarContent(), { date: '2027-01-01', kind: 'off', name: 'Отдых' });
    expect(countdown(marked, '2026-12-31', '2027-01-04')).toEqual({ days: 4, working: 1, weeks: 0, rest: 4, past: false });
  });

  it('returns today instead of zero units', () => {
    const value = countdown(createEmptyCalendarContent(), '2026-11-01', '2026-11-01');
    expect(value).toEqual({ days: 0, working: 0, weeks: 0, rest: 0, past: false });
    expect(formatCountdown(value)).toBe('Сегодня');
  });

  it('formats whole weeks with a remainder', () => {
    expect(formatCountdown({ days: 14, working: 10, weeks: 2, rest: 0, past: false })).toBe('Через 14 дней · 10 рабочих дней · 2 недели');
    expect(formatCountdown({ days: 21, working: 15, weeks: 3, rest: 0, past: true })).toBe('Прошло 21 день · 15 рабочих дней · 3 недели');
  });
});
