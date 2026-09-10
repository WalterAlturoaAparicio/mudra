import { defineConfig } from 'vitest/config';

/**
 * Two environments, because the split is the point (research D13): everything that
 * carries a rule runs in `node` with no DOM, and only the thin adapter tests get a
 * browser-shaped environment. A domain test that quietly started depending on the DOM
 * fails here rather than passing by accident.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    environmentMatchGlobs: [['test/adapters/**', 'jsdom']],
  },
});
