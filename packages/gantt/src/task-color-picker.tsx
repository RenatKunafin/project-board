import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { TASK_COLORS } from './task-colors';
import './task-color-picker.css';

/**
 * Ряд выбора цвета задачи (PBT-084, прототип TaskColorPicker.tsx):
 * «Авто» + десять кружков палитры; тот же набор используется формой
 * задачи и меню быстрой смены, поэтому варианты всегда совпадают
 * со значениями, которые принимает формат плана.
 */
export function TaskColorSwatches({ value, onPick, label = 'Цвет задачи' }: {
  readonly value: string | undefined;
  readonly onPick: (color: string | undefined) => void;
  readonly label?: string;
}) {
  return (
    <div className="task-colors" role="group" aria-label={label}>
      <button
        type="button"
        aria-pressed={value === undefined}
        title="Цвет из темы"
        className={`task-colors__auto${value === undefined ? ' task-colors__auto--active' : ''}`}
        onClick={() => onPick(undefined)}
      >
        <i className="task-colors__auto-dot" />
        Авто
      </button>
      {TASK_COLORS.map((color) => {
        const active = value === color.id;
        return (
          <button
            key={color.id}
            type="button"
            aria-pressed={active}
            title={color.label}
            aria-label={color.label}
            data-task-color={color.id}
            className={`task-colors__swatch${active ? ' task-colors__swatch--active' : ''}`}
            style={{ background: color.hex }}
            onClick={() => onPick(color.id)}
          >
            {active && <Check aria-hidden className="task-colors__check" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

export interface TaskColorMenuState {
  readonly x: number;
  readonly y: number;
  readonly taskId: string;
}

/**
 * Портальное меню быстрой смены цвета (правый клик на полосе):
 * вне окна поверх остальных слоёв, закрытие Escape и кликом вне,
 * координаты ограничены viewport (по прототипу).
 */
export function TaskColorMenu({ state, value, onPick, onClose }: {
  readonly state: TaskColorMenuState;
  readonly value: string | undefined;
  readonly onPick: (color: string | undefined) => void;
  readonly onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const left = Math.max(8, Math.min(state.x, window.innerWidth - 268));
  const top = Math.max(8, Math.min(state.y, window.innerHeight - 96));
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Быстрая смена цвета"
      data-task-color-menu
      className="task-color-menu"
      style={{ left, top }}
    >
      <div className="task-color-menu__caption">Цвет задачи</div>
      <TaskColorSwatches value={value} onPick={onPick} label="Быстрая смена цвета" />
    </div>,
    document.body,
  );
}
