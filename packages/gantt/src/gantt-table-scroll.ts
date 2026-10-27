interface TableState {
  readonly rows: readonly { readonly id: string | number }[];
  readonly height: number;
}

const OFFSET = '--plan-gantt-body-offset';

/** Согласует фактический набор DOM-строк с нативным scroll, без ожидания React effect SVAR. */
export function syncGanttTableScroll(root: HTMLElement, readState: () => TableState | null): () => void {
  let styledBody: HTMLElement | null = null;
  const clear = () => {
    styledBody?.style.removeProperty(OFFSET);
    styledBody = null;
  };
  const sync = () => {
    const scroller = root.querySelector<HTMLElement>('.wx-gantt');
    const body = root.querySelector<HTMLElement>('.wx-table .wx-body');
    const first = body?.querySelector<HTMLElement>('.wx-row[data-id]:not(.wx-reorder-task)');
    const state = readState();
    const rawId = first?.dataset.id;
    const id = rawId?.startsWith(':') ? rawId.slice(1) : rawId;
    if (!scroller || !body || !id || !state || !(state.height > 0)) {
      clear();
      return;
    }
    // Набор в DOM может ещё относиться к предыдущей виртуальной области.
    // Индекс берём по фактической первой строке, не по запланированному area.start.
    const index = state.rows.findIndex(row => String(row.id) === id);
    if (index < 0) {
      clear();
      return;
    }
    if (styledBody !== body) {
      clear();
      styledBody = body;
    }
    const offset = `${index * state.height - scroller.scrollTop}px`;
    if (body.style.getPropertyValue(OFFSET) !== offset) body.style.setProperty(OFFSET, offset);
  };
  const onScroll = (event: Event) => {
    if (event.target instanceof HTMLElement && event.target.classList.contains('wx-gantt')) sync();
  };
  root.addEventListener('scroll', onScroll, { capture: true, passive: true });
  const observer = new MutationObserver(sync);
  // Style не наблюдаем: собственное согласование не порождает новый цикл.
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-id'] });
  sync();
  return () => {
    observer.disconnect();
    root.removeEventListener('scroll', onScroll, true);
    clear();
  };
}
