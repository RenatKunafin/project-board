import type { WidgetRegistry } from '@project-board/dashboard';
import { UnknownWidgetType } from '@project-board/dashboard';
import DemoWidget from './widgets/demo-widget';

interface AppProps {
  widgetRegistry: WidgetRegistry;
}

export default function App({ widgetRegistry }: AppProps) {
  const catalog = widgetRegistry.list();
  const demoType = widgetRegistry.get('demo');
  const checklistType = widgetRegistry.get('checklist');

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
        {'kind' in demoType ? (
          <UnknownWidgetType lookup={demoType} />
        ) : (
          <DemoWidget widgetInstanceId="w-demo-1" settings={demoType.startSettings} />
        )}
        <UnknownWidgetType lookup={checklistType} />
      </section>
    </main>
  );
}
