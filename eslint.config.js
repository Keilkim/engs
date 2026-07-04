import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // youtube-audio-server is a standalone Node (CommonJS) service deployed to
  // Railway, not part of the Vite app — don't lint it with the browser/ESM config.
  globalIgnores(['dist', 'youtube-audio-server']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Vercel serverless functions run on Node, not the browser (process, Buffer, etc.).
    files: ['api/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Some api files explicitly `import process/Buffer` while others use the global;
      // don't flag either style now that node globals are supplied.
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
])
