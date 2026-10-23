import { CalendarRange, FileText, ListTodo, Puzzle, Users, type LucideIcon } from 'lucide-react';

// Ключи графики, а не предметные ID типов: платформа не знает модулей.
const ICONS: ReadonlyMap<string, LucideIcon> = new Map([
  ['lucide:calendar-range', CalendarRange],
  ['lucide:users', Users],
  ['lucide:list-todo', ListTodo],
]);

export interface WidgetIconProps {
  readonly icon?: string;
  readonly fallback?: 'widget' | 'document';
}

/** Иконка из метаданных SDK; прежние текстовые символы остаются совместимы. */
export function WidgetIcon({ icon, fallback = 'widget' }: WidgetIconProps) {
  const Icon = icon ? ICONS.get(icon) : undefined;
  if (!Icon && icon && !icon.startsWith('lucide:')) {
    return <span className="widget-type-icon" aria-hidden="true">{icon}</span>;
  }
  const Graphic = Icon ?? (fallback === 'document' ? FileText : Puzzle);
  return <Graphic className="widget-type-icon" size={16} aria-hidden="true" focusable="false" />;
}
