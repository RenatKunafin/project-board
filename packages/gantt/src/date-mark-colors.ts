import { taskColor } from './task-colors';

/**
 * Палитра цветовых меток дат (PBT-141): шесть идентификаторов
 * существующей палитры задач (PBT-084) — тот же цветовой язык
 * приложения. Hex не дублируется: единственный источник — task-colors.
 * В документе хранится только идентификатор.
 */
const DATE_MARK_IDS = [
  'coral',
  'pumpkin',
  'ochre',
  'jade',
  'sapphire',
  'plum',
] as const;

export type DateMarkColor = (typeof DATE_MARK_IDS)[number];

export interface DateMarkColorInfo {
  readonly id: DateMarkColor;
  readonly label: string;
  readonly hex: string;
}

const BY_ID = new Map<string, DateMarkColorInfo>(
  DATE_MARK_IDS.map((id) => {
    const color = taskColor(id);
    if (color === undefined) {
      throw new Error(`Палитра задач не содержит цвет «${id}».`);
    }
    return [
      id,
      { id, label: color.label, hex: color.hex } satisfies DateMarkColorInfo,
    ];
  }),
);

export const DATE_MARK_COLORS: readonly DateMarkColorInfo[] = DATE_MARK_IDS.map(
  (id) => BY_ID.get(id)!,
);

/** Идентификатор палитры меток (значение поля `color` метки даты). */
export function isDateMarkColor(value: unknown): value is DateMarkColor {
  return typeof value === 'string' && BY_ID.has(value);
}

/** Запись палитры меток по идентификатору; `undefined` — нет такого цвета. */
export function dateMarkColorInfo(value?: string): DateMarkColorInfo | undefined {
  return value === undefined ? undefined : BY_ID.get(value);
}

/**
 * Плотность заливки особых дат: проценты базового hex в смешении
 * с поверхностью. Плотнее праздника (15% --warning), притушеннее
 * насыщенных полос задач — метки заметны, но не конфликтуют с задачами
 * (решение владельца 2026-11-11; значение выверяется живым осмотром).
 */
export const DATE_MARK_FILL_PERCENT = 32;

/** CSS-значение заливки дня метки (одинаково для шкалы и свотчей). */
export function dateMarkFill(colorId: string): string {
  const info = dateMarkColorInfo(colorId);
  if (info === undefined) {
    return 'transparent';
  }
  return `color-mix(in oklch, ${info.hex} ${DATE_MARK_FILL_PERCENT}%, var(--surface))`;
}

/**
 * Классы заливки особых дат проектного Гантта: по одному классу на цвет
 * палитры, значения берутся из палитры задач (PBT-141 design D2 —
 * генерация по образцу ganttBarColorRules, без новых литеральных
 * цветов в tokens.css).
 */
export function dateMarkColorRules(prefix = '.plan-gantt '): string {
  return DATE_MARK_COLORS.map(
    (info) =>
      `${prefix}.gantt-date-mark-${info.id}{background:${dateMarkFill(info.id)}}`,
  ).join('\n');
}

/**
 * Осветлённое к белу представление базового hex для экспорта PlantUML:
 * эмуляция прозрачности приложения на светлом фоне диаграммы
 * (насыщенные hex полос задач метки не используют). Коэффициент —
 * доля базового цвета в смешении с белым, единый для палитры
 * (подбирается рендером, design D2/D7).
 */
export const PLANTUML_MARK_MIX_PERCENT = 45;

export function plantUmlDateMarkColor(colorId: string): string {
  const info = dateMarkColorInfo(colorId);
  if (info === undefined) {
    return '#ffffff';
  }
  return mixTowardWhite(info.hex, PLANTUML_MARK_MIX_PERCENT);
}

function mixTowardWhite(hex: string, percent: number): string {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  );
  const mixed = channels.map(
    (channel) =>
      Math.round((channel * percent + 255 * (100 - percent)) / 100) |
      0,
  );
  return `#${mixed
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`.toLowerCase();
}
