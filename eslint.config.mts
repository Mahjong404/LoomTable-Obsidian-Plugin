import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
  globalIgnores([
    'coverage',
    'main.js',
    'node_modules',
    'openapi/loomtable-server.openapi.yaml',
    'src/generated/transport.ts',
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mts', 'esbuild.config.mjs', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['eslint.config.mts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    files: ['esbuild.config.mjs', 'scripts/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-globals': 'off',
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/rule-custom-message': 'off',
    },
  },
  {
    files: ['src/settings/settings-tab.ts'],
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
      'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
    },
  },
);
