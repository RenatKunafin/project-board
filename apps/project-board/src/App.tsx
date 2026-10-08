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
  documentId: string;
}

const SAVE_STATE_LABELS: Record<string, string> = {
  saved: 'Сохранено',
  saving: 'Сохраняется…',
  error: 'Ошибка сохранения',
  conflict: 'Обновлено из другого окна',
};

export default function App({
  widgetRegistry,
  documentService,
  documentId,
}: AppProps) {
  const catalog = widgetRegistry.list();
  const checklistType = widgetRegistry.get('checklist');
  const unknownType = widgetRegistry.get('demo');

  const [saveState, setSaveState] = useState(
    documentService.getSaveState(documentId),
  );
  useEffect(
    () => documentService.subscribeSaveState(documentId, setSaveState),
    [documentService, documentId],
  );

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
        Каталог типов виджетов: {catalog.length}. Модули подключаются при сборке.
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
          {'kind' in checklistType ? (
            <UnknownWidgetType lookup={checklistType} />
          ) : (
            <>
              <div className="instances__pane" role="group" aria-label="Экземпляр 1">
                <p className="instances__label">Экземпляр 1</p>
                <ChecklistWidget
                  widgetInstanceId="w-1"
                  settings={checklistType.startSettings}
                  documentId={documentId}
                  documentService={documentService}
                />
              </div>
              <div className="instances__pane" role="group" aria-label="Экземпляр 2">
                <p className="instances__label">Экземпляр 2</p>
                <ChecklistWidget
                  widgetInstanceId="w-2"
                  settings={checklistType.startSettings}
                  documentId={documentId}
                  documentService={documentService}
                />
              </div>
            </>
          )}
        </div>
        <UnknownWidgetType lookup={unknownType} />
      </section>
    </main>
  );
}
