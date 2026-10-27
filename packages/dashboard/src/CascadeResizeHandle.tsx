import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { WidgetSizeConstraints } from '@project-board/widget-sdk';
import { cascadeSizeBounds, cascadeSnapRange, snapCascadeArea, type CascadeArea } from './cascade-layout';

interface Props {
  readonly viewport: RefObject<HTMLDivElement>;
  readonly area: CascadeArea;
  readonly constraints: WidgetSizeConstraints;
  readonly onPreview: (area: CascadeArea | null) => void;
  readonly onCommit: (area: CascadeArea) => void;
}

interface ResizeSession {
  readonly pointerId: number;
  readonly start: CascadeArea;
  readonly startX: number;
  readonly startY: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly constraints: WidgetSizeConstraints;
  clientX: number;
  clientY: number;
  area: CascadeArea;
  time: number;
}

/** Уголок каскада: размер в координатах канваса, включая его прокрутку. */
export function CascadeResizeHandle({ viewport, area, constraints, onPreview, onCommit }: Props) {
  const session = useRef<ResizeSession | null>(null);
  const frame = useRef<number | null>(null);
  const callbacks = useRef({ onPreview, onCommit });
  useLayoutEffect(() => { callbacks.current = { onPreview, onCommit }; });

  const finish = useCallback((commit: boolean) => {
    const current = session.current;
    session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (!current) return;
    callbacks.current.onPreview(null);
    if (commit) callbacks.current.onCommit(current.area);
  }, []);
  useEffect(() => () => finish(false), [finish]);
  useEffect(() => {
    const cancel = () => finish(false);
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [finish]);

  const update = useCallback(() => {
    const current = session.current;
    const element = viewport.current;
    if (!current || !element) return;
    const next = snapCascadeArea({
      ...current.start,
      width: current.start.width + current.clientX - current.startX + element.scrollLeft - current.scrollLeft,
      height: current.start.height + current.clientY - current.startY + element.scrollTop - current.scrollTop,
    }, null, current.constraints);
    if (next.width !== current.area.width || next.height !== current.area.height) {
      current.area = next;
      callbacks.current.onPreview(next);
    }
  }, [viewport]);

  const tick = useCallback((time: number) => {
    const current = session.current;
    const element = viewport.current;
    // Keep-mounted вкладка может стать скрытой посреди жеста.
    if (!current || !element || element.clientHeight === 0) {
      finish(false);
      return;
    }
    const elapsed = Math.min(48, time - current.time);
    current.time = time;
    const rect = element.getBoundingClientRect();
    const depth = current.clientY > rect.bottom - 40
      ? current.clientY - (rect.bottom - 40)
      : current.clientY < rect.top + 40 ? current.clientY - (rect.top + 40) : 0;
    const bounds = cascadeSizeBounds(current.constraints);
    const range = cascadeSnapRange(bounds.minHeight, Number(bounds.maxHeight ?? Infinity));
    if (depth !== 0 && (depth > 0 ? current.area.height < range.max : current.area.height > range.min)) {
      const speed = Math.sign(depth) * Math.min(600, 180 + Math.abs(depth) * 7.2);
      element.scrollTop += speed * elapsed / 1000;
    }
    update();
    frame.current = requestAnimationFrame(tick);
  }, [finish, update, viewport]);

  return <div
    className="cascade-resize cascade-resize-se"
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary || !viewport.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      session.current = {
        pointerId: event.pointerId, start: area, startX: event.clientX, startY: event.clientY,
        scrollLeft: viewport.current.scrollLeft, scrollTop: viewport.current.scrollTop,
        constraints, clientX: event.clientX, clientY: event.clientY, area, time: performance.now(),
      };
      callbacks.current.onPreview(area);
      frame.current = requestAnimationFrame(tick);
    }}
    onPointerMove={event => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.clientX = event.clientX;
      current.clientY = event.clientY;
      update();
    }}
    onPointerUp={event => {
      if (event.pointerId === session.current?.pointerId) {
        update();
        finish(true);
      }
    }}
    onPointerCancel={() => finish(false)}
    onLostPointerCapture={() => finish(false)}
  />;
}
