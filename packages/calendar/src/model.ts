export const CALENDAR_SCHEMA_VERSION = 1 as const;

export const CALENDAR_COLORS = [
  'blue',
  'green',
  'amber',
  'pink',
  'orange',
  'teal',
] as const;

export type CalendarColor = (typeof CALENDAR_COLORS)[number];
export type CalendarRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type NonWorkingDayKind = 'holiday' | 'off';

export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  /** Local calendar date. It is deliberately not a UTC timestamp. */
  readonly date: string;
  /** Local wall-clock time, or an empty string for an all-day event. */
  readonly time: string;
  readonly typeId: string;
  readonly description: string;
  readonly repeat: CalendarRepeat;
  /** Inclusive end date for a repeating event, or an empty string. */
  readonly until: string;
}

export interface CalendarEventType {
  readonly id: string;
  readonly name: string;
  readonly color: CalendarColor;
}

export interface NonWorkingDay {
  readonly date: string;
  readonly kind: NonWorkingDayKind;
  readonly name: string;
}

export interface CalendarContent {
  readonly events: readonly CalendarEvent[];
  readonly types: readonly CalendarEventType[];
  readonly days: readonly NonWorkingDay[];
}

export interface CalendarIssue {
  readonly path: string;
  readonly message: string;
}

export class CalendarValidationError extends Error {
  readonly issues: readonly CalendarIssue[];
  readonly raw: unknown;

  constructor(issues: readonly CalendarIssue[], raw: unknown) {
    super(`Некорректный документ календаря: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'CalendarValidationError';
    this.issues = issues;
    this.raw = raw;
  }
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID_PATTERN = /^\S+$/;
const REPEATS = new Set<CalendarRepeat>(['none', 'daily', 'weekly', 'monthly', 'yearly']);
const COLORS = new Set<string>(CALENDAR_COLORS);
const DAY_KINDS = new Set<NonWorkingDayKind>(['holiday', 'off']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function addIssue(issues: CalendarIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateEvent(value: unknown, path: string, typeIds: Set<string>, issues: CalendarIssue[]): value is CalendarEvent {
  if (!isRecord(value)) {
    addIssue(issues, path, 'ожидался объект');
    return false;
  }
  const fields = ['id', 'title', 'date', 'time', 'typeId', 'description', 'repeat', 'until'];
  for (const field of fields) {
    if (!(field in value)) addIssue(issues, `${path}.${field}`, 'поле отсутствует');
  }
  const valid =
    typeof value.id === 'string' && ID_PATTERN.test(value.id) ||
    (addIssue(issues, `${path}.id`, 'нужна непустая строка без пробелов'), false);
  if (typeof value.title !== 'string' || value.title.trim() === '') addIssue(issues, `${path}.title`, 'название не может быть пустым');
  if (!isValidDate(value.date)) addIssue(issues, `${path}.date`, 'нужна существующая дата YYYY-MM-DD');
  if (typeof value.time !== 'string' || (value.time !== '' && !TIME_PATTERN.test(value.time))) addIssue(issues, `${path}.time`, 'нужно время HH:mm или пустое значение');
  if (typeof value.typeId !== 'string' || (value.typeId !== '' && !typeIds.has(value.typeId))) addIssue(issues, `${path}.typeId`, 'тип события не найден');
  if (typeof value.description !== 'string') addIssue(issues, `${path}.description`, 'нужна строка');
  if (typeof value.repeat !== 'string' || !REPEATS.has(value.repeat as CalendarRepeat)) addIssue(issues, `${path}.repeat`, 'неизвестное правило повторения');
  if (typeof value.until !== 'string' || (value.until !== '' && !isValidDate(value.until))) addIssue(issues, `${path}.until`, 'нужна существующая дата YYYY-MM-DD или пустое значение');
  if (value.repeat === 'none' && value.until !== '') addIssue(issues, `${path}.until`, 'для события без повторения дата окончания должна быть пустой');
  if (value.repeat !== 'none' && typeof value.date === 'string' && value.until !== '' && isValidDate(value.date) && isValidDate(value.until) && value.until < value.date) addIssue(issues, `${path}.until`, 'дата окончания не может быть раньше даты начала');
  return valid;
}

export function validateCalendarContent(value: unknown): readonly CalendarIssue[] {
  const issues: CalendarIssue[] = [];
  if (!isRecord(value)) {
    addIssue(issues, '$', 'ожидался объект');
    return issues;
  }
  for (const field of ['events', 'types', 'days']) {
    if (!Array.isArray(value[field])) addIssue(issues, field, 'нужен массив');
  }
  if (!Array.isArray(value.events) || !Array.isArray(value.types) || !Array.isArray(value.days)) return issues;

  const typeIds = new Set<string>();
  value.types.forEach((item, index) => {
    const path = `types[${index}]`;
    if (!isRecord(item)) {
      addIssue(issues, path, 'ожидался объект');
      return;
    }
    if (typeof item.id !== 'string' || !ID_PATTERN.test(item.id)) addIssue(issues, `${path}.id`, 'нужна непустая строка без пробелов');
    else if (typeIds.has(item.id)) addIssue(issues, `${path}.id`, 'идентификатор повторяется');
    else typeIds.add(item.id);
    if (typeof item.name !== 'string' || item.name.trim() === '') addIssue(issues, `${path}.name`, 'название не может быть пустым');
    if (typeof item.color !== 'string' || !COLORS.has(item.color)) addIssue(issues, `${path}.color`, 'неизвестный цвет');
  });

  const eventIds = new Set<string>();
  value.events.forEach((item, index) => {
    const path = `events[${index}]`;
    if (validateEvent(item, path, typeIds, issues) && eventIds.has(item.id)) addIssue(issues, `${path}.id`, 'идентификатор повторяется');
    if (isRecord(item) && typeof item.id === 'string') eventIds.add(item.id);
  });

  const dayDates = new Set<string>();
  value.days.forEach((item, index) => {
    const path = `days[${index}]`;
    if (!isRecord(item)) {
      addIssue(issues, path, 'ожидался объект');
      return;
    }
    if (!isValidDate(item.date)) addIssue(issues, `${path}.date`, 'нужна существующая дата YYYY-MM-DD');
    else if (dayDates.has(item.date)) addIssue(issues, `${path}.date`, 'отметка даты повторяется');
    else dayDates.add(item.date);
    if (typeof item.kind !== 'string' || !DAY_KINDS.has(item.kind as NonWorkingDayKind)) addIssue(issues, `${path}.kind`, 'неизвестный вид нерабочего дня');
    if (typeof item.name !== 'string') addIssue(issues, `${path}.name`, 'нужна строка');
  });
  return issues;
}

export function createEmptyCalendarContent(): CalendarContent {
  return { events: [], types: [], days: [] };
}

export function parseCalendarContent(value: unknown): CalendarContent {
  const issues = validateCalendarContent(value);
  if (issues.length > 0) throw new CalendarValidationError(issues, value);
  const content = value as CalendarContent;
  return {
    events: content.events.map((event) => ({ ...event })),
    types: content.types.map((type) => ({ ...type })),
    days: content.days.map((day) => ({ ...day })),
  };
}

function nextId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createCalendarId(prefix: 'event' | 'type' = 'event'): string {
  return nextId(prefix);
}

function checked(next: CalendarContent): CalendarContent {
  return parseCalendarContent(next);
}

export function addCalendarEvent(content: CalendarContent, event: CalendarEvent): CalendarContent {
  return checked({ ...content, events: [...content.events, { ...event }] });
}

export function updateCalendarEvent(content: CalendarContent, event: CalendarEvent): CalendarContent {
  if (!content.events.some((item) => item.id === event.id)) throw new Error(`Событие "${event.id}" не найдено.`);
  return checked({ ...content, events: content.events.map((item) => item.id === event.id ? { ...event } : { ...item }) });
}

export function removeCalendarEvent(content: CalendarContent, eventId: string): CalendarContent {
  return checked({ ...content, events: content.events.filter((event) => event.id !== eventId).map((event) => ({ ...event })) });
}

export function addCalendarType(content: CalendarContent, type: CalendarEventType): CalendarContent {
  return checked({ ...content, types: [...content.types, { ...type }] });
}

export function updateCalendarType(content: CalendarContent, type: CalendarEventType): CalendarContent {
  if (!content.types.some((item) => item.id === type.id)) throw new Error(`Тип "${type.id}" не найден.`);
  return checked({ ...content, types: content.types.map((item) => item.id === type.id ? { ...type } : { ...item }) });
}

/** Удаление типа оставляет его события, но снимает ссылку на тип. */
export function removeCalendarType(content: CalendarContent, typeId: string): CalendarContent {
  return checked({
    ...content,
    types: content.types.filter((type) => type.id !== typeId).map((type) => ({ ...type })),
    events: content.events.map((event) => ({ ...event, typeId: event.typeId === typeId ? '' : event.typeId })),
  });
}

export function setNonWorkingDay(content: CalendarContent, day: NonWorkingDay): CalendarContent {
  return checked({ ...content, days: [...content.days.filter((item) => item.date !== day.date), { ...day }] });
}

export function removeNonWorkingDay(content: CalendarContent, date: string): CalendarContent {
  return checked({ ...content, days: content.days.filter((day) => day.date !== date).map((day) => ({ ...day })) });
}
