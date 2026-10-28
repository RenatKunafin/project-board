import type { Note } from './model';

export const GROUPS = ['Закреплённые', 'Сегодня', 'За неделю', 'Раньше'] as const;
export type NoteGroup = typeof GROUPS[number];

export function normalizeTag(raw: string): string | null {
  return raw.trim().replace(/^(?:#\s*)+/, '').trim().toLowerCase() || null;
}
export function normalizedTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter((tag): tag is string => tag !== null))];
}
export function allTags(notes: readonly Note[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) for (const tag of normalizedTags(note.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) =>
    b.count - a.count || a.tag.localeCompare(b.tag, 'ru') || compareIds(a.tag, b.tag));
}
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function filterNotes(notes: readonly Note[], query: string, tag: string | null): Note[] {
  const q = query.trim().toLowerCase();
  return notes.filter(note => {
    const tags = normalizedTags(note.tags);
    return (!tag || tags.includes(tag)) && (!q || [note.title, note.body, ...tags].some(value => value.toLowerCase().includes(q)));
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || compareIds(a.id, b.id));
}
export function dateGroup(note: Note, now: number): NoteGroup {
  if (note.pinned) return 'Закреплённые';
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const week = new Date(today); week.setDate(week.getDate() - 6);
  const timestamp = Date.parse(note.updatedAt);
  return timestamp >= today.getTime() ? 'Сегодня' : timestamp >= week.getTime() ? 'За неделю' : 'Раньше';
}
export function groupNotes(notes: readonly Note[], query: string, tag: string | null, now: number) {
  const buckets = new Map<NoteGroup, Note[]>(GROUPS.map(group => [group, []]));
  for (const note of filterNotes(notes, query, tag)) buckets.get(dateGroup(note, now))!.push(note);
  return [...buckets].filter(([, items]) => items.length).map(([title, notes]) => ({ title, notes }));
}
export function notePreview(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^(?:`{3,}|~{3,})/.test(trimmed) || /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) continue;
    const text = trimmed.replace(/^(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/, '').replace(/[*_`]/g, '').trim();
    if (text) return text;
  }
  return 'Нет текста';
}
export function noteDate(timestamp: string): string {
  return new Date(timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function nextMidnight(now: number): number {
  const next = new Date(now); next.setHours(24, 0, 0, 0); return next.getTime();
}
