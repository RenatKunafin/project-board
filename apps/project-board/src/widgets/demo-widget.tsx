import type { WidgetProps } from '@project-board/widget-sdk';

export default function DemoWidget({ widgetInstanceId, settings }: WidgetProps) {
  return (
    <section className="demo-widget">
      <h2 className="demo-widget__title">
        {typeof settings.title === 'string' ? settings.title : 'Панель'}
      </h2>
      <dl className="demo-widget__meta">
        <dt>Экземпляр</dt>
        <dd>{widgetInstanceId}</dd>
        <dt>Настройки</dt>
        <dd>
          <code>{JSON.stringify(settings)}</code>
        </dd>
      </dl>
    </section>
  );
}
