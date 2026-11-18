import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts',
        'prisma/'
      ]
    },
    mockReset: true,
    restoreMocks: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        isolate: true
      }
    },
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
    sequence: {
      shuffle: false
    }
  }
});
