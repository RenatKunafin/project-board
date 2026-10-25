import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.{ts,tsx}',
      'apps/**/*.test.{ts,tsx}',
      'tests/**/*.test.{ts,tsx}',
      'examples/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['tests/vitest-setup.ts'],
  },
});
