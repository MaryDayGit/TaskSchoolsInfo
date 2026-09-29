import { defineConfig } from 'vitest/config';

// Запускается только через `npm run test:rules`: нужен эмулятор Firestore.
export default defineConfig({
  test: {
    name: 'rules',
    include: ['firestore/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
