/**
 * Декларация схемы локальной БД «project-board», общая для всех модулей
 * доступа: новое хранилище добавляется только новой версией схемы.
 */
export const WORKSPACE_DB_SCHEMA_VERSION = 3;

export const DOCUMENTS_TABLE_DECLARATION = 'id, moduleId, documentType';

export const WORKSPACE_TABLE_DECLARATIONS = {
  tabs: 'id, position',
  widgetInstances: 'id, tabId',
  settings: 'key',
} as const;

export const BACKUPS_TABLE_DECLARATION = 'id, createdAt, kind';

export const SCHEMA_V1_DECLARATIONS = {
  documents: DOCUMENTS_TABLE_DECLARATION,
} as const;

export const SCHEMA_V2_DECLARATIONS = {
  documents: DOCUMENTS_TABLE_DECLARATION,
  ...WORKSPACE_TABLE_DECLARATIONS,
} as const;

export const SCHEMA_V3_DECLARATIONS = {
  ...SCHEMA_V2_DECLARATIONS,
  backups: BACKUPS_TABLE_DECLARATION,
} as const;
