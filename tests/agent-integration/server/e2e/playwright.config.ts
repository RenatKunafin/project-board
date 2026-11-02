import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const previewServer = fileURLToPath(new URL('../../preview/server.mjs', import.meta.url));
const port = 4390;

/**
 * E2E стенда PBT-121: preview собранной изолированной панели (не dev-сервер),
 * отдельный outputDir; компонент запускается тестами на своём порту.
 * Конфиг живёт в серверном пакете: здесь единственный инстанс @playwright/test.
 */
export default defineConfig({
  testDir: '.',
  outputDir: fileURLToPath(new URL('../../../../test-results/agent-integration/', import.meta.url)),
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: `node ${previewServer}`,
    port,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
