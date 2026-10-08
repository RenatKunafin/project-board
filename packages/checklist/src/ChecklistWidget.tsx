import { useEffect, useState } from 'react';
import type { WidgetProps } from '@project-board/widget-sdk';
import {
  addItem,
  parseChecklistContent,
  removeItem,
  renameItem,
  setItemDone,
  type ChecklistContent,
} from './model';

export default function ChecklistWidget({
  widgetInstanceId,
  documentId,
  documentService,
}: WidgetProps) {
  const [content, setContent] = useState<ChecklistContent>(() =>
    emptyState(),
  );
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId || !documentService) {
      return;
    }
    const document = documentService.get(documentId);
    if (document) {
      setContent(parseChecklistContent(document.content));
    }
    const unsubscribe = documentService.subscribe(documentId, (updated) => {
      setContent(parseChecklistContent(updated.content));
    });
    return unsubscribe;
  }, [documentId, documentService]);

  if (!documentId || !documentService) {
    return (
      <div className="checklist" role="status">
        <p className="checklist__hint">Документ не привязан к экземпляру.</p>
      </div>
    );
  }

  const commit = (nextContent: ChecklistContent) => {
    const document = documentService.get(documentId);
    if (!document) {
      return;
    }
    documentService.update(documentId, document.revision, nextContent);
  };

  const handleAdd = () => {
    commit(addItem(content, draft));
    setDraft('');
  };

  return (
    <div className="checklist" data-instance={widgetInstanceId}>
      {content.items.length === 0 ? (
        <p className="checklist__hint">
          Список пуст — добавьте первый пункт ниже.
        </p>
      ) : (
        <ul className="checklist__items">
          {content.items.map((item) => (
            <li key={item.id} className="checklist__item">
              <label className="checklist__label">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(event) =>
                    commit(setItemDone(content, item.id, event.target.checked))
                  }
                />
                {editingId === item.id ? (
                  <input
                    className="checklist__edit"
                    autoFocus
                    value={item.text}
                    onChange={(event) =>
                      commit(renameItem(content, item.id, event.target.value))
                    }
                    onBlur={() => setEditingId(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') {
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <span
                    className={
                      item.done ? 'checklist__text is-done' : 'checklist__text'
                    }
                    onDoubleClick={() => setEditingId(item.id)}
                  >
                    {item.text}
                  </span>
                )}
              </label>
              <button
                type="button"
                className="checklist__remove"
                aria-label={`Удалить: ${item.text}`}
                onClick={() => commit(removeItem(content, item.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="checklist__form"
        onSubmit={(event) => {
          event.preventDefault();
          handleAdd();
        }}
      >
        <input
          className="checklist__input"
          placeholder="Новый пункт"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="checklist__add">
          Добавить
        </button>
      </form>
    </div>
  );
}

function emptyState(): ChecklistContent {
  return { items: [] };
}
