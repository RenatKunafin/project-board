export { createWidgetRegistry } from './widget-registry';
export type {
  WidgetRegistry,
  WidgetTypeLookup,
  UnknownWidgetType as UnknownWidgetTypeData,
} from './widget-registry';
export { UnknownWidgetType } from './UnknownWidgetType';
export { WidgetWindow } from './WidgetWindow';
export type { WidgetWindowProps } from './WidgetWindow';
export { TiledLayout } from './TiledLayout';
export type { TiledItemInput, TiledLayoutProps } from './TiledLayout';
export {
  TILE_GAP,
  TILE_GRID_COLUMNS,
  TILE_ROW_HEIGHT,
  areaOf,
  areasFromPositions,
  defaultArea,
} from './tiled-layout';
export type { TiledArea, TiledLayoutState } from './tiled-layout';
export { StorageSelfTest } from './StorageSelfTest';
export { createDocumentService } from './document-service';
export type {
  AutosavingDocumentService,
  DocumentSaveState,
  DocumentSaveStatus,
  SaveStateHandler,
  DocumentStoreLike,
} from './document-service';
export { createWorkspaceState, addTab, renameTab, moveTab, removeTab, setActive } from './workspace';
export type {
  WorkspaceState,
  WorkspaceTab,
  WorkspaceError,
} from './workspace';
export { EmptyWorkspace } from './EmptyWorkspace';
export {
  createIndexedDbDocumentStore,
  IndexedDbDocumentStore,
  DOCUMENTS_DB_SCHEMA_VERSION,
} from './document-store';
export type {
  DocumentStore,
  PersistenceError as PersistenceErrorData,
} from './document-store';
export { PersistenceError } from './document-store';

export const DASHBOARD_PACKAGE = '@project-board/dashboard' as const;
