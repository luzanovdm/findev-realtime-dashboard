import { defineConfig, globalIgnores } from 'eslint/config';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['.angular/**', 'dist/**', 'node_modules/**', 'public/wasm/**']),
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommended, ...angular.configs.tsRecommended],
  },
  {
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
  {
    files: ['src/app/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      complexity: ['error', 15],
      'max-depth': ['error', 4],
      'max-params': ['error', 5],
    },
  },
  {
    files: ['src/app/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/**'],
              message: 'Core primitives cannot depend on a feature.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/features/dashboard/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/settings/**', '../settings/**', '../../settings/**'],
              message: 'Dashboard cannot depend on settings internals.',
            },
            {
              group: ['**/market-producer/generation/**', '**/market-producer/metrics/**'],
              message: 'Dashboard can use producer public contracts, not its runtime internals.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/features/settings/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/dashboard/**', '../dashboard/**', '../../dashboard/**'],
              message: 'Settings cannot depend on dashboard internals.',
            },
            {
              group: ['**/market-producer/generation/**', '**/market-producer/metrics/**'],
              message: 'Settings can use producer public contracts, not its runtime internals.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/features/market-producer/{generation,metrics}/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@angular/**', '@taiga-ui/**'],
              message: 'Worker-side producer code cannot depend on Angular or Taiga UI.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Worker-side producer code cannot access window.' },
        { name: 'document', message: 'Worker-side producer code cannot access document.' },
      ],
    },
  },
]);
