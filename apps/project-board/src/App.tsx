import { FileText, Layers, LayoutGrid } from 'lucide-react';
import { PwaStatus } from './PwaStatus';
import type {
  AutosavingDocumentService,
  WidgetRegistry,
} from '@project-board/dashboard';
import {
  addTab,
  createWorkspaceState,
  DocumentCatalogPanel,
  DocumentMissingPane,
  DocumentPickerPanel,
  DropdownPanel,
  EmptyWorkspace,
  filterDocuments,
  moveTab,
  removeTab,
  renameTab,
  setActive,
  documentTypeInfos,
  sortDocumentsByRecency,
  UnknownWidgetType,
  AppTopBar,
  WidgetWindow,
  WidgetIcon,
  TiledLayout,
  CascadeLayout,
  freeCascadeArea,
  cascadeAreaOf,
  snapCascadeArea,
  defaultArea,
  TILE_GRID_COLUMNS,
  WidgetCatalogPanel,
  widgetTypesForDocument,
  WorkspaceStore,
  type CascadeItemInput,
  type CascadeLayoutState,
  type DocumentTypeInfo,
  type TiledLayoutState,
  type WorkspaceSnapshot,
} from '@project-board/dashboard';
import {
  useCallback,
  useEffect,
  memo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent } from 'react';
import type { WorkspaceState } from '@project-board/dashboard';
import type {
  ManagedDocument,
  WidgetSize,
  WidgetTypeDefinition,
} from '@project-board/widget-sdk';

interface PaneInstance {
  readonly instanceId: string;
  readonly typeId: string;
  readonly label: string;
  readonly documentId?: string;
  readonly collapsed?: boolean;
}

/** Панели шапки: каталог виджетов, каталог документов, пикер документа для типа. */
type HeaderPanel =
  | { readonly kind: 'none' }
  | { readonly kind: 'widgets' }
  | { readonly kind: 'documents' }
  | { readonly kind: 'picker'; readonly typeId: string }
  | { readonly kind: 'open-with'; readonly documentId: string };

export interface RestoredWorkspace {
  readonly tabs: readonly {
    readonly id: string;
    readonly title: string;
    readonly mode: 'grid' | 'cascade';
  }[];
  readonly activeTabId: string | null;
  readonly panesByTab: Record<string, PaneInstance[]>;
  readonly areasByTab: Record<string, TiledLayoutState>;
  readonly cascadeByTab: CascadeByTab;
  readonly modeByTab: Record<string, 'grid' | 'cascade'>;
}

interface AppProps {
  widgetRegistry: WidgetRegistry;
  documentService: AutosavingDocumentService;
  workspaceStore: WorkspaceStore;
  list1Id: string;
  list2Id: string;
  restored?: RestoredWorkspace;
  /** Состояния представлений экземпляров из БД (PBT-049, ключи `view:*`). */
  initialViewStates?: Record<string, Record<string, unknown>>;
  /** Ошибка восстановления документов при старте: каталог показывает её, а не «пусто». */
  documentsLoadError?: boolean;
}

type CascadeByTab = { readonly [tabId: string]: CascadeLayoutState };

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

/** Подписка на размеры содержимого окна (registrant, design D2). */
type ResizeSubscriber = (listener: (size: WidgetSize) => void) => () => void;

function WidgetPane({
  lookup,
  pane,
  documentService,
  documents,
  visible,
  handlers,
  onPickDocument,
  onCreateDocument,
}: {
  lookup: WidgetTypeDefinition;
  pane: PaneInstance;
  documentService: AutosavingDocumentService;
  documents: readonly ManagedDocument[];
  visible: boolean;
  handlers: { readonly current: PaneHandlers };
  onPickDocument: (instanceId: string, documentId: string) => void;
  onCreateDocument: (instanceId: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sizeListeners = useRef(new Set<(size: WidgetSize) => void>());
  const lastSize = useRef<WidgetSize | null>(null);
  const lastFrame = useRef<number | null>(null);

  // Подписка виджета на размеры (design D2): регистратор с немедленной
  // доставкой последнего известного размера и rAF-троттлингом наблюдателя.
  const subscribeResize = useCallback<ResizeSubscriber>((listener) => {
    sizeListeners.current.add(listener);
    if (lastSize.current) {
      listener(lastSize.current);
    }
    return () => {
      sizeListeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    const listeners = sizeListeners.current;
    const element = contentRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) {
        return;
      }
      if (lastFrame.current !== null) {
        cancelAnimationFrame(lastFrame.current);
      }
      lastFrame.current = requestAnimationFrame(() => {
        lastFrame.current = null;
        lastSize.current = { width: rect.width, height: rect.height };
        for (const listener of [...listeners]) {
          listener(lastSize.current);
        }
      });
    });
    observer.observe(element);
    return () => {
      if (lastFrame.current !== null) {
        cancelAnimationFrame(lastFrame.current);
      }
      observer.disconnect();
      listeners.clear();
    };
  }, []);

  // Ссылка на недоступный документ (удалён или битая ссылка после восстановления):
  // состояние с выбором другого документа того же типа (ADR-7 PBT-002).
  if (pane.documentId && !documentService.get(pane.documentId)) {
    const support = lookup.documentSupport;
    const sameType = support
      ? documents.filter(
          (document) =>
            document.moduleId === support.moduleId &&
            document.documentType === support.documentType,
        )
      : [];
    return (
      <DocumentMissingPane
        documents={sameType}
        canCreate={support !== undefined}
        onPick={(documentId) => onPickDocument(pane.instanceId, documentId)}
        onCreate={() => onCreateDocument(pane.instanceId)}
      />
    );
  }
  const WidgetComponent = lookup.component;
  return (
    <div
      className="widget-pane__content"
      ref={contentRef}
      // documentId в DOM для контрольных данных e2e (PBT-037).
      data-document-id={pane.documentId}
    >
      <WidgetComponent
        widgetInstanceId={pane.instanceId}
        settings={{
          ...lookup.startSettings,
          ...handlers.current.viewStateOf(pane.instanceId),
        }}
        updateSettings={(patch) =>
          handlers.current.updateViewState(pane.instanceId, patch)
        }
        documentId={pane.documentId}
        documentService={documentService}
        visible={visible}
        onResize={subscribeResize}
        // Переключение документа экземпляра по запросу виджета (PBT-051):
        // тот же механизм перепривязки, что и у замены недоступного документа.
        switchDocument={(documentId) =>
          handlers.current.replacePaneDocument(pane.instanceId, documentId)
        }
      />
    </div>
  );
}

/** Обработчики поверхности вкладки: актуальные реализации через стабильный ref. */
export interface PaneHandlers {
  activatePane(instanceId: string): void;
  toggleCollapse(instanceId: string): void;
  toggleMaximize(instanceId: string): void;
  closePane(instanceId: string): void;
  replacePaneDocument(instanceId: string, documentId: string): void;
  createDocumentForPane(instanceId: string): void;
  onAreasChange(next: TiledLayoutState): void;
  onCascadeChange(next: CascadeLayoutState): void;
  /** Снапшот состояния представления экземпляра (PBT-049, ADR-6.4). */
  viewStateOf(instanceId: string): Record<string, unknown>;
  updateViewState(instanceId: string, patch: Record<string, unknown>): void;
}

interface TabSurfaceProps {
  readonly tabTitle: string;
  readonly visible: boolean;
  readonly mode: 'grid' | 'cascade';
  readonly panes: readonly PaneInstance[];
  readonly areas: TiledLayoutState;
  readonly cascade: CascadeLayoutState;
  readonly activeInstanceId: string | null;
  /** Развёрнутое окно вкладки или null (PBT-071; память вкладки, не персистится). */
  readonly maximizedInstanceId?: string | null;
  /** Открыть каталог виджетов из пустого состояния (PBT-072 D6);
   *  стабильная ссылка — в memo-сравнении не участвует. */
  readonly onAddWidget?: () => void;
  readonly registry: WidgetRegistry;
  readonly documentService: AutosavingDocumentService;
  readonly documents: readonly ManagedDocument[];
  readonly handlers: { readonly current: PaneHandlers };
}

/** Скрытые вкладки не перерисовываются от действий активной: сравнение
 * собственных данных (design D1). Обработчики идут через стабильный ref. */
function tiledAreasEqual(
  previous: TiledLayoutState,
  next: TiledLayoutState,
): boolean {
  const previousKeys = Object.keys(previous);
  if (previousKeys.length !== Object.keys(next).length) {
    return false;
  }
  return previousKeys.every((key) => {
    const a = previous[key];
    const b = next[key];
    if (!a || !b) {
      return a === b;
    }
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  });
}

function cascadeEqual(
  previous: CascadeLayoutState,
  next: CascadeLayoutState,
): boolean {
  const previousAreas = previous.areas ?? {};
  const nextAreas = next.areas ?? {};
  const previousKeys = Object.keys(previousAreas);
  if (previousKeys.length !== Object.keys(nextAreas).length) {
    return false;
  }
  const sameAreas = previousKeys.every((key) => {
    const a = previousAreas[key];
    const b = nextAreas[key];
    if (!a || !b) {
      return a === b;
    }
    return (
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height
    );
  });
  if (!sameAreas) {
    return false;
  }
  const previousOrder = previous.order ?? [];
  const nextOrder = next.order ?? [];
  return (
    previousOrder.length === nextOrder.length &&
    previousOrder.every((id, index) => id === nextOrder[index])
  );
}

function tabSurfaceAreEqual(previous: TabSurfaceProps, next: TabSurfaceProps): boolean {
  if (
    previous.visible !== next.visible ||
    previous.mode !== next.mode ||
    previous.tabTitle !== next.tabTitle ||
    previous.activeInstanceId !== next.activeInstanceId ||
    (previous.maximizedInstanceId ?? null) !==
      (next.maximizedInstanceId ?? null) ||
    previous.registry !== next.registry ||
    previous.documentService !== next.documentService ||
    previous.handlers !== next.handlers
  ) {
    return false;
  }
  if (!tiledAreasEqual(previous.areas, next.areas)) {
    return false;
  }
  if (!cascadeEqual(previous.cascade, next.cascade)) {
    return false;
  }
  if (previous.panes.length !== next.panes.length) {
    return false;
  }
  for (let index = 0; index < previous.panes.length; index += 1) {
    const a = previous.panes[index];
    const b = next.panes[index];
    if (
      a.instanceId !== b.instanceId ||
      a.typeId !== b.typeId ||
      a.label !== b.label ||
      a.documentId !== b.documentId ||
      a.collapsed !== b.collapsed
    ) {
      return false;
    }
  }
  if (previous.documents.length !== next.documents.length) {
    return false;
  }
  for (let index = 0; index < previous.documents.length; index += 1) {
    const a = previous.documents[index];
    const b = next.documents[index];
    if (a.id !== b.id || a.revision !== b.revision) {
      return false;
    }
  }
  return true;
}

export const TabSurface = memo(function TabSurface({
  tabTitle,
  visible,
  mode,
  panes,
  areas,
  cascade,
  activeInstanceId,
  maximizedInstanceId,
  onAddWidget,
  registry,
  documentService,
  documents,
  handlers,
}: TabSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // Скролл канваса до разворота: фиксируется в 0 и восстанавливается после
  // возврата (паттерн previousScroll прототипа, PBT-071 D4).
  const previousScrollRef = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    // Каскад прокручивается внутри своего viewport; тайлинг — в .instances.
    // При развороте сбрасываем нужный scroller и восстанавливаем при возврате.
    const scroller = mode === 'cascade'
      ? surface?.querySelector<HTMLElement>('.cascade-viewport')
      : surface?.parentElement;
    if (!surface || !scroller) {
      return;
    }
    if (maximizedInstanceId) {
      previousScrollRef.current = {
        left: scroller.scrollLeft,
        top: scroller.scrollTop,
      };
      scroller.scrollTo(0, 0);
      return;
    }
    const previous = previousScrollRef.current;
    if (previous) {
      previousScrollRef.current = null;
      // Возврат высоты контента и восстановление скролла — после отрисовки.
      requestAnimationFrame(() => {
        scroller.scrollTo(previous.left, previous.top);
      });
    }
  }, [maximizedInstanceId, mode]);

  const effectiveActiveInstanceId = visible
    ? (panes.some((pane) => pane.instanceId === activeInstanceId)
        ? activeInstanceId
        : (panes[0]?.instanceId ?? null))
    : null;

  // Подпись окна — производная при рендере: префикс экземпляра из label +
  // актуальное название документа из метаданных (design PBT-024 D2 снят).
  const windowTitleOf = (pane: PaneInstance): string => {
    const prefix = pane.label.split(' · ')[0] ?? pane.label;
    if (!pane.documentId) {
      return pane.label;
    }
    const document = documentService.get(pane.documentId);
    return document ? `${prefix} · ${document.title}` : prefix;
  };

  const paneToItem = (pane: PaneInstance): CascadeItemInput => {
    const lookup = registry.get(pane.typeId);
    const definition = lookup && !('kind' in lookup) ? lookup : undefined;
    const maximized =
      (maximizedInstanceId ?? null) === pane.instanceId &&
      maximizedInstanceId != null;
    const hiddenByMaximize = maximizedInstanceId != null && !maximized;
    return {
      instanceId: pane.instanceId,
      constraints:
        definition?.sizeConstraints ?? { minWidth: 3, minHeight: 3 },
      collapsed: pane.collapsed === true,
      node: (
        <WidgetWindow
          title={windowTitleOf(pane)}
          icon={definition?.icon}
          collapsed={pane.collapsed === true}
          active={pane.instanceId === effectiveActiveInstanceId}
          maximized={maximized}
          hiddenByMaximize={hiddenByMaximize}
          onActivate={() => handlers.current.activatePane(pane.instanceId)}
          onToggleCollapse={() => handlers.current.toggleCollapse(pane.instanceId)}
          onToggleMaximize={() => handlers.current.toggleMaximize(pane.instanceId)}
          onClose={() => handlers.current.closePane(pane.instanceId)}
        >
          {definition ? (
            <WidgetPane
              lookup={definition}
              pane={pane}
              documentService={documentService}
              documents={documents}
              visible={
                visible && (!pane.collapsed || maximized) && !hiddenByMaximize
              }
              handlers={handlers}
              onPickDocument={(instanceId, documentId) =>
                handlers.current.replacePaneDocument(instanceId, documentId)
              }
              onCreateDocument={(instanceId) =>
                handlers.current.createDocumentForPane(instanceId)
              }
            />
          ) : (
            <UnknownWidgetType lookup={lookup} />
          )}
        </WidgetWindow>
      ),
    };
  };

  if (panes.length === 0) {
    return (
      <div
        className="tab-surface"
        hidden={!visible}
      >
        <EmptyWorkspace onAddWidget={onAddWidget} />
      </div>
    );
  }
  return (
    <div
      ref={surfaceRef}
      className={[
        'tab-surface',
        maximizedInstanceId != null ? 'tab-surface--maximized' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      hidden={!visible}
      data-tab-title={tabTitle}
    >
      {mode === 'grid' ? (
        <TiledLayout
          items={panes.map(paneToItem)}
          areas={areas}
          onAreasChange={(next) => handlers.current.onAreasChange(next)}
        />
      ) : (
        <CascadeLayout
          items={panes.map(paneToItem)}
          state={cascade}
          onStateChange={(next) => handlers.current.onCascadeChange(next)}
        />
      )}
      {/* Overlay-слой разворота окна (PBT-071 D1): сюда эффект WidgetWindow
          переносит DOM-узел максимизированного окна без размонтирования. */}
      <div
        className="widget-maximize-layer"
        hidden={maximizedInstanceId == null}
        data-testid="widget-maximize-layer"
      />
    </div>
  );
}, tabSurfaceAreEqual);

export default function App({
  widgetRegistry,
  documentService,
  workspaceStore,
  list1Id,
  list2Id,
  restored,
  initialViewStates,
  documentsLoadError = false,
}: AppProps) {
  // Состояние представлений экземпляров (PBT-049, ADR-6.4): стабильный ref —
  // виджеты сами применяют свой state, платформа не ре-рендерит панели.
  const viewStatesRef = useRef<Record<string, Record<string, unknown>>>(
    initialViewStates ?? {},
  );
  const viewStateOf = useCallback(
    (instanceId: string): Record<string, unknown> =>
      viewStatesRef.current[instanceId] ?? {},
    [],
  );
  const updateViewState = useCallback(
    (instanceId: string, patch: Record<string, unknown>) => {
      viewStatesRef.current = {
        ...viewStatesRef.current,
        [instanceId]: { ...viewStatesRef.current[instanceId], ...patch },
      };
      void workspaceStore.saveViewSetting(
        instanceId,
        viewStatesRef.current[instanceId],
      ).catch((error) => console.error('view settings save failed', error));
    },
    [workspaceStore],
  );
  const [workspace, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    () =>
      restored && restored.tabs.length > 0
        ? {
            tabs: restored.tabs.map((tab) => ({
              id: tab.id,
              title: tab.title,
            })),
            activeId:
              restored.activeTabId ?? restored.tabs[0]?.id ?? 'workspace-tab',
          }
        : createWorkspaceState('Чек-листы'),
  );

  const [panesByTab, setPanesByTab] = useState<Record<string, PaneInstance[]>>(
    () =>
      restored?.panesByTab ?? {
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
      },
  );

  const [headerPanel, setHeaderPanel] = useState<HeaderPanel>({ kind: 'none' });
  const widgetsButtonRef = useRef<HTMLButtonElement>(null);
  const documentsButtonRef = useRef<HTMLButtonElement>(null);

  // Версия структурных операций над документами (rename/delete/перепривязка):
  // эти операции не меняют состояние App, редьюсер провоцирует перерендер,
  // чтобы окна и каталог перечитали documentService (уведомлений нет, design D6).
  const [, bumpDocumentsVersion] = useReducer(
    (count: number) => count + 1,
    0,
  );

  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  // Развёрнутое окно по вкладкам (PBT-071, design D2): память вкладки,
  // не персистится — перезапуск восстанавливает обычный вид (PBT-024).
  const [maximizedByTab, setMaximizedByTab] = useState<
    Record<string, string | null>
  >({});

  // Режим размещения: сетка (PBT-021) или каскад (PBT-022). Переключатель
  // временен: продуктовое переключение с раздельными раскладками — PBT-023.
  // Режим размещения — свойство вкладки (решения §4.1): умолчание — каскад.
  // Персистентность режима и раскладок — PBT-024.
  const [modeByTab, setModeByTab] = useState<
    Record<string, 'grid' | 'cascade'>
  >(() => restored?.modeByTab ?? {});

  // Раскладка вкладок в собственной структуре платформы; персистентность — PBT-024.
  const [areasByTab, setAreasByTab] = useState<Record<string, TiledLayoutState>>(
    () => restored?.areasByTab ?? {},
  );
  // Каскадные раскладки вкладок: области и порядок глубины; персистентность — PBT-024.
  const [cascadeByTab, setCascadeByTab] = useState<CascadeByTab>(
    () => restored?.cascadeByTab ?? {},
  );
  // Прежняя высота свёрнутых окон: разворачивание возвращает область (ADR-7).
  const collapsedHeights = useRef<Map<string, number>>(new Map());

  // Индикатор топ-бара — сводное состояние записи всех документов (PBT-072
  // D9; прежде отслеживался только документ среза «Список 1»).
  const [saveStatus, setSaveStatus] = useState(() =>
    documentService.getAggregateSaveStatus(),
  );
  useEffect(
    () => documentService.subscribeAggregateSaveStatus(setSaveStatus),
    [documentService],
  );

  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeId);

  const layoutMode: 'grid' | 'cascade' = activeTab
    ? (modeByTab[activeTab.id] ?? 'cascade')
    : 'cascade';

  const setLayoutMode = (mode: 'grid' | 'cascade'): void => {
    if (activeTab) {
      setModeByTab((previous) => ({ ...previous, [activeTab.id]: mode }));
    }
  };
  const activePanes = activeTab ? (panesByTab[activeTab.id] ?? []) : [];
  const isLastTab = workspace.tabs.length === 1;

  const catalogTypes = widgetRegistry.list();

  // Список читается на каждом рендере: create/update уже перерендеривают App
  // через своё состояние, структурные операции — через bumpDocumentsVersion.
  const allDocuments = documentService.listDocuments();
  const documentTypes = documentTypeInfos(catalogTypes);

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
    // В каскаде новое окно занимает свободную область и поднимается наверх.
    setActiveInstanceId(instanceId);
    setCascadeByTab((previous) => {
      const current = previous[activeTab.id] ?? { areas: {}, order: [] };
      const nextAreas = { ...current.areas };
      if (layoutMode === 'cascade') {
        const occupied = activePanes.map((pane, index) => {
          const lookup = widgetRegistry.get(pane.typeId);
          const constraints = lookup && !('kind' in lookup) ? lookup.sizeConstraints : { minWidth: 3, minHeight: 3 };
          const raw = cascadeAreaOf(pane.instanceId, constraints, index, current);
          // Стартовые окна тоже должны сохранять место: после reload порядок
          // записей IDB может отличаться от порядка добавления экземпляров.
          nextAreas[pane.instanceId] = raw;
          return snapCascadeArea(raw, null, constraints);
        });
        const viewportWidth = document.querySelector<HTMLElement>(
          '.tab-surface:not([hidden]) .cascade-viewport',
        )?.clientWidth ?? window.innerWidth;
        nextAreas[instanceId] = freeCascadeArea(type.sizeConstraints, occupied, viewportWidth);
      }
      return {
        ...previous,
        [activeTab.id]: { areas: nextAreas, order: [...current.order, instanceId] },
      };
    });
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

  const toggleMaximize = (instanceId: string): void => {
    if (!activeTab) {
      return;
    }
    // Разворот делает окно активным (прототип: focusWidget), в каскаде
    // поднимает обёртку наверх порядка глубины.
    activatePane(instanceId);
    setMaximizedByTab((previous) => ({
      ...previous,
      [activeTab.id]:
        previous[activeTab.id] === instanceId ? null : instanceId,
    }));
  };

  const toggleCollapse = (instanceId: string): void => {
    // Сворачивание развёрнутого окна возвращает обычный вид (PBT-071 D5,
    // поведение прототипа), затем сворачивает как обычно.
    if (activeTab && maximizedByTab[activeTab.id] === instanceId) {
      setMaximizedByTab((previous) => ({
        ...previous,
        [activeTab.id]: null,
      }));
    }
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
    // Закрытие развёрнутого окна снимает максимизацию вкладки (PBT-071):
    // узел удаляется из overlay сам (React убирает от фактического родителя).
    setMaximizedByTab((previous) => {
      const next: Record<string, string | null> = {};
      let changed = false;
      for (const [tabId, maximized] of Object.entries(previous)) {
        const value = maximized === instanceId ? null : maximized;
        if (value !== maximized) {
          changed = true;
        }
        next[tabId] = value;
      }
      return changed ? next : previous;
    });
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
        if (
          instanceId in (state.areas ?? {}) ||
          (state.order ?? []).includes(instanceId)
        ) {
          const restAreas = { ...(state.areas ?? {}) };
          delete restAreas[instanceId];
          next[tabId] = {
            areas: restAreas,
            order: (state.order ?? []).filter((id) => id !== instanceId),
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

  // Обработчики поверхности вкладок: стабильный ref с актуальными
  // реализациями — TabSurface не перерендеривается от их пересоздания.
  const paneHandlersRef = useRef<PaneHandlers>(null as unknown as PaneHandlers);

  // Снапшот рабочего пространства записывается с отложенной серией:
  // многократные изменения (например, перетаскивание) дают одну запись
  // итогового состояния (PBT-024).
  const snapshotRef = useRef<WorkspaceSnapshot | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const snapshot: WorkspaceSnapshot = {
      tabs: workspace.tabs.map((tab, index) => ({
        id: tab.id,
        title: tab.title,
        position: index,
        mode: modeByTab[tab.id] ?? 'cascade',
        cascadeOrder: cascadeByTab[tab.id]?.order ?? [],
        active: tab.id === workspace.activeId ? 1 : 0,
      })),
      instances: Object.entries(panesByTab).flatMap(([tabId, panes]) =>
        panes.map((pane) => ({
          id: pane.instanceId,
          tabId,
          typeId: pane.typeId,
          documentId: pane.documentId,
          label: pane.label,
          collapsed: pane.collapsed ? 1 : 0,
          gridArea: areasByTab[tabId]?.[pane.instanceId] ?? null,
          cascadeArea: cascadeByTab[tabId]?.areas[pane.instanceId] ?? null,
        })),
      ),
      activeTabId: workspace.activeId,
    };
    snapshotRef.current = snapshot;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pending = snapshotRef.current;
      if (pending) {
        void workspaceStore
          .save(pending)
          .catch((error) => console.error('workspace save failed', error));
      }
    }, 300);
  });

  useEffect(() => {
    const flush = (): void => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = snapshotRef.current;
      if (pending) {
        void workspaceStore.save(pending).catch((error) => console.error('workspace flush failed', error));
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [workspaceStore]);

  const prepareForUpdate = async (): Promise<void> => {
    // Модальное окно блокирует ввод; завершившийся callback виджета всё же
    // может обновить refs во время await — в таком случае фиксируем их снова.
    let snapshot: WorkspaceSnapshot | null;
    let views: Record<string, Record<string, unknown>>;
    do {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      snapshot = snapshotRef.current;
      views = viewStatesRef.current;
      if (!snapshot) throw new Error('Рабочее пространство ещё не готово к сохранению.');
      await Promise.all([
        documentService.flushAll(),
        workspaceStore.flush(snapshot, structuredClone(views)),
      ]);
    } while (snapshot !== snapshotRef.current || views !== viewStatesRef.current);
  };

  const handleCatalogPick = (type: WidgetTypeDefinition): void => {
    if (!type.documentSupport) {
      addPane(type);
      setHeaderPanel({ kind: 'none' });
      return;
    }
    setHeaderPanel({ kind: 'picker', typeId: type.id });
  };

  const pickerType =
    headerPanel.kind === 'picker'
      ? (() => {
          const lookup = widgetRegistry.get(headerPanel.typeId);
          return lookup && !('kind' in lookup) ? lookup : undefined;
        })()
      : undefined;

  const pickerDocuments: readonly ManagedDocument[] = pickerType?.documentSupport
    ? sortDocumentsByRecency(
        filterDocuments(allDocuments, {
          kind: 'type',
          moduleId: pickerType.documentSupport.moduleId,
          documentType: pickerType.documentSupport.documentType,
        }),
      )
    : [];

  const createDocumentForPicker = (title: string): void => {
    const support = pickerType?.documentSupport;
    if (!support || !activeTab) {
      return;
    }
    const document = documentService.create({
      moduleId: support.moduleId,
      documentType: support.documentType,
      schemaVersion: support.schemaVersion,
      title,
      content: support.createContent(),
    });
    addPane(pickerType as WidgetTypeDefinition, document.id, title);
    setHeaderPanel({ kind: 'none' });
  };

  const openDocumentWithWidget = (
    type: WidgetTypeDefinition,
    document: ManagedDocument,
  ): void => {
    addPane(type, document.id, document.title);
    setHeaderPanel({ kind: 'none' });
  };

  /** Открытие из каталога документов: подбор зарегистрированного типа по документу. */
  const openFromCatalog = (document: ManagedDocument): void => {
    const candidates = widgetTypesForDocument(
      catalogTypes,
      document.moduleId,
      document.documentType,
    );
    if (candidates.length === 1) {
      openDocumentWithWidget(candidates[0], document);
      return;
    }
    setHeaderPanel({ kind: 'open-with', documentId: document.id });
  };

  const createFromCatalog = (info: DocumentTypeInfo, title: string): void => {
    const type = catalogTypes.find((entry) => entry.id === info.widgetTypeId);
    const support = type?.documentSupport;
    if (!support) {
      return;
    }
    documentService.create({
      moduleId: support.moduleId,
      documentType: support.documentType,
      schemaVersion: support.schemaVersion,
      title,
      content: support.createContent(),
    });
    bumpDocumentsVersion();
  };

  const renameDocument = (documentId: string, title: string): void => {
    const document = documentService.get(documentId);
    if (!document) {
      return;
    }
    documentService.rename(documentId, document.revision, title);
    bumpDocumentsVersion();
  };

  const deleteDocument = (documentId: string): void => {
    void documentService.delete(documentId).then(() => bumpDocumentsVersion());
  };

  /** Перепривязка окна из состояния «документ недоступен» к выбранному документу. */
  const replacePaneDocument = (instanceId: string, documentId: string): void => {
    setPanesByTab((previous) => {
      const next: Record<string, PaneInstance[]> = {};
      for (const [tabId, panes] of Object.entries(previous)) {
        next[tabId] = panes.map((pane) =>
          pane.instanceId === instanceId
            ? { ...pane, documentId }
            : pane,
        );
      }
      return next;
    });
    bumpDocumentsVersion();
  };

  /** Создание документа того же типа из состояния «документ недоступен». */
  const createDocumentForPane = (instanceId: string): void => {
    const pane = Object.values(panesByTab)
      .flat()
      .find((entry) => entry.instanceId === instanceId);
    const lookup = pane
      ? widgetRegistry.get(pane.typeId)
      : undefined;
    const definition = lookup && !('kind' in lookup) ? lookup : undefined;
    const support = definition?.documentSupport;
    if (!support) {
      return;
    }
    const document = documentService.create({
      moduleId: support.moduleId,
      documentType: support.documentType,
      schemaVersion: support.schemaVersion,
      title: definition.title,
      content: support.createContent(),
    });
    replacePaneDocument(instanceId, document.id);
  };

  paneHandlersRef.current = {
    activatePane,
    toggleCollapse,
    toggleMaximize,
    closePane,
    replacePaneDocument,
    createDocumentForPane,
    viewStateOf,
    updateViewState,
    onAreasChange: (next) => {
      if (activeTab) {
        setAreasByTab((previous) => ({ ...previous, [activeTab.id]: next }));
      }
    },
    onCascadeChange: (next) => {
      if (activeTab) {
        setCascadeByTab((previous) => ({ ...previous, [activeTab.id]: next }));
      }
    },
  };

  const openWithDocument =
    headerPanel.kind === 'open-with'
      ? documentService.get(headerPanel.documentId)
      : undefined;

  // Документу подходит несколько зарегистрированных типов — выбираем в панели.
  const openWithTypes =
    headerPanel.kind === 'open-with' && openWithDocument
      ? widgetTypesForDocument(
          catalogTypes,
          openWithDocument.moduleId,
          openWithDocument.documentType,
        )
      : [];

  const commitRename = (tabId: string, title: string) => {
    dispatch({ type: 'rename', tabId, title });
    setRenamingTabId(null);
  };

  // Пустое состояние (PBT-072 D6): стабильная ссылка — TabSurface-memo
  // не сравнивает её (см. TabSurfaceProps).
  const openWidgetCatalog = useCallback(() => {
    setHeaderPanel({ kind: 'widgets' });
  }, []);

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
      {/* Топ-бар каркаса (PBT-072 D1): название + индикатор сохранения. */}
      <AppTopBar title="Project Board">
        <PwaStatus prepareForUpdate={prepareForUpdate} />
        <p
          className={`save-state is-${saveStatus}`}
          role="status"
          aria-label="Состояние сохранения"
        >
          {SAVE_STATE_LABELS[saveStatus] ?? saveStatus}
        </p>
      </AppTopBar>
      <header className="tabs-header">
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
          {/* Сегмент-контрол режима вкладки (PBT-023; оформление PBT-072 D3). */}
          <div
            className="layout-mode-switch"
            role="group"
            aria-label="Режим размещения"
          >
            <button
              type="button"
              aria-pressed={layoutMode === 'cascade'}
              onClick={() => setLayoutMode('cascade')}
            >
              <Layers aria-hidden="true" />
              Каскад
            </button>
            <button
              type="button"
              aria-pressed={layoutMode === 'grid'}
              onClick={() => setLayoutMode('grid')}
            >
              <LayoutGrid aria-hidden="true" />
              Сетка
            </button>
          </div>
          <span className="header-anchor">
            <button
              type="button"
              ref={documentsButtonRef}
              className="add-widget-button"
              aria-label="Каталог документов"
              aria-expanded={headerPanel.kind === 'documents' || headerPanel.kind === 'open-with'}
              onClick={() =>
                setHeaderPanel((current) =>
                  current.kind === 'documents' || current.kind === 'open-with'
                    ? { kind: 'none' }
                    : { kind: 'documents' },
                )
              }
            >
              <FileText aria-hidden="true" />
              Документы
            </button>
            <DropdownPanel
              open={headerPanel.kind === 'documents' || headerPanel.kind === 'open-with'}
              onClose={() => setHeaderPanel({ kind: 'none' })}
              anchorRef={documentsButtonRef}
              ariaLabel="Каталог документов"
            >
              {headerPanel.kind === 'open-with' && openWithDocument ? (
                <div className="open-with">
                  <h2 className="dropdown-panel__title">
                    Открыть «{openWithDocument.title}» в:
                  </h2>
                  {openWithTypes.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      className="open-with__item"
                      onClick={() => openDocumentWithWidget(type, openWithDocument)}
                    >
                      <span aria-hidden="true"><WidgetIcon icon={type.icon} /></span>
                      {type.title}
                    </button>
                  ))}
                </div>
              ) : (
                <DocumentCatalogPanel
                  documents={allDocuments}
                  typeInfos={documentTypes}
                  loadError={documentsLoadError}
                  isFutureVersion={(documentId) =>
                    documentService.isFutureVersion(documentId)
                  }
                  openWindowCount={(documentId) =>
                    Object.values(panesByTab).reduce(
                      (sum, panes) =>
                        sum +
                        panes.filter(
                          (pane) => pane.documentId === documentId,
                        ).length,
                      0,
                    )
                  }
                  onOpen={openFromCatalog}
                  onCreate={createFromCatalog}
                  onRename={renameDocument}
                  onDelete={deleteDocument}
                />
              )}
            </DropdownPanel>
          </span>
          <span className="header-anchor">
            <button
              type="button"
              ref={widgetsButtonRef}
              className="add-widget-button"
              aria-label="Виджеты"
              aria-expanded={headerPanel.kind === 'widgets' || headerPanel.kind === 'picker'}
              onClick={() =>
                setHeaderPanel((current) =>
                  current.kind === 'widgets' || current.kind === 'picker'
                    ? { kind: 'none' }
                    : { kind: 'widgets' },
                )
              }
            >
              Виджеты
            </button>
            <DropdownPanel
              open={headerPanel.kind === 'widgets' || headerPanel.kind === 'picker'}
              onClose={() => setHeaderPanel({ kind: 'none' })}
              anchorRef={widgetsButtonRef}
              ariaLabel="Каталог виджетов"
            >
              {headerPanel.kind === 'picker' && pickerType ? (
                <DocumentPickerPanel
                  type={pickerType}
                  documents={pickerDocuments}
                  onCreate={createDocumentForPicker}
                  onOpen={(document) => openDocumentWithWidget(pickerType, document)}
                  onCancel={() => setHeaderPanel({ kind: 'widgets' })}
                />
              ) : (
                <WidgetCatalogPanel types={catalogTypes} onPick={handleCatalogPick} />
              )}
            </DropdownPanel>
          </span>
        </div>
      </header>

      <section
        className="instances"
        aria-label={`Пространство: ${activeTab?.title ?? ''}`}
        role="tabpanel"
      >
        {/* Keep-mounted (design D1): панели скрытых вкладок остаются
            смонтированы в hidden-контейнерах, состояние представления живо. */}
        {workspace.tabs.map((tab) => {
          const maximizedId = maximizedByTab[tab.id] ?? null;
          return (
          <TabSurface
            key={tab.id}
            tabTitle={tab.title}
            visible={tab.id === workspace.activeId}
            mode={modeByTab[tab.id] ?? 'cascade'}
            panes={panesByTab[tab.id] ?? []}
            areas={areasByTab[tab.id] ?? {}}
            cascade={
              cascadeByTab[tab.id] ?? { areas: {}, order: [] }
            }
            activeInstanceId={activeInstanceId}
            maximizedInstanceId={
              maximizedId &&
              (panesByTab[tab.id] ?? []).some(
                (pane) => pane.instanceId === maximizedId,
              )
                ? maximizedId
                : null
            }
            registry={widgetRegistry}
            documentService={documentService}
            documents={allDocuments}
            handlers={paneHandlersRef}
            onAddWidget={openWidgetCatalog}
          />
          );
        })}
      </section>
    </main>
  );
}
