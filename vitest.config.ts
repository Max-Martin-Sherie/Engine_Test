import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Whole matches between two computer players are played in some tests.
    testTimeout: 60000,
  },
});
