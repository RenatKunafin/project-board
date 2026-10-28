import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Очередь принадлежит модулю, без регистрации в платформе. Все запросы
// остаются смонтированы; показывается только первый модальный диалог.
const queue: string[] = [];
const listeners = new Set<() => void>();
let restoreFocus: HTMLElement | null = null;
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const first = () => queue[0];

export function NotesDialog({ title, children, onCancel }: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onCancel?: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useSyncExternalStore(subscribe, first) === id;
  useLayoutEffect(() => {
    if (!queue.length) restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queue.push(id);
    notify();
    return () => {
      queue.splice(queue.indexOf(id), 1);
      dialog.current?.close();
      notify();
      if (!queue.length) {
        if (restoreFocus?.isConnected) restoreFocus.focus();
        restoreFocus = null;
      }
    };
  }, [id]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!active || !element) return;
    if (!element.open) element.showModal();
    if (!element.contains(document.activeElement)) element.querySelector<HTMLElement>('input, textarea, button')?.focus();
  }, [active, title]);
  return createPortal(<dialog ref={dialog} className="notes-dialog" aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); onCancel?.(); }}
    onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }}>
    <h2 id={`${id}-title`}>{title}</h2>
    {children}
  </dialog>, document.body);
}
