/**
 * Aura Zľavy — test guardu z `test/setup.ts` (INVARIANT I6).
 *
 * Overuje akceptačné kritérium A0: „`test/setup.ts` zhodí test pri `fetch` na
 * iný host než localhost". Overuje sa aj to, že lokálne hosty guard prepustí,
 * aby mock shop (A6) fungoval.
 *
 * Súbor nie je v zozname žiadneho iného agenta; vlastní ho A0 spolu s
 * `test/setup.ts`, ktorý testuje.
 */
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TEST_HOSTNAMES,
  getFetchGuardViolations,
  isAllowedTestUrl,
  resetFetchGuardViolations,
} from './setup';

describe('I6 — fetch guard', () => {
  it('povolí lokálne hosty', () => {
    for (const host of ALLOWED_TEST_HOSTNAMES) {
      const url = host.startsWith('[') || host.includes(':') ? `http://[::1]:8080/api` : `http://${host}:8080/api`;
      expect(isAllowedTestUrl(url)).toBe(true);
    }
  });

  it('odmietne reálnu doménu shopu', () => {
    expect(isAllowedTestUrl('https://sperky-eshop.sk/api/products')).toBe(false);
    expect(isAllowedTestUrl('http://example.com/')).toBe(false);
    expect(isAllowedTestUrl('https://127.0.0.1.evil.com/api')).toBe(false);
  });

  it('fetch na nepovolený host hodí výnimku a zaznamená porušenie', async () => {
    await expect(fetch('https://example.com/api/products')).rejects.toThrow(/\[I6\]/);
    expect(getFetchGuardViolations()).toHaveLength(1);
    expect(getFetchGuardViolations()[0]?.hostname).toBe('example.com');

    // Vyčistíme, inak by `afterEach` hook tento test zhodil (a to je správne).
    resetFetchGuardViolations();
  });
});
