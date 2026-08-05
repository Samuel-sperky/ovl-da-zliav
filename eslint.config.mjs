/**
 * Aura Zľavy — ESLint flat config (D99).
 *
 * Zámerne bez `eslint-config-next`: `next lint` v Next.js 16 už neexistuje a
 * lint beží ako samostatný krok v CI (`npm run lint`). Pravidlá sú cielené na
 * invarianty projektu — nie na štýl.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        globalThis: 'readonly',
        React: 'readonly',
      },
    },
    rules: {
      // Nepoužité premenné sú chyba, ale `_`-prefix je vedomé ignorovanie.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `any` je povolený len tam, kde ho vynucuje cudzí typ (DB driver).
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
      'prefer-const': 'error',
      // I10 — pripomienka, že nad zápisovými volaniami sa `Promise.all` nesmie
      // použiť; skutočnú kontrolu robia testy A9/A17, toto je len upozornenie
      // pri zjavnom vzore.
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.object.name='Promise'][callee.property.name='all'] :matches(Identifier[name=/setReduction/])",
          message:
            'Zápisy do shopu musia byť sekvenčné s pauzou 250 ms — Promise.all je zakázaný (I10, D46).',
        },
      ],
    },
  },
  {
    // Skripty bežia priamo cez `node scripts/*.ts` mimo Next.js.
    files: ['scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      // JSX si React 19 importuje sám (automatic runtime).
      'no-undef': 'off',
    },
  },
);
