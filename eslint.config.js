import js from '@eslint/js';
import globals from 'globals';
import compat from 'eslint-plugin-compat';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.cache/**',
      'apps/server/drizzle/**',
      'coverage/**',
      // A verbatim copy of Клас-пульт code (browser ES5), used only by the migration tests.
      'tools/migrate/test/klas-pult-stats.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/platform/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // School PCs: Chrome 109 / Firefox 115 (browserslist in apps/platform/package.json).
    files: ['apps/platform/src/**/*.{ts,tsx}'],
    plugins: { compat },
    settings: { browsers: ['chrome >= 109', 'firefox >= 115'], lintAllEsApis: true },
    rules: {
      'compat/compat': 'error',
      // Embedded browsers don't show native dialogs and answer "cancel" at once
      // (a Клас-пульт lesson): use useConfirm() from components/Dialog instead.
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use useConfirm() from components/Dialog.' },
        { name: 'prompt', message: 'Use a form or components/Dialog.' },
        { name: 'alert', message: 'Use components/Dialog.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'confirm',
          message: 'Use useConfirm() from components/Dialog.',
        },
        { object: 'window', property: 'prompt', message: 'Use a form or components/Dialog.' },
        { object: 'window', property: 'alert', message: 'Use components/Dialog.' },
      ],
    },
  },
);
