export type DocumentContent = unknown;

export interface DocumentCreateInput {
  readonly moduleId: string;
  readonly documentType: string;
  readonly schemaVersion: number;
  readonly content: DocumentContent;
}

export interface ManagedDocument {
  readonly id: string;
  readonly moduleId: string;
  readonly documentType: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly content: DocumentContent;
}

export class DocumentConflictError extends Error {
  readonly documentId: string;
  readonly actualRevision: number;
  readonly expectedRevision: number;

  constructor(
    documentId: string,
    actualRevision: number,
    expectedRevision: number,
  ) {
    super(
      `Конфликт редакций документа "${documentId}": ожидается ${expectedRevision}, актуальная ${actualRevision}.`,
    );
    this.name = 'DocumentConflictError';
    this.documentId = documentId;
    this.actualRevision = actualRevision;
    this.expectedRevision = expectedRevision;
  }
}

export type DocumentChangeHandler = (document: ManagedDocument) => void;

export type Unsubscribe = () => void;
