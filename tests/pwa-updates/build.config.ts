import { defineConfig, mergeConfig } from 'vite';
import productionConfig from '../../apps/project-board/vite.config';

export default defineConfig(async (environment) => mergeConfig(await productionConfig(environment), {
  define: { __PBT_TEST_VERSION__: JSON.stringify(process.env.PBT_UPDATE_VERSION) },
  plugins: [{
    name: 'pbt-update-fixture-composition',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './widgets' && importer?.endsWith('/src/main.tsx')) {
        return new URL('./widgets.tsx', import.meta.url).pathname;
      }
    },
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'pbt-test-version', content: process.env.PBT_UPDATE_VERSION! } }],
  }],
}));
