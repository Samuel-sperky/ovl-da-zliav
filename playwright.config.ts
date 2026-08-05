/**
 * Aura Zľavy — Playwright konfigurácia.
 *
 * STUB od A0. Vlastníctvo PREBERÁ A18 (e2e scenáre + CI). A0 tu drží len
 * minimum, aby `npx playwright test` nespadol na chýbajúcej konfigurácii.
 *
 * INVARIANT I6: `baseURL` aj `SHOP_BASE_URL_OVERRIDE` smú ukazovať VÝHRADNE na
 * `127.0.0.1`. Reálna doména shopu sa do konfigurácie NESMIE dostať nikdy.
 */
import { defineConfig } from '@playwright/test';

const PORT = process.env.E2E_PORT ?? '3000';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  use: {
    // Len localhost (I6).
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'sk-SK',
    timezoneId: 'Europe/Bratislava',
  },
});
