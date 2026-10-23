import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/planning',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/planning',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/planning-results.json' }]],
  webServer: [
    { command: 'npm run preview', port: 4173, reuseExistingServer: false },
    { command: 'node tests/planning/network-proxy.mjs', url: 'http://127.0.0.1:4185/__health', reuseExistingServer: false },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4185',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
  ],
});
