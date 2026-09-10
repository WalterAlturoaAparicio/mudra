/**
 * Lint rules for Mudra Web.
 *
 * Deliberately thin: the architecture rules that matter here — layering, privacy, the
 * capture boundary — are asserted by `test/architecture/**` against the real source, where
 * they can be explained and where a violation reads as a failing claim rather than a rule
 * id. This file covers what a type checker and a test cannot: unused code, unsafe `any`, and
 * floating promises.
 *
 * `recommended-type-checked` rather than `strict-type-checked`: `tsconfig.json` is already
 * strict and the compiler is the authority on types, so lint is here for what the compiler
 * does not model. The stricter preset's stylistic rules (template-expression types,
 * plus-operand types) fire in hundreds of places this codebase deliberately writes.
 */

module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  rules: {
    // An unawaited promise in a UI event handler is how a save silently does not happen.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    // A leading underscore is the codebase's existing way of saying "required by the
    // signature, deliberately unused" — the fake adapters in test/ rely on it.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
    ],
  },
  overrides: [
    {
      // Tests reach into fakes and fixtures where a non-null assertion is the clearest way
      // to say "this fixture case exists"; the assertion itself is the test's subject.
      files: ['test/**/*.ts'],
      rules: {
        // A fake that satisfies an async port has nothing to await — its whole point is to
        // answer synchronously while keeping the port's shape.
        '@typescript-eslint/require-await': 'off',
        // Tests capture a prototype method to restore it afterwards; that reference is the
        // point, not an accidental unbinding.
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
      },
    },
  ],
};
