/**
 * Aura Zľavy — Playwright konfigurácia (A18; stub od A0 je plne nahradený).
 *
 * `webServer` je harness `test/e2e/serve.ts`: postaví mock shop na ephemeral
 * porte (127.0.0.1), control server, e2e DB schému a `next dev` s
 * `SHOP_BASE_URL_OVERRIDE` na mock.
 *
 * INVARIANT I6: `baseURL` aj adresa shopu smú ukazovať VÝHRADNE na `127.0.0.1`.
 * Reálna doména shopu sa do konfigurácie NESMIE dostať nikdy — e2e beží
 * výhradne proti mocku.
 * INVARIANT I1: v konfigurácii nie je žiadne tajomstvo; heslo aj kľúč sú
 * syntetické hodnoty z `test/e2e/config.ts` a `test/mock-shop/fixtures.ts`.
 */
import { defineConfig, devices } from '@playwright/test';

import { APP_BASE_URL } from './test/e2e/config';

export default defineConfig({
  testDir: './test/e2e',
  // Harness drží JEDNU appku a JEDNU DB schému — paralelný beh by si testy
  // navzájom vyresetoval (fixture `cleanState` čistí DB pred každým testom).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: './test-results',
  use: {
    // Len localhost (I6).
    baseURL: APP_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'sk-SK',
    timezoneId: 'Europe/Bratislava',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium' }],
  /**
   * Harness (mock shop + control server + e2e DB + `next dev`) beží ako
   * `globalSetup`, nie ako `webServer`: potrebuje mock na EPHEMERAL porte
   * a jeho hodnotu podsunúť appke ako `SHOP_BASE_URL_OVERRIDE` (I6), čo
   * deklaratívny `webServer` neumožňuje. `globalSetup` vracia teardown, takže
   * po poslednom teste nezostane žiadny proces ani otvorený port.
   */
  globalSetup: './test/e2e/serve.ts',
});
