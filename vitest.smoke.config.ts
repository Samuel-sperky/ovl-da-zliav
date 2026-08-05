/**
 * Aura Zľavy — vitest konfigurácia SMOKE TESTU NAD BUILDOM (F.7, D100).
 *
 * Samostatný projekt zámerne: `next build` trvá minúty, takže tento test NESMIE
 * byť v `npm run test` (`vitest.config.ts` má `test/smoke/**` v `exclude`).
 * Spúšťa sa `npm run test:build`, v CI ako vlastný job na PR.
 *
 * Rozdiely proti hlavnej konfigurácii:
 *  - `include` len `test/smoke/**`,
 *  - dlhé timeouty (build + boot produkčného servera),
 *  - `setupFiles: test/setup.ts` zostáva — drží fetch guard na `127.0.0.1` (I6).
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['test/smoke/**/*.spec.ts'],
    exclude: ['node_modules/**', '.next/**'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 1_200_000,
    teardownTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
  },
});
