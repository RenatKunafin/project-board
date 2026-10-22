import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/pwa-updates',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/pwa-updates',
  workers: 1, // Сервер переключает одну опубликованную версию на один origin.
  timeout: 45_000,
  webServer: { command: 'node tests/pwa-updates/server.mjs', port: 4184, reuseExistingServer: false },
  use: { baseURL: 'http://localhost:4184' },
});
