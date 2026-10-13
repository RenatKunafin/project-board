import type { ComponentType } from 'react';
import type { DocumentService } from './documents';

export type WidgetTypeSettings = Record<string, unknown>;

export interface WidgetProps {
  readonly widgetInstanceId: string;
  readonly settings: WidgetTypeSettings;
  /** Идентификатор документа, привязанного к экземпляру (если работает с документом). */
  readonly documentId?: string;
  /** Сервис документов платформы (SDK-контракт; реализация — платформа). */
  readonly documentService?: DocumentService;
}

export interface WidgetSizeConstraints {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
}

/** Документная поддержка: модуль описывает, как создавать содержимое нового документа. */
export interface WidgetDocumentSupport {
  readonly moduleId: string;
  readonly documentType: string;
  readonly schemaVersion: number;
  /** Название документа задаётся пользователем и передаётся сервису документов. */
  readonly createContent: () => Record<string, unknown>;
}

export interface WidgetTypeDefinition {
  readonly id: string;
  readonly title: string;
  /** Текстовый символ иконки (emoji) до появления набора иконок темы. */
  readonly icon?: string;
  readonly component: ComponentType<WidgetProps>;
  readonly startSettings: WidgetTypeSettings;
  readonly sizeConstraints: WidgetSizeConstraints;
  /** Наличие — тип работает с документом; платформа предложит создать/открыть. */
  readonly documentSupport?: WidgetDocumentSupport;
}

export class WidgetRegistryError extends Error {
  readonly conflictingId?: string;

  constructor(message: string, conflictingId?: string) {
    super(message);
    this.name = 'WidgetRegistryError';
    this.conflictingId = conflictingId;
  }
}

export const SDK_PACKAGE = '@project-board/widget-sdk' as const;

export function defineWidgetType(definition: WidgetTypeDefinition): WidgetTypeDefinition {
  return definition;
}

export type {
  DocumentContent,
  DocumentCreateInput,
  DocumentChangeHandler,
  DocumentService,
  ManagedDocument,
  Unsubscribe,
} from './documents';
export {
  DocumentConflictError,
  assertDocumentTitle,
} from './documents';
