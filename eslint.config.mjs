import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores([
    'node_modules/**',
    'coverage/**',
    'dist/**',
    'remote/dist/**',
    'monitor/dist/**',
    'pass/dist/**',
    'site-dist/**',
    '.wrangler/**',
    '.mcpb-build/**',
    'private/**',
    '.claude/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mjs'],
        },
      },
    },
  },
  {
    // The site's service worker is plain browser JavaScript, served as is.
    files: ['site/public/sw.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Response: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // One-line JSX event handlers like onClick={() => setOpen(true)}.
    files: ['site/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
])
