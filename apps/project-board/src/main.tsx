import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  collectDocumentMigrations,
  createDocumentService,
  createIndexedDbDocumentStore,
  createWidgetRegistry,
  PersistenceError,
  RecoverySnapshotCoordinator,
  RecoverySnapshotStore,
  WorkspaceBackupStore,
  StorageSelfTest,
  WorkspaceStore,
  type CascadeLayoutState,
  type TiledLayoutState,
} from '@project-board/dashboard';
import { checklistTitle } from '@project-board/checklist';
import { planTitle } from '@project-board/gantt';
import App, { type RestoredWorkspace } from './App';
import { RecoveryStartup } from './RecoveryStartup';
import { widgetTypes } from './widgets';
import { initializeYandexMetrika } from './analytics/yandex-metrika';
// Шрифты — локальная сборка @fontsource (офлайн-требование PWA, PBT-069):
// внешних CDN-запросов нет, значения --font-sans/--font-mono в tokens.css.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';

declare global {
  interface Window {
    __projectBoard?: {
      activeSubscriptionCount: () => number;
      /** Быстрое создание документа типа виджета для контрольных данных e2e (PBT-090). */
      createDocument: (widgetTypeId: string, title: string) => { id: string } | null;
      /** Запись содержимого документа для контрольных данных e2e (PBT-037). */
      writeDocumentContent: (documentId: string, content: unknown) => void;
      /** Чтение документа (ревизия/содержимое) для проверок e2e (PBT-039). */
      readDocument: (documentId: string) => { revision: number; content: unknown } | undefined;
    };
  }
}

const store = createIndexedDbDocumentStore('project-board');
const recoveryCoordinatorRef: { current: RecoverySnapshotCoordinator | null } = { current: null };
// Поддержка миграций собирается приложением из зарегистрированных типов
// (design D1): сервис остаётся независимым от реестра.
const documentService = createDocumentService({
  store,
  migrations: collectDocumentMigrations(widgetTypes),
  onPersistedChange: () => recoveryCoordinatorRef.current?.markPersistedChange(),
});
const workspaceStore = new WorkspaceStore('project-board', () => recoveryCoordinatorRef.current?.markPersistedChange());
const backupStore = new WorkspaceBackupStore('project-board');
const backupCompatibility = {
  widgetTypeIds: widgetTypes.map((type) => type.id),
  documentTypes: widgetTypes.flatMap((type) => type.documentSupport ? [{ moduleId: type.documentSupport.moduleId, documentType: type.documentSupport.documentType, schemaVersion: type.documentSupport.schemaVersion }] : []),
};
const recoveryStore = new RecoverySnapshotStore(backupCompatibility);
const recoveryCoordinator = new RecoverySnapshotCoordinator(recoveryStore, async () => {
  await Promise.all([documentService.flushAll(), workspaceStore.waitForPendingWrites()]);
  return (await backupStore.readCapture()).payload;
});
recoveryCoordinatorRef.current = recoveryCoordinator;

// Отложенные правки записываются при закрытии/перезагрузке страницы (PBT-010).
window.addEventListener('pagehide', () => {
  void documentService.flushAll().catch((error) => console.error('document flush failed', error));
});

// Диагностика e2e (design D4, PBT-027): счётчик активных подписок
// для проверки «закрытие освобождает, повторное открытие не умножает».
// writeDocumentContent (PBT-037): контрольные данные плана без формы
// редактирования — записи идут через общий контракт сервиса.
window.__projectBoard = {
  activeSubscriptionCount: () => documentService.activeSubscriptionCount(),
  // Тестовый мост (e2e): быстрое создание документа выбранного типа
  // без прохождения каталога; productId/данные не затрагивает.
  createDocument: (widgetTypeId: string, title: string) => {
    const support = widgetTypes.find((type) => type.id === widgetTypeId)?.documentSupport;
    if (!support) {
      return null;
    }
    return documentService.create({
      moduleId: support.moduleId,
      documentType: support.documentType,
      schemaVersion: support.schemaVersion,
      title,
      content: support.createContent(),
    });
  },
  writeDocumentContent: (documentId, content) => {
    const document = documentService.get(documentId);
    if (document) {
      documentService.update(documentId, document.revision, content);
    }
  },
  readDocument: (documentId) => documentService.get(documentId),
};

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
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
  // Метрика загружается независимо от восстановления локальных данных и не
  // должна блокировать запуск PWA при недоступности внешнего скрипта.
  initializeYandexMetrika();
  // Сбой восстановления не выдаётся за пустой каталог: флаг доходит до App,
  // каталог показывает состояние ошибки загрузки (DoD PBT-025).
  let documentsLoadError = false;
  let documentLoadFailure: unknown;
  try {
    await documentService.restoreAll();
  } catch (error) {
    documentsLoadError = true;
    documentLoadFailure = error;
    console.error('document restore failed', error);
  }
  if (documentLoadFailure instanceof PersistenceError && documentLoadFailure.code === 'schema-version-unsupported') {
    root.render(<main className="recovery-startup"><section className="recovery-startup__card" role="alert"><h1>Не удалось открыть локальные данные</h1><p>{documentLoadFailure.message}</p><p>Данные не заменены пустым пространством.</p></section></main>);
    return;
  }
  // Проблемы миграций доступны приложению (spec PBT-026): документ остаётся
  // нетронутым в хранилище, показываем диагностику в консоли.
  for (const issue of documentService.listRecoveryIssues()) {
    console.warn(
      `[миграция] документ ${issue.documentId} (${issue.moduleId}/${issue.documentType}): ` +
        `версия ${issue.storedVersion} → ${issue.targetVersion}, причина: ${issue.reason}` +
        (issue.detail ? ` — ${issue.detail}` : ''),
    );
  }
  let saved: Awaited<ReturnType<WorkspaceStore['load']>>;
  let initialViewStates: Awaited<ReturnType<WorkspaceStore['loadViewSettings']>>;
  let emptyCapture: Awaited<ReturnType<WorkspaceBackupStore['readCapture']>> | undefined;
  try {
    saved = await workspaceStore.load();
    // Состояния представлений экземпляров (PBT-049) нужны до рендера.
    initialViewStates = await workspaceStore.loadViewSettings();
    if (!documentsLoadError) emptyCapture = await backupStore.readCapture();
  } catch (error) {
    console.error('workspace restore failed', error);
    root.render(<main className="recovery-startup"><section className="recovery-startup__card" role="alert"><h1>Не удалось открыть локальные данные</h1><p>{error instanceof Error ? error.message : String(error)}</p><p>Данные не заменены пустым пространством.</p></section></main>);
    return;
  }

  const widgetRegistry = createWidgetRegistry(widgetTypes);

  // Ленивое дополнение названия старым записям (design D2): название —
  // метаданные оболочки (ADR-5), у записей до PBT-025 его нет. Приложение
  // (composition root) вычисляет его зарегистрированными функциями модулей.
  fixupDocumentTitles(widgetRegistry);

  const renderApp = (): void => {
    recoveryCoordinator.setEnabled(!documentsLoadError);
    root.render(<React.StrictMode><App
      widgetRegistry={widgetRegistry}
      documentService={documentService}
      workspaceStore={workspaceStore}
      restored={saved.tabs.length > 0 ? restoreWorkspace(saved) : undefined}
      initialViewStates={initialViewStates}
      documentsLoadError={documentsLoadError}
      backupStore={backupStore}
      backupCompatibility={backupCompatibility}
      recoveryCoordinator={recoveryCoordinator}
    /></React.StrictMode>);
  };

  const empty = !!emptyCapture && emptyCapture.payload.documents.length === 0 &&
    emptyCapture.payload.workspace.tabs.length === 0 && emptyCapture.payload.workspace.instances.length === 0 &&
    Object.keys(emptyCapture.payload.viewSettings).length === 0;
  try {
    const lookup = await recoveryCoordinator.refresh();
    if (empty) {
      root.render(<React.StrictMode><RecoveryStartup
        initialLookup={lookup}
        coordinator={recoveryCoordinator}
        backupStore={backupStore}
        emptyCapture={emptyCapture!}
        prepareDocuments={(documents) => documentService.prepareDocumentsForRestore(documents)}
        onContinue={renderApp}
      /></React.StrictMode>);
      return;
    }
  } catch (error) {
    console.error('recovery folder check failed', error);
    if (empty) {
      root.render(<main className="recovery-startup"><section className="recovery-startup__card" role="alert"><h1>Не удалось проверить папку с копиями</h1><p>{error instanceof Error ? error.message : String(error)}</p><button type="button" onClick={() => window.location.reload()}>Повторить</button></section></main>);
      return;
    }
  }
  renderApp();
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
