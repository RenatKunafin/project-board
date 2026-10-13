export type DocumentContent = unknown;

export interface DocumentCreateInput {
  readonly moduleId: string;
  readonly documentType: string;
  readonly schemaVersion: number;
  /** Название документа — часть метаданных оболочки (ADR-5 PBT-002). */
  readonly title: string;
  readonly content: DocumentContent;
}

export interface ManagedDocument {
  readonly id: string;
  readonly moduleId: string;
  readonly documentType: string;
  readonly title: string;
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

export function assertDocumentTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === '') {
    throw new Error('Название документа не может быть пустым.');
  }
  return trimmed;
}

export interface DocumentService {
  create(input: DocumentCreateInput): ManagedDocument;
  get(documentId: string): ManagedDocument | undefined;
  update(
    documentId: string,
    expectedRevision: number,
    nextContent: DocumentContent,
  ): ManagedDocument;
  /** Переименование: новая редакция оболочки без изменения содержимого модуля. */
  rename(
    documentId: string,
    expectedRevision: number,
    title: string,
  ): ManagedDocument;
  /** Удаление документа из хранилища и состояния вместе с отложенными записями. */
  delete(documentId: string): Promise<void>;
  subscribe(documentId: string, handler: DocumentChangeHandler): Unsubscribe;
  getViewSettings(viewSettingsKey: string): Record<string, unknown> | undefined;
  setViewSettings(
    viewSettingsKey: string,
    settings: Record<string, unknown>,
  ): void;
}
