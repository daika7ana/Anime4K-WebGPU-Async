import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const CODE_FILES = ['**/*.{js,mjs,cjs,ts,mts,cts}'];
const TS_FILES = ['**/*.{ts,mts,cts}'];

export default tseslint.config(
  // Mirrors the legacy .eslintignore set.
  {
    name: 'anime4k/ignores',
    ignores: ['dist/**', 'node_modules/**', 'examples/**', 'scripts/**', 'vite.config.ts'],
  },
  {
    name: 'anime4k/language',
    files: CODE_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    name: 'anime4k/js-recommended',
    files: CODE_FILES,
    extends: [js.configs.recommended],
  },
  {
    // Modern equivalent of airbnb-typescript's type-checked set.
    name: 'anime4k/typescript',
    files: TS_FILES,
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    name: 'anime4k/imports',
    files: TS_FILES,
    extends: [importX.flatConfigs.recommended, importX.flatConfigs.typescript],
    settings: {
      'import-x/resolver': {
        node: { extensions: ['.js', '.ts'] },
        typescript: {},
      },
    },
    rules: {
      // Relaxed in the legacy config (Airbnb's import/extensions).
      'import-x/extensions': 'off',
      // Relaxed in the legacy config.
      'import-x/prefer-default-export': 'off',
    },
  },
  {
    name: 'anime4k/overrides',
    files: TS_FILES,
    rules: {
      // Relaxed in the legacy config.
      '@typescript-eslint/no-explicit-any': 'off',
      'no-bitwise': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // Relaxed in the legacy config.
      'class-methods-use-this': 'off',
      // Airbnb/base set no-console to "warn"; preserved here.
      'no-console': 'warn',
      // Repo-wide existing override (was `linebreak-style: "off"`).
      'linebreak-style': 'off',
    },
  },
  // Must stay last: switches off residual formatting rules so Prettier owns
  // all formatting (the former @stylistic block was removed for this reason).
  eslintConfigPrettier,
);
