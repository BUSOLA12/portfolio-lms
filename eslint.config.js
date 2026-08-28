import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'apps/api/prisma/generated/**',
    ],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },

  // API — Node environment.
  {
    files: ['apps/api/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Web — browser environment. Server components also run in Node, so both
  // global sets are supplied.
  {
    files: ['apps/web/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },

  // Shared schemas — no environment-specific globals, deliberately. Anything
  // needing them does not belong in a package both tiers import.
  {
    files: ['packages/schemas/**/*.js'],
  },
];
