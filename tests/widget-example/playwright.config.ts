import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.',
  testMatch: 'counter.spec.ts',
  outputDir: '../../test-results/widget-example',
  workers: 1,
  retries: 0,
  reporter: 'list',
  webServer: {
    command: 'npm run preview -w apps/project-board -- --port 4178 --strictPort',
    cwd: resolve(import.meta.dirname, '../..'),
    port: 4178,
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://localhost:4178', viewport: { width: 1600, height: 1000 } },
});
