// OCI Platform — ESLint flat config (root, applies to whole monorepo).
// Per-package `lint` scripts call `eslint .` and pick this up via discovery.
// Keep rules conservative for Phase A; tighten as the codebase matures.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/cdk.out/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      '**/*.d.ts',
      'apps/web/next-env.d.ts',
      'packages/database/src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  prettier,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    rules: {
      // Security baseline
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      // Style
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Allow `any` in Phase A scaffold; tighten in Phase B
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Browser globals for the Next.js app
  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // Test files: relax some rules
  {
    files: ['**/*.{spec,test}.{ts,tsx,js,jsx}', '**/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
);
