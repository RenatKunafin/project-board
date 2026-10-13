import { useState } from 'react';
import type { ManagedDocument } from '@project-board/widget-sdk';
import {
  filterDocuments,
  filterKey,
  sortDocumentsByRecency,
  type DocumentFilter,
  type DocumentTypeInfo,
} from './document-catalog';

export interface DocumentCatalogPanelProps {
  readonly documents: readonly ManagedDocument[];
  readonly typeInfos: readonly DocumentTypeInfo[];
  /** Ошибка восстановления хранилища при старте: не выдаётся за пустой каталог. */
  readonly loadError: boolean;
  readonly onOpen: (document: ManagedDocument) => void;
  readonly onCreate: (info: DocumentTypeInfo, title: string) => void;
  readonly onRename: (documentId: string, title: string) => void;
  readonly onDelete: (documentId: string) => void;
}

/** Каталог документов: список по метаданным, фильтр по типу, переименование, удаление. */
export function DocumentCatalogPanel({
  documents,
  typeInfos,
  loadError,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: DocumentCatalogPanelProps) {
  const [filter, setFilter] = useState<DocumentFilter>({ kind: 'all' });
  const [newTypeKey, setNewTypeKey] = useState(
    typeInfos[0] ? filterKey(typeInfos[0].moduleId, typeInfos[0].documentType) : '',
  );
  const [newTitle, setNewTitle] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const visible = sortDocumentsByRecency(filterDocuments(documents, filter));
  const isEmptyCatalog = documents.length === 0;
  const isFilterEmpty = filter.kind === 'type' && visible.length === 0;

  const submitCreate = (): void => {
    const info = typeInfos.find(
      (entry) => filterKey(entry.moduleId, entry.documentType) === newTypeKey,
    );
    const title = newTitle.trim();
    if (!info || title === '') {
      return;
    }
    onCreate(info, title);
    setNewTitle('');
  };

  const commitRename = (): void => {
    const title = renameDraft.trim();
    if (renamingId !== null && title !== '') {
      onRename(renamingId, title);
    }
    setRenamingId(null);
  };

  return (
    <div className="doc-catalog">
      <h2 className="dropdown-panel__title">Документы</h2>

      {loadError && (
        <p className="doc-catalog__error" role="alert">
          Не удалось загрузить сохранённые документы. Список может быть неполным.
        </p>
      )}

      <form
        className="doc-catalog__create"
        onSubmit={(event) => {
          event.preventDefault();
          submitCreate();
        }}
      >
        <select
          className="doc-catalog__type"
          aria-label="Тип нового документа"
          value={newTypeKey}
          onChange={(event) => setNewTypeKey(event.target.value)}
        >
          {typeInfos.map((info) => (
            <option
              key={filterKey(info.moduleId, info.documentType)}
              value={filterKey(info.moduleId, info.documentType)}
            >
              {info.icon ? `${info.icon} ` : ''}
              {info.label}
            </option>
          ))}
        </select>
        <input
          className="doc-catalog__input"
          placeholder="Название нового документа"
          aria-label="Название нового документа"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <button type="submit" className="doc-catalog__submit">
          Создать
        </button>
      </form>

      {typeInfos.length > 1 && (
        <div className="doc-catalog__filters" role="group" aria-label="Фильтр по типу">
          <button
            type="button"
            className="doc-catalog__chip"
            aria-pressed={filter.kind === 'all'}
            onClick={() => setFilter({ kind: 'all' })}
          >
            Все
          </button>
          {typeInfos.map((info) => {
            const key = filterKey(info.moduleId, info.documentType);
            const active =
              filter.kind === 'type' &&
              filter.moduleId === info.moduleId &&
              filter.documentType === info.documentType;
            return (
              <button
                key={key}
                type="button"
                className="doc-catalog__chip"
                aria-pressed={active}
                onClick={() =>
                  setFilter(
                    active
                      ? { kind: 'all' }
                      : {
                          kind: 'type',
                          moduleId: info.moduleId,
                          documentType: info.documentType,
                        },
                  )
                }
              >
                {info.icon ? `${info.icon} ` : ''}
                {info.label}
              </button>
            );
          })}
        </div>
      )}

      {isEmptyCatalog ? (
        <p className="doc-catalog__empty" role="status">
          Документов пока нет. Создайте первый документ формой выше.
        </p>
      ) : isFilterEmpty ? (
        <p className="doc-catalog__empty" role="status">
          Нет документов выбранного типа. Снимите фильтр, чтобы увидеть остальные.
        </p>
      ) : (
        <ul className="doc-catalog__list">
          {visible.map((document) => (
            <li key={document.id} className="doc-catalog__row">
              {renamingId === document.id ? (
                <form
                  className="doc-catalog__rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitRename();
                  }}
                >
                  <input
                    className="doc-catalog__input"
                    aria-label="Новое название документа"
                    autoFocus
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setRenamingId(null);
                      }
                    }}
                  />
                  <button type="submit" className="doc-catalog__action">
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="doc-catalog__action"
                    onClick={() => setRenamingId(null)}
                  >
                    Отмена
                  </button>
                </form>
              ) : deletingId === document.id ? (
                <span className="doc-catalog__confirm">
                  Удалить «{document.title}»?
                  <button
                    type="button"
                    className="doc-catalog__action doc-catalog__action--danger"
                    onClick={() => {
                      onDelete(document.id);
                      setDeletingId(null);
                    }}
                  >
                    Удалить
                  </button>
                  <button
                    type="button"
                    className="doc-catalog__action"
                    onClick={() => setDeletingId(null)}
                  >
                    Отмена
                  </button>
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="doc-catalog__open"
                    onClick={() => onOpen(document)}
                  >
                    <span className="doc-catalog__title">{document.title}</span>
                    <span className="doc-catalog__kind">
                      {typeInfos.find(
                        (info) =>
                          info.moduleId === document.moduleId &&
                          info.documentType === document.documentType,
                      )?.label ?? `${document.moduleId}/${document.documentType}`}
                    </span>
                  </button>
                  <span className="doc-catalog__row-actions">
                    <button
                      type="button"
                      className="doc-catalog__action"
                      aria-label={`Переименовать «${document.title}»`}
                      onClick={() => {
                        setRenamingId(document.id);
                        setRenameDraft(document.title);
                        setDeletingId(null);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="doc-catalog__action"
                      aria-label={`Удалить «${document.title}»`}
                      onClick={() => {
                        setDeletingId(document.id);
                        setRenamingId(null);
                      }}
                    >
                      🗑
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
