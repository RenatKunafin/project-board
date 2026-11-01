// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentService, WidgetProps } from '@project-board/widget-sdk';
import { CalendarWidget } from './CalendarWidget';
import { createCalendarModule } from './index';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function managed(content: unknown) {
  return {
    id: 'calendar-1', moduleId: 'calendar', documentType: 'calendar', title: 'Личный календарь', schemaVersion: 1,
    revision: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', content,
  };
}

function renderCalendar(content: unknown, overrides: Partial<WidgetProps> = {}) {
  let resizeListener: ((size: { width: number; height: number }) => void) | undefined;
  const updateSettings = vi.fn();
  const service = {
    get: vi.fn(() => managed(content)),
    subscribe: vi.fn((_id: string, handler: (document: ReturnType<typeof managed>) => void) => { service.handler = handler; return () => undefined; }),
    update: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    getViewSettings: vi.fn(),
    setViewSettings: vi.fn(),
    handler: undefined as ((document: ReturnType<typeof managed>) => void) | undefined,
  } as unknown as DocumentService & { handler?: (document: ReturnType<typeof managed>) => void };
  const rootElement = document.createElement('div');
  document.body.append(rootElement);
  const root: Root = createRoot(rootElement);
  const props: WidgetProps = {
    widgetInstanceId: 'calendar-window', settings: {}, visible: true, maximized: false,
    documentId: 'calendar-1', documentService: service,
    updateSettings, onResize: (listener) => { resizeListener = listener; return () => undefined; },
    ...overrides,
  };
  act(() => root.render(<CalendarWidget {...props} />));
  return { root, rootElement, service, updateSettings, resize: (size: { width: number; height: number }) => act(() => resizeListener?.(size)) };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CalendarWidget', () => {
  it('registers a document-backed calendar type', () => {
    const type = createCalendarModule().widgetTypes[0];
    expect(type.id).toBe('calendar');
    expect(type.title).toBe('Календарь');
    expect(type.documentSupport).toMatchObject({ moduleId: 'calendar', documentType: 'calendar', schemaVersion: 1 });
    expect(type.documentSupport?.createContent()).toEqual({ events: [], types: [], days: [] });
  });

  it('switches from month to compact mode using content size', () => {
    const rendered = renderCalendar({ events: [], types: [], days: [] });
    expect(rendered.rootElement.querySelector('[data-calendar-mode="month"]')).not.toBeNull();
    rendered.resize({ width: 280, height: 320 });
    expect(rendered.rootElement.querySelector('[data-calendar-mode="small"]')).not.toBeNull();
    expect(rendered.rootElement.querySelector('[aria-label="Открыть сегодняшний день"]')).not.toBeNull();
    act(() => rendered.root.unmount());
  });

  it('uses year mode only for an explicitly maximized window', () => {
    const rendered = renderCalendar({ events: [], types: [], days: [] }, { maximized: true });
    rendered.resize({ width: 200, height: 200 });
    expect(rendered.rootElement.querySelector('[data-calendar-mode="year"]')).not.toBeNull();
    expect(rendered.rootElement.querySelectorAll('.calendar-month')).toHaveLength(12);
    act(() => rendered.root.unmount());
  });

  it('opens selected-day details without writing the document', () => {
    const rendered = renderCalendar({
      events: [{ id: 'event-1', title: 'Демо', date: '2026-11-01', time: '', typeId: '', description: '', repeat: 'none', until: '' }],
      types: [], days: [],
    }, { settings: { calendarMonth: '2026-11' } });
    const day = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('воскресенье, 1 ноября'));
    expect(day).toBeDefined();
    act(() => day?.click());
    expect(rendered.rootElement.querySelector('[role="dialog"]')).not.toBeNull();
    expect(rendered.rootElement.textContent).toContain('Демо');
    expect(rendered.service.update).not.toHaveBeenCalled();
    act(() => rendered.root.unmount());
  });
});
