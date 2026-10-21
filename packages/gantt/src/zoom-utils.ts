/**
 * Масштаб шкалы проектного Гантта «Дни/Недели» (PBT-073 D3/D6.5; PBT-076 D2 —
 * недельная семантика: «Недели» = одна колонка шкалы — одна неделя).
 *
 * «Дни»: дневные колонки, cellWidth 48, подпись дд.мм.
 * «Недели»: недельные колонки (unit 'week' SVAR), cellWidth ~100 на неделю
 * (≈14px/день), подпись-диапазон «12–18 окт» — решения владельца 2026-10-21.
 * Полосы задач и подсветка нерабочих дней сохраняют дневую точность в обоих
 * режимах: позиции считаются в пикселях дня (zoomPxPerDay).
 * Состояние экземпляра (settings), документ не меняется.
 */

export type GanttZoom = 'days' | 'weeks';

/**
 * Ширина клетки нижней строки шкалы (px): «Дни» — клетка дня,
 * «Недели» — клетка недели (подбор живой сверкой, design D2.2).
 */
export const ZOOM_SCALE: Readonly<Record<GanttZoom, number>> = {
  days: 48,
  weeks: 112,
};

/** Пикселей на день в масштабе (дневная плотность для конверсий). */
export function zoomPxPerDay(zoom: GanttZoom): number {
  return zoom === 'days' ? ZOOM_SCALE.days : ZOOM_SCALE.weeks / 7;
}

/** Приводит произвольное значение настроек к масштабу (защита от мусора). */
export function normalizeGanttZoom(value: unknown): GanttZoom {
  return value === 'days' ? 'days' : 'weeks';
}

/**
 * Конверсия пиксельной позиции прокрутки шкалы между масштабами
 * (design D6.5, PBT-076 D2.4): позиция дня стабильна, плотность —
 * пиксели дня (для «Дней» клетка и день совпадают; для «Недель»
 * клетка недели делится на 7). Дробная часть сохраняется.
 */
export function convertZoomScrollLeft(
  left: number,
  from: GanttZoom,
  to: GanttZoom,
): number {
  if (from === to) {
    return left;
  }
  return (left / zoomPxPerDay(from)) * zoomPxPerDay(to);
}

/** Формат даты шкалы дня: «Дни» — дд.мм. */
export function formatZoomDayLabel(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

/** Локализованный короткий месяц ru-RU без точки («окт», «дек», «янв»). */
function shortMonth(date: Date): string {
  const month = date.toLocaleDateString('ru-RU', { month: 'short' });
  return month.replace(/\.$/, '');
}

/**
 * Подпись недельной колонки шкалы — диапазон дат её дней
 * (решение владельца 2026-10-21): «12–18 окт» внутри месяца,
 * «28 окт – 3 ноя» на стыке (год — в строке месяцев над ней).
 * next — начало следующей клетки (контракт IScaleConfig.format);
 * последняя клетка шкалы без next добирает 6 дней по датам
 * (защита, не влияет на типичный случай).
 */
export function formatWeekRangeLabel(start: Date, next?: Date): string {
  const end = next === undefined ? addDays(start, 6) : addDays(next, -1);
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${shortMonth(start)}`;
  }
  return `${start.getDate()} ${shortMonth(start)} – ${end.getDate()} ${shortMonth(end)}`;
}

/** Дата через N календарных дней (локальная, без мутации исходной). */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Формат дд.мм из ISO-даты документа плана ('2026-10-12' → '12.10'). */
export function formatIsoDayMonth(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}
