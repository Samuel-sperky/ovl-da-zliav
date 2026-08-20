/**
 * Aura Zľavy — globálny test setup (INVARIANT I6, D99).
 *
 * I6: ŽIADNY test (unit, integračný, e2e komponentový) NESMIE poslať request na
 * reálnu doménu shopu. Tento súbor preto:
 *   1. nastaví bezpečné ENV defaulty pre testy (vrátane samostatnej testovacej DB),
 *   2. obalí globálny `fetch` guardom, ktorý požiadavku na iný host než lokálny
 *      mock ODMIETNE (hodí výnimku),
 *   3. navyše si každé porušenie zapamätá a v `afterEach` test ZHODÍ — aby ho
 *      nezachránilo ani `try/catch` v testovanom kóde.
 *
 * Registruje sa cez `setupFiles` vo `vitest.config.ts`.
 */
import { afterEach, beforeEach } from 'vitest';

/* ────────────────────────── 1. bezpečné ENV defaulty ───────────────────────── */

// NODE_ENV je v typoch read-only; vitest ho nastavuje sám, toto je poistka.
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.PUBLIC_BIND ??= '127.0.0.1';
process.env.APP_VERSION ??= '0.1.0-test';
// Vlastná testovacia DB — testy sa NIKDY nesmú spustiť nad prevádzkovou schémou.
process.env.DB_HOST ??= '127.0.0.1';
process.env.DB_PORT ??= '3306';
process.env.DB_NAME ??= 'ovl_zliav_test';
process.env.DB_USER ??= 'ovl_zliav_app';
process.env.DB_PASSWORD ??= 'test_app_password';
process.env.DB_MIGRATION_USER ??= 'ovl_zliav_mig';
process.env.DB_MIGRATION_PASSWORD ??= 'test_mig_password';
process.env.MASTER_KEY_FILE ??= 'secrets/test-master.key';
process.env.SESSION_SECRET_FILE ??= 'secrets/test-session.key';
// Scheduler v testoch nebeží sám — tick sa volá explicitne (A10).
process.env.SCHEDULER_ENABLED ??= 'false';
process.env.LOG_LEVEL ??= 'error';

/* ─────────────────────────── 2. fetch guard (I6) ──────────────────────────── */

/** Jediné povolené cieľové hosty: lokálny mock shop a lokálna appka. */
export const ALLOWED_TEST_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '::1', '[::1]'];

export interface FetchGuardViolation {
  url: string;
  hostname: string;
  at: Date;
}

const violations: FetchGuardViolation[] = [];

export function getFetchGuardViolations(): readonly FetchGuardViolation[] {
  return violations;
}

export function resetFetchGuardViolations(): void {
  violations.length = 0;
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof input === 'object' && input !== null && 'url' in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

export function isAllowedTestUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Relatívna URL sa v Node bez base aj tak nedá zavolať — nech to rieši fetch.
    return true;
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'file:') {
    return true;
  }
  return ALLOWED_TEST_HOSTNAMES.includes(parsed.hostname);
}

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = urlOf(input);
  if (!isAllowedTestUrl(url)) {
    let hostname = url;
    try {
      hostname = new URL(url).hostname;
    } catch {
      // ponecháme celú URL v hláške
    }
    violations.push({ url, hostname, at: new Date() });
    throw new Error(
      `[I6] Test sa pokúsil o HTTP požiadavku na "${hostname}". Testy smú volať výhradne ` +
        `lokálny mock (${ALLOWED_TEST_HOSTNAMES.join(', ')}). Použi mock shop z test/mock-shop/.`,
    );
  }
  return realFetch(input as Parameters<typeof realFetch>[0], init as RequestInit | undefined);
}) as typeof globalThis.fetch;

/* ──────────── 3. porušenie zhodí test aj keď ho kód „prehltne" ───────────── */

beforeEach(() => {
  resetFetchGuardViolations();
});

afterEach(() => {
  if (violations.length === 0) return;
  const list = violations.map((v) => `  - ${v.url}`).join('\n');
  resetFetchGuardViolations();
  throw new Error(
    `[I6] Počas testu vznikli požiadavky na nepovolené hosty:\n${list}\n` +
      'Invariant I6: testy bežia výhradne proti lokálnemu mocku.',
  );
});
