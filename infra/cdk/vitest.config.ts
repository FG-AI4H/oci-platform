import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the sources: `dist/` and `cdk.out/` hold compiled copies.
    include: ['test/**/*.spec.ts'],
    environment: 'node',
  },
});
