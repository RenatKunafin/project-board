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

  it('creates a recurring event with an inclusive end date', () => {
    const rendered = renderCalendar({ events: [], types: [], days: [] }, { settings: { calendarMonth: '2026-11' } });
    const day = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('воскресенье, 1 ноября'));
    act(() => day?.click());
    const dialog = rendered.rootElement.querySelector('[role="dialog"]') as HTMLElement;
    act(() => [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Добавить событие'))?.click());
    const editor = rendered.rootElement.querySelector('[aria-labelledby="calendar-event-title"]') as HTMLDialogElement;
    act(() => setInputValue(editor.querySelector('[aria-label="Название события"]') as HTMLInputElement, 'Еженедельная встреча'));
    act(() => {
      const repeat = editor.querySelector('[aria-label="Повторение"]') as HTMLSelectElement;
      repeat.value = 'weekly';
      repeat.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => setInputValue(editor.querySelector('[aria-label="Дата окончания повторения"]') as HTMLInputElement, '2026-11-29'));
    act(() => (editor.querySelector('form') as HTMLFormElement).requestSubmit());
    expect(rendered.service.update).toHaveBeenCalledWith('calendar-1', 1, expect.objectContaining({ events: [expect.objectContaining({ title: 'Еженедельная встреча', repeat: 'weekly', until: '2026-11-29' })] }));
    act(() => rendered.root.unmount());
  });

  it('shows a recurring event in the selected occurrence date and labels the series', () => {
    const rendered = renderCalendar({
      events: [{ id: 'series-1', title: 'Синхронизация', date: '2026-11-01', time: '', typeId: '', description: '', repeat: 'daily', until: '2026-11-03' }],
      types: [], days: [],
    }, { settings: { calendarMonth: '2026-11' } });
    const day = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('вторник, 3 ноября'));
    expect(day?.getAttribute('aria-label')).toContain('событий: 1');
    act(() => day?.click());
    expect(rendered.rootElement.textContent).toContain('Синхронизация');
    expect(rendered.rootElement.textContent).toContain('Каждый день');
    expect(rendered.rootElement.textContent).toContain('Весь день');
    act(() => rendered.root.unmount());
  });

  it('marks weekends independently from event markers and opens the non-working-day editor', () => {
    const rendered = renderCalendar({
      events: [{ id: 'event-1', title: 'Выходная встреча', date: '2026-11-01', time: '', typeId: '', description: '', repeat: 'none', until: '' }],
      types: [], days: [],
    }, { settings: { calendarMonth: '2026-11' } });
    const weekend = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('воскресенье, 1 ноября')) as HTMLButtonElement;
    expect(weekend.classList.contains('is-non-working')).toBe(true);
    expect(weekend.getAttribute('aria-label')).toContain('Нерабочий день');
    expect(weekend.querySelectorAll('.calendar-widget__dot')).toHaveLength(1);
    act(() => weekend.click());
    expect(rendered.rootElement.textContent).toMatch(/Сегодня|Через|Прошло/);
    expect(rendered.rootElement.textContent).toContain('Выходная встреча');
    act(() => rendered.root.unmount());
  });

  it('saves and cancels a manual non-working day without changing event data', () => {
    const rendered = renderCalendar({
      events: [{ id: 'event-1', title: 'Рабочая встреча', date: '2026-11-02', time: '', typeId: '', description: '', repeat: 'none', until: '' }],
      types: [], days: [],
    }, { settings: { calendarMonth: '2026-11' } });
    const day = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('понедельник, 2 ноября'));
    act(() => day?.click());
    const dayDialog = rendered.rootElement.querySelector('[aria-labelledby="calendar-day-title"]') as HTMLElement;
    act(() => [...dayDialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Нерабочий день'))?.click());
    const editor = rendered.rootElement.querySelector('[aria-labelledby="calendar-non-working-title"]') as HTMLDialogElement;
    act(() => setInputValue(editor.querySelector('[aria-label="Причина нерабочего дня"]') as HTMLInputElement, 'Корпоративный выходной'));
    act(() => (editor.querySelector('button.calendar-editor__secondary-button') as HTMLButtonElement | null)?.click());
    expect(rendered.service.update).not.toHaveBeenCalled();
    expect(rendered.rootElement.querySelector('[aria-labelledby="calendar-non-working-title"]')).toBeNull();

    act(() => day?.click());
    const reopenedDayDialog = rendered.rootElement.querySelector('[aria-labelledby="calendar-day-title"]') as HTMLElement;
    act(() => [...reopenedDayDialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Нерабочий день'))?.click());
    const savedEditor = rendered.rootElement.querySelector('[aria-labelledby="calendar-non-working-title"]') as HTMLDialogElement;
    act(() => setInputValue(savedEditor.querySelector('[aria-label="Причина нерабочего дня"]') as HTMLInputElement, 'Корпоративный выходной'));
    act(() => (savedEditor.querySelector('button.calendar-editor__primary-button') as HTMLButtonElement | null)?.click());
    expect(rendered.service.update).toHaveBeenCalledWith('calendar-1', 1, expect.objectContaining({
      events: [expect.objectContaining({ title: 'Рабочая встреча' })],
      days: [{ date: '2026-11-02', kind: 'off', name: 'Корпоративный выходной' }],
    }));
    act(() => rendered.root.unmount());
  });

  it('keeps a manual-day draft after a revision conflict', () => {
    const rendered = renderCalendar({ events: [], types: [], days: [] }, { settings: { calendarMonth: '2026-11' } });
    (rendered.service.update as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new DocumentConflictError('calendar-1', 2, 1); });
    const day = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('понедельник, 2 ноября'));
    act(() => day?.click());
    const dayDialog = rendered.rootElement.querySelector('[aria-labelledby="calendar-day-title"]') as HTMLElement;
    act(() => [...dayDialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Нерабочий день'))?.click());
    const editor = rendered.rootElement.querySelector('[aria-labelledby="calendar-non-working-title"]') as HTMLDialogElement;
    const reason = editor.querySelector('[aria-label="Причина нерабочего дня"]') as HTMLInputElement;
    act(() => setInputValue(reason, 'Черновик выходного'));
    act(() => (editor.querySelector('button.calendar-editor__primary-button') as HTMLButtonElement | null)?.click());
    expect(editor.textContent).toContain('Конфликт редакций');
    expect(reason.value).toBe('Черновик выходного');
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

  it('keeps a recurring event draft after a revision conflict', () => {
    const rendered = renderCalendar({
      events: [{ id: 'series-1', title: 'Серия', date: '2026-11-01', time: '', typeId: '', description: '', repeat: 'daily', until: '' }],
      types: [], days: [],
    }, { settings: { calendarMonth: '2026-11' } });
    (rendered.service.update as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new DocumentConflictError('calendar-1', 2, 1); });
    const day = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('понедельник, 2 ноября'));
    act(() => day?.click());
    const dayDialog = rendered.rootElement.querySelector('[aria-labelledby="calendar-day-title"]') as HTMLElement;
    act(() => (dayDialog.querySelector('[aria-label="Изменить событие Серия"]') as HTMLButtonElement).click());
    const editor = rendered.rootElement.querySelector('[aria-labelledby="calendar-event-title"]') as HTMLDialogElement;
    act(() => setInputValue(editor.querySelector('[aria-label="Название события"]') as HTMLInputElement, 'Локальный черновик'));
    act(() => (editor.querySelector('form') as HTMLFormElement).requestSubmit());
    expect(editor.textContent).toContain('Конфликт редакций');
    expect((editor.querySelector('[aria-label="Название события"]') as HTMLInputElement).value).toBe('Локальный черновик');
    expect(editor.textContent).toContain('Изменения и удаление применяются ко всей серии.');
    act(() => rendered.root.unmount());
  });

  it('edits the base record and deletes the whole series from an occurrence', () => {
    const content = {
      events: [{ id: 'series-1', title: 'Серия', date: '2026-11-01', time: '', typeId: '', description: '', repeat: 'daily' as const, until: '2026-11-03' }],
      types: [], days: [],
    };
    const rendered = renderCalendar(content, { settings: { calendarMonth: '2026-11' } });
    const occurrenceDay = [...rendered.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('понедельник, 2 ноября'));
    act(() => occurrenceDay?.click());
    const dayDialog = rendered.rootElement.querySelector('[aria-labelledby="calendar-day-title"]') as HTMLElement;
    act(() => (dayDialog.querySelector('[aria-label="Изменить событие Серия"]') as HTMLButtonElement).click());
    const editor = rendered.rootElement.querySelector('[aria-labelledby="calendar-event-title"]') as HTMLDialogElement;
    act(() => (editor.querySelector('.calendar-editor__checkbox input') as HTMLInputElement).click());
    act(() => setInputValue(editor.querySelector('[aria-label="Время события"]') as HTMLInputElement, '10:15'));
    act(() => (editor.querySelector('form') as HTMLFormElement).requestSubmit());
    expect(rendered.service.update).toHaveBeenCalledWith('calendar-1', 1, expect.objectContaining({ events: [expect.objectContaining({ date: '2026-11-01', time: '10:15', repeat: 'daily' })] }));
    act(() => rendered.root.unmount());

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deletion = renderCalendar(content, { settings: { calendarMonth: '2026-11' } });
    const deletionDay = [...deletion.rootElement.querySelectorAll<HTMLButtonElement>('.calendar-widget__day')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('понедельник, 2 ноября'));
    act(() => deletionDay?.click());
    const deletionDialog = deletion.rootElement.querySelector('[aria-labelledby="calendar-day-title"]') as HTMLElement;
    act(() => (deletionDialog.querySelector('[aria-label="Изменить событие Серия"]') as HTMLButtonElement).click());
    const deletionEditor = deletion.rootElement.querySelector('[aria-labelledby="calendar-event-title"]') as HTMLDialogElement;
    act(() => deletionEditor.querySelector('button.calendar-editor__danger')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(deletion.service.update).toHaveBeenCalledWith('calendar-1', 1, expect.objectContaining({ events: [] }));
    confirm.mockRestore();
    act(() => deletion.root.unmount());
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
