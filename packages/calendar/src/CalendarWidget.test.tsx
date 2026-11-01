// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentService, WidgetProps } from '@project-board/widget-sdk';
import { DocumentConflictError } from '@project-board/widget-sdk';
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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

  it('creates an event from the selected-day dialog and keeps cancellation local', () => {
    const rendered = renderCalendar({ events: [], types: [], days: [] }, { settings: { calendarMonth: '2026-11' } });
    const day = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('воскресенье, 1 ноября'));
    act(() => day?.click());
    const dialog = rendered.rootElement.querySelector('[role="dialog"]') as HTMLElement;
    const add = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Добавить событие')) as HTMLButtonElement;
    act(() => add.click());
    const editor = rendered.rootElement.querySelector('[aria-labelledby="calendar-event-title"]') as HTMLDialogElement;
    const title = editor.querySelector('[aria-label="Название события"]') as HTMLInputElement;
    act(() => setInputValue(title, 'Планёрка'));
    act(() => (editor.querySelector('form') as HTMLFormElement).requestSubmit());
    expect(rendered.service.update).toHaveBeenCalledWith('calendar-1', 1, expect.objectContaining({ events: [expect.objectContaining({ title: 'Планёрка', repeat: 'none' })] }));
    act(() => rendered.root.unmount());
  });

  it('edits type drafts and keeps them out of the document until save', () => {
    const rendered = renderCalendar({ events: [], types: [], days: [] });
    act(() => [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__today-button')].at(-1)?.click());
    const dialog = rendered.rootElement.querySelector('[aria-labelledby="calendar-types-title"]') as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    const add = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Добавить тип')) as HTMLButtonElement;
    act(() => add.click());
    expect(rendered.service.update).not.toHaveBeenCalled();
    const input = dialog.querySelector('[aria-label="Название типа"]') as HTMLInputElement;
    act(() => setInputValue(input, 'Работа'));
    act(() => [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Сохранить')?.click());
    expect(rendered.service.update).toHaveBeenCalledWith('calendar-1', 1, expect.objectContaining({ types: [expect.objectContaining({ name: 'Работа' })] }));
    act(() => rendered.root.unmount());
  });

  it('shows a revision conflict without clearing the event draft', () => {
    const rendered = renderCalendar({ events: [], types: [], days: [] });
    (rendered.service.update as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new DocumentConflictError('calendar-1', 2, 1); });
    act(() => [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__today-button')].at(-1)?.click());
    const typeDialog = rendered.rootElement.querySelector('[aria-labelledby="calendar-types-title"]') as HTMLDialogElement;
    const add = [...typeDialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Добавить тип')) as HTMLButtonElement;
    act(() => add.click());
    const input = typeDialog.querySelector('[aria-label="Название типа"]') as HTMLInputElement;
    act(() => setInputValue(input, 'Черновик'));
    act(() => [...typeDialog.querySelectorAll('button')].find((button) => button.textContent === 'Сохранить')?.click());
    expect(typeDialog.textContent).toContain('Конфликт редакций');
    expect((typeDialog.querySelector('[aria-label="Название типа"]') as HTMLInputElement).value).toBe('Черновик');
    act(() => rendered.root.unmount());
  });

  it('removes a used type only after confirmation and leaves its event untyped', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const rendered = renderCalendar({
      events: [{ id: 'event-1', title: 'Встреча', date: '2026-11-01', time: '', typeId: 'type-1', description: '', repeat: 'none', until: '' }],
      types: [{ id: 'type-1', name: 'Работа', color: 'green' }], days: [],
    });
    act(() => [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__today-button')].at(-1)?.click());
    const dialog = rendered.rootElement.querySelector('[aria-labelledby="calendar-types-title"]') as HTMLDialogElement;
    act(() => dialog.querySelector('[aria-label="Удалить тип Работа"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Сохранить')?.click());
    expect(rendered.service.update).toHaveBeenCalledWith('calendar-1', 1, expect.objectContaining({ types: [], events: [expect.objectContaining({ typeId: '' })] }));
    confirm.mockRestore();
    act(() => rendered.root.unmount());
  });

  it('offers event actions from the maximized day panel', () => {
    const rendered = renderCalendar({
      events: [{ id: 'event-1', title: 'Встреча', date: '2026-11-01', time: '', typeId: '', description: '', repeat: 'none', until: '' }],
      types: [], days: [],
    }, { maximized: true, settings: { calendarMonth: '2026-11' } });
    rendered.resize({ width: 900, height: 700 });
    const day = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('воскресенье, 1 ноября'));
    act(() => day?.click());
    const panel = rendered.rootElement.querySelector('.calendar-widget__day-panel') as HTMLElement;
    expect(panel.textContent).toContain('Встреча');
    act(() => (panel.querySelector('button[aria-label="Изменить событие Встреча"]') as HTMLButtonElement | null)?.click());
    expect(rendered.rootElement.querySelector('[aria-labelledby="calendar-event-title"]')).not.toBeNull();
    act(() => rendered.root.unmount());
  });

  it('shows three event markers and overflow for a busy day', () => {
    const events = Array.from({ length: 4 }, (_, index) => ({ id: `event-${index}`, title: `Событие ${index}`, date: '2026-11-01', time: `${String(9 + index).padStart(2, '0')}:00`, typeId: '', description: '', repeat: 'none' as const, until: '' }));
    const rendered = renderCalendar({ events, types: [], days: [] }, { settings: { calendarMonth: '2026-11' } });
    const day = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('воскресенье, 1 ноября')) as HTMLButtonElement;
    expect(day.querySelectorAll('.calendar-widget__dot')).toHaveLength(3);
    expect(day.querySelector('.calendar-widget__overflow')?.textContent).toBe('+1');
    act(() => rendered.root.unmount());
  });
});
