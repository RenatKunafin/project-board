import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WidgetWindow } from './WidgetWindow';

describe('WidgetWindow', () => {
  it('отображает заголовок, иконку и подписанные кнопки', () => {
    const html = renderToStaticMarkup(
      <WidgetWindow title="План · ОКАД" icon="📅">
        <p>Содержимое</p>
      </WidgetWindow>,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="План · ОКАД"');
    expect(html).toContain('📅');
    expect(html).toContain('aria-label="Свернуть План · ОКАД"');
    expect(html).toContain('aria-label="Закрыть План · ОКАД"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Содержимое');
  });

  it('активное окно помечено атрибутом', () => {
    const html = renderToStaticMarkup(
      <WidgetWindow title="Окно" active>
        <p>Содержимое</p>
      </WidgetWindow>,
    );
    expect(html).toContain('widget-window--active');
    expect(html).toContain('data-active="true"');
  });

  it('свёрнутое окно скрывает содержимое без удаления и меняет кнопку', () => {
    const html = renderToStaticMarkup(
      <WidgetWindow title="Окно" collapsed>
        <p>Содержимое</p>
      </WidgetWindow>,
    );
    expect(html).toContain('widget-window--collapsed');
    expect(html).toContain('aria-label="Развернуть Окно"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
    expect(html).toContain('Содержимое');
  });
});
