import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'migrate-emulator',
    root: 'tools/migrate',
    include: ['*.emulator.test.ts'],
    testTimeout: 60_000,
  },
});
