/**
 * Палитра ручных цветов задачи (PBT-084, раздел 6 прототипа MVP):
 * в документе хранится только идентификатор из конечного списка,
 * hex — представление для отображения и экспорта PlantUML.
 * Состав и порядок — референс прототипа (src/lib/task-colors.ts).
 */
export interface TaskColor {
  readonly id: string;
  readonly label: string;
  readonly hex: string;
}

export const TASK_COLORS: readonly TaskColor[] = [
  { id: 'sapphire', label: 'Сапфир', hex: '#3186E9' },
  { id: 'turquoise', label: 'Бирюза', hex: '#1DBCB5' },
  { id: 'jade', label: 'Нефрит', hex: '#2FC183' },
  { id: 'lime', label: 'Лайм', hex: '#BEBF28' },
  { id: 'ochre', label: 'Охра', hex: '#EAB532' },
  { id: 'pumpkin', label: 'Тыква', hex: '#F3821D' },
  { id: 'coral', label: 'Коралл', hex: '#F05653' },
  { id: 'rose', label: 'Роза', hex: '#E266A7' },
  { id: 'plum', label: 'Слива', hex: '#9F5DCB' },
  { id: 'steel', label: 'Сталь', hex: '#8B9AAB' },
];

const BY_ID = new Map(TASK_COLORS.map((color) => [color.id, color]));
const BY_HEX = new Map(TASK_COLORS.map((color) => [color.hex.toLowerCase(), color.id]));

/** Идентификатор палитры (значение поля `color` задачи). */
export function isTaskColor(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

/** Запись палитры по идентификатору; `undefined` — «Авто». */
export function taskColor(value?: string): TaskColor | undefined {
  return value === undefined ? undefined : BY_ID.get(value);
}

/** Идентификатор по hex-значению (нормализация регистра) — импорт OnlineGantt. */
export function taskColorIdByHex(hex: string): string | undefined {
  return BY_HEX.get(hex.trim().toLowerCase());
}

/**
 * Только идентификаторы, безопасные внутри attribute-селектора,
 * получают правило; прочие задачи остаются «Авто», чтобы одно
 * значение не сломало весь блок стилей (правило прототипа).
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Правила окраски полос проектного Гантта (SVAR): подмешивание в
 * переменные темы — фон разбавляется поверхностью темы (адаптация
 * к светлой/тёмной), заливка и рамка — полный цвет палитры.
 * SVAR выводит идентификатор задачи в data-task-id с префиксом «:»
 * (контракт 2.8.0, как в референсе прототипа) — prefix добавляется
 * в селектор, но не в проверку безопасности самого идентификатора.
 */
export function ganttBarColorRules(
  tasks: readonly { readonly id: string; readonly color?: string }[],
  prefix = '',
): string {
  return tasks
    .filter((task) => isTaskColor(task.color) && SAFE_ID.test(task.id))
    .map(
      (task) =>
        `[data-task-id="${prefix}${task.id}"]{--wx-gantt-task-color:color-mix(in oklch,${BY_ID.get(task.color!)!.hex} 45%,var(--surface));--wx-gantt-task-fill-color:${BY_ID.get(task.color!)!.hex};--wx-gantt-task-border-color:${BY_ID.get(task.color!)!.hex}}`,
    )
    .join('\n');
}

/** Инлайн-стиль элемента дорожки ресурсного вида для задачи с цветом. */
export function resourceTimelineColorStyle(
  colorId?: string,
): { readonly background: string; readonly borderColor: string } | undefined {
  const color = taskColor(colorId);
  return color === undefined
    ? undefined
    : {
        background: `color-mix(in oklch, ${color.hex} 45%, var(--surface))`,
        borderColor: color.hex,
      };
}
