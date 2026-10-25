// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createDocumentService, createWidgetRegistry, WorkspaceStore } from '@project-board/dashboard';
import { defineWidgetType, type WidgetProps } from '@project-board/widget-sdk';
import App from './App';

const pwa = vi.hoisted(() => ({ prepare: undefined as undefined | (() => Promise<void>) }));
vi.mock('./PwaStatus', () => ({
  PwaStatus: ({ prepareForUpdate }: { prepareForUpdate: () => Promise<void> }) => {
    pwa.prepare = prepareForUpdate;
    return null;
  },
}));

it('закрытый экземпляр не возвращает настройки поздним callback или PWA flush', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  let update: WidgetProps['updateSettings'];
  const widget = defineWidgetType({
    id: 'probe', title: 'Проба', startSettings: {},
    sizeConstraints: { minWidth: 1, minHeight: 1 },
    component: (props: WidgetProps) => { update = props.updateSettings; return <p>Проба</p>; },
  });
  const store = new WorkspaceStore('close-tab-late-update');
  const savedSettings = vi.spyOn(store, 'saveViewSetting');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<App
      widgetRegistry={createWidgetRegistry([widget])}
      documentService={createDocumentService()}
      workspaceStore={store}
      restored={{
        tabs: [{ id: 'a', title: 'A', mode: 'grid' }, { id: 'b', title: 'B', mode: 'cascade' }],
        activeTabId: 'a',
        panesByTab: {
          a: [{ instanceId: 'live', typeId: 'probe', label: 'Проба' }], b: [],
          orphan: [{ instanceId: 'orphan', typeId: 'probe', label: 'Лишнее окно' }],
        },
        areasByTab: {}, cascadeByTab: {}, modeByTab: {},
      }}
    />));
    // Снапшот ограничен живыми вкладками даже при старом ключе в карте.
    await act(async () => { await pwa.prepare!(); });
    expect((await store.load()).instances.map(instance => instance.id)).toEqual(['live']);
    act(() => { update!({ flag: true }); });
    expect(savedSettings).toHaveBeenCalledTimes(1);
    act(() => { container.querySelector<HTMLButtonElement>('[aria-label="Закрыть A"]')!.click(); });
    // Callback захвачен до размонтирования, но больше не имеет живого владельца.
    act(() => { update!({ flag: false }); });
    await act(async () => { await pwa.prepare!(); });
    expect(savedSettings).toHaveBeenCalledTimes(1);
    expect(await store.loadViewSettings()).toEqual({});
    const after = await store.load();
    expect(after.instances).toEqual([]);
    expect(after.tabs.map(tab => tab.id)).toEqual(['b']);
    expect(after.activeTabId).toBe('b');
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
