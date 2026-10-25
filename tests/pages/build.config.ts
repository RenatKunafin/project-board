import { defineConfig, mergeConfig } from 'vite';
import productionConfig from '../../apps/project-board/vite.config';

// Та же продуктовая комплектация; только тестовый JS-probe делает поколения различимыми.
export default defineConfig(async environment => {
  const version = process.env.PBT_PAGES_VERSION;
  if (!['A', 'B'].includes(version ?? '')) throw new Error('Ожидалось поколение A/B.');
  const probe = `assets/pages-generation-${version}.js`;
  return mergeConfig(await productionConfig(environment), {
    base: '/project-board/',
    plugins: [{
      name: 'pages-test-generation',
      generateBundle() { this.emitFile({ type: 'asset', fileName: probe, source: `globalThis.__pagesGeneration=${JSON.stringify(version)};` }); },
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { name: 'pbt-pages-version', content: version! } },
        { tag: 'script', attrs: { src: `/project-board/${probe}` }, injectTo: 'head' },
      ],
    }],
  });
});
