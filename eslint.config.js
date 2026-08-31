import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';

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
  //
  // `react/jsx-uses-vars` is the reason the plugin is here at all. Without it
  // `no-unused-vars` cannot see that `<Button />` is a reference to `Button`,
  // so every component imported for use in JSX — which is all of them — reports
  // as unused. Parsing JSX and understanding it are separate things, and
  // `ecmaFeatures.jsx` only does the first.
  //
  // Nothing else from the plugin is enabled. Its recommended set carries
  // opinions about prop-types and React versions that this project has not
  // taken a position on.
  {
    files: ['apps/web/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'react/jsx-uses-vars': 'error',
    },
  },

  // Shared schemas — no environment-specific globals, deliberately. Anything
  // needing them does not belong in a package both tiers import.
  {
    files: ['packages/schemas/**/*.js'],
  },
];
