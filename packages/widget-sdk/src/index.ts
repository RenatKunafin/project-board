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

export interface WidgetTypeDefinition {
  readonly id: string;
  readonly title: string;
  readonly component: ComponentType<WidgetProps>;
  readonly startSettings: WidgetTypeSettings;
  readonly sizeConstraints: WidgetSizeConstraints;
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
export { DocumentConflictError } from './documents';
