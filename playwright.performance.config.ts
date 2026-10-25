import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/performance',
  testMatch: '*.bench.ts',
  outputDir: 'test-results/performance',
  workers: 1,
  retries: 0,
  timeout: 900_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  webServer: { command: 'npm run preview', port: 4173, reuseExistingServer: false },
  use: {
    baseURL: 'http://localhost:4173',
    actionTimeout: 15_000,
    channel: 'chrome',
    headless: process.env.PBT_BENCH_HEADLESS === '1',
    viewport: { width: 1400, height: 1000 },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
