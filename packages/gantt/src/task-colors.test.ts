import { describe, expect, it } from 'vitest';
import {
  TASK_COLORS,
  ganttBarColorRules,
  isTaskColor,
  resourceTimelineColorStyle,
  taskColor,
  taskColorIdByHex,
} from './task-colors';

describe('палитра цветов задачи', () => {
  it('ровно десять значений с уникальными id и hex', () => {
    expect(TASK_COLORS).toHaveLength(10);
    expect(new Set(TASK_COLORS.map((color) => color.id)).size).toBe(10);
    expect(new Set(TASK_COLORS.map((color) => color.hex.toLowerCase())).size).toBe(10);
    for (const color of TASK_COLORS) {
      expect(color.hex).toMatch(/^#[0-9A-F]{6}$/i);
      expect(color.label).not.toBe('');
    }
  });

  it('isTaskColor различает известные и неизвестные значения', () => {
    expect(isTaskColor('sapphire')).toBe(true);
    expect(isTaskColor('steel')).toBe(true);
    expect(isTaskColor('navy')).toBe(false);
    expect(isTaskColor('#3186E9')).toBe(false);
    expect(isTaskColor(undefined)).toBe(false);
    expect(isTaskColor(42)).toBe(false);
  });

  it('taskColor возвращает запись палитры, undefined — «Авто»', () => {
    expect(taskColor('coral')).toEqual({ id: 'coral', label: 'Коралл', hex: '#F05653' });
    expect(taskColor('unknown')).toBeUndefined();
    expect(taskColor(undefined)).toBeUndefined();
  });

  it('taskColorIdByHex нормализует регистр и пробелы', () => {
    expect(taskColorIdByHex('#3186E9')).toBe('sapphire');
    expect(taskColorIdByHex('#3186e9')).toBe('sapphire');
    expect(taskColorIdByHex(' #3186e9 ')).toBe('sapphire');
    expect(taskColorIdByHex('#123456')).toBeUndefined();
    expect(taskColorIdByHex('blue')).toBeUndefined();
  });
});

describe('генерация правил окраски полос', () => {
  it('правило только для задач с цветом и безопасным идентификатором', () => {
    const rules = ganttBarColorRules([
      { id: 't-1', color: 'sapphire' },
      { id: 't-2' },
      { id: 't/bad', color: 'coral' },
      { id: 't-3', color: 'coral' },
    ]);
    expect(rules).toContain('[data-task-id="t-1"]');
    expect(rules).toContain('[data-task-id="t-3"]');
    expect(rules).not.toContain('t-2');
    expect(rules).not.toContain('t/bad');
    expect(rules).toContain('--wx-gantt-task-color:color-mix(in oklch,#3186E9 80%,#000)');
    expect(rules).toContain('--wx-gantt-task-fill-color:#3186E9');
    expect(rules).toContain('--wx-gantt-task-border-color:#3186E9');
  });

  it('префикс SVAR попадает в селектор, но не в проверку идентификатора', () => {
    const rules = ganttBarColorRules([{ id: 't-1', color: 'jade' }], ':');
    expect(rules).toContain('[data-task-id=":t-1"]');
  });

  it('пустой набор — без правил', () => {
    expect(ganttBarColorRules([{ id: 't-1' }, { id: 't/bad', color: 'jade' }])).toBe('');
  });
});

describe('инлайн-стиль ресурсного вида', () => {
  it('цвет палитры смешивается с чёрным — оттенок сохраняется', () => {
    expect(resourceTimelineColorStyle('sapphire')).toEqual({
      background: 'color-mix(in oklch, #3186E9 80%, #000)',
      borderColor: '#3186E9',
    });
  });

  it('без цвета и неизвестный id — undefined («Авто»)', () => {
    expect(resourceTimelineColorStyle(undefined)).toBeUndefined();
    expect(resourceTimelineColorStyle('navy')).toBeUndefined();
  });
});
