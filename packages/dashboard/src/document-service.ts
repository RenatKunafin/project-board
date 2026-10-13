import type {
  DocumentChangeHandler,
  DocumentCreateInput,
  DocumentMigrationsSupport,
  DocumentService,
  ManagedDocument,
  Unsubscribe,
} from '@project-board/widget-sdk';
import {
  DocumentConflictError,
  DocumentFutureVersionError,
  assertDocumentTitle,
} from '@project-board/widget-sdk';

export type DocumentSaveStatus = 'saved' | 'saving' | 'error' | 'conflict';

export interface DocumentSaveState {
  readonly status: DocumentSaveStatus;
  readonly at: string;
}

export type SaveStateHandler = (state: DocumentSaveState) => void;

/** Проблема восстановления документа: миграция не выполнена, документ нетронут. */
export interface DocumentRecoveryIssue {
  readonly documentId: string;
  readonly moduleId: string;
  readonly documentType: string;
  readonly storedVersion: number;
  readonly targetVersion: number;
  readonly reason: 'chain-gap' | 'step-failed';
  readonly detail?: string;
}

/** Минимальный контракт хранилища, необходимый сервису. */
export interface DocumentStoreLike {
  save(
    document: ManagedDocument,
    expectedStoredRevision: number,
  ): Promise<void>;
  /** Пакетная фиксация в одной транзакции: сбой любой записи откатывает всё. */
  saveAll(
    entries: readonly {
      readonly document: ManagedDocument;
      readonly expectedStoredRevision: number;
    }[],
  ): Promise<void>;
  get(documentId: string): Promise<ManagedDocument | undefined>;
  listAll(): Promise<ManagedDocument[]>;
  delete(documentId: string): Promise<void>;
}

export interface PersistenceHooks {
  readonly store: DocumentStoreLike;
  readonly saveDelayMs?: number;
  /** Поддержка миграций: собирается приложением из зарегистрированных типов. */
  readonly migrations?: readonly DocumentMigrationsSupport[];
}

interface DocumentRecord {
  document: ManagedDocument;
  handlers: DocumentChangeHandler[];
}

interface SaveQueueEntry {
  pending: ManagedDocument | null;
  lastSavedRevision: number;
  inFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
}

const MAX_SAVE_RETRIES = 3;
const RETRY_DELAYS_MS = [250, 500, 1000];

export interface AutosavingDocumentService extends DocumentService {
  /** Восстанавливает все документы из хранилища в память. */
  restoreAll(): Promise<ManagedDocument[]>;
/** Немедленно записывает все отложенные правки (закрытие страницы). */
  flushAll(): Promise<void>;
  /** Выборка документов из памяти, опционально по модулю и типу. */
  listDocuments(
    filter?: { readonly moduleId?: string; readonly documentType?: string },
  ): ManagedDocument[];
  getSaveState(documentId: string): DocumentSaveState | undefined;
  subscribeSaveState(
    documentId: string,
    handler: SaveStateHandler,
  ): Unsubscribe;
  /** Проблемы миграций последнего восстановления (design D2). */
  listRecoveryIssues(): DocumentRecoveryIssue[];
  /** Документ записан версией новее поддерживаемой: запись запрещена. */
  isFutureVersion(documentId: string): boolean;
}

/** Разрыв цепочки миграций: нет шага из хранимой версии. */
class MigrationChainGapError extends Error {}

export function createDocumentService(
  persistence?: Partial<PersistenceHooks>,
): AutosavingDocumentService {
  const store = persistence?.store;
  const saveDelayMs = persistence?.saveDelayMs ?? 250;

  const documents = new Map<string, DocumentRecord>();
  const viewSettings = new Map<string, Record<string, unknown>>();
  const queue = new Map<string, SaveQueueEntry>();
  const saveStates = new Map<string, DocumentSaveState>();
  const saveStateHandlers = new Map<string, Set<SaveStateHandler>>();
  let notifyingDocumentId: string | null = null;

  // Индекс поддержки миграций и результаты последнего восстановления.
  const migrationsIndex = new Map<string, DocumentMigrationsSupport>();
  for (const support of persistence?.migrations ?? []) {
    migrationsIndex.set(
      `${support.moduleId}/${support.documentType}`,
      support,
    );
  }
  const futureVersionIds = new Set<string>();
  const recoveryIssues: DocumentRecoveryIssue[] = [];

  const supportKey = (
    document: Pick<ManagedDocument, 'moduleId' | 'documentType'>,
  ): string => `${document.moduleId}/${document.documentType}`;

  /** Записи в документ версии новее поддерживаемой запрещены (design D3). */
  function assertNotFutureVersion(document: ManagedDocument): void {
    const support = migrationsIndex.get(supportKey(document));
    if (support && document.schemaVersion > support.actualVersion) {
      throw new DocumentFutureVersionError(
        document.id,
        document.schemaVersion,
        support.actualVersion,
      );
    }
  }

  /** Цепочка шагов «от хранимой версии к актуальной»; разрыв — исключение. */
  function buildChain(
    support: DocumentMigrationsSupport,
    fromVersion: number,
  ): { step: DocumentMigrationsSupport['steps'][number] }[] {
    const chain: { step: DocumentMigrationsSupport['steps'][number] }[] = [];
    let current = fromVersion;
    while (current < support.actualVersion) {
      const step = support.steps.find(
        (candidate) => candidate.from === current,
      );
      if (!step) {
        throw new MigrationChainGapError(
          `разрыв цепочки миграций: нет шага из версии ${current} (актуальная ${support.actualVersion})`,
        );
      }
      chain.push({ step });
      current = step.to;
    }
    return chain;
  }

  function setSaveState(documentId: string, status: DocumentSaveStatus): void {
    const state: DocumentSaveState = {
      status,
      at: new Date().toISOString(),
    };
    saveStates.set(documentId, state);
    const handlers = saveStateHandlers.get(documentId);
    if (handlers) {
      for (const handler of [...handlers]) {
        handler(state);
      }
    }
  }

  function enqueue(document: ManagedDocument): void {
    if (!store) {
      return;
    }
    let entry = queue.get(document.id);
    if (!entry) {
      entry = {
        pending: null,
        lastSavedRevision: 0,
        inFlight: false,
        timer: null,
        retryAttempt: 0,
      };
      queue.set(document.id, entry);
    }
    entry.pending = document;
    if (entry.timer !== null) {
      // Flush уже запланирован: обновляем только pending, чтобы сохранить
      // порядок планирования между документами.
      return;
    }
    setSaveState(document.id, 'saving');
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void flushDocument(document.id);
    }, saveDelayMs);
  }

  async function flushDocument(documentId: string): Promise<void> {
    if (!store) {
      return;
    }
    const entry = queue.get(documentId);
    if (!entry || entry.inFlight || entry.pending === null) {
      return;
    }
    const document = entry.pending;
    entry.pending = null;
    entry.inFlight = true;
    setSaveState(documentId, 'saving');

    try {
      await store.save(document, entry.lastSavedRevision);
      entry.lastSavedRevision = document.revision;
      entry.retryAttempt = 0;
      entry.inFlight = false;
      if (entry.pending !== null) {
        void flushDocument(documentId);
      } else {
        setSaveState(documentId, 'saved');
      }
    } catch (error) {
      entry.inFlight = false;
      if (error instanceof DocumentConflictError) {
        await resolveConflict(documentId, entry);
        return;
      }
      if (entry.retryAttempt < MAX_SAVE_RETRIES) {
        const delay =
          RETRY_DELAYS_MS[
            Math.min(entry.retryAttempt, RETRY_DELAYS_MS.length - 1)
          ];
        entry.retryAttempt += 1;
        entry.pending = document;
        entry.timer = setTimeout(() => {
          entry.timer = null;
          void flushDocument(documentId);
        }, delay);
        setSaveState(documentId, 'saving');
        return;
      }
      entry.retryAttempt = 0;
      entry.pending = document;
      setSaveState(documentId, 'error');
    }
  }

  async function resolveConflict(
    documentId: string,
    entry: SaveQueueEntry,
  ): Promise<void> {
    entry.retryAttempt = 0;
    const stored = (await store?.get(documentId)) ?? undefined;
    const record = documents.get(documentId);
    if (stored && record) {
      record.document = stored;
      entry.lastSavedRevision = stored.revision;
      notifyingDocumentId = documentId;
      try {
        for (const handler of [...record.handlers]) {
          handler(stored);
        }
      } finally {
        notifyingDocumentId = null;
      }
    }
    entry.pending = null;
    setSaveState(documentId, 'conflict');
  }

  const base: DocumentService = {
    create(input: DocumentCreateInput): ManagedDocument {
      const now = new Date().toISOString();
      const document: ManagedDocument = {
        id: crypto.randomUUID(),
        moduleId: input.moduleId,
        documentType: input.documentType,
        title: assertDocumentTitle(input.title),
        schemaVersion: input.schemaVersion,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        content: input.content,
      };
      documents.set(document.id, { document, handlers: [] });
      enqueue(document);
      return document;
    },

    get(documentId: string): ManagedDocument | undefined {
      return documents.get(documentId)?.document;
    },

    update(
      documentId: string,
      expectedRevision: number,
      nextContent: ManagedDocument['content'],
    ): ManagedDocument {
      if (notifyingDocumentId === documentId) {
        throw new Error(
          `Недопустимо обновлять документ "${documentId}" во время доставки его уведомлений.`,
        );
      }

      const record = documents.get(documentId);
      if (!record) {
        throw new DocumentConflictError(documentId, 0, expectedRevision);
      }
      assertNotFutureVersion(record.document);

      const actualRevision = record.document.revision;
      if (actualRevision !== expectedRevision) {
        throw new DocumentConflictError(
          documentId,
          actualRevision,
          expectedRevision,
        );
      }

      const updated: ManagedDocument = {
        ...record.document,
        revision: actualRevision + 1,
        updatedAt: new Date().toISOString(),
        content: nextContent,
      };
      record.document = updated;
      enqueue(updated);

      notifyingDocumentId = documentId;
      try {
        for (const handler of [...record.handlers]) {
          handler(updated);
        }
      } finally {
        notifyingDocumentId = null;
      }
      return updated;
    },

    subscribe(documentId: string, handler: DocumentChangeHandler): Unsubscribe {
      const record = documents.get(documentId);
      if (!record) {
        return () => {};
      }
      record.handlers.push(handler);
      return () => {
        record.handlers = record.handlers.filter((h) => h !== handler);
      };
    },

    rename(
      documentId: string,
      expectedRevision: number,
      title: string,
    ): ManagedDocument {
      if (notifyingDocumentId === documentId) {
        throw new Error(
          `Недопустимо обновлять документ "${documentId}" во время доставки его уведомлений.`,
        );
      }
      const record = documents.get(documentId);
      if (!record) {
        throw new DocumentConflictError(documentId, 0, expectedRevision);
      }
      assertNotFutureVersion(record.document);
      const actualRevision = record.document.revision;
      if (actualRevision !== expectedRevision) {
        throw new DocumentConflictError(
          documentId,
          actualRevision,
          expectedRevision,
        );
      }
      const renamed: ManagedDocument = {
        ...record.document,
        title: assertDocumentTitle(title),
        revision: actualRevision + 1,
        updatedAt: new Date().toISOString(),
      };
      record.document = renamed;
      enqueue(renamed);
      notifyingDocumentId = documentId;
      try {
        for (const handler of [...record.handlers]) {
          handler(renamed);
        }
      } finally {
        notifyingDocumentId = null;
      }
      return renamed;
    },

    async delete(documentId: string): Promise<void> {
      const existing = documents.get(documentId)?.document;
      if (existing) {
        assertNotFutureVersion(existing);
      }
      // Отложенная запись снимается первой: незавершённый таймер не должен
      // вернуть документ в хранилище после удаления. Сама запись очереди
      // удаляется после успеха store.delete: при сбое lastSavedRevision
      // сохраняется для следующей операции над живым документом.
      const entry = queue.get(documentId);
      if (entry) {
        if (entry.timer !== null) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
        entry.pending = null;
      }
      if (store) {
        await store.delete(documentId);
      }
      queue.delete(documentId);
      documents.delete(documentId);
      saveStates.delete(documentId);
      saveStateHandlers.delete(documentId);
    },

    getViewSettings(
      viewSettingsKey: string,
    ): Record<string, unknown> | undefined {
      return viewSettings.get(viewSettingsKey);
    },

    setViewSettings(
      viewSettingsKey: string,
      settings: Record<string, unknown>,
    ): void {
      viewSettings.set(viewSettingsKey, settings);
    },
  };

  return {
    ...base,
    async flushAll(): Promise<void> {
      // Немедленный flush всех отложенных записей (например, при закрытии страницы).
      const ids = [...queue.keys()];
      await Promise.all(ids.map((id) => flushDocument(id)));
    },
    async restoreAll(): Promise<ManagedDocument[]> {
      if (!store) {
        return [];
      }
      const all = await store.listAll();

      // Классификация (design D2): actual / outdated / future / unknown.
      const recovered: {
        document: ManagedDocument;
        expectedStoredRevision: number;
      }[] = [];
      futureVersionIds.clear();
      recoveryIssues.length = 0;

      for (const stored of all) {
        const support = migrationsIndex.get(supportKey(stored));
        if (!support) {
          continue; // unknown: модуль не зарегистрирован — документ не трогаем.
        }
        if (stored.schemaVersion === support.actualVersion) {
          continue; // actual: миграции не выполняются (однократность, D5).
        }
        if (stored.schemaVersion > support.actualVersion) {
          futureVersionIds.add(stored.id); // future: чтение без записи (D3).
          continue;
        }
        // outdated: цепочка миграций от хранимой версии к актуальной.
        try {
          const chain = buildChain(support, stored.schemaVersion);
          let content = stored.content;
          for (const { step } of chain) {
            content = step.migrate(content);
          }
          recovered.push({
            document: {
              ...stored,
              schemaVersion: support.actualVersion,
              content,
            },
            expectedStoredRevision: stored.revision,
          });
        } catch (error) {
          // Сбой шага/разрыв: документ остаётся нетронутым, восстановление
          // продолжается (spec «Сбой преобразования не повреждает документ»).
          const isChainGap = error instanceof MigrationChainGapError;
          recoveryIssues.push({
            documentId: stored.id,
            moduleId: stored.moduleId,
            documentType: stored.documentType,
            storedVersion: stored.schemaVersion,
            targetVersion: support.actualVersion,
            reason: isChainGap ? 'chain-gap' : 'step-failed',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Атомарная фиксация одной транзакцией: сбой отклоняется целиком,
      // хранилище остаётся в исходном состоянии.
      if (recovered.length > 0) {
        await store.saveAll(recovered);
      }

      for (const document of all) {
        const migrated = recovered.find(
          (entry) => entry.document.id === document.id,
        );
        const finalDocument = migrated?.document ?? document;
        documents.set(finalDocument.id, { document: finalDocument, handlers: [] });
        const entry: SaveQueueEntry = {
          pending: null,
          lastSavedRevision: finalDocument.revision,
          inFlight: false,
          timer: null,
          retryAttempt: 0,
        };
        queue.set(finalDocument.id, entry);
      }
      return all.map(
        (document) => documents.get(document.id)?.document ?? document,
      );
    },
    listRecoveryIssues(): DocumentRecoveryIssue[] {
      return [...recoveryIssues];
    },
    isFutureVersion(documentId: string): boolean {
      return futureVersionIds.has(documentId);
    },
    listDocuments(
      filter?: { readonly moduleId?: string; readonly documentType?: string },
    ): ManagedDocument[] {
      return [...documents.values()]
        .map((record) => record.document)
        .filter(
          (document) =>
            (!filter?.moduleId || document.moduleId === filter.moduleId) &&
            (!filter?.documentType ||
              document.documentType === filter.documentType),
        );
    },
    getSaveState(documentId: string): DocumentSaveState | undefined {
      return saveStates.get(documentId);
    },
    subscribeSaveState(
      documentId: string,
      handler: SaveStateHandler,
    ): Unsubscribe {
      let handlers = saveStateHandlers.get(documentId);
      if (!handlers) {
        handlers = new Set();
        saveStateHandlers.set(documentId, handlers);
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
