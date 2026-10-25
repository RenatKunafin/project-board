import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { createPackageBoundaryRule } from './scripts/eslint/package-boundaries.mjs';

export const createConfig = (root) => tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**'] },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    files: ['apps/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: {
      'project-board': { rules: { 'package-boundaries': createPackageBoundaryRule(root) } },
    },
    rules: {
      'project-board/package-boundaries': 'error',
    },
  },
);

export default createConfig(import.meta.dirname);
