/**
 * Декларация схемы локальной БД «project-board», общая для всех модулей
 * доступа: новое хранилище добавляется только новой версией схемы.
 */
export const WORKSPACE_DB_SCHEMA_VERSION = 2;

export const DOCUMENTS_TABLE_DECLARATION = 'id, moduleId, documentType';

export const WORKSPACE_TABLE_DECLARATIONS = {
  tabs: 'id, position',
  widgetInstances: 'id, tabId',
  settings: 'key',
} as const;
