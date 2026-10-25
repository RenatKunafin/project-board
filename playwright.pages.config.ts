import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/pages',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/pages',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/pages-results.json' }]],
  webServer: { command: 'node tests/pages/server.mjs', port: 4187, reuseExistingServer: false },
  use: { baseURL: 'http://localhost:4187/project-board/', viewport: { width: 1600, height: 1000 }, trace: 'retain-on-failure' },
});
