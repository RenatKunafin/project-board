import { describe, expect, it } from 'vitest';
import { groupUpcomingOccurrences, normalizeUpcomingTypeFilter, upcomingOccurrences } from './upcoming';
import type { CalendarContent } from './model';

const empty: CalendarContent = { events: [], types: [], days: [] };

function event(id: string, date: string, time = '', typeId = '', extra: Partial<CalendarContent['events'][number]> = {}) {
  return { id, title: id, date, time, typeId, description: '', repeat: 'none' as const, until: '', ...extra };
}

describe('upcomingOccurrences', () => {
  it('keeps all-day today and future time, while excluding past time locally', () => {
    const content = { ...empty, events: [
      event('past', '2026-11-01', '09:00'),
      event('future', '2026-11-01', '11:00'),
      event('all-day', '2026-11-01'),
    ] };
    const result = upcomingOccurrences(content, new Date(2026, 10, 1, 10, 0));
    expect(result.map((item) => item.event.id)).toEqual(['future', 'all-day']);
  });

  it('uses an inclusive today plus 365 calendar-day boundary', () => {
    const content = { ...empty, events: [event('boundary', '2027-11-01'), event('outside', '2027-11-02')] };
    expect(upcomingOccurrences(content, new Date(2026, 10, 1)).map((item) => item.event.id)).toEqual(['boundary']);
  });

  it('sorts timed events before all-day events and applies the limit after filtering', () => {
    const content = {
      ...empty,
      types: [{ id: 'work', name: 'Работа', color: 'blue' as const }],
      events: [event('all-day', '2026-11-02', '', 'work'), event('late', '2026-11-02', '18:00', 'work'), event('early', '2026-11-02', '08:00', 'work'), event('other', '2026-11-02', '07:00')],
    };
    expect(upcomingOccurrences(content, new Date(2026, 10, 1), 'work', 365, 2).map((item) => item.event.id)).toEqual(['early', 'late']);
  });

  it('expands repeated occurrences without changing the source content', () => {
    const content = { ...empty, events: [event('daily', '2026-11-01', '', '', { repeat: 'daily', until: '2026-11-03' })] };
    const before = JSON.stringify(content);
    expect(upcomingOccurrences(content, new Date(2026, 10, 1)).map((item) => item.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(JSON.stringify(content)).toBe(before);
  });
});

describe('upcoming filters and grouping', () => {
  it('normalizes an unknown type to all and groups by date', () => {
    const content = { ...empty, types: [{ id: 'work', name: 'Работа', color: 'blue' as const }] };
    expect(normalizeUpcomingTypeFilter(content, 'missing')).toBe('all');
    const occurrences = [{ event: event('a', '2026-11-01'), date: '2026-11-01', key: 'a:2026-11-01' }, { event: event('b', '2026-11-02'), date: '2026-11-02', key: 'b:2026-11-02' }];
    expect(groupUpcomingOccurrences(occurrences).map((group) => [group.date, group.occurrences.length])).toEqual([['2026-11-01', 1], ['2026-11-02', 1]]);
  });
});
