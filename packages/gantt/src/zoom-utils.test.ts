import { describe, expect, it } from 'vitest';
import {
  convertZoomScrollLeft,
  formatIsoDayMonth,
  formatZoomDayLabel,
  normalizeGanttZoom,
  ZOOM_CELL_WIDTH,
} from './zoom-utils';

describe('normalizeGanttZoom', () => {
  it('принимает days и weeks, мусор приводит к дефолту weeks', () => {
    expect(normalizeGanttZoom('days')).toBe('days');
    expect(normalizeGanttZoom('weeks')).toBe('weeks');
    expect(normalizeGanttZoom(undefined)).toBe('weeks');
    expect(normalizeGanttZoom('DAYS')).toBe('weeks');
    expect(normalizeGanttZoom(42)).toBe('weeks');
  });
});

describe('convertZoomScrollLeft', () => {
  it('при том же масштабе возвращает позицию без изменений', () => {
    expect(convertZoomScrollLeft(123.5, 'days', 'days')).toBe(123.5);
    expect(convertZoomScrollLeft(0, 'weeks', 'weeks')).toBe(0);
  });

  it('недели → дни: пиксели растут пропорционально клетке', () => {
    // 10 дней в «Неделях» (33px) = 330px; в «Днях» (48px) = 480px.
    expect(convertZoomScrollLeft(330, 'weeks', 'days')).toBeCloseTo(480);
  });

  it('дни → недели: позиция сохраняет дробную часть дня', () => {
    // 480px в «Днях» → 330px в «Неделях».
    expect(convertZoomScrollLeft(480, 'days', 'weeks')).toBeCloseTo(330);
    // Полдня в «Днях» (24px) → полдня в «Неделях» (16.5px).
    expect(convertZoomScrollLeft(24, 'days', 'weeks')).toBeCloseTo(16.5);
  });

  it('нулевая позиция остаётся нулевой в любом направлении', () => {
    expect(convertZoomScrollLeft(0, 'days', 'weeks')).toBe(0);
    expect(convertZoomScrollLeft(0, 'weeks', 'days')).toBe(0);
  });

  it('ширины клеток соответствуют спеке зума (48/33)', () => {
    expect(ZOOM_CELL_WIDTH.days).toBe(48);
    expect(ZOOM_CELL_WIDTH.weeks).toBe(33);
  });
});

describe('formatZoomDayLabel', () => {
  it('«Дни» — дд.мм с ведущими нулями', () => {
    expect(formatZoomDayLabel(new Date(2026, 9, 5), 'days')).toBe('05.10');
    expect(formatZoomDayLabel(new Date(2026, 11, 31), 'days')).toBe('31.12');
  });

  it('«Недели» — только число дня', () => {
    expect(formatZoomDayLabel(new Date(2026, 9, 5), 'weeks')).toBe('5');
  });
});

describe('formatIsoDayMonth', () => {
  it('ISO-дата документа → дд.мм', () => {
    expect(formatIsoDayMonth('2026-10-12')).toBe('12.10');
    expect(formatIsoDayMonth('2026-01-05')).toBe('05.01');
  });
});
