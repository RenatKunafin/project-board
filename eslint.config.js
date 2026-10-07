import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
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
    files: ['packages/dashboard/src/**/*.ts?(x)'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@project-board/gantt', '@project-board/gantt/*', '@project-board/checklist', '@project-board/checklist/*'],
              message: 'Платформа не импортирует предметные модули (ADR PBT-002, граница dashboard -> модули).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/widget-sdk/src/**/*.ts?(x)'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@project-board/dashboard',
                '@project-board/dashboard/*',
                '@project-board/gantt',
                '@project-board/gantt/*',
                '@project-board/checklist',
                '@project-board/checklist/*',
              ],
              message: 'SDK не зависит от пакетов проекта (ADR PBT-002, граница widget-sdk -> пакеты).',
            },
          ],
        },
      ],
    },
  },
);
