import type { ManagedDocument } from '@project-board/widget-sdk';
import type {
  CascadeAreaRecord,
  GridAreaRecord,
  WidgetInstanceRecord,
  WorkspaceSnapshot,
  WorkspaceTabRecord,
} from './workspace-store';

export const WORKSPACE_BACKUP_FORMAT = 'project-board-workspace' as const;
export const WORKSPACE_BACKUP_FORMAT_VERSION = 1 as const;
export const WORKSPACE_BACKUP_SCHEMA_VERSION = 1 as const;

export interface WorkspaceBackupPayload {
  readonly documents: readonly ManagedDocument[];
  readonly workspace: WorkspaceSnapshot;
  readonly viewSettings: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface WorkspaceBackup extends WorkspaceBackupPayload {
  readonly format: typeof WORKSPACE_BACKUP_FORMAT;
  readonly formatVersion: typeof WORKSPACE_BACKUP_FORMAT_VERSION;
  readonly workspaceSchemaVersion: typeof WORKSPACE_BACKUP_SCHEMA_VERSION;
  readonly createdAt: string;
}

export interface WorkspaceBackupIssue {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface WorkspaceBackupCompatibility {
  readonly widgetTypeIds: readonly string[];
  readonly documentTypes: readonly {
    readonly moduleId: string;
    readonly documentType: string;
    readonly schemaVersion: number;
  }[];
}

export type WorkspaceBackupResult<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly WorkspaceBackupIssue[] }
  | { readonly ok: false; readonly issues: readonly WorkspaceBackupIssue[] };

export type WorkspaceBackupSerializeResult =
  | { readonly ok: true; readonly json: string; readonly issues: readonly WorkspaceBackupIssue[] }
  | { readonly ok: false; readonly issues: readonly WorkspaceBackupIssue[] };

type RecordValue = Record<string, unknown>;
type IssueSink = WorkspaceBackupIssue[];

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: IssueSink,
  severity: WorkspaceBackupIssue['severity'],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ severity, code, path, message });
}

function fail(issues: IssueSink, path: string, message: string, code = 'invalid-data'): void {
  addIssue(issues, 'error', code, path, message);
}

function hasOnlyKeys(
  value: RecordValue,
  allowed: readonly string[],
  path: string,
  issues: IssueSink,
): boolean {
  let valid = true;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      fail(issues, path, `Неизвестное поле «${String(key)}».`);
      valid = false;
    }
  }
  return valid;
}

function jsonClone(
  value: unknown,
  path: string,
  issues: IssueSink,
  ancestors = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(issues, path, 'Число должно быть конечным.', 'non-json-value');
      return undefined;
    }
    return value;
  }
  if (typeof value !== 'object') {
    fail(issues, path, 'Значение нельзя представить в JSON без потери данных.', 'non-json-value');
    return undefined;
  }
  if (ancestors.has(value)) {
    fail(issues, path, 'Обнаружена циклическая ссылка.', 'non-json-value');
    return undefined;
  }
  if (Object.getPrototypeOf(value) !== Array.prototype &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) {
    fail(issues, path, 'Поддерживаются только обычные JSON-объекты и массивы.', 'non-json-value');
    return undefined;
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        fail(issues, `${path}[${index}]`, 'Разреженный массив нельзя переносить.', 'non-json-value');
        result[index] = null;
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) {
        fail(issues, `${path}[${index}]`, 'Accessor-свойство нельзя переносить.', 'non-json-value');
        result[index] = null;
        continue;
      }
      result[index] = jsonClone(descriptor.value, `${path}[${index}]`, issues, ancestors);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        fail(issues, path, 'Массив содержит дополнительные свойства.', 'non-json-value');
      }
    }
    ancestors.delete(value);
    return result;
  }

  const result: RecordValue = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      fail(issues, path, 'Symbol-свойство нельзя переносить.', 'non-json-value');
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const childPath = `${path}.${key}`;
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined) {
      fail(issues, childPath, 'Свойство должно содержать JSON-значение.', 'non-json-value');
      continue;
    }
    Object.defineProperty(result, key, {
      value: jsonClone(descriptor.value, childPath, issues, ancestors),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  ancestors.delete(value);
  return result;
}

function nonEmptyString(value: unknown, path: string, issues: IssueSink): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(issues, path, 'Ожидается непустая строка.');
    return false;
  }
  return true;
}

function finiteNumber(value: unknown, path: string, issues: IssueSink, minimum: number): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    fail(issues, path, `Ожидается конечное число не меньше ${minimum}.`);
    return false;
  }
  return true;
}

function integer(value: unknown, path: string, issues: IssueSink, minimum: number): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    fail(issues, path, `Ожидается целое число не меньше ${minimum}.`);
    return false;
  }
  return true;
}

function validateArea(
  value: unknown,
  path: string,
  keys: readonly string[],
  integerGeometry: boolean,
  issues: IssueSink,
): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) {
    fail(issues, path, 'Область размещения должна быть объектом или null.');
    return false;
  }
  let valid = hasOnlyKeys(value, keys, path, issues);
  for (const key of keys) {
    const raw = value[key];
    const minimum = key === 'x' || key === 'y' ? 0 : Number.EPSILON;
    const ok = integerGeometry
      ? integer(raw, `${path}.${key}`, issues, key === 'x' || key === 'y' ? 0 : 1)
      : finiteNumber(raw, `${path}.${key}`, issues, minimum);
    valid &&= ok;
  }
  return valid;
}

function validateWorkspace(
  value: unknown,
  documents: readonly ManagedDocument[],
  viewSettings: unknown,
  issues: IssueSink,
): value is WorkspaceSnapshot {
  if (!isRecord(value)) {
    fail(issues, 'workspace', 'Раздел workspace обязателен и должен быть объектом.');
    return false;
  }
  let valid = hasOnlyKeys(value, ['tabs', 'instances', 'activeTabId'], 'workspace', issues);
  const tabsValue = value.tabs;
  const instancesValue = value.instances;
  if (!Array.isArray(tabsValue) || tabsValue.length === 0) {
    fail(issues, 'workspace.tabs', 'Должна существовать хотя бы одна вкладка.');
    valid = false;
  }
  if (!Array.isArray(instancesValue)) {
    fail(issues, 'workspace.instances', 'Ожидается массив экземпляров.');
    valid = false;
  }
  const tabs = Array.isArray(tabsValue) ? tabsValue : [];
  const instances = Array.isArray(instancesValue) ? instancesValue : [];
  const tabIds = new Set<string>();
  const positions = new Set<number>();
  const activeId = value.activeTabId;
  let activeCount = 0;
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index] as unknown;
    const path = `workspace.tabs[${index}]`;
    if (!isRecord(tab)) {
      fail(issues, path, 'Вкладка должна быть объектом.');
      valid = false;
      continue;
    }
    valid &&= hasOnlyKeys(tab, ['id', 'title', 'position', 'mode', 'cascadeOrder', 'active'], path, issues);
    const idOk = nonEmptyString(tab.id, `${path}.id`, issues);
    const titleOk = nonEmptyString(tab.title, `${path}.title`, issues);
    const positionOk = integer(tab.position, `${path}.position`, issues, 0);
    valid &&= idOk && titleOk && positionOk;
    if (idOk && typeof tab.id === 'string') {
      if (tabIds.has(tab.id)) {
        fail(issues, `${path}.id`, 'ID вкладки повторяется.', 'duplicate-id');
        valid = false;
      }
      tabIds.add(tab.id);
    }
    if (positionOk && typeof tab.position === 'number') {
      if (positions.has(tab.position)) {
        fail(issues, `${path}.position`, 'Позиция вкладки повторяется.');
        valid = false;
      }
      positions.add(tab.position);
    }
    if (tab.mode !== 'grid' && tab.mode !== 'cascade') {
      fail(issues, `${path}.mode`, 'Неизвестный режим расположения.');
      valid = false;
    }
    if (!Array.isArray(tab.cascadeOrder)) {
      fail(issues, `${path}.cascadeOrder`, 'Ожидается массив ID окон.');
      valid = false;
    }
    if (tab.active !== 0 && tab.active !== 1) {
      fail(issues, `${path}.active`, 'Флаг активности должен быть 0 или 1.');
      valid = false;
    }
    if (tab.active === 1) activeCount += 1;
  }

  if (typeof activeId !== 'string' || !tabIds.has(activeId)) {
    fail(issues, 'workspace.activeTabId', 'Активная вкладка отсутствует.');
    valid = false;
  }
  if (activeCount !== 1 || tabs.filter((tab) => isRecord(tab) && tab.id === activeId && tab.active === 1).length !== 1) {
    fail(issues, 'workspace.tabs', 'Ровно активная вкладка должна иметь active=1.');
    valid = false;
  }

  const instanceIds = new Set<string>();
  const instanceById = new Map<string, RecordValue>();
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index] as unknown;
    const path = `workspace.instances[${index}]`;
    if (!isRecord(instance)) {
      fail(issues, path, 'Экземпляр должен быть объектом.');
      valid = false;
      continue;
    }
    valid &&= hasOnlyKeys(instance, ['id', 'tabId', 'typeId', 'documentId', 'label', 'collapsed', 'gridArea', 'cascadeArea'], path, issues);
    for (const key of ['id', 'tabId', 'typeId'] as const) {
      valid &&= nonEmptyString(instance[key], `${path}.${key}`, issues);
    }
    if (instance.documentId !== undefined) valid &&= nonEmptyString(instance.documentId, `${path}.documentId`, issues);
    if (instance.label !== undefined && typeof instance.label !== 'string') {
      fail(issues, `${path}.label`, 'Подпись окна должна быть строкой.');
      valid = false;
    }
    if (instance.collapsed !== 0 && instance.collapsed !== 1) {
      fail(issues, `${path}.collapsed`, 'Флаг свёрнутости должен быть 0 или 1.');
      valid = false;
    }
    valid &&= validateArea(instance.gridArea, `${path}.gridArea`, ['x', 'y', 'w', 'h'], true, issues);
    valid &&= validateArea(instance.cascadeArea, `${path}.cascadeArea`, ['x', 'y', 'width', 'height'], false, issues);
    if (typeof instance.id === 'string') {
      if (instanceIds.has(instance.id)) {
        fail(issues, `${path}.id`, 'ID экземпляра повторяется.', 'duplicate-id');
        valid = false;
      }
      instanceIds.add(instance.id);
      instanceById.set(instance.id, instance);
    }
    if (typeof instance.tabId === 'string' && !tabIds.has(instance.tabId)) {
      fail(issues, `${path}.tabId`, 'Экземпляр ссылается на неизвестную вкладку.', 'invalid-reference');
      valid = false;
    }
  }

  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (!isRecord(tab) || !Array.isArray(tab.cascadeOrder)) continue;
    const seen = new Set<string>();
    for (let orderIndex = 0; orderIndex < tab.cascadeOrder.length; orderIndex += 1) {
      const id = tab.cascadeOrder[orderIndex];
      const path = `workspace.tabs[${index}].cascadeOrder[${orderIndex}]`;
      if (typeof id !== 'string' || seen.has(id) || instanceById.get(id)?.tabId !== tab.id) {
        fail(issues, path, 'Порядок каскада содержит неизвестный, повторный или чужой ID окна.', 'invalid-reference');
        valid = false;
      }
      if (typeof id === 'string') seen.add(id);
    }
  }

  const documentIds = new Set<string>();
  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    if (documentIds.has(document.id)) {
      fail(issues, `documents[${index}].id`, 'ID документа повторяется.', 'duplicate-id');
      valid = false;
    }
    documentIds.add(document.id);
  }
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    if (isRecord(instance) && typeof instance.documentId === 'string' && !documentIds.has(instance.documentId)) {
      addIssue(issues, 'warning', 'document-missing', `workspace.instances[${index}].documentId`, `Документ «${instance.documentId}» отсутствует.`);
    }
  }

  if (!isRecord(viewSettings)) {
    fail(issues, 'viewSettings', 'Ожидается объект настроек представлений.');
    valid = false;
  } else {
    for (const [instanceId, settings] of Object.entries(viewSettings)) {
      if (!instanceIds.has(instanceId)) {
        fail(issues, `viewSettings.${instanceId}`, 'Настройки принадлежат отсутствующему экземпляру.', 'invalid-reference');
        valid = false;
      }
      if (!isRecord(settings)) {
        fail(issues, `viewSettings.${instanceId}`, 'Настройки экземпляра должны быть объектом.');
        valid = false;
      }
    }
  }
  return valid;
}

function validateBackup(
  value: unknown,
  issues: IssueSink,
  compatibility?: WorkspaceBackupCompatibility,
): value is WorkspaceBackup {
  if (!isRecord(value)) {
    fail(issues, '', 'Файл резервной копии должен содержать JSON-объект.');
    return false;
  }
  let valid = hasOnlyKeys(value, ['format', 'formatVersion', 'workspaceSchemaVersion', 'createdAt', 'documents', 'workspace', 'viewSettings'], '', issues);
  if (value.format !== WORKSPACE_BACKUP_FORMAT) {
    fail(issues, 'format', 'Неизвестный формат файла.', 'unknown-format');
    valid = false;
  }
  if (!integer(value.formatVersion, 'formatVersion', issues, 1) || value.formatVersion > WORKSPACE_BACKUP_FORMAT_VERSION) {
    fail(issues, 'formatVersion', `Поддерживается версия ${WORKSPACE_BACKUP_FORMAT_VERSION}.`, 'unsupported-format-version');
    valid = false;
  }
  if (!integer(value.workspaceSchemaVersion, 'workspaceSchemaVersion', issues, 1) || value.workspaceSchemaVersion > WORKSPACE_BACKUP_SCHEMA_VERSION) {
    fail(issues, 'workspaceSchemaVersion', `Поддерживается версия ${WORKSPACE_BACKUP_SCHEMA_VERSION}.`, 'unsupported-workspace-version');
    valid = false;
  }
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !/^\d{4}-\d\d-\d\dT.*Z$/.test(value.createdAt)) {
    fail(issues, 'createdAt', 'Ожидается временная метка UTC в формате ISO.');
    valid = false;
  }
  if (!Array.isArray(value.documents)) {
    fail(issues, 'documents', 'Ожидается массив документов.');
    valid = false;
  }
  const documents: ManagedDocument[] = [];
  const documentRows = Array.isArray(value.documents) ? value.documents : [];
  const documentKeys = ['id', 'moduleId', 'documentType', 'title', 'schemaVersion', 'revision', 'createdAt', 'updatedAt', 'content'] as const;
  for (let index = 0; index < documentRows.length; index += 1) {
    const document = documentRows[index];
    const path = `documents[${index}]`;
    if (!isRecord(document)) {
      fail(issues, path, 'Документ должен быть объектом.');
      valid = false;
      continue;
    }
    valid &&= hasOnlyKeys(document, documentKeys, path, issues);
    for (const key of ['id', 'moduleId', 'documentType', 'title'] as const) valid &&= nonEmptyString(document[key], `${path}.${key}`, issues);
    valid &&= integer(document.schemaVersion, `${path}.schemaVersion`, issues, 0);
    valid &&= integer(document.revision, `${path}.revision`, issues, 1);
    for (const key of ['createdAt', 'updatedAt'] as const) {
      if (typeof document[key] !== 'string' || !Number.isFinite(Date.parse(document[key])) || !/^\d{4}-\d\d-\d\dT.*Z$/.test(document[key])) {
        fail(issues, `${path}.${key}`, 'Ожидается временная метка UTC в формате ISO.');
        valid = false;
      }
    }
    if (!Object.hasOwn(document, 'content')) {
      fail(issues, `${path}.content`, 'Содержимое документа обязательно.');
      valid = false;
    }
    documents.push(document as unknown as ManagedDocument);
    const support = compatibility?.documentTypes.find((entry) => entry.moduleId === document.moduleId && entry.documentType === document.documentType);
    if (compatibility && !support) addIssue(issues, 'warning', 'unknown-document-type', `${path}.documentType`, 'Тип документа не установлен в текущей сборке.');
    else if (support && typeof document.schemaVersion === 'number' && document.schemaVersion > support.schemaVersion) {
      addIssue(issues, 'warning', 'future-document-version', `${path}.schemaVersion`, `Формат документа ${document.schemaVersion} новее поддерживаемой версии ${support.schemaVersion}.`);
    } else if (support && typeof document.schemaVersion === 'number' && document.schemaVersion < support.schemaVersion) {
      addIssue(issues, 'warning', 'outdated-document-version', `${path}.schemaVersion`, `Формат документа ${document.schemaVersion} будет обновлён до версии ${support.schemaVersion} при восстановлении.`);
    }
  }

  valid &&= validateWorkspace(value.workspace, documents, value.viewSettings, issues);
  if (compatibility) {
    const widgetIds = new Set(compatibility.widgetTypeIds);
    const workspaceValue = isRecord(value.workspace) ? value.workspace : null;
    const workspaceInstances = workspaceValue && Array.isArray(workspaceValue.instances) ? workspaceValue.instances : [];
    for (let index = 0; index < workspaceInstances.length; index += 1) {
      const instance = workspaceInstances[index];
      if (isRecord(instance) && typeof instance.typeId === 'string' && !widgetIds.has(instance.typeId)) {
        addIssue(issues, 'warning', 'unknown-widget-type', `workspace.instances[${index}].typeId`, 'Тип окна не установлен в текущей сборке.');
      }
    }
  }
  return valid;
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function serializeWorkspaceBackup(
  payload: WorkspaceBackupPayload,
  createdAt: string,
): WorkspaceBackupSerializeResult {
  const issues: IssueSink = [];
  const cloned = jsonClone({
    format: WORKSPACE_BACKUP_FORMAT,
    formatVersion: WORKSPACE_BACKUP_FORMAT_VERSION,
    workspaceSchemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
    createdAt,
    documents: payload.documents,
    workspace: payload.workspace,
    viewSettings: payload.viewSettings,
  }, '', issues);
  if (issues.some(({ severity }) => severity === 'error')) return { ok: false, issues };
  if (!validateBackup(cloned, issues)) return { ok: false, issues };
  try {
    return { ok: true, json: JSON.stringify(cloned, null, 2), issues };
  } catch (error) {
    fail(issues, '', error instanceof Error ? error.message : String(error), 'non-json-value');
    return { ok: false, issues };
  }
}

export function deserializeWorkspaceBackup(
  text: string,
  compatibility?: WorkspaceBackupCompatibility,
): WorkspaceBackupResult<WorkspaceBackup> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, issues: [{ severity: 'error', code: 'invalid-json', path: '', message: error instanceof Error ? error.message : String(error) }] };
  }
  const issues: IssueSink = [];
  const cloned = jsonClone(parsed, '', issues);
  if (issues.some(({ severity }) => severity === 'error')) return { ok: false, issues };
  if (!validateBackup(cloned, issues, compatibility)) return { ok: false, issues };
  return {
    ok: true,
    value: deepCloneJson(cloned),
    issues,
  };
}

export type { GridAreaRecord, CascadeAreaRecord, WidgetInstanceRecord, WorkspaceSnapshot, WorkspaceTabRecord };
