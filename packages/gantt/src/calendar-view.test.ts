import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from './working-calendar';
import { calendarView, CALENDAR_DAY_CACHE_LIMIT } from './calendar-view';

afterEach(() => vi.restoreAllMocks());
const definition = (): core.WorkingCalendarDefinition => ({
  workingDays: [1, 2, 3, 4, 5], holidays: ['2026-10-14'], workingExceptions: ['2026-10-17'],
});

describe('календарь представления', () => {
  it('сохраняет семантику ядра, включая праздник поверх выходного и рабочее исключение', () => {
    const def = { ...definition(), holidays: ['2026-10-14', '2026-10-17', '2026-10-18'] };
    const view = calendarView(def);
    expect(view.dayKind('2026-10-12')).toBeUndefined();
    expect(view.dayKind('2026-10-14')).toBe('holiday');
    expect(view.dayKind('2026-10-17')).toBeUndefined();
    expect(view.dayKind('2026-10-18')).toBe('holiday');
    expect(view.dayKind('2026-10-25')).toBe('weekend');
  });

  it('один неизменяемый календарь переиспользуется разными видами и ревизиями', () => {
    const def = definition();
    const factory = vi.spyOn(core, 'createWorkingCalendar');
    expect(calendarView(def)).toBe(calendarView(def));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it.each(['workingDays', 'holidays', 'workingExceptions'] as const)('новое поле %s не использует прежние результаты', field => {
    const def = definition();
    const before = calendarView(def);
    const edited: core.WorkingCalendarDefinition = field === 'workingDays'
      ? { ...def, workingDays: [7] }
      : field === 'holidays' ? { ...def, holidays: [] } : { ...def, workingExceptions: [] };
    const after = calendarView(edited);
    expect(after).not.toBe(before);
    if (field === 'workingDays') expect(after.dayKind('2026-10-12')).toBe('weekend');
    if (field === 'holidays') expect(after.dayKind('2026-10-14')).toBeUndefined();
    if (field === 'workingExceptions') expect(after.dayKind('2026-10-17')).toBe('weekend');
    expect(before.dayKind('2026-10-14')).toBe('holiday');
  });

  it('рабочие дни тоже кэшируются, а старые даты вытесняются при достижении предела', () => {
    const create = core.createWorkingCalendar;
    const isWorkingDay = vi.fn(create(definition()).isWorkingDay);
    vi.spyOn(core, 'createWorkingCalendar').mockImplementation(def => ({ ...create(def), isWorkingDay }));
    const view = calendarView(definition());
    expect(view.dayKind('2026-10-12')).toBeUndefined();
    expect(view.dayKind('2026-10-12')).toBeUndefined();
    expect(isWorkingDay).toHaveBeenCalledTimes(1);
    const start = Date.parse('2026-10-12T00:00:00Z');
    for (let day = 1; day <= CALENDAR_DAY_CACHE_LIMIT; day++) {
      view.dayKind(new Date(start + day * 86_400_000).toISOString().slice(0, 10));
    }
    const calls = isWorkingDay.mock.calls.length;
    view.dayKind('2026-10-12');
    expect(isWorkingDay).toHaveBeenCalledTimes(calls + 1);
    view.dayKind('2026-10-12');
    expect(isWorkingDay).toHaveBeenCalledTimes(calls + 1);
  });

  it('не скрывает ошибку некорректной даты', () => {
    const view = calendarView(definition());
    expect(() => view.dayKind('2026-02-30')).toThrow(core.WorkingCalendarError);
    expect(() => view.dayKind('не дата')).toThrow(core.WorkingCalendarError);
  });
});
