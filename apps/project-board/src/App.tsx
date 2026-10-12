import type {
  AutosavingDocumentService,
  WidgetRegistry,
} from '@project-board/dashboard';
import {
  addTab,
  createWorkspaceState,
  EmptyWorkspace,
  moveTab,
  removeTab,
  renameTab,
  setActive,
  UnknownWidgetType,
  WidgetWindow,
} from '@project-board/dashboard';
import { checklistTitle } from '@project-board/checklist';
import { planTitle } from '@project-board/gantt';
import { useEffect, useReducer, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { WorkspaceState } from '@project-board/dashboard';
import type {
  ManagedDocument,
  WidgetTypeDefinition,
} from '@project-board/widget-sdk';

interface PaneInstance {
  readonly instanceId: string;
  readonly typeId: string;
  readonly label: string;
  readonly documentId?: string;
  readonly collapsed?: boolean;
}

const NEW_DOCUMENT_TITLE_BY_MODULE: Record<string, string> = {
  checklist: 'чек-листа',
  gantt: 'плана',
};

interface AppProps {
  widgetRegistry: WidgetRegistry;
  documentService: AutosavingDocumentService;
  list1Id: string;
  list2Id: string;
}

const SAVE_STATE_LABELS: Record<string, string> = {
  saved: 'Сохранено',
  saving: 'Сохраняется…',
  error: 'Ошибка сохранения',
  conflict: 'Обновлено из другого окна',
};

type WorkspaceAction =
  | { type: 'add' }
  | { type: 'rename'; tabId: string; title: string }
  | { type: 'move'; tabId: string; direction: -1 | 1 }
  | { type: 'remove'; tabId: string }
  | { type: 'activate'; tabId: string };

function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'add':
      return addTab(state);
    case 'rename':
      return renameTab(state, action.tabId, action.title);
    case 'move':
      return moveTab(state, action.tabId, action.direction);
    case 'remove':
      return removeTab(state, action.tabId);
    case 'activate':
      return setActive(state, action.tabId);
  }
}

type CatalogDialog =
  | { readonly step: 'none' }
  | { readonly step: 'document-choice'; readonly type: WidgetTypeDefinition };

function WidgetPane({
  lookup,
  pane,
  documentService,
}: {
  lookup: WidgetTypeDefinition;
  pane: PaneInstance;
  documentService: AutosavingDocumentService;
}) {
  const WidgetComponent = lookup.component;
  return (
    <WidgetComponent
      widgetInstanceId={pane.instanceId}
      settings={lookup.startSettings}
      documentId={pane.documentId}
      documentService={documentService}
    />
  );
}

export default function App({
  widgetRegistry,
  documentService,
  list1Id,
  list2Id,
}: AppProps) {
  const [workspace, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    () => createWorkspaceState('Чек-листы'),
  );

  const [panesByTab, setPanesByTab] = useState<Record<string, PaneInstance[]>>(
    () => ({
      [workspace.tabs[0].id]: [
        {
          instanceId: 'w-1',
          typeId: 'checklist',
          label: 'Экземпляр 1 · Список 1',
          documentId: list1Id,
        },
        {
          instanceId: 'w-2',
          typeId: 'checklist',
          label: 'Экземпляр 2 · Список 1',
          documentId: list1Id,
        },
        {
          instanceId: 'w-3',
          typeId: 'checklist',
          label: 'Экземпляр 3 · Список 2',
          documentId: list2Id,
        },
      ],
    }),
  );

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [dialog, setDialog] = useState<CatalogDialog>({ step: 'none' });
  const [newListTitle, setNewListTitle] = useState('');

  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  const [saveState, setSaveState] = useState(
    documentService.getSaveState(list1Id),
  );
  useEffect(
    () => documentService.subscribeSaveState(list1Id, setSaveState),
    [documentService, list1Id],
  );

  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeId);
  const activePanes = activeTab ? (panesByTab[activeTab.id] ?? []) : [];
  const visiblePanes = activePanes;
  const effectiveActiveInstanceId = visiblePanes.some(
    (pane) => pane.instanceId === activeInstanceId,
  )
    ? activeInstanceId
    : (visiblePanes[0]?.instanceId ?? null);
  const isLastTab = workspace.tabs.length === 1;

  const catalogTypes = widgetRegistry.list();

  const addPane = (type: WidgetTypeDefinition, documentId?: string, title?: string): void => {
    if (!activeTab) {
      return;
    }
    const instanceId = crypto.randomUUID();
    const label = documentId
      ? `${type.title} · ${title ?? 'Без названия'}`
      : type.title;
    setPanesByTab((previous) => ({
      ...previous,
      [activeTab.id]: [
        ...(previous[activeTab.id] ?? []),
        {
          instanceId,
          typeId: type.id,
          label,
          documentId,
        },
      ],
    }));
  };

  const toggleCollapse = (instanceId: string): void => {
    setPanesByTab((previous) => {
      const next: Record<string, PaneInstance[]> = {};
      for (const [tabId, panes] of Object.entries(previous)) {
        next[tabId] = panes.map((pane) =>
          pane.instanceId === instanceId
            ? { ...pane, collapsed: !pane.collapsed }
            : pane,
        );
      }
      return next;
    });
  };

  const closePane = (instanceId: string): void => {
    setPanesByTab((previous) => {
      const next: Record<string, PaneInstance[]> = {};
      for (const [tabId, panes] of Object.entries(previous)) {
        next[tabId] = panes.filter((pane) => pane.instanceId !== instanceId);
      }
      return next;
    });
    setActiveInstanceId((current) =>
      current === instanceId ? null : current,
    );
  };

  const handleCatalogPick = (type: WidgetTypeDefinition): void => {
    if (!type.documentSupport) {
      addPane(type);
      setCatalogOpen(false);
      return;
    }
    setDialog({ step: 'document-choice', type });
  };

  const createNewDocument = (): void => {
    if (dialog.step !== 'document-choice') {
      return;
    }
    const support = dialog.type.documentSupport;
    if (!support || !activeTab) {
      return;
    }
    const document = documentService.create({
      moduleId: support.moduleId,
      documentType: support.documentType,
      schemaVersion: support.schemaVersion,
      content: support.createContent(newListTitle.trim() || 'Без названия'),
    });
    addPane(
      dialog.type,
      document.id,
      newListTitle.trim() || 'Без названия',
    );
    setDialog({ step: 'none' });
    setNewListTitle('');
    setCatalogOpen(false);
  };

  const openExistingDocument = (document: ManagedDocument): void => {
    if (dialog.step !== 'document-choice') {
      return;
    }
    const moduleId = dialog.type.documentSupport?.moduleId;
    addPane(
      dialog.type,
      document.id,
      moduleId === 'gantt'
        ? planTitle(document.content)
        : checklistTitle(document.content),
    );
    setDialog({ step: 'none' });
    setCatalogOpen(false);
  };

  const existingDocuments: readonly ManagedDocument[] =
    dialog.step === 'document-choice' && dialog.type.documentSupport
      ? documentService
          .listDocuments({
            moduleId: dialog.type.documentSupport.moduleId,
            documentType: dialog.type.documentSupport.documentType,
          })
          .slice()
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      : [];

  const commitRename = (tabId: string, title: string) => {
    dispatch({ type: 'rename', tabId, title });
    setRenamingTabId(null);
  };

  const focusNeighbourTab = (tabId: string, delta: -1 | 1): void => {
    const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
    const neighbour = workspace.tabs[index + delta];
    if (neighbour) {
      dispatch({ type: 'activate', tabId: neighbour.id });
      document.getElementById(`tab-${neighbour.id}`)?.focus();
    }
  };

  const handleTabKeyDown = (
    event: KeyboardEvent,
    tabId: string,
  ): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusNeighbourTab(tabId, 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusNeighbourTab(tabId, -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dispatch({ type: 'activate', tabId });
    }
  };

  return (
    <main className="shell shell--workspace">
      <header className="tabs-header">
        <h1 className="shell__title">Project Board</h1>
        <div
          className="tablist"
          role="tablist"
          aria-label="Вкладки рабочего пространства"
        >
          {workspace.tabs.map((tab) => {
            const isActive = tab.id === workspace.activeId;
            return (
              <div
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                className={`tab ${isActive ? 'is-active' : ''}`}
                onClick={() => dispatch({ type: 'activate', tabId: tab.id })}
                onDoubleClick={() => setRenamingTabId(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
              >
                {renamingTabId === tab.id ? (
                  <input
                    className="tab__rename"
                    autoFocus
                    defaultValue={tab.title}
                    aria-label="Название вкладки"
                    onBlur={(event) => commitRename(tab.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        commitRename(tab.id, event.currentTarget.value);
                      }
                      if (event.key === 'Escape') {
                        setRenamingTabId(null);
                      }
                      event.stopPropagation();
                    }}
                  />
                ) : (
                  <span className="tab__title">{tab.title}</span>
                )}
                <button
                  type="button"
                  className="tab__move"
                  aria-label={`Переместить ${tab.title} влево`}
                  disabled={workspace.tabs[0].id === tab.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch({ type: 'move', tabId: tab.id, direction: -1 });
                  }}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="tab__move"
                  aria-label={`Переместить ${tab.title} вправо`}
                  disabled={workspace.tabs[workspace.tabs.length - 1].id === tab.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch({ type: 'move', tabId: tab.id, direction: 1 });
                  }}
                >
                  →
                </button>
                <button
                  type="button"
                  className="tab__close"
                  aria-label={`Закрыть ${tab.title}`}
                  disabled={isLastTab}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch({ type: 'remove', tabId: tab.id });
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="tablist__add"
            aria-label="Новая вкладка"
            onClick={() => dispatch({ type: 'add' })}
          >
            +
          </button>
        </div>
        <div className="tabs-header__right">
          {saveState && (
            <p
              className={`save-state is-${saveState.status}`}
              role="status"
              aria-label="Состояние сохранения"
            >
              {SAVE_STATE_LABELS[saveState.status] ?? saveState.status}
            </p>
          )}
          <button
            type="button"
            className="add-widget-button"
            aria-label="Добавить виджет"
            onClick={() => setCatalogOpen(true)}
          >
            + Виджет
          </button>
        </div>
      </header>

      <section
        className="instances"
        aria-label={`Пространство: ${activeTab?.title ?? ''}`}
        role="tabpanel"
      >
        {visiblePanes.length === 0 ? (
          <EmptyWorkspace />
        ) : (
          <div className="instances__pair">
            {visiblePanes.map((pane) => {
              const lookup = widgetRegistry.get(pane.typeId);
              const known = lookup && !('kind' in lookup);
              return (
                <WidgetWindow
                  key={pane.instanceId}
                  title={pane.label}
                  icon={known ? lookup.icon : undefined}
                  collapsed={pane.collapsed === true}
                  active={pane.instanceId === effectiveActiveInstanceId}
                  onActivate={() => setActiveInstanceId(pane.instanceId)}
                  onToggleCollapse={() => toggleCollapse(pane.instanceId)}
                  onClose={() => closePane(pane.instanceId)}
                >
                  {known ? (
                    <WidgetPane
                      lookup={lookup}
                      pane={pane}
                      documentService={documentService}
                    />
                  ) : (
                    <UnknownWidgetType lookup={lookup} />
                  )}
                </WidgetWindow>
              );
            })}
          </div>
        )}
      </section>

      {catalogOpen && (
        <div
          className="overlay"
          role="dialog"
          aria-label="Каталог виджетов"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setCatalogOpen(false);
            }
          }}
        >
          <div className="catalog-dialog">
            <div className="catalog-dialog__head">
              <h2 className="catalog-dialog__title">Добавить виджет</h2>
              <button
                type="button"
                className="tab__close"
                aria-label="Закрыть каталог"
                onClick={() => setCatalogOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="catalog-dialog__grid">
              {catalogTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className="catalog-dialog__item"
                  onClick={() => handleCatalogPick(type)}
                >
                  <span className="catalog-dialog__icon" aria-hidden="true">
                    {type.icon ?? '🧩'}
                  </span>
                  <span className="catalog-dialog__name">{type.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {dialog.step === 'document-choice' && (
        <div
          className="overlay"
          role="dialog"
          aria-label="Выбор документа"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setDialog({ step: 'none' });
            }
          }}
        >
          <div className="catalog-dialog">
            <div className="catalog-dialog__head">
              <h2 className="catalog-dialog__title">{dialog.type.title}</h2>
              <button
                type="button"
                className="tab__close"
                aria-label="Закрыть выбор документа"
                onClick={() => setDialog({ step: 'none' })}
              >
                ×
              </button>
            </div>
            <form
              className="doc-choice__new"
              onSubmit={(event) => {
                event.preventDefault();
                createNewDocument();
              }}
            >
              <input
                className="checklist__input"
                placeholder={`Название нового ${NEW_DOCUMENT_TITLE_BY_MODULE[
                  dialog.type.documentSupport?.moduleId ?? ''
                ] ?? 'документа'}`}
                aria-label={`Название нового ${NEW_DOCUMENT_TITLE_BY_MODULE[
                  dialog.type.documentSupport?.moduleId ?? ''
                ] ?? 'документа'}`}
                value={newListTitle}
                onChange={(event) => setNewListTitle(event.target.value)}
              />
              <button type="submit" className="checklist__add">
                Создать
              </button>
            </form>
            <p className="doc-choice__caption">Или открыть существующий:</p>
            {existingDocuments.length === 0 ? (
              <p className="checklist__hint">Существующих документов нет.</p>
            ) : (
              <ul className="doc-choice__list">
                {existingDocuments.map((document) => (
                  <li key={document.id}>
                    <button
                      type="button"
                      className="doc-choice__item"
                      onClick={() => openExistingDocument(document)}
                    >
                      {dialog.type.documentSupport?.moduleId === 'gantt'
                        ? planTitle(document.content)
                        : checklistTitle(document.content)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
