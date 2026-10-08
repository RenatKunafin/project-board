import type { DocumentService, WidgetRegistry } from '@project-board/dashboard';
import { UnknownWidgetType } from '@project-board/dashboard';
import { ChecklistWidget } from '@project-board/checklist';

interface AppProps {
  widgetRegistry: WidgetRegistry;
  documentService: DocumentService;
  documentId: string;
}

export default function App({
  widgetRegistry,
  documentService,
  documentId,
}: AppProps) {
  const catalog = widgetRegistry.list();
  const checklistType = widgetRegistry.get('checklist');
  const unknownType = widgetRegistry.get('demo');

  return (
    <main className="shell">
      <h1 className="shell__title">Project Board</h1>
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
