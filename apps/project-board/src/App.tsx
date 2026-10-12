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
  TiledLayout,
  CascadeLayout,
  defaultArea,
  TILE_GRID_COLUMNS,
  type CascadeItemInput,
  type CascadeLayoutState,
  type TiledLayoutState,
} from '@project-board/dashboard';
import { checklistTitle } from '@project-board/checklist';
import { planTitle } from '@project-board/gantt';
import { useEffect, useReducer, useRef, useState } from 'react';
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

  // Режим размещения: сетка (PBT-021) или каскад (PBT-022). Переключатель
  // временен: продуктовое переключение с раздельными раскладками — PBT-023.
  // Режим размещения — свойство вкладки (решения §4.1): умолчание — сетка.
  // Персистентность режима и раскладок — PBT-024.
  const [modeByTab, setModeByTab] = useState<
    Record<string, 'grid' | 'cascade'>
  >({});

  // Раскладка вкладок в собственной структуре платформы; персистентность — PBT-024.
  const [areasByTab, setAreasByTab] = useState<Record<string, TiledLayoutState>>(
    {},
  );
  // Каскадные раскладки вкладок: области и порядок глубины; персистентность — PBT-024.
  const [cascadeByTab, setCascadeByTab] = useState<
    Record<string, CascadeLayoutState>
  >({});
  // Прежняя высота свёрнутых окон: разворачивание возвращает область (ADR-7).
  const collapsedHeights = useRef<Map<string, number>>(new Map());

  const [saveState, setSaveState] = useState(
    documentService.getSaveState(list1Id),
  );
  useEffect(
    () => documentService.subscribeSaveState(list1Id, setSaveState),
    [documentService, list1Id],
  );

  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeId);

  const layoutMode: 'grid' | 'cascade' = activeTab
    ? (modeByTab[activeTab.id] ?? 'grid')
    : 'grid';

  const setLayoutMode = (mode: 'grid' | 'cascade'): void => {
    if (activeTab) {
      setModeByTab((previous) => ({ ...previous, [activeTab.id]: mode }));
    }
  };
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
    // Новое окно начинает с левой или правой половины сетки поочередно:
    // сетка сама уплотнит по вертикали без перекрытий.
    const existing = areasByTab[activeTab.id] ?? {};
    const start = defaultArea(type.sizeConstraints);
    setAreasByTab((previous) => ({
      ...previous,
      [activeTab.id]: {
        ...(previous[activeTab.id] ?? {}),
        [instanceId]: {
          ...start,
          x: (Object.keys(existing).length % 2) * (TILE_GRID_COLUMNS / 2),
        },
      },
    }));
    // В каскаде новое окно добавляется наверх стека; область посчитает адаптер.
    setCascadeByTab((previous) => ({
      ...previous,
      [activeTab.id]: {
        areas: previous[activeTab.id]?.areas ?? {},
        order: [...(previous[activeTab.id]?.order ?? []), instanceId],
      },
    }));
  };

  const activatePane = (instanceId: string): void => {
    setActiveInstanceId(instanceId);
    if (layoutMode !== 'cascade' || !activeTab) {
      return;
    }
    // Полный порядок глубины: сохранённые + новые окна, активируемое — наверх.
    setCascadeByTab((previous) => {
      const state = previous[activeTab.id] ?? { areas: {}, order: [] };
      const liveIds = activePanes.map((pane) => pane.instanceId);
      const kept = state.order.filter((id) => liveIds.includes(id));
      for (const id of liveIds) {
        if (!kept.includes(id)) {
          kept.push(id);
        }
      }
      const rotated = kept.filter((id) => id !== instanceId);
      rotated.push(instanceId);
      return {
        ...previous,
        [activeTab.id]: { ...state, order: rotated },
      };
    });
  };

  const toggleCollapse = (instanceId: string): void => {
    const pane = activePanes.find((entry) => entry.instanceId === instanceId);
    if (layoutMode === 'cascade') {
      // В каскаде полная высота хранится в области окна; свёрнутое окно
      // сжимается адаптером до заголовка без изменения раскладки.
      setPanesByTab((previous) => {
        const next: Record<string, PaneInstance[]> = {};
        for (const [tabId, panes] of Object.entries(previous)) {
          next[tabId] = panes.map((entry) =>
            entry.instanceId === instanceId
              ? { ...entry, collapsed: !entry.collapsed }
              : entry,
          );
        }
        return next;
      });
      return;
    }
    const area = activeTab
      ? areasByTab[activeTab.id]?.[instanceId]
      : undefined;
    if (pane && !pane.collapsed && area) {
      collapsedHeights.current.set(instanceId, area.h);
    }
    setPanesByTab((previous) => {
      const next: Record<string, PaneInstance[]> = {};
      for (const [tabId, panes] of Object.entries(previous)) {
        next[tabId] = panes.map((entry) =>
          entry.instanceId === instanceId
            ? { ...entry, collapsed: !entry.collapsed }
            : entry,
        );
      }
      return next;
    });
    if (pane?.collapsed) {
      const restored = collapsedHeights.current.get(instanceId);
      if (restored !== undefined && activeTab) {
        setAreasByTab((previous) => ({
          ...previous,
          [activeTab.id]: {
            ...(previous[activeTab.id] ?? {}),
            [instanceId]: {
              ...(previous[activeTab.id]?.[instanceId] ?? { x: 0, y: 0, w: 6, h: 4 }),
              h: restored,
            },
          },
        }));
      }
    }
  };

  const closePane = (instanceId: string): void => {
    setPanesByTab((previous) => {
      const next: Record<string, PaneInstance[]> = {};
      for (const [tabId, panes] of Object.entries(previous)) {
        next[tabId] = panes.filter((pane) => pane.instanceId !== instanceId);
      }
      return next;
    });
    // Окно уходит из обеих раскладок вкладки (решения §4.4, design D3).
    setAreasByTab((previous) => {
      const next: Record<string, TiledLayoutState> = {};
      for (const [tabId, areas] of Object.entries(previous)) {
        if (instanceId in areas) {
          const rest = { ...areas };
          delete rest[instanceId];
          next[tabId] = rest;
        } else {
          next[tabId] = areas;
        }
      }
      return next;
    });
    setCascadeByTab((previous) => {
      const next: Record<string, CascadeLayoutState> = {};
      for (const [tabId, state] of Object.entries(previous)) {
        if (instanceId in state.areas || state.order.includes(instanceId)) {
          const restAreas = { ...state.areas };
          delete restAreas[instanceId];
          next[tabId] = {
            areas: restAreas,
            order: state.order.filter((id) => id !== instanceId),
          };
        } else {
          next[tabId] = state;
        }
      }
      return next;
    });
    setActiveInstanceId((current) =>
      current === instanceId ? null : current,
    );
  };

  const paneToItem = (pane: PaneInstance): CascadeItemInput => {
    const lookup = widgetRegistry.get(pane.typeId);
    const definition = lookup && !('kind' in lookup) ? lookup : undefined;
    return {
      instanceId: pane.instanceId,
      constraints:
        definition?.sizeConstraints ?? { minWidth: 3, minHeight: 3 },
      collapsed: pane.collapsed === true,
      node: (
        <WidgetWindow
          title={pane.label}
          icon={definition?.icon}
          collapsed={pane.collapsed === true}
          active={pane.instanceId === effectiveActiveInstanceId}
          onActivate={() => activatePane(pane.instanceId)}
          onToggleCollapse={() => toggleCollapse(pane.instanceId)}
          onClose={() => closePane(pane.instanceId)}
        >
          {definition ? (
            <WidgetPane
              lookup={definition}
              pane={pane}
              documentService={documentService}
            />
          ) : (
            <UnknownWidgetType lookup={lookup} />
          )}
        </WidgetWindow>
      ),
    };
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
          {/* Временное управление режимами: заменяется продуктовым
              переключением PBT-023 (раздельные раскладки per вкладка). */}
          <div
            className="layout-mode-switch"
            role="group"
            aria-label="Режим размещения"
          >
            <button
              type="button"
              aria-pressed={layoutMode === 'grid'}
              onClick={() => setLayoutMode('grid')}
            >
              Сетка
            </button>
            <button
              type="button"
              aria-pressed={layoutMode === 'cascade'}
              onClick={() => setLayoutMode('cascade')}
            >
              Каскад
            </button>
          </div>
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
          <>
            {layoutMode === 'grid' ? (
              <TiledLayout
                items={visiblePanes.map(paneToItem)}
                areas={activeTab ? (areasByTab[activeTab.id] ?? {}) : {}}
                onAreasChange={(next) => {
                  if (activeTab) {
                    setAreasByTab((previous) => ({
                      ...previous,
                      [activeTab.id]: next,
                    }));
                  }
                }}
              />
            ) : (
              <CascadeLayout
                items={visiblePanes.map(paneToItem)}
                state={
                  activeTab
                    ? (cascadeByTab[activeTab.id] ?? {
                        areas: {},
                        order: [],
                      })
                    : { areas: {}, order: [] }
                }
                onStateChange={(next) => {
                  if (activeTab) {
                    setCascadeByTab((previous) => ({
                      ...previous,
                      [activeTab.id]: next,
                    }));
                  }
                }}
              />
            )}
          </>
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
