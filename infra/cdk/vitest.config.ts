import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the sources: `dist/` and `cdk.out/` hold compiled copies.
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    // Each test synthesizes a stack, and the first one also pays for loading
    // aws-cdk-lib: about 7 s on a CI runner that is running the other
    // packages' tests at the same time, over Vitest's 5 s default.
    testTimeout: 60_000,
  },
});
