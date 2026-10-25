// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import { WidgetWindow } from './WidgetWindow';

let container: HTMLDivElement;
let root: Root;

function render(ui: React.ReactNode): void {
  act(() => {
    root.render(ui);
  });
}

function text(): string {
  return container.textContent ?? '';
}

function button(label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent === label,
  );
  if (!element) {
    throw new Error(`Кнопка не найдена: ${label}`);
  }
  return element;
}

function click(label: string): void {
  act(() => {
    button(label).click();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function Thrower({ fails }: { fails: boolean }): null {
  if (fails) {
    throw new Error('взрыв отрисовки');
  }
  return null;
}

describe('WidgetErrorBoundary — изоляция ошибки рендера (PBT-027)', () => {
  it('падающее содержимое показывает состояние ошибки с сообщением', () => {
    render(
      <WidgetErrorBoundary>
        <Thrower fails />
      </WidgetErrorBoundary>,
    );
    expect(text()).toContain('Не удалось отобразить содержимое');
    expect(text()).toContain('взрыв отрисовки');
    expect(button('Повторить')).toBeTruthy();
  });

  it('«Повторить» перемонтирует содержимое; устранённая причина возвращает работу', () => {
    let fails = true;
    function Conditional(): null {
      if (fails) {
        throw new Error('раз');
      }
      return null;
    }
    render(
      <WidgetErrorBoundary>
        <Conditional />
      </WidgetErrorBoundary>,
    );
    expect(text()).toContain('Не удалось отобразить содержимое');

    fails = false;
    click('Повторить');
    expect(text()).not.toContain('Не удалось отобразить содержимое');
  });
});

describe('рамка окна переживает падение содержимого (PBT-027)', () => {
  it('ошибка локальна: соседнее окно живо, кнопки рамки работают', () => {
    const onClose = vi.fn();
    render(
      <>
        <WidgetWindow title="Падающее" onClose={onClose}>
          <Thrower fails />
        </WidgetWindow>
        <WidgetWindow title="Здоровое">
          <p>Соседний текст</p>
        </WidgetWindow>
      </>,
    );

    expect(text().split('Не удалось отобразить содержимое')).toHaveLength(2);
    expect(text()).toContain('Соседний текст');
    expect(button('Закрыть Падающее')).toBeTruthy();
    expect(button('Закрыть Здоровое')).toBeTruthy();

    click('Закрыть Падающее');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Соседний текст');
  });

  it('свёрнутое окно: ошибка ловится, но скрыта body[hidden]; кнопка разворачивания жива', () => {
    render(
      <WidgetWindow title="План · ОКАД" collapsed>
        <Thrower fails />
      </WidgetWindow>,
    );
    const body = container.querySelector('.widget-window__body');
    expect(body?.getAttribute('hidden')).toBe('');
    expect(body?.textContent).toContain('Не удалось отобразить содержимое');
    expect(button('Развернуть План · ОКАД')).toBeTruthy();
  });
});
