import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...tsPlugin.configs['recommended-requiring-type-checking'].rules,
      
      // TypeScript 관련 규칙
      '@typescript-eslint/no-explicit-any': 'error', // any 타입 금지
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/prefer-const': 'error',
      '@typescript-eslint/no-var-requires': 'error',
      
      // 코드 품질 규칙
      'no-console': 'off', // 서버에서는 console.log 허용
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-unused-expressions': 'error',
      'prefer-template': 'error',
      'object-shorthand': 'error',
      
      // 스타일 규칙
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'trailing-comma': 'off', // prettier가 처리
      
      // 네이밍 컨벤션
      '@typescript-eslint/naming-convention': [
        'error',
        {
          'selector': 'variable',
          'format': ['camelCase', 'UPPER_CASE'],
        },
        {
          'selector': 'function',
          'format': ['camelCase'],
        },
        {
          'selector': 'typeLike',
          'format': ['PascalCase'],
        },
      ],
    },
  },
  prettierConfig, // Prettier와 충돌하는 규칙 비활성화
  {
    ignores: ['dist/**', 'node_modules/**', '*.js'],
  },
];