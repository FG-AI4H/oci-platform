/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    rules: {
      // Security baseline
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      // Style
      'no-unused-vars': 'warn',
    },
  },
];
