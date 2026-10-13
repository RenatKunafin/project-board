import { useState } from 'react';
import type {
  ManagedDocument,
  WidgetTypeDefinition,
} from '@project-board/widget-sdk';

export interface DocumentPickerPanelProps {
  readonly type: WidgetTypeDefinition;
  /** Существующие документы этого модуля и типа (по метаданным). */
  readonly documents: readonly ManagedDocument[];
  readonly onCreate: (title: string) => void;
  readonly onOpen: (document: ManagedDocument) => void;
  readonly onCancel: () => void;
}

/**
 * Выбор документа для документного типа: создать новый или открыть
 * существующий (spec widget-windows «Выбор документа для документного типа»).
 */
export function DocumentPickerPanel({
  type,
  documents,
  onCreate,
  onOpen,
  onCancel,
}: DocumentPickerPanelProps) {
  const [title, setTitle] = useState('');

  const submitCreate = (): void => {
    const trimmed = title.trim();
    if (trimmed !== '') {
      onCreate(trimmed);
    }
  };

  return (
    <div className="doc-picker">
      <h2 className="dropdown-panel__title">{type.title}</h2>
      <form
        className="doc-picker__create"
        onSubmit={(event) => {
          event.preventDefault();
          submitCreate();
        }}
      >
        <input
          className="doc-picker__input"
          placeholder="Название нового документа"
          aria-label="Название нового документа"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button type="submit" className="doc-picker__submit">
          Создать
        </button>
      </form>
      <p className="doc-picker__caption">Или открыть существующий:</p>
      {documents.length === 0 ? (
        <p className="doc-picker__empty">Существующих документов нет.</p>
      ) : (
        <ul className="doc-picker__list">
          {documents.map((document) => (
            <li key={document.id}>
              <button
                type="button"
                className="doc-picker__item"
                onClick={() => onOpen(document)}
              >
                {document.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="doc-picker__cancel" onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}
