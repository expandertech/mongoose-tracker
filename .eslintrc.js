module.exports = {
  env: {
    es2020: true,
    'jest/globals': true
  },
  extends: [
    'standard-with-typescript'
  ],
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
    // Existing rule
    '@typescript-eslint/restrict-template-expressions': ['error', { allowAny: true }],

    // Example: turn off strict-boolean-expressions
    '@typescript-eslint/strict-boolean-expressions': 'off',

    // Example: lower severity for no-unnecessary-type-assertion
    '@typescript-eslint/no-unnecessary-type-assertion': 'warn'
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  overrides: [
    {
      files: ['**/*.stories.*'],
      rules: {
        'import/no-anonymous-default-export': 'off'
      }
    }
  ]
}
