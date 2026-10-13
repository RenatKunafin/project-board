import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createDocumentService,
  createIndexedDbDocumentStore,
  createWidgetRegistry,
  StorageSelfTest,
  WorkspaceStore,
  type CascadeLayoutState,
  type TiledLayoutState,
} from '@project-board/dashboard';
import { checklistTitle } from '@project-board/checklist';
import { planTitle } from '@project-board/gantt';
import App, { type RestoredWorkspace } from './App';
import { widgetTypes } from './widgets';
import './index.css';

const store = createIndexedDbDocumentStore('project-board');
const documentService = createDocumentService({ store });
const workspaceStore = new WorkspaceStore('project-board');

// Отложенные правки записываются при закрытии/перезагрузке страницы (PBT-010).
window.addEventListener('pagehide', () => {
  void documentService.flushAll();
});

// Технический маршрут самопроверки локального хранилища (не продуктовый UI):
// открывается только по явному #storage-selftest, используется e2e и вручную.
if (window.location.hash === '#storage-selftest') {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <StorageSelfTest />
    </React.StrictMode>,
  );
} else {
  bootstrap();
}

async function bootstrap(): Promise<void> {
  // Сбой восстановления не выдаётся за пустой каталог: флаг доходит до App,
  // каталог показывает состояние ошибки загрузки (DoD PBT-025).
  let documentsLoadError = false;
  try {
    await documentService.restoreAll();
  } catch (error) {
    documentsLoadError = true;
    console.error('document restore failed', error);
  }
  const saved = await workspaceStore.load();

  const widgetRegistry = createWidgetRegistry(widgetTypes);

  // Ленивое дополнение названия старым записям (design D2): название —
  // метаданные оболочки (ADR-5), у записей до PBT-025 его нет. Приложение
  // (composition root) вычисляет его зарегистрированными функциями модулей.
  fixupDocumentTitles(widgetRegistry);

  // Восстановление сохранённого рабочего пространства: вкладки, окна,
  // раскладки и режимы. Документы уже в сервисе (restoreAll).
  if (saved.tabs.length > 0) {
    const restored = restoreWorkspace(saved);
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <App
          widgetRegistry={widgetRegistry}
          documentService={documentService}
          workspaceStore={workspaceStore}
          list1Id={firstChecklistId()}
          list2Id={secondChecklistId()}
          restored={restored}
          documentsLoadError={documentsLoadError}
        />
      </React.StrictMode>,
    );
    return;
  }

  // Первый запуск: вертикальный срез PBT-011 (два документа чек-листа).
  const [list1Id, list2Id] = ensureTwoChecklists();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App
        widgetRegistry={widgetRegistry}
        documentService={documentService}
        workspaceStore={workspaceStore}
        list1Id={list1Id}
        list2Id={list2Id}
        documentsLoadError={documentsLoadError}
      />
    </React.StrictMode>,
  );
}

const DOCUMENT_TITLE_BY_MODULE: Record<string, (content: unknown) => string> = {
  checklist: checklistTitle,
  gantt: planTitle,
};

function fixupDocumentTitles(widgetRegistry: ReturnType<typeof createWidgetRegistry>): void {
  for (const document of documentService.listDocuments()) {
    if (document.title) {
      continue;
    }
    const lookup = widgetRegistry.get(
      widgetTypes.find(
        (type) =>
          type.documentSupport?.moduleId === document.moduleId &&
          type.documentSupport?.documentType === document.documentType,
      )?.id ?? '',
    );
    const support = 'kind' in lookup ? undefined : lookup.documentSupport;
    if (!support) {
      continue;
    }
    const derived = DOCUMENT_TITLE_BY_MODULE[document.moduleId];
    const title = derived ? derived(document.content) : 'Без названия';
    try {
      documentService.rename(document.id, document.revision, title);
    } catch (error) {
      console.error('document title fixup failed', document.id, error);
    }
  }
}

function firstChecklistId(): string {
  return ensureTwoChecklists()[0];
}

function secondChecklistId(): string {
  return ensureTwoChecklists()[1];
}

function ensureTwoChecklists(): [string, string] {
  // Сопоставление панелей с документами должно быть стабильным между
  // перезагрузками: сортируем (createdAt, затем id) и ПОСЛЕ создания
  // недостающих — иначе при создании двух документов в одну миллисекунду
  // панели после перезагрузки ссылаются на другие документы.
  const restored = documentService
    .listDocuments({ moduleId: 'checklist', documentType: 'list' })
    .sort(
      (a, b) =>
        a.createdAt < b.createdAt
          ? -1
          : a.createdAt > b.createdAt
            ? 1
            : a.id < b.id
              ? -1
              : 1,
    );
  let documents = restored;
  while (documents.length < 2) {
    const createdDocument = documentService.create({
      moduleId: 'checklist',
      documentType: 'list',
      schemaVersion: 1,
      title: `Список ${documents.length + 1}`,
      content: { items: [] },
    });
    documents = [...documents, createdDocument];
  }
  return [documents[0].id, documents[1].id];
}

function restoreWorkspace(
  saved: Awaited<ReturnType<WorkspaceStore['load']>>,
): RestoredWorkspace {
  const tabs = saved.tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    mode: tab.mode,
  }));
  const panesByTab: RestoredWorkspace['panesByTab'] = {};
  const areasByTab: Record<string, TiledLayoutState> = {};
  const cascadeByTab: Record<string, CascadeLayoutState> = {};
  const modeByTab: Record<string, 'grid' | 'cascade'> = {};

  for (const tab of saved.tabs) {
    panesByTab[tab.id] = [];
    areasByTab[tab.id] = {};
    cascadeByTab[tab.id] = { areas: {}, order: [...tab.cascadeOrder] };
    modeByTab[tab.id] = tab.mode;
  }

  for (const instance of saved.instances) {
    const panes = panesByTab[instance.tabId];
    if (!panes) {
      continue;
    }
    panes.push({
      instanceId: instance.id,
      typeId: instance.typeId,
      label: instance.label ?? instance.typeId,
      documentId: instance.documentId,
      collapsed: instance.collapsed === 1,
    });
    if (instance.gridArea) {
      areasByTab[instance.tabId] = areasByTab[instance.tabId] ?? {};
      areasByTab[instance.tabId][instance.id] = instance.gridArea;
    }
    if (instance.cascadeArea) {
      cascadeByTab[instance.tabId] = cascadeByTab[instance.tabId] ?? {
        areas: {},
        order: [],
      };
      cascadeByTab[instance.tabId].areas[instance.id] = instance.cascadeArea;
    }
  }

  const activeTabId =
    saved.activeTabId && tabs.some((tab) => tab.id === saved.activeTabId)
      ? saved.activeTabId
      : (tabs[0]?.id ?? null);

  // Порядок глубины: держим только живые экземпляры вкладки.
  for (const tab of saved.tabs) {
    const live = new Set(
      (panesByTab[tab.id] ?? []).map((pane) => pane.instanceId),
    );
    cascadeByTab[tab.id] = {
      areas: cascadeByTab[tab.id]?.areas ?? {},
      order: cascadeByTab[tab.id]?.order.filter((id) => live.has(id)) ?? [],
    };
  }

  return { tabs, activeTabId, panesByTab, areasByTab, cascadeByTab, modeByTab };
}
