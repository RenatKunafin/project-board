import { useEffect, useRef, type RefObject, type ReactNode } from 'react';

export interface DropdownPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Кнопка-якорь: клик по ней не закрывает панель (переключает сама кнопка). */
  readonly anchorRef?: RefObject<HTMLElement | null>;
  readonly ariaLabel: string;
  readonly children: ReactNode;
}

/** Панель под кнопкой в шапке: закрытие по клику вне и Escape (макет 04). */
export function DropdownPanel({
  open,
  onClose,
  anchorRef,
  ariaLabel,
  children,
}: DropdownPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      const insidePanel =
        rootRef.current !== null && rootRef.current.contains(target);
      const insideAnchor =
        anchorRef?.current !== null && anchorRef?.current !== undefined
          ? anchorRef.current.contains(target)
          : false;
      if (!insidePanel && !insideAnchor) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) {
    return null;
  }
  return (
    <div ref={rootRef} className="dropdown-panel" role="dialog" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
