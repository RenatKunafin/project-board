/**
 * Масштаб шкалы проектного Гантта «Дни/Недели» (PBT-073, design D3/D6.5).
 *
 * Дефолт — «Недели» (33px): компактная плотность по референсу OnlineGantt
 * (PBT-068). «Дни» (48px) — явно выбранный пользователем масштаб.
 * Состояние экземпляра (settings), документ не меняется.
 */

export type GanttZoom = 'days' | 'weeks';

/** Ширина клетки дня по масштабу (px). */
export const ZOOM_CELL_WIDTH: Readonly<Record<GanttZoom, number>> = {
  days: 48,
  weeks: 33,
};

/** Приводит произвольное значение настроек к масштабу (защита от мусора). */
export function normalizeGanttZoom(value: unknown): GanttZoom {
  return value === 'days' ? 'days' : 'weeks';
}

/**
 * Конверсия пиксельной позиции прокрутки шкалы между масштабами
 * (design D6.5): позиция дня стабильна — cellWidth меняет только
 * пиксельную плотность, поэтому left пересчитывается пропорционально
 * ширине клетки. Дробная часть сохраняется (полоса может начинаться
 * внутри дня).
 */
export function convertZoomScrollLeft(
  left: number,
  from: GanttZoom,
  to: GanttZoom,
): number {
  if (from === to) {
    return left;
  }
  return (left / ZOOM_CELL_WIDTH[from]) * ZOOM_CELL_WIDTH[to];
}

/** Формат даты шкалы дня: «Дни» — дд.мм, «Недели» — число месяца. */
export function formatZoomDayLabel(date: Date, zoom: GanttZoom): string {
  if (zoom === 'days') {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
  }
  return String(date.getDate());
}

/** Формат дд.мм из ISO-даты документа плана ('2026-10-12' → '12.10'). */
export function formatIsoDayMonth(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}
