import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import './plan-menu.css';

/**
 * Меню вторичных команд плана (PBT-089, референс GanttPrototype):
 * портал вне окна, fixed у кнопки с clamp к viewport, полная клавиатура
 * (стрелки/Home/End/Enter/Escape/Tab), закрытие кликом вне и при
 * resize/scroll, возврат фокуса на кнопку. Собственный компонент модуля
 * Гантта — без DropdownPanel платформы и общих сервисов.
 */
export interface PlanMenuItem {
  readonly label: string;
  readonly icon: ReactNode;
  readonly dataAttr: string;
  readonly onSelect: () => void;
}

const MENU_WIDTH = 232;
const MENU_HEIGHT_ESTIMATE = 176;
const VIEWPORT_MARGIN = 8;

export default function PlanMoreMenu({
  planTitle,
  items,
}: {
  readonly planTitle: string;
  readonly items: readonly PlanMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const select = useCallback(
    (index: number) => {
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
      items[index]?.onSelect();
    },
    [items],
  );

  const focusItem = useCallback((index: number) => {
    const count = itemRefs.current.length;
    if (count === 0) return;
    const next = ((index % count) + count) % count;
    setActiveIndex(next);
    itemRefs.current[next]?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        menuRef.current !== null &&
        !menuRef.current.contains(event.target as Node) &&
        triggerRef.current !== event.target
      ) {
        close(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    const onWindowChange = () => close(false);
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onWindowChange, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onWindowChange, true);
    };
  }, [open, close]);

  // Позиция: у кнопки, clamp к viewport, разворот вверх у нижнего края.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    );
    const below = rect.bottom + 6;
    const top =
      below + MENU_HEIGHT_ESTIMATE > window.innerHeight
        ? Math.max(VIEWPORT_MARGIN, rect.top - MENU_HEIGHT_ESTIMATE - 6)
        : below;
    setPosition({ left, top });
    setActiveIndex(0);
    itemRefs.current[0]?.focus({ preventScroll: true });
  }, [open]);

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(activeIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(items.length - 1);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="plan-gantt__button plan-gantt__button--icon"
        data-plan-menu
        aria-label="Меню плана"
        title="Меню плана"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Меню плана"
            data-plan-menu-panel
            className="plan-menu"
            style={position ?? undefined}
            onKeyDown={onMenuKeyDown}
          >
            <div className="plan-menu__title">{planTitle}</div>
            <div className="plan-menu__separator" aria-hidden="true" />
            {items.map((item, index) => (
              <button
                key={item.dataAttr}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                className={`plan-menu__item${index === activeIndex ? ' plan-menu__item--active' : ''}`}
                data-plan-menu-index={index}
                {...{ [item.dataAttr]: '' }}
                onClick={() => select(index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
