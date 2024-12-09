module.exports = {
  env: {
    es2020: true,
    'jest/globals': true
  },
  extends: [
    'standard-with-typescript'
  ],
  files: ['**/*.test.ts', '**/*.test.tsx'], // כלול קבצי בדיקה
  parserOptions: {
    project: './tsconfig.json',
    ecmaFeatures: {
      jsx: true
    },
    ecmaVersion: 11,
    sourceType: 'module'
  },
  plugins: [
    'jest'
  ],
  rules: {
    '@typescript-eslint/restrict-template-expressions': ['error', { allowAny: true }]
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  overrides: [{
    files: [
      '**/*.stories.*'
    ],
    rules: {
      'import/no-anonymous-default-export': 'off'
    }
  }]
}