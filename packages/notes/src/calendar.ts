import { nextMidnight } from './organization';

/** Visible widgets subscribe; hidden pages stop the timer until shown again. */
export function watchLocalDay(onChange: (now: number) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    if (document.hidden) return;
    const now = Date.now();
    onChange(now);
    timer = setTimeout(refresh, nextMidnight(now) - now + 20);
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  refresh();
  return () => {
    clearTimeout(timer);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}
