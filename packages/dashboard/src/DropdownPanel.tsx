import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react';

export interface DropdownPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Кнопка-якорь: клик по ней не закрывает панель (переключает сама кнопка). */
  readonly anchorRef?: RefObject<HTMLElement | null>;
  readonly ariaLabel: string;
  readonly children: ReactNode;
}

const VIEWPORT_MARGIN = 8;

export interface DropdownPosition {
  readonly left: number;
  readonly top: number;
}

/**
 * Позиция панели у якоря с clamp к viewport (PBT-090): выравнивание
 * по правому краю кнопки, ограничение краёв экрана и разворот вверх,
 * когда внизу не хватает высоты. Чистая функция — покрывается unit.
 */
export function dropdownPanelPosition(
  anchor: { readonly left: number; readonly right: number; readonly bottom: number; readonly top: number },
  viewport: { readonly width: number; readonly height: number },
  panel: { readonly width: number; readonly height: number },
): DropdownPosition {
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchor.right - panel.width, viewport.width - panel.width - VIEWPORT_MARGIN),
  );
  const below = anchor.bottom + 6;
  const top =
    below + panel.height + VIEWPORT_MARGIN > viewport.height
      ? Math.max(VIEWPORT_MARGIN, anchor.top - panel.height - 6)
      : below;
  return { left, top };
}

/**
 * Панель под кнопкой в шапке: закрытие по клику вне и Escape (макет 04),
 * размещение у якоря с clamp к viewport и фокус-менеджмент (PBT-090):
 * при открытии фокус — первому полю панели, при закрытии — кнопке-якорю.
 */
export function DropdownPanel({
  open,
  onClose,
  anchorRef,
  ariaLabel,
  children,
}: DropdownPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const returnFocus = (): void => {
      // Панель размонтируется после onClose: фокус возвращаем в следующем
      // кадре, иначе браузер сбросит его на body вместе с активным элементом.
      requestAnimationFrame(() => anchorRef?.current?.focus({ preventScroll: true }));
    };
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      const insidePanel =
        rootRef.current !== null && rootRef.current.contains(target);
      const insideAnchor =
        anchorRef?.current !== null && anchorRef?.current !== undefined
          ? anchorRef.current.contains(target)
          : false;
      if (!insidePanel && !insideAnchor) {
        returnFocus();
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        returnFocus();
        onClose();
      }
    };
    const onWindowChange = (): void => onClose();
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onWindowChange);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onWindowChange);
    };
  }, [open, onClose, anchorRef]);

  // Позиция и фокус: панель монтируется скрытой, замеряется, затем
  // позиционируется и раскрывается; фокус — первому полю панели.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const panel = rootRef.current;
    const anchor = anchorRef?.current ?? null;
    if (panel === null || anchor === null) {
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    setPosition(
      dropdownPanelPosition(
        anchorRect,
        { width: window.innerWidth, height: window.innerHeight },
        panelRect,
      ),
    );
  }, [open, anchorRef]);

  // Фокус — после позиционирования (скрытая панель не принимает фокус).
  useLayoutEffect(() => {
    if (!open || position === null) {
      return;
    }
    const focusable = rootRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button',
    );
    focusable?.focus({ preventScroll: true });
  }, [open, position]);

  if (!open) {
    return null;
  }
  return (
    <div
      ref={rootRef}
      className="dropdown-panel"
      role="dialog"
      aria-label={ariaLabel}
      data-dropdown-panel
      style={
        position === null
          ? { visibility: 'hidden' }
          : { position: 'fixed', left: `${position.left}px`, top: `${position.top}px` }
      }
    >
      {children}
    </div>
  );
}
