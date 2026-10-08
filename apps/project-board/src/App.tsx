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
} from '@project-board/dashboard';
import { ChecklistWidget } from '@project-board/checklist';
import { useEffect, useReducer, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { WorkspaceState } from '@project-board/dashboard';

interface PaneInstance {
  readonly instanceId: string;
  readonly label: string;
  readonly documentId: string;
}

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
  const unknownType = widgetRegistry.get('demo');

  // Наборы экземпляров per-вкладка. Первая вкладка — срез PBT-011,
  // новые вкладки пусты (каталог — PBT-019).
  const [panesByTab] = useState<Record<string, PaneInstance[]>>(
    () => ({
      [workspace.tabs[0].id]: [
        { instanceId: 'w-1', label: 'Экземпляр 1 · Список 1', documentId: list1Id },
        { instanceId: 'w-2', label: 'Экземпляр 2 · Список 1', documentId: list1Id },
        { instanceId: 'w-3', label: 'Экземпляр 3 · Список 2', documentId: list2Id },
      ],
    }),
  );
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
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
  const visiblePanes = activePanes.filter(
    (pane) => !closed.has(pane.instanceId),
  );
  const isLastTab = workspace.tabs.length === 1;

  const checklistType = widgetRegistry.get('checklist');
  const hasChecklistType = checklistType && !('kind' in checklistType);

  const togglePane = (instanceId: string) => {
    setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  };

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
        {saveState && (
          <p
            className={`save-state is-${saveState.status}`}
            role="status"
            aria-label="Состояние сохранения"
          >
            {SAVE_STATE_LABELS[saveState.status] ?? saveState.status}
          </p>
        )}
      </header>

      <section
        className="instances"
        aria-label={`Пространство: ${activeTab?.title ?? ''}`}
        role="tabpanel"
      >
        {hasChecklistType ? (
          visiblePanes.length === 0 ? (
            <EmptyWorkspace />
          ) : (
            <div className="instances__pair">
              {visiblePanes.map((pane) => (
                <div
                  key={pane.instanceId}
                  className="instances__pane"
                  role="group"
                  aria-label={pane.label}
                >
                  <div className="instances__head">
                    <p className="instances__label">{pane.label}</p>
                    <button
                      type="button"
                      className="instances__close"
                      aria-label={`Закрыть ${pane.label}`}
                      onClick={() => togglePane(pane.instanceId)}
                    >
                      Закрыть
                    </button>
                  </div>
                  <ChecklistWidget
                    widgetInstanceId={pane.instanceId}
                    settings={checklistType.startSettings}
                    documentId={pane.documentId}
                    documentService={documentService}
                  />
                </div>
              ))}
            </div>
          )
        ) : (
          <UnknownWidgetType lookup={unknownType} />
        )}
      </section>
    </main>
  );
}
