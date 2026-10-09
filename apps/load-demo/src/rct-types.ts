import type { TimelineGroupBase, TimelineItemBase } from 'react-calendar-timeline';

export type SpikeGroup = TimelineGroupBase & { id: string; title: string };
export type SpikeItem = TimelineItemBase<number> & {
  id: string;
  group: string;
  title: string;
  className?: string;
};

export const DAY_MS = 86400000;

export function isoToMs(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function msToIso(ms: number): string {
  const date = new Date(ms);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
