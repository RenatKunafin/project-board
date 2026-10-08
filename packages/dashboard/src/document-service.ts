import type {
  DocumentChangeHandler,
  DocumentCreateInput,
  DocumentService,
  ManagedDocument,
  Unsubscribe,
} from '@project-board/widget-sdk';
import { DocumentConflictError } from '@project-board/widget-sdk';

export type DocumentSaveStatus = 'saved' | 'saving' | 'error' | 'conflict';

export interface DocumentSaveState {
  readonly status: DocumentSaveStatus;
  readonly at: string;
}

export type SaveStateHandler = (state: DocumentSaveState) => void;

/** Минимальный контракт хранилища, необходимый сервису. */
export interface DocumentStoreLike {
  save(
    document: ManagedDocument,
    expectedStoredRevision: number,
  ): Promise<void>;
  get(documentId: string): Promise<ManagedDocument | undefined>;
  listAll(): Promise<ManagedDocument[]>;
}

export interface PersistenceHooks {
  readonly store: DocumentStoreLike;
  readonly saveDelayMs?: number;
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
  getSaveState(documentId: string): DocumentSaveState | undefined;
  subscribeSaveState(
    documentId: string,
    handler: SaveStateHandler,
  ): Unsubscribe;
}

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
    async restoreAll(): Promise<ManagedDocument[]> {
      if (!store) {
        return [];
      }
      const all = await store.listAll();
      for (const document of all) {
        documents.set(document.id, { document, handlers: [] });
        const entry: SaveQueueEntry = {
          pending: null,
          lastSavedRevision: document.revision,
          inFlight: false,
          timer: null,
          retryAttempt: 0,
        };
        queue.set(document.id, entry);
      }
      return all;
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
