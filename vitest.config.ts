import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.{ts,tsx}',
      'apps/**/*.test.{ts,tsx}',
      'tests/**/*.test.{ts,tsx}',
      'examples/**/*.test.{ts,tsx}',
    ],
    exclude: ['tests/agent-integration/server/**'],
    setupFiles: ['tests/vitest-setup.ts'],
  },
});
