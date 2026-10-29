import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { countWords, parseMarkdown, renderMarkdownNodes } from './markdown';

describe('просмотр Markdown заметок', () => {
  it('отображает вложенные блоки и смешанное форматирование без изменения исходника', () => {
    const source = '# План\n\n- **один**\n  - `два`\n\n> *три*\n\n---\n\n```ts\nчетыре()\n';
    const view = parseMarkdown(source);
    const markup = renderToStaticMarkup(<>{renderMarkdownNodes(view.nodes)}</>);
    expect(markup).toContain('<h1>План</h1>');
    expect(markup).toContain('<ul><li><p><strong>один</strong></p><ul><li><p><code>два</code></p></li></ul></li></ul>');
    expect(markup).toContain('<blockquote><p><em>три</em></p></blockquote>');
    expect(markup).toContain('<hr/>');
    expect(markup).toContain('<pre><code>четыре()\n</code></pre>');
    expect(source).toContain('```ts\nчетыре()\n');
  });

  it('оставляет незакрытое форматирование текстом и отключённые расширения обычным содержимым', () => {
    const view = parseMarkdown('**незакрыто\n\n- [x] задача\n\n|a|b|\n|-|-|\n|1|2|');
    const markup = renderToStaticMarkup(<>{renderMarkdownNodes(view.nodes)}</>);
    expect(markup).toContain('**незакрыто');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<table>');
    expect(markup).toContain('[x] задача');
  });

  it('показывает HTML как безопасный текст и не создаёт изображений', () => {
    const markup = renderToStaticMarkup(<>{renderMarkdownNodes(parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(2)> ![alt](https://example.com/i.png)').nodes)}</>);
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<img');
    expect(markup).toContain('alt');
    expect(markup).not.toContain('example.com');
  });

  it('разрешает только абсолютные HTTP(S) и mailto ссылки', () => {
    const source = '[https](https://example.com) [mail](mailto:a@example.com) [bad](javascript:alert%281%29) [data](data:text/html,x) [file](file:///etc/passwd) [rel](/x) [protocol](//example.com) [ctl](https://x/%0a)';
    const markup = renderToStaticMarkup(<>{renderMarkdownNodes(parseMarkdown(source).nodes)}</>);
    expect(markup).toContain('<a href="https://example.com/" target="_blank" rel="noopener noreferrer">https</a>');
    expect(markup).toContain('href="mailto:a@example.com"');
    expect(markup).toContain('[bad](javascript:alert%281%29)');
    expect(markup).not.toContain('href="javascript:');
    expect(markup).not.toContain('href="data:');
    expect(markup).not.toContain('href="file:');
    expect(markup).not.toContain('href="/x"');
    expect(markup).not.toContain('href="//example.com"');
    expect(markup).not.toContain('href="https://x/%0a"');
  });

  it('считает видимый текст, код и составные слова', () => {
    expect(countWords(parseMarkdown("# План\n\nпо-русски **don't** 42 `hello world` [ещё два](https://example.com)").plainText)).toBe(8);
    expect(countWords(parseMarkdown('---\n\n🙂 ...').plainText)).toBe(0);
    expect(countWords(parseMarkdown('e\u0301lan').plainText)).toBe(1);
  });
});
