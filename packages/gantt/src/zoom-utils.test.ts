import { describe, expect, it } from 'vitest';
import {
  convertZoomScrollLeft,
  formatIsoDayMonth,
  formatWeekRangeLabel,
  formatZoomDayLabel,
  normalizeGanttZoom,
  ZOOM_SCALE,
  zoomPxPerDay,
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

  it('недели → дни: пиксели пересчитываются по пикселям дня', () => {
    // 10 дней в «Неделях» (16px/день) = 160px; в «Днях» (48px/день) = 480px.
    expect(convertZoomScrollLeft(160, 'weeks', 'days')).toBeCloseTo(480);
  });

  it('дни → недели: позиция сохраняет дробную часть дня', () => {
    // 480px в «Днях» → 160px в «Неделях».
    expect(convertZoomScrollLeft(480, 'days', 'weeks')).toBeCloseTo(160);
    // Полдня в «Днях» (24px) → полдня в «Неделях» (8px).
    expect(convertZoomScrollLeft(24, 'days', 'weeks')).toBeCloseTo(8);
  });

  it('нулевая позиция остаётся нулевой в любом направлении', () => {
    expect(convertZoomScrollLeft(0, 'days', 'weeks')).toBe(0);
    expect(convertZoomScrollLeft(0, 'weeks', 'days')).toBe(0);
  });

  it('ширины клеток и пиксели дня соответствуют спеке зума', () => {
    // «Дни» — клетка дня 48px; «Недели» — клетка недели 112px = 16px/день
    // (PBT-076, design D2.2: плотность недельного режима).
    expect(ZOOM_SCALE.days).toBe(48);
    expect(ZOOM_SCALE.weeks).toBe(112);
    expect(zoomPxPerDay('days')).toBe(48);
    expect(zoomPxPerDay('weeks')).toBe(16);
  });
});

describe('formatZoomDayLabel', () => {
  it('«Дни» — дд.мм с ведущими нулями', () => {
    expect(formatZoomDayLabel(new Date(2026, 9, 5))).toBe('05.10');
    expect(formatZoomDayLabel(new Date(2026, 11, 31))).toBe('31.12');
  });
});

describe('formatWeekRangeLabel', () => {
  it('неделя внутри месяца — «12–18 окт»', () => {
    // Пн 12.10 — Вс 18.10.2026.
    expect(formatWeekRangeLabel(new Date(2026, 9, 12), new Date(2026, 9, 19))).toBe(
      '12–18 окт',
    );
  });

  it('неделя на стыке месяцев — «28 окт – 3 нояб»', () => {
    expect(formatWeekRangeLabel(new Date(2026, 9, 28), new Date(2026, 10, 4))).toBe(
      '28 окт – 3 нояб',
    );
  });

  it('неделя на стыке годов — «29 дек – 4 янв»', () => {
    expect(formatWeekRangeLabel(new Date(2026, 11, 29), new Date(2027, 0, 5))).toBe(
      '29 дек – 4 янв',
    );
  });

  it('без next (последняя клетка) — диапазон добирается по датам клетки', () => {
    // Пн 12.10.2026 + 6 дней = Вс 18.10.
    expect(formatWeekRangeLabel(new Date(2026, 9, 12))).toBe('12–18 окт');
  });
});

describe('formatIsoDayMonth', () => {
  it('ISO-дата документа → дд.мм', () => {
    expect(formatIsoDayMonth('2026-10-12')).toBe('12.10');
    expect(formatIsoDayMonth('2026-01-05')).toBe('05.01');
  });
});
