import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    testTimeout: 30_000,
    // Each file boots its own app + mongod; running them one at a time keeps
    // slow machines from starving a server mid-suite.
    fileParallelism: false,
  },
});
