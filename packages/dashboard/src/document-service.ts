import type {
  DocumentChangeHandler,
  DocumentCreateInput,
  DocumentService,
  ManagedDocument,
  Unsubscribe,
} from '@project-board/widget-sdk';
import { DocumentConflictError } from '@project-board/widget-sdk';

export type {
  DocumentChangeHandler,
  DocumentService,
  Unsubscribe,
} from '@project-board/widget-sdk';

interface DocumentRecord {
  document: ManagedDocument;
  handlers: DocumentChangeHandler[];
}

export function createDocumentService(): DocumentService {
  const documents = new Map<string, DocumentRecord>();
  const viewSettings = new Map<string, Record<string, unknown>>();
  let notifyingDocumentId: string | null = null;

  return {
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
        // Подписка на несуществующий документ: нет документа — нет уведомлений.
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
}
