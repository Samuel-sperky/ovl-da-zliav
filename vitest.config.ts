/**
 * Aura Zľavy — vitest konfigurácia (BUILD-SPEC §12).
 *
 * - `setupFiles: test/setup.ts` — globálny fetch guard (I6) a ENV defaulty.
 * - `test/e2e/**` je vylúčené: e2e beží pod Playwrightom (A18).
 * - `test/smoke/**` je vylúčené: smoke test nad PRODUKČNÝM buildom beží
 *   samostatne (`npm run test:build`, `vitest.smoke.config.ts`) — `next build`
 *   je príliš pomalý na to, aby bol v bežnom `npm run test` (F.7).
 * - Testy bežia sekvenčne v jednom procese (jeden worker), pretože integračné
 *   testy zdieľajú jednu testovaciu MariaDB schému a paralelný truncate by ich
 *   navzájom rozbil.
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
    include: ['test/**/*.spec.ts'],
    exclude: ['test/e2e/**', 'test/smoke/**', 'node_modules/**', '.next/**'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: 'forks',
    // vitest 4: jeden worker + bez paralelizmu súborov = deterministické
    // integračné testy nad jednou zdieľanou testovacou DB.
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/app/**', 'src/contracts.ts'],
    },
  },
});
