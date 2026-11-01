import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/analytics',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/analytics',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  webServer: {
    command: 'npm run preview --workspace=apps/project-board -- --host 127.0.0.1 --port 4174',
    port: 4174,
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:4174/',
    trace: 'retain-on-failure',
  },
});
