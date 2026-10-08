import type {
  AutosavingDocumentService,
  WidgetRegistry,
} from '@project-board/dashboard';
import { UnknownWidgetType } from '@project-board/dashboard';
import { ChecklistWidget } from '@project-board/checklist';
import { useEffect, useState } from 'react';

interface AppProps {
  widgetRegistry: WidgetRegistry;
  documentService: AutosavingDocumentService;
  list1Id: string;
  list2Id: string;
}

const SAVE_STATE_LABELS: Record<string, string> = {
  saved: 'Сохранено',
  saving: 'Сохраняется…',
  error: 'Ошибка сохранения',
  conflict: 'Обновлено из другого окна',
};

interface PaneDefinition {
  readonly instanceId: string;
  readonly label: string;
  readonly documentId: string;
}

export default function App({
  widgetRegistry,
  documentService,
  list1Id,
  list2Id,
}: AppProps) {
  const catalog = widgetRegistry.list();
  const checklistType = widgetRegistry.get('checklist');
  const unknownType = widgetRegistry.get('demo');

  const [saveState, setSaveState] = useState(
    documentService.getSaveState(list1Id),
  );
  useEffect(
    () => documentService.subscribeSaveState(list1Id, setSaveState),
    [documentService, list1Id],
  );

  const panes: readonly PaneDefinition[] = [
    { instanceId: 'w-1', label: 'Экземпляр 1 · Список 1', documentId: list1Id },
    { instanceId: 'w-2', label: 'Экземпляр 2 · Список 1', documentId: list1Id },
    { instanceId: 'w-3', label: 'Экземпляр 3 · Список 2', documentId: list2Id },
  ];
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const togglePane = (instanceId: string) => {
    setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  };

  return (
    <main className="shell">
      <h1 className="shell__title">Project Board</h1>
      {saveState && (
        <p
          className={`save-state is-${saveState.status}`}
          role="status"
          aria-label="Состояние сохранения"
        >
          {SAVE_STATE_LABELS[saveState.status] ?? saveState.status}
        </p>
      )}
      <p className="shell__hint">
        Вертикальный срез: экземпляры 1–2 — один документ, экземпляр 3 — другой.
      </p>

      <section className="catalog" aria-label="Каталог типов виджетов">
        {catalog.map((type) => (
          <article key={type.id} className="catalog__item">
            <span className="catalog__id">{type.id}</span>
            <span className="catalog__title">{type.title}</span>
          </article>
        ))}
      </section>

      <section className="instances" aria-label="Экземпляры виджетов">
        <div className="instances__pair">
          {'kind' in checklistType
            ? <UnknownWidgetType lookup={checklistType} />
            : panes.map((pane) =>
                closed.has(pane.instanceId) ? null : (
                  <div
                    key={pane.instanceId}
                    className="instances__pane"
                    role="group"
                    aria-label={pane.label}
                  >
                    <div className="instances__head">
                      <p className="instances__label">{pane.label}</p>
                      <button
                        type="button"
                        className="instances__close"
                        aria-label={`Закрыть ${pane.label}`}
                        onClick={() => togglePane(pane.instanceId)}
                      >
                        Закрыть
                      </button>
                    </div>
                    <ChecklistWidget
                      widgetInstanceId={pane.instanceId}
                      settings={checklistType.startSettings}
                      documentId={pane.documentId}
                      documentService={documentService}
                    />
                  </div>
                ),
              )}
        </div>

        <div className="reopen">
          {[...closed].map((instanceId) => (
            <button
              key={instanceId}
              type="button"
              className="reopen__button"
              onClick={() => togglePane(instanceId)}
            >
              Открыть {instanceId}
            </button>
          ))}
        </div>

        <UnknownWidgetType lookup={unknownType} />
      </section>
    </main>
  );
}
