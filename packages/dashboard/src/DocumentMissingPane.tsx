import { useState } from 'react';
import type { ManagedDocument } from '@project-board/widget-sdk';

export interface DocumentMissingPaneProps {
  /** Доступные документы того же модуля и типа (по метаданным). */
  readonly documents: readonly ManagedDocument[];
  /** У типа есть документная поддержка — доступно создание нового. */
  readonly canCreate: boolean;
  readonly onPick: (documentId: string) => void;
  readonly onCreate: () => void;
}

/**
 * Состояние окна со ссылкой на отсутствующий документ (ADR-7 PBT-002):
 * предлагает выбрать другой документ того же типа или создать новый.
 */
export function DocumentMissingPane({
  documents,
  canCreate,
  onPick,
  onCreate,
}: DocumentMissingPaneProps) {
  const [choosing, setChoosing] = useState(false);

  if (!choosing) {
    return (
      <div className="pane-document-missing" role="status">
        <p className="pane-document-missing__text">Документ недоступен.</p>
        <div className="pane-document-missing__actions">
          {(documents.length > 0 || canCreate) && (
            <button
              type="button"
              className="pane-document-missing__button"
              onClick={() => setChoosing(true)}
            >
              Выбрать документ…
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pane-document-missing pane-document-missing--choosing">
      <p className="pane-document-missing__text">Выберите документ:</p>
      {documents.length === 0 ? (
        <p className="pane-document-missing__hint">Документов этого типа нет.</p>
      ) : (
        <ul className="pane-document-missing__list">
          {documents.map((document) => (
            <li key={document.id}>
              <button
                type="button"
                className="pane-document-missing__button"
                onClick={() => onPick(document.id)}
              >
                {document.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <button
          type="button"
          className="pane-document-missing__button"
          onClick={onCreate}
        >
          Создать новый…
        </button>
      )}
      <button
        type="button"
        className="pane-document-missing__button pane-document-missing__button--muted"
        onClick={() => setChoosing(false)}
      >
        Отмена
      </button>
    </div>
  );
}
