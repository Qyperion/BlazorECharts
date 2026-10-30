import { defineConfig } from 'vitest/config';

const generatorSetup = ['tests/javascript/generator/global-setup.ts'];

const generatorWriters = [
  'api-diff', 'cli-codes', 'docs-acquire', 'emission', 'extraction', 'review-regressions', 'scope-categories', 'sharded-json', 'strict-coverage',
].map(name => `tests/javascript/generator/${name}.test.ts`);

export default defineConfig({
  test: {
    environment: 'node',
    outputFile: 'artifacts/vitest/results.json',
    reporters: ['default', 'json'],
    projects: [
      // Generator tests load the 120 MB schema; global-setup.ts generates the committed baseline once per run for both projects.
      // Files that run the CLI or write workspaces under artifacts/ stay sequential; the others only read, or write their own temporary
      // directory (wordcloud), and run three at a time.
      {
        extends: true,
        test: {
          name: 'generator',
          include: generatorWriters,
          fileParallelism: false,
          globalSetup: generatorSetup,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'generator-parallel',
          include: ['tests/javascript/generator/**/*.test.ts'],
          exclude: generatorWriters,
          maxWorkers: 3,
          globalSetup: generatorSetup,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      { extends: true, test: { name: 'javascript', include: ['tests/javascript/**/*.test.ts'], exclude: ['tests/javascript/generator/**'] } },
    ],
  },
});
