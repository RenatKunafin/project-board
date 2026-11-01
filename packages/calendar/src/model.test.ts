import { describe, expect, it } from 'vitest';
import {
  CalendarValidationError,
  addCalendarEvent,
  addCalendarType,
  createEmptyCalendarContent,
  parseCalendarContent,
  removeCalendarEvent,
  removeCalendarType,
  setNonWorkingDay,
  updateCalendarEvent,
  updateCalendarType,
  validateCalendarContent,
  type CalendarContent,
} from './model';

const event = {
  id: 'event-1',
  title: 'Новый год',
  date: '2028-02-29',
  time: '09:30',
  typeId: 'type-1',
  description: '',
  repeat: 'none' as const,
  until: '',
};

const type = { id: 'type-1', name: 'Праздник', color: 'amber' as const };

function content(): CalendarContent {
  return { events: [event], types: [type], days: [] };
}

describe('calendar document model', () => {
  it('creates the v1 shape without an embedded version', () => {
    expect(createEmptyCalendarContent()).toEqual({ events: [], types: [], days: [] });
    expect(createEmptyCalendarContent()).not.toHaveProperty('version');
  });

  it('accepts leap-day local values and preserves them through parsing', () => {
    expect(parseCalendarContent(content())).toEqual(content());
    expect(validateCalendarContent(content())).toEqual([]);
  });

  it('reports invalid values without replacing the raw content', () => {
    const broken = { ...content(), events: [{ ...event, date: '2027-02-29', time: '25:00' }] };
    expect(() => parseCalendarContent(broken)).toThrow(CalendarValidationError);
    try {
      parseCalendarContent(broken);
    } catch (error) {
      expect(error).toBeInstanceOf(CalendarValidationError);
      expect((error as CalendarValidationError).raw).toBe(broken);
      expect((error as CalendarValidationError).issues.map((issue) => issue.path)).toEqual([
        'events[0].date',
        'events[0].time',
      ]);
    }
  });

  it('rejects duplicate ids, unknown references and duplicate manual dates', () => {
    const broken = {
      ...content(),
      events: [event, { ...event, id: 'event-1', typeId: 'missing' }],
      days: [
        { date: '2028-01-01', kind: 'holiday' as const, name: '' },
        { date: '2028-01-01', kind: 'off' as const, name: '' },
      ],
    };
    const issues = validateCalendarContent(broken);
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'events[1].typeId',
      'events[1].id',
      'days[1].date',
    ]));
  });

  it('keeps operations immutable and supports multiple events on a date', () => {
    const before = content();
    const second = { ...event, id: 'event-2', title: 'Встреча' };
    const after = addCalendarEvent(before, second);
    expect(after.events).toHaveLength(2);
    expect(before.events).toHaveLength(1);
    expect(before.events[0]).toEqual(event);
  });

  it('removes a type while keeping its events without a type', () => {
    const after = removeCalendarType(content(), 'type-1');
    expect(after.types).toEqual([]);
    expect(after.events[0]?.typeId).toBe('');
  });

  it('creates, updates and removes independent event and type records', () => {
    const withType = addCalendarType(createEmptyCalendarContent(), { id: 'type-2', name: 'Работа', color: 'teal' });
    const withEvent = addCalendarEvent(withType, { id: 'event-2', title: 'Встреча', date: '2028-02-29', time: '', typeId: 'type-2', description: 'Описание', repeat: 'none', until: '' });
    const renamed = updateCalendarType(withEvent, { id: 'type-2', name: 'Рабочее', color: 'green' });
    const updated = updateCalendarEvent(renamed, { ...renamed.events[0]!, title: 'Важная встреча' });
    expect(updated.types[0]).toEqual({ id: 'type-2', name: 'Рабочее', color: 'green' });
    expect(updated.events[0]?.title).toBe('Важная встреча');
    expect(removeCalendarEvent(updated, 'event-2').events).toEqual([]);
  });

  it('replaces a manual non-working date without mutating the input', () => {
    const before = content();
    const after = setNonWorkingDay(before, { date: '2028-01-01', kind: 'holiday', name: 'Праздник' });
    expect(before.days).toEqual([]);
    expect(after.days).toEqual([{ date: '2028-01-01', kind: 'holiday', name: 'Праздник' }]);
  });
});
