export { createWidgetRegistry } from './widget-registry';
export type {
  WidgetRegistry,
  WidgetTypeLookup,
  UnknownWidgetType as UnknownWidgetTypeData,
} from './widget-registry';
export { UnknownWidgetType } from './UnknownWidgetType';
export { StorageSelfTest } from './StorageSelfTest';
export { createDocumentService } from './document-service';
export type {
  AutosavingDocumentService,
  DocumentSaveState,
  DocumentSaveStatus,
  SaveStateHandler,
  DocumentStoreLike,
} from './document-service';
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
