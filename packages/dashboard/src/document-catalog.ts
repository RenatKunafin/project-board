import type {
  ManagedDocument,
  WidgetTypeDefinition,
} from '@project-board/widget-sdk';

/** Зарегистрированный тип документа для фильтра и создания в каталоге. */
export interface DocumentTypeInfo {
  readonly moduleId: string;
  readonly documentType: string;
  /** Первый зарегистрированный тип виджета, открывающий этот документ. */
  readonly widgetTypeId: string;
  readonly label: string;
  readonly icon?: string;
}

export type DocumentFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'type'; readonly moduleId: string; readonly documentType: string };

/** Уникальные типы документов из дескрипторов реестра; порядок — по регистрации. */
export function documentTypeInfos(
  types: readonly WidgetTypeDefinition[],
): DocumentTypeInfo[] {
  const byKey = new Map<string, DocumentTypeInfo>();
  for (const type of types) {
    const support = type.documentSupport;
    if (!support) {
      continue;
    }
    const key = `${support.moduleId}/${support.documentType}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        moduleId: support.moduleId,
        documentType: support.documentType,
        widgetTypeId: type.id,
        label: type.title,
        icon: type.icon,
      });
    }
  }
  return [...byKey.values()];
}

export function filterKey(moduleId: string, documentType: string): string {
  return `${moduleId}/${documentType}`;
}

export function matchesFilter(
  document: Pick<ManagedDocument, 'moduleId' | 'documentType'>,
  filter: DocumentFilter,
): boolean {
  return (
    filter.kind === 'all' ||
    (document.moduleId === filter.moduleId &&
      document.documentType === filter.documentType)
  );
}

export function filterDocuments(
  documents: readonly ManagedDocument[],
  filter: DocumentFilter,
): ManagedDocument[] {
  return documents.filter((document) => matchesFilter(document, filter));
}

/** Зарегистрированные типы виджетов, открывающие документ этого модуля и типа. */
export function widgetTypesForDocument(
  types: readonly WidgetTypeDefinition[],
  moduleId: string,
  documentType: string,
): WidgetTypeDefinition[] {
  return types.filter(
    (type) =>
      type.documentSupport?.moduleId === moduleId &&
      type.documentSupport?.documentType === documentType,
  );
}

/** Новые сверху: по убыванию updatedAt, при равенстве — по id для стабильности. */
export function sortDocumentsByRecency(
  documents: readonly ManagedDocument[],
): ManagedDocument[] {
  return [...documents].sort((a, b) =>
    a.updatedAt === b.updatedAt
      ? a.id < b.id
        ? -1
        : 1
      : a.updatedAt < b.updatedAt
        ? 1
        : -1,
  );
}
