import { useEffect, useMemo, useRef, useState } from 'react';
import type { WidgetProps } from '@project-board/widget-sdk';
import { Plus, Trash2 } from 'lucide-react';
import {
  addItem,
  parseChecklistContent,
  removeItem,
  renameItem,
  setItemDone,
  type ChecklistContent,
  type ChecklistItem,
} from './model';
import './checklist.css';

export default function ChecklistWidget({
  widgetInstanceId,
  documentId,
  documentService,
  visible,
  settings,
  updateSettings,
}: WidgetProps) {
  const [content, setContent] = useState<ChecklistContent>(() => ({
    items: [],
  }));
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  // Скрытие выполненных — persisted-состояние экземпляра (PBT-075,
  // механизм PBT-049): settings вида view:<instanceId>; прежний in-memory
  // флаг сервиса reload не переживал (карточка: должно переживать).
  const [hideDone, setHideDone] = useState(
    () => settings.hideDone === true,
  );

  useEffect(() => {
    if (!documentId || !documentService) {
      return;
    }
    const document = documentService.get(documentId);
    if (document) {
      setContent(parseChecklistContent(document.content));
    }
    // Подписка сохраняется при hidden: возврат показывает актуальный документ.
    const unsubscribe = documentService.subscribe(documentId, (updated) => {
      setContent(parseChecklistContent(updated.content));
    });
    return unsubscribe;
  }, [documentId, documentService]);

  // Уважение видимости (PBT-027): при hidden пересчёт фильтра не выполняется,
  // возвращается последний результат; подписка на документ остаётся живой.
  const visibleItemsRef = useRef<readonly ChecklistItem[]>([]);
  const visibleItems = useMemo(() => {
    if (visible === false) {
      return visibleItemsRef.current;
    }
    const next = hideDone
      ? content.items.filter((item) => !item.done)
      : content.items;
    visibleItemsRef.current = next;
    return next;
  }, [content, hideDone, visible]);

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

  const toggleHideDone = () => {
    const next = !hideDone;
    setHideDone(next);
    // Настройка представления — в settings экземпляра (в документ
    // не попадает); необязательный API — окружение без поддержки
    // просто держит флаг в памяти (design D2).
    updateSettings?.({ hideDone: next });
  };

  const doneCount = content.items.filter((item) => item.done).length;
  const totalCount = content.items.length;
  const donePercent =
    totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="checklist" data-instance={widgetInstanceId}>
      {typeof content.title === 'string' && content.title !== '' && (
        <h2 className="checklist__title">{content.title}</h2>
      )}
      {/* Шапка (PBT-075, по прототипу TodoWidget): производный прогресс
          документа + кнопка-чип скрытия выполненных. */}
      <div className="checklist__header">
        <div className="checklist__progress">
          <p className="checklist__progress-label" data-checklist-progress>
            {doneCount}/{totalCount} выполнено{' '}
            <span className="checklist__progress-percent">
              ({donePercent}%)
            </span>
          </p>
          <div className="checklist__progress-track">
            <div
              className="checklist__progress-bar"
              data-checklist-progress-bar
              style={{ width: `${donePercent}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          className="checklist__hide-toggle"
          data-checklist-hide-done
          aria-pressed={hideDone}
          onClick={toggleHideDone}
        >
          {hideDone ? 'Показать выполненные' : 'Скрыть выполненные'}
        </button>
      </div>

      {content.items.length === 0 ? (
        <p className="checklist__hint">
          Список пуст — добавьте первый пункт ниже.
        </p>
      ) : visibleItems.length === 0 ? (
        <p className="checklist__hint">Все пункты выполнены.</p>
      ) : (
        <ul className="checklist__items">
          {visibleItems.map((item) => (
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
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="checklist__form"
        onSubmit={(event) => {
          event.preventDefault();
          commit(addItem(content, draft));
          setDraft('');
        }}
      >
        <input
          className="checklist__input"
          placeholder="Новая задача…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="checklist__add"
          aria-label="Добавить"
        >
          <Plus aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
