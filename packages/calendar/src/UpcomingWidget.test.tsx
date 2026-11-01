// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentService, WidgetProps } from '@project-board/widget-sdk';
import { UpcomingWidget } from './UpcomingWidget';
import { createCalendarModule } from './index';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function managed(content: unknown) {
  return { id: 'calendar-1', moduleId: 'calendar', documentType: 'calendar', title: 'Личный календарь', schemaVersion: 1, revision: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', content };
}

function renderUpcoming(content: unknown, settings: Record<string, unknown> = {}) {
  const updateSettings = vi.fn();
  const service = {
    get: vi.fn(() => managed(content)),
    subscribe: vi.fn((_id: string, handler: (document: ReturnType<typeof managed>) => void) => { service.handler = handler; return () => undefined; }),
    update: vi.fn(), create: vi.fn(), rename: vi.fn(), delete: vi.fn(), getViewSettings: vi.fn(), setViewSettings: vi.fn(),
    handler: undefined as ((document: ReturnType<typeof managed>) => void) | undefined,
  } as unknown as DocumentService & { handler?: (document: ReturnType<typeof managed>) => void };
  const rootElement = document.createElement('div');
  document.body.append(rootElement);
  const root: Root = createRoot(rootElement);
  const props: WidgetProps = { widgetInstanceId: 'upcoming-window', settings, visible: true, maximized: false, documentId: 'calendar-1', documentService: service, updateSettings };
  act(() => root.render(<UpcomingWidget {...props} />));
  return { root, rootElement, service, updateSettings };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 1, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('UpcomingWidget', () => {
  it('registers a second type with the same calendar document support', () => {
    const types = createCalendarModule().widgetTypes;
    expect(types.map((type) => type.id)).toEqual(['calendar', 'upcoming-events']);
    expect(types[1]).toMatchObject({ title: 'Ближайшие события', description: 'Список ближайших событий календаря' });
    expect(types[1].documentSupport).toEqual(types[0].documentSupport);
  });

  it('groups upcoming events, exposes the type filter and keeps document untouched', () => {
    const rendered = renderUpcoming({
      events: [
        { id: 'later', title: 'Встреча', date: '2026-11-02', time: '11:00', typeId: 'work', description: '', repeat: 'none', until: '' },
        { id: 'series', title: 'Серия', date: '2026-11-03', time: '', typeId: 'home', description: '', repeat: 'daily', until: '2026-11-04' },
      ],
      types: [{ id: 'work', name: 'Работа', color: 'green' }, { id: 'home', name: 'Дом', color: 'blue' }], days: [],
    });
    expect(rendered.rootElement.textContent).toContain('Встреча');
    expect(rendered.rootElement.textContent).toContain('понедельник, 2 ноября');
    expect(rendered.rootElement.textContent).toContain('Ближайшие 12 месяцев');
    expect(rendered.rootElement.querySelector('[aria-label="Фильтр типа события"]')).not.toBeNull();
    act(() => (rendered.rootElement.querySelector('[aria-label="Фильтр типа события"]') as HTMLSelectElement).value = 'work');
    act(() => rendered.rootElement.querySelector('[aria-label="Фильтр типа события"]')?.dispatchEvent(new Event('change', { bubbles: true })));
    expect(rendered.updateSettings).toHaveBeenCalledWith({ typeFilter: 'work' });
    expect(rendered.service.update).not.toHaveBeenCalled();
    act(() => rendered.root.unmount());
  });

  it('opens the shared event editor from an accessible row and saves the source event', () => {
    const rendered = renderUpcoming({ events: [{ id: 'event-1', title: 'Встреча', date: '2026-11-02', time: '', typeId: '', description: '', repeat: 'none', until: '' }], types: [], days: [] });
    const row = rendered.rootElement.querySelector('button.calendar-upcoming__event') as HTMLButtonElement;
    expect(row.getAttribute('aria-label')).toContain('Встреча');
    act(() => row.click());
    const editor = rendered.rootElement.querySelector('[aria-labelledby="calendar-event-title"]') as HTMLDialogElement;
    const title = editor.querySelector('[aria-label="Название события"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => { setter?.call(title, 'Изменённая встреча'); title.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => (editor.querySelector('form') as HTMLFormElement).requestSubmit());
    expect(rendered.service.update).toHaveBeenCalledWith('calendar-1', 1, expect.objectContaining({ events: [expect.objectContaining({ title: 'Изменённая встреча' })] }));
    act(() => rendered.root.unmount());
  });

  it('shows a separate unavailable-document state', () => {
    const rendered = renderUpcoming({ events: [], types: [], days: [] });
    (rendered.service.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    act(() => rendered.service.handler?.(undefined as never));
    expect(rendered.rootElement.textContent).toContain('Документ календаря недоступен');
    act(() => rendered.root.unmount());
  });
});
