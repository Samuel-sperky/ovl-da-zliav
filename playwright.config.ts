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
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { APP_BASE_URL } from './test/e2e/config';

/**
 * Cesta k Chromiu, ktorým sa e2e spúšťajú.
 *
 * Poradie hľadania:
 *   1. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` — explicitné prepísanie.
 *   2. Chromium už nainštalované v `PLAYWRIGHT_BROWSERS_PATH` (predvolene
 *      `/opt/pw-browsers`), NEZÁVISLE od revízie, ktorú `@playwright/test`
 *      očakáva. V uzavretých prostrediach je `cdn.playwright.dev` nedostupný,
 *      takže `npx playwright install` nemá odkiaľ stiahnuť presnú revíziu a
 *      launch by padol na „Executable doesn't exist" — hoci funkčný prehliadač
 *      na disku JE. Bez tohto fallbacku prejde `npx playwright test` len s ručne
 *      nastavenou premennou, čo z e2e robí past na ďalšieho človeka.
 *   3. `undefined` → štandardné správanie Playwrightu (browser z `install`).
 */
function findChromium(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (explicit !== undefined && explicit !== '') return explicit;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return undefined;
  }

  // Novšia revízia vyhráva: `chromium-1194` < `chromium-1234`.
  const revision = (name: string): number => Number(/-(\d+)$/.exec(name)?.[1] ?? 0);
  const candidates = entries
    .filter((name) => name.startsWith('chromium-'))
    .sort((a, b) => revision(b) - revision(a))
    .map((name) => join(root, name, 'chrome-linux', 'chrome'));

  return candidates.find((candidate) => existsSync(candidate));
}

const chromiumExecutable = findChromium();

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
    // Len localhost (I6). Schéma je `https://` — harness servuje appku cez TLS
    // (viď nižšie `ignoreHTTPSErrors`).
    baseURL: APP_BASE_URL,
    /**
     * Harness servuje appku cez HTTPS so **self-signed** certifikátom
     * (`test/e2e/serve.ts` → `ensureTlsCert()`), preto sa chyba dôveryhodnosti
     * certifikátu ignoruje. Dôvod je session cookie: je (správne, D69) `Secure`
     * a Playwright `APIRequestContext` (`page.request`) ju cez `http://`
     * NEPOSIELA — nad plain HTTP harnessom končilo každé API volanie na 401
     * (§D.2/F.6). Appka sa tým NEOSLABUJE: cookie zostáva `Secure`, `httpOnly`,
     * `SameSite=Strict`, a beh cez TLS je bližšie produkcii (Caddy).
     */
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'sk-SK',
    timezoneId: 'Europe/Bratislava',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'chromium',
      ...(chromiumExecutable === undefined
        ? {}
        : { use: { launchOptions: { executablePath: chromiumExecutable } } }),
    },
  ],
  /**
   * Harness (mock shop + control server + e2e DB + `next dev`) beží ako
   * `globalSetup`, nie ako `webServer`: potrebuje mock na EPHEMERAL porte
   * a jeho hodnotu podsunúť appke ako `SHOP_BASE_URL_OVERRIDE` (I6), čo
   * deklaratívny `webServer` neumožňuje. `globalSetup` vracia teardown, takže
   * po poslednom teste nezostane žiadny proces ani otvorený port.
   */
  globalSetup: './test/e2e/serve.ts',
});
