import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'migrate',
    include: ['*.test.ts'],
    exclude: ['*.emulator.test.ts'],
  },
});
