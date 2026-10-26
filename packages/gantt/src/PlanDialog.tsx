import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './plan-dialog.css';

/** Внутренняя принадлежность формы экземпляру и документу, без API платформы. */
export interface PlanDialogOwner {
  readonly id: string;
  readonly title: string;
  readonly visible: boolean;
}

interface PlanDialogProps {
  readonly owner: PlanDialogOwner;
  readonly title: string;
  readonly description: string;
  readonly closeLabel: string;
  readonly className: string;
  readonly wide?: boolean;
  readonly onClose: () => void;
  readonly onBeforeClose?: () => boolean;
  readonly children: ReactNode;
}

/** Нативный верхний слой оставляет содержимое в дереве/границе ошибки виджета. */
export default function PlanDialog({
  owner, title, description, closeLabel, className, wide = false, onClose, onBeforeClose, children,
}: PlanDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openedFor = useRef(owner.id);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pausedFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (openedFor.current !== owner.id) {
      closeRef.current();
      return;
    }
    if (owner.visible) {
      if (!dialog.open) dialog.showModal();
      if (pausedFocus.current?.isConnected) pausedFocus.current.focus();
      pausedFocus.current = null;
    }
    return () => {
      // Cleanup скрытого владельца не должен стирать фокус, сохранённый при hide.
      if (!dialog.open) return;
      const active = document.activeElement;
      pausedFocus.current = active instanceof HTMLElement && dialog.contains(active) ? active : null;
      dialog.close();
    };
  }, [owner.id, owner.visible]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Scroll-lock локален диалогу: не меняем body или геометрию диаграмм.
    const canScroll = (target: EventTarget | null, dx: number, dy: number) => {
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const delta = horizontal ? dx : dy;
      let element = target instanceof Element ? target : null;
      while (element && element !== dialog) {
        const style = getComputedStyle(element);
        const overflow = horizontal ? style.overflowX : style.overflowY;
        const position = horizontal ? element.scrollLeft : element.scrollTop;
        const extent = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
        if (/(auto|scroll)/.test(overflow) && (delta < 0 ? position > 0 : position < extent - 1)) return true;
        element = element.parentElement;
      }
      return false;
    };
    const wheel = (event: WheelEvent) => {
      if (!canScroll(event.target, event.deltaX || (event.shiftKey ? event.deltaY : 0), event.shiftKey ? 0 : event.deltaY)) event.preventDefault();
      event.stopPropagation();
    };
    let touch: { x: number; y: number } | undefined;
    const touchStart = (event: TouchEvent) => {
      touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : undefined;
    };
    const touchMove = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) return;
      const next = event.touches[0];
      if (!canScroll(event.target, touch.x - next.clientX, touch.y - next.clientY)) event.preventDefault();
      touch = { x: next.clientX, y: next.clientY };
      event.stopPropagation();
    };
    dialog.addEventListener('wheel', wheel, { passive: false });
    dialog.addEventListener('touchstart', touchStart, { passive: true });
    dialog.addEventListener('touchmove', touchMove, { passive: false });
    return () => {
      dialog.removeEventListener('wheel', wheel);
      dialog.removeEventListener('touchstart', touchStart);
      dialog.removeEventListener('touchmove', touchMove);
    };
  }, []);

  const requestClose = () => {
    if (onBeforeClose && !onBeforeClose()) return;
    dialogRef.current?.close();
    closeRef.current();
  };

  return (
    <dialog
      ref={dialogRef}
      className={`plan-dialog ${wide ? 'plan-dialog--wide' : ''} ${className}`}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClickCapture={(event) => {
        // WebKit не всегда фокусирует кнопку при клике мышью.
        if (event.target instanceof Element) event.target.closest('button')?.focus({ preventScroll: true });
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.defaultPrevented) return;
        const dialog = event.currentTarget;
        const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
          .filter(element => element.tabIndex >= 0 && !element.matches(':disabled')
            && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
            && element.closest('dialog[open]') === dialog);
        const first = controls[0];
        const last = controls[controls.length - 1];
        const active = document.activeElement;
        if (event.shiftKey ? active === first : active === last) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus({ preventScroll: true });
        }
      }}
    >
      <header className="plan-dialog__head">
        <div>
          <h3 id={titleId} className="plan-dialog__title">{title}</h3>
          <p className="plan-dialog__plan" title={owner.title}>{owner.title}</p>
          <p id={descriptionId} className="plan-dialog__description">{description}</p>
        </div>
        <button type="button" className="plan-dialog__close" aria-label={closeLabel} onClick={requestClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
