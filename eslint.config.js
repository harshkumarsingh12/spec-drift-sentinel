import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint rules are deliberately lean. Under time pressure a linter that shouts
 * about style trains people to ignore it; these rules catch real defects only.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      // Next.js build output and the type shim it regenerates on every build.
      'web/.next/**',
      'web/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused code is usually a half-finished edit. Allow a leading underscore
      // to mark something intentionally unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // `any` erases the type contract in src/types.ts, which both halves of the
      // team build against. Warn rather than error so it never blocks a merge.
      '@typescript-eslint/no-explicit-any': 'warn',

      // A floating promise silently swallows failures — exactly the class of bug
      // that makes a CI gate lie about whether it passed.
      '@typescript-eslint/no-floating-promises': 'error',

      // Catches `if (await maybe)` style mistakes around async boundaries.
      '@typescript-eslint/await-thenable': 'error',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off', // this is a CLI; printing is the point
    },
  },

  {
    // node:test's test() and describe() return promises the runner owns. Awaiting
    // them is wrong, so the floating-promise rule only creates noise here.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  {
    // Plain-JS helper scripts: no type-aware linting, Node globals available.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
);
