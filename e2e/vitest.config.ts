import { defineConfig } from 'vitest/config';

// Запускается только через `npm run test:e2e`: нужны сборка и эмуляторы.
export default defineConfig({
  test: {
    name: 'e2e',
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
