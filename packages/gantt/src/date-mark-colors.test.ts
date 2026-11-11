import { describe, expect, it } from 'vitest';
import {
  DATE_MARK_COLORS,
  dateMarkColorRules,
  dateMarkFill,
  isDateMarkColor,
  PLANTUML_MARK_MIX_PERCENT,
  plantUmlDateMarkColor,
} from './date-mark-colors';
import { TASK_COLORS } from './task-colors';

describe('палитра меток дат (PBT-141)', () => {
  it('шесть цветов из палитры задач, hex не дублируется', () => {
    expect(DATE_MARK_COLORS.map((color) => color.id)).toEqual([
      'coral',
      'pumpkin',
      'ochre',
      'jade',
      'sapphire',
      'plum',
    ]);
    const taskHexById = new Map(TASK_COLORS.map((color) => [color.id, color.hex]));
    for (const color of DATE_MARK_COLORS) {
      expect(color.hex).toBe(taskHexById.get(color.id));
    }
  });

  it('isDateMarkColor принимает только идентификаторы палитры меток', () => {
    expect(isDateMarkColor('coral')).toBe(true);
    expect(isDateMarkColor('plum')).toBe(true);
    expect(isDateMarkColor('turquoise')).toBe(false); // есть у задач, нет у меток
    expect(isDateMarkColor('#F05653')).toBe(false);
    expect(isDateMarkColor(undefined)).toBe(false);
  });

  it('заливка — смешение базового hex с поверхностью (притушенная)', () => {
    expect(dateMarkFill('coral')).toBe(
      'color-mix(in oklch, #F05653 32%, var(--surface))',
    );
    expect(dateMarkFill('неизвестный')).toBe('transparent');
  });

  it('правила классов: по классу на цвет палитры меток', () => {
    const lines = dateMarkColorRules().split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(
      '.plan-gantt .gantt-date-mark-coral{background:color-mix(in oklch, #F05653 32%, var(--surface))}',
    );
    for (const line of lines) {
      expect(line).toMatch(
        /^\.plan-gantt \.gantt-date-mark-[a-z]+\{background:color-mix/,
      );
    }
  });

  it('plantUml-представление — осветлённый к белу hex формата #rrggbb', () => {
    const lightened = plantUmlDateMarkColor('coral');
    expect(lightened).toMatch(/^#[0-9a-f]{6}$/);
    // 45% базового цвета: канал = round(channel * 45% + 255 * 55%)
    expect(lightened).toBe('#f8b3b2');
    expect(plantUmlDateMarkColor('sapphire')).toBe('#a2c9f5');
  });

  it('коэффициент осветления PlantUML зафиксирован в одном месте', () => {
    expect(PLANTUML_MARK_MIX_PERCENT).toBeGreaterThan(0);
    expect(PLANTUML_MARK_MIX_PERCENT).toBeLessThan(100);
  });
});
