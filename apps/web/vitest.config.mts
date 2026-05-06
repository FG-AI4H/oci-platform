import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{spec,test}.{ts,tsx}'],
    environment: 'node',
    globals: true,
  },
});
