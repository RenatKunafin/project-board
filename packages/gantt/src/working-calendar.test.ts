import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDaySpan,
  createWorkingCalendar,
  WorkingCalendarError,
  type WorkingCalendarDefinition,
} from './working-calendar.js';

const standard = createWorkingCalendar({
  workingDays: [1, 2, 3, 4, 5],
});

describe('рабочий календарь — определение рабочего дня', () => {
  it('праздник делает среду нерабочей', () => {
    const calendar = createWorkingCalendar({
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-10-14'],
    });
    expect(calendar.isWorkingDay('2026-10-14')).toBe(false);
    expect(calendar.isWorkingDay('2026-10-13')).toBe(true);
    expect(calendar.isWorkingDay('2026-10-17')).toBe(false); // суббота
  });

  it('рабочее исключение делает субботу рабочей', () => {
    const calendar = createWorkingCalendar({
      workingDays: [1, 2, 3, 4, 5],
      workingExceptions: ['2026-10-17'],
    });
    expect(calendar.isWorkingDay('2026-10-17')).toBe(true);
    expect(calendar.isWorkingDay('2026-10-18')).toBe(false); // воскресенье без исключения
  });

  it('рабочее исключение приоритетнее праздника', () => {
    const calendar = createWorkingCalendar({
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-10-14'],
      workingExceptions: ['2026-10-14'],
    });
    expect(calendar.isWorkingDay('2026-10-14')).toBe(true);
  });
});

describe('рабочий календарь — следующий рабочий день', () => {
  it('пятница переходит в понедельник', () => {
    expect(standard.nextWorkingDay('2026-10-16')).toBe('2026-10-19');
  });

  it('праздники пропускаются', () => {
    const calendar = createWorkingCalendar({
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-10-12', '2026-10-13'],
    });
    expect(calendar.nextWorkingDay('2026-10-09')).toBe('2026-10-14');
  });

  it('рабочее исключение в субботу учитывается', () => {
    const calendar = createWorkingCalendar({
      workingDays: [1, 2, 3, 4, 5],
      workingExceptions: ['2026-10-17'],
    });
    expect(calendar.nextWorkingDay('2026-10-16')).toBe('2026-10-17');
  });
});

describe('рабочий календарь — предыдущий рабочий день', () => {
  it('понедельник переходит в пятницу', () => {
    expect(standard.prevWorkingDay('2026-10-12')).toBe('2026-10-09');
  });

  it('праздники пропускаются назад', () => {
    const calendar = createWorkingCalendar({
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-10-08', '2026-10-09'],
    });
    expect(calendar.prevWorkingDay('2026-10-12')).toBe('2026-10-07');
  });

  it('рабочее исключение в субботу учитывается', () => {
    const calendar = createWorkingCalendar({
      workingDays: [1, 2, 3, 4, 5],
      workingExceptions: ['2026-10-17'],
    });
    expect(calendar.prevWorkingDay('2026-10-19')).toBe('2026-10-17');
  });
});

describe('рабочий календарь — прибавление лага', () => {
  it('лаг 0 после пятницы даёт понедельник', () => {
    expect(standard.addWorkingDays('2026-10-16', 0)).toBe('2026-10-19');
  });

  it('лаг 5 через выходные даёт понедельник следующей недели', () => {
    expect(standard.addWorkingDays('2026-10-12', 5)).toBe('2026-10-19');
  });

  it('отрицательный и нецелый лаг отклоняются', () => {
    expect(() => standard.addWorkingDays('2026-10-16', -1)).toThrowError(
      WorkingCalendarError,
    );
    expect(() => standard.addWorkingDays('2026-10-16', 1.5)).toThrowError(
      WorkingCalendarError,
    );
  });
});

describe('календарные дни — утилиты', () => {
  it('сдвиг без учёта рабочести, включая выходные', () => {
    expect(addCalendarDays('2026-10-16', 1)).toBe('2026-10-17'); // пт → сб
    expect(addCalendarDays('2026-10-17', 1)).toBe('2026-10-18');
    expect(addCalendarDays('2026-10-31', 1)).toBe('2026-11-01'); // граница месяца
    expect(addCalendarDays('2026-10-12', -1)).toBe('2026-10-11');
  });

  it('календарная разница интервала в днях', () => {
    expect(calendarDaySpan('2026-10-12', '2026-10-16')).toBe(4);
    expect(calendarDaySpan('2026-10-17', '2026-10-18')).toBe(1);
    expect(calendarDaySpan('2026-10-12', '2026-10-12')).toBe(0);
    expect(calendarDaySpan('2026-10-16', '2026-10-12')).toBe(-4);
  });

  it('несуществующая дата отклоняется', () => {
    expect(() => addCalendarDays('2026-02-30', 1)).toThrowError(
      WorkingCalendarError,
    );
    expect(() => calendarDaySpan('2026-02-30', '2026-03-01')).toThrowError(
      WorkingCalendarError,
    );
  });
});

describe('рабочий календарь — длительность интервала', () => {
  it('неделя с праздником внутри даёт 4 дня', () => {
    const calendar = createWorkingCalendar({
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-10-14'],
    });
    expect(calendar.workingDaysBetween('2026-10-12', '2026-10-16')).toBe(4);
  });

  it('однодневный интервал даёт 1', () => {
    expect(standard.workingDaysBetween('2026-10-12', '2026-10-12')).toBe(1);
  });

  it('перевёрнутый интервал даёт 0 без ошибки', () => {
    expect(standard.workingDaysBetween('2026-10-16', '2026-10-12')).toBe(0);
  });

  it('интервал через границу года даёт 5 рабочих дней', () => {
    expect(standard.workingDaysBetween('2025-12-29', '2026-01-02')).toBe(5);
  });

  it('високосный и обычный февраль дают 5 рабочих дней', () => {
    // пн 24.02.2020 – пт 28.02.2020 (високосный): пн, вт, ср, чт, пт.
    expect(standard.workingDaysBetween('2020-02-24', '2020-02-28')).toBe(5);
    // пн 23.02.2026 – пт 27.02.2026 (обычный): те же будни.
    expect(standard.workingDaysBetween('2026-02-23', '2026-02-27')).toBe(5);
  });

  it('переход DST внутри интервала не смещает календарную дату', () => {
    // Последнее воскресенье марта 2026 — 29.03 (переход летнего времени в ряде поясов).
    expect(standard.workingDaysBetween('2026-03-27', '2026-04-01')).toBe(4);
    expect(standard.addWorkingDays('2026-03-27', 0)).toBe('2026-03-30');
  });

  it('некорректная дата отклоняется', () => {
    expect(() => standard.isWorkingDay('2026-02-30')).toThrowError(
      WorkingCalendarError,
    );
    expect(() => standard.isWorkingDay('16.10.2026')).toThrowError(
      WorkingCalendarError,
    );
  });
});

describe('рабочий календарь — валидация', () => {
  it('календарь без рабочих дней отклоняется', () => {
    expect(() => createWorkingCalendar({ workingDays: [] })).toThrowError(
      WorkingCalendarError,
    );
  });

  it('несуществующий день недели отклоняется', () => {
    expect(() =>
      createWorkingCalendar({
        workingDays: [8] as unknown as WorkingCalendarDefinition['workingDays'],
      }),
    ).toThrowError(WorkingCalendarError);
  });

  it('календарь иммутабелен', () => {
    expect(Object.isFrozen(standard)).toBe(true);
  });
});
