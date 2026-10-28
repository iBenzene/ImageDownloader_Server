const js = require('@eslint/js');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const typescript = require('@typescript-eslint/parser');
const { defineConfig } = require('eslint/config');
const prettierConfig = require('eslint-config-prettier');
const jsonc = require('eslint-plugin-jsonc');
const perfectionist = require('eslint-plugin-perfectionist');
const prettier = require('eslint-plugin-prettier');
const vue = require('eslint-plugin-vue');
const globals = require('globals');

module.exports = defineConfig([
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/coverage/**',
            '**/package-lock.json'
        ]
    },
    {
        extends: [js.configs.recommended],
        files: ['**/*.{js,mjs,cjs,ts,jsx,tsx,vue}'],
        languageOptions: {
            globals: globals.node,
            parserOptions: { ecmaFeatures: { jsx: true } }
        }
    },
    {
        files: ['**/*.{jsx,tsx,vue}', '**/*.browser.js'],
        languageOptions: { globals: globals.browser }
    },
    {
        files: ['**/*.{js,mjs,cjs,jsx}'],
        rules: {
            'no-unused-vars': ['error', { args: 'all' }],
            'no-var': 'error',
            'prefer-const': 'error'
        }
    },
    {
        extends: typescriptPlugin.configs['flat/recommended'].map(config => ({
            ...config,
            files: ['**/*.{ts,tsx,vue}']
        })),
        files: ['**/*.{ts,tsx,vue}'],
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { args: 'all' }]
        }
    },
    ...vue.configs['flat/recommended'],
    {
        files: ['**/*.vue'],
        languageOptions: { parserOptions: { parser: typescript } }
    },
    {
        extends: [jsonc.configs['flat/recommended-with-json']],
        files: ['**/*.json']
    },
    {
        extends: [jsonc.configs['flat/recommended-with-jsonc']],
        files: ['**/*.jsonc']
    },
    prettierConfig,
    ...jsonc.configs['flat/prettier'],
    {
        files: ['**/*.{js,mjs,cjs,ts,jsx,tsx,vue}'],
        plugins: { perfectionist },
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    message: '回调函数必须使用箭头函数。',
                    selector: 'CallExpression > FunctionExpression.arguments'
                }
            ],
            'perfectionist/sort-objects': [
                'error',
                {
                    ignoreCase: false,
                    partitionByComputedKey: true,
                    type: 'alphabetical'
                }
            ],
            'prefer-arrow-callback': ['error', { allowUnboundThis: false }]
        }
    },
    {
        files: ['**/*.{json,jsonc}'],
        ignores: ['**/package.json'],
        rules: {
            'jsonc/sort-keys': [
                'error',
                { order: { type: 'asc' }, pathPattern: '.*' }
            ]
        }
    },
    {
        files: ['**/*.{js,mjs,cjs,ts,jsx,tsx,vue,json,jsonc}'],
        plugins: { prettier },
        rules: { 'prettier/prettier': 'error' }
    }
]);
