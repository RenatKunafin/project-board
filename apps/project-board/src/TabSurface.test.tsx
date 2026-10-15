// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineWidgetType, type WidgetProps, type WidgetSize } from '@project-board/widget-sdk';
import {
  createDocumentService,
  createWidgetRegistry,
} from '@project-board/dashboard';
import { TabSurface } from './App';
import type { PaneHandlers } from './App';

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(width: number, height: number): void {
    this.callback(
      [
        {
          contentRect: {
            width,
            height,
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: width,
            bottom: height,
          },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
}

let renders = 0;
let lastVisible: boolean | null = null;
const receivedSizes: WidgetSize[] = [];

function CounterWidget({ visible, onResize }: WidgetProps): JSX.Element {
  renders += 1;
  lastVisible = visible;
  useEffect(() => onResize?.((size) => receivedSizes.push(size)), [onResize]);
  return <div data-visible={String(visible)} />;
}

const counterType = defineWidgetType({
  id: 'counter',
  title: 'Счётчик',
  component: CounterWidget,
  startSettings: {},
  sizeConstraints: { minWidth: 1, minHeight: 1 },
});

const pane = {
  instanceId: 'w-1',
  typeId: 'counter',
  label: 'Счётчик',
  documentId: undefined,
  collapsed: false,
};

function handlers(): { current: PaneHandlers } {
  return {
    current: {
      activatePane(): void {},
      toggleCollapse(): void {},
      closePane(): void {},
      replacePaneDocument(): void {},
      createDocumentForPane(): void {},
      viewStateOf(): Record<string, unknown> {
        return {};
      },
      updateViewState(): void {},
      onAreasChange(): void {},
      onCascadeChange(): void {},
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  MockResizeObserver.instances = [];
  renders = 0;
  lastVisible = null;
  receivedSizes.length = 0;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

const stableHandlers = handlers();
const stableService = createDocumentService();
const stableRegistry = createWidgetRegistry([counterType]);

function renderSurface(props?: Partial<Parameters<typeof TabSurface>[0]>): void {
  act(() => {
    root.render(
      <TabSurface
        tabTitle="Тест"
        visible={true}
        mode="grid"
        panes={[{ ...pane }]}
        areas={{}}
        cascade={{ areas: {}, order: [] }}
        activeInstanceId="w-1"
        registry={stableRegistry}
        documentService={stableService}
        documents={stableService.listDocuments()}
        handlers={stableHandlers}
        {...props}
      />,
    );
  });
}

describe('TabSurface — жизненный цикл скрытых виджетов (PBT-027)', () => {
  it('равные данные не перерисовывают поверхность: счётчик рендеров виджета не растёт', () => {
    renderSurface();
    expect(renders).toBe(1);

    // Новые ссылки, равное содержимое — memo-граница пропускает рендер.
    renderSurface();
    expect(renders).toBe(1);
  });

  it('изменение данных вкладки перерисовывает виджет с актуальной видимостью', () => {
    renderSurface();
    expect(renders).toBe(1);
    expect(lastVisible).toBe(true);

    renderSurface({
      panes: [{ ...pane, collapsed: true }],
      visible: false,
    });
    expect(renders).toBe(2);
    expect(lastVisible).toBe(false);
    expect(container.querySelector('[data-visible="false"]')).toBeTruthy();
  });

  it('размеры доставляются подписчику с троттлингом: серия триггеров — одно значение на кадр', async () => {
    renderSurface();
    const observer = MockResizeObserver.instances.at(-1);
    expect(observer).toBeTruthy();

    observer?.trigger(320, 240);
    observer?.trigger(321, 241);
    observer?.trigger(322, 242);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(receivedSizes).toEqual([{ width: 322, height: 242 }]);

    observer?.trigger(400, 300);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(receivedSizes).toEqual([
      { width: 322, height: 242 },
      { width: 400, height: 300 },
    ]);
  });

  it('нулевые размеры (скрытое окно) не доставляются', async () => {
    renderSurface();
    const observer = MockResizeObserver.instances.at(-1);
    observer?.trigger(0, 0);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(receivedSizes).toEqual([]);
  });
});
