import type { ComponentType } from 'react';
import type {
  DocumentMigration,
  DocumentMigrationsSupport,
  DocumentService,
} from './documents';

export type WidgetTypeSettings = Record<string, unknown>;

/** Размер содержимого окна, доставляемый виджету платформой. */
export interface WidgetSize {
  readonly width: number;
  readonly height: number;
}

export interface WidgetProps {
  readonly widgetInstanceId: string;
  readonly settings: WidgetTypeSettings;
  /** Идентификатор документа, привязанного к экземпляру (если работает с документом). */
  readonly documentId?: string;
  /** Сервис документов платформы (SDK-контракт; реализация — платформа). */
  readonly documentService?: DocumentService;
  /**
   * Видимость экземпляра: активная вкладка И окно не свёрнуто.
   * Контракт: при false виджет приостанавливает тяжёлую отрисовку,
   * сохраняя подписки на документ (ADR-6.5, PBT-027).
   */
  readonly visible: boolean;
  /**
   * Подписка на размеры содержимого окна (design D2): регистрирует слушателя,
   * возвращает функцию отписки; платформа троттлит значения кадром.
   */
  readonly onResize?: (listener: (size: WidgetSize) => void) => () => void;
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
  /** Миграции содержимого «от версии → к версии» до актуальной schemaVersion. */
  readonly migrations?: readonly DocumentMigration[];
}

/** Собирает поддержку миграций из зарегистрированных типов виджетов. */
export function collectDocumentMigrations(
  types: readonly WidgetTypeDefinition[],
): DocumentMigrationsSupport[] {
  const byKey = new Map<string, DocumentMigrationsSupport>();
  for (const type of types) {
    const support = type.documentSupport;
    if (!support) {
      continue;
    }
    const key = `${support.moduleId}/${support.documentType}`;
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, {
      moduleId: support.moduleId,
      documentType: support.documentType,
      actualVersion: support.schemaVersion,
      steps: support.migrations ?? [],
    });
  }
  return [...byKey.values()];
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
  DocumentMigration,
  DocumentMigrationsSupport,
  DocumentService,
  ManagedDocument,
  Unsubscribe,
} from './documents';
export {
  DocumentConflictError,
  DocumentFutureVersionError,
  assertDocumentTitle,
} from './documents';
