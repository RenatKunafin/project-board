import Dexie, { type Table } from 'dexie';
import {
  DocumentConflictError,
  type ManagedDocument,
} from '@project-board/widget-sdk';
import {
  WORKSPACE_DB_SCHEMA_VERSION,
  SCHEMA_V1_DECLARATIONS,
  SCHEMA_V2_DECLARATIONS,
  SCHEMA_V3_DECLARATIONS,
} from './db-schema';

export type PersistenceErrorCode =
  | 'open-failed'
  | 'write-failed'
  | 'read-failed'
  | 'schema-version-unsupported'
  | 'document-not-found';

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

export interface DocumentStoreSaveEntry {
  readonly document: ManagedDocument;
  readonly expectedStoredRevision: number;
}

export interface DocumentStore {
  save(
    document: ManagedDocument,
    expectedStoredRevision: number,
  ): Promise<void>;
  /** Пакетная фиксация в одной транзакции: сбой любой записи откатывает всё. */
  saveAll(entries: readonly DocumentStoreSaveEntry[]): Promise<void>;
  get(documentId: string): Promise<ManagedDocument | undefined>;
  listByModule(moduleId: string): Promise<ManagedDocument[]>;
  listByType(documentType: string): Promise<ManagedDocument[]>;
  listAll(): Promise<ManagedDocument[]>;
  delete(documentId: string): Promise<void>;
  close(): void;
}

export const DB_SCHEMA_VERSION = WORKSPACE_DB_SCHEMA_VERSION;
/** Историческое имя константы: общая версия схемы БД приложения. */
export const DOCUMENTS_DB_SCHEMA_VERSION = DB_SCHEMA_VERSION;

export class IndexedDbDocumentStore implements DocumentStore {
  private readonly db: Dexie;
  private readonly documents: Table<ManagedDocument, string>;
  private readonly settings: Table<{ key: string; value: unknown }, string>;
  private opened = false;
  private generation = 0;

  constructor(name: string) {
    this.db = new Dexie(name);
    this.db.version(1).stores(SCHEMA_V1_DECLARATIONS);
    this.db.version(2).stores(SCHEMA_V2_DECLARATIONS);
    this.db.version(3).stores(SCHEMA_V3_DECLARATIONS);
    this.documents = this.db.table('documents');
    this.settings = this.db.table('settings');
  }

  async open(): Promise<void> {
    try {
      await this.db.open();
      // Dexie хранит нативную версию как номер версии * 10.
      const expectedNativeVersion = DB_SCHEMA_VERSION * 10;
      const nativeVersion = this.db.backendDB()?.version;
      if (
        typeof nativeVersion === 'number' &&
        nativeVersion > expectedNativeVersion
      ) {
        this.db.close();
        throw new PersistenceError(
          'schema-version-unsupported',
          `Локальная БД имеет версию схемы ${Math.floor(nativeVersion / 10)}, приложение поддерживает ${DB_SCHEMA_VERSION}. Обновите приложение или очистите данные сайта.`,
        );
      }
      this.opened = true;
      const setting = await this.settings.get('__generation');
      this.generation = typeof setting?.value === 'number' ? setting.value : 0;
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async save(
    document: ManagedDocument,
    expectedStoredRevision: number,
  ): Promise<void> {
    try {
      await this.openOnce();
      await this.db.transaction('rw', [this.documents, this.settings], async () => {
        const [setting, stored] = await Promise.all([
          this.settings.get('__generation'),
          this.documents.get(document.id),
        ]);
        this.assertGeneration(setting);
        const storedRevision = stored?.revision ?? 0;
        if (storedRevision !== expectedStoredRevision) {
          throw new DocumentConflictError(
            document.id,
            storedRevision,
            expectedStoredRevision,
          );
        }
        await this.documents.put(document);
      });
    } catch (error) {
      if (error instanceof DocumentConflictError) {
        throw error;
      }
      throw toPersistenceError(error);
    }
  }

  async saveAll(
    entries: readonly DocumentStoreSaveEntry[],
  ): Promise<void> {
    try {
      await this.openOnce();
      await this.db.transaction('rw', [this.documents, this.settings], async () => {
        const setting = await this.settings.get('__generation');
        this.assertGeneration(setting);
        for (const entry of entries) {
          const stored = await this.documents.get(entry.document.id);
          const storedRevision = stored?.revision ?? 0;
          if (storedRevision !== entry.expectedStoredRevision) {
            throw new DocumentConflictError(
              entry.document.id,
              storedRevision,
              entry.expectedStoredRevision,
            );
          }
          await this.documents.put(entry.document);
        }
      });
    } catch (error) {
      if (error instanceof DocumentConflictError) {
        throw error;
      }
      throw toPersistenceError(error);
    }
  }

  async get(documentId: string): Promise<ManagedDocument | undefined> {
    try {
      await this.openOnce();
      return await this.documents.get(documentId);
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async listByModule(moduleId: string): Promise<ManagedDocument[]> {
    try {
      await this.openOnce();
      return await this.documents.where('moduleId').equals(moduleId).toArray();
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async listByType(documentType: string): Promise<ManagedDocument[]> {
    try {
      await this.openOnce();
      return await this.documents
        .where('documentType')
        .equals(documentType)
        .toArray();
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async listAll(): Promise<ManagedDocument[]> {
    try {
      await this.openOnce();
      return await this.documents.toArray();
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async delete(documentId: string): Promise<void> {
    try {
      await this.openOnce();
      await this.db.transaction('rw', [this.documents, this.settings], async () => {
        const setting = await this.settings.get('__generation');
        this.assertGeneration(setting);
        await this.documents.delete(documentId);
      });
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  close(): void {
    this.db.close();
    this.opened = false;
  }

  private async openOnce(): Promise<void> {
    if (!this.opened) {
      await this.open();
    }
  }

  private assertGeneration(row: { value?: unknown } | undefined): void {
    const current = typeof row?.value === 'number' ? row.value : 0;
    if (current !== this.generation) {
      throw new PersistenceError('write-failed', 'Рабочее пространство восстановлено в другом окне. Перезагрузите приложение.');
    }
  }
}

function toPersistenceError(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) {
    return error;
  }
  if (error instanceof Dexie.MissingAPIError) {
    return new PersistenceError(
      'open-failed',
      'IndexedDB недоступен в этом окружении.',
    );
  }
  if (error instanceof Dexie.VersionError) {
    return new PersistenceError(
      'schema-version-unsupported',
      'Локальная БД создана более новой версией приложения. Обновите приложение или очистите данные сайта.',
    );
  }
  return new PersistenceError(
    'write-failed',
    error instanceof Error ? error.message : String(error),
  );
}

export function createIndexedDbDocumentStore(name: string): DocumentStore {
  return new IndexedDbDocumentStore(name);
}
