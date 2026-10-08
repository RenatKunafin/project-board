import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    setupFiles: ['tests/vitest-setup.ts'],
  },
});
