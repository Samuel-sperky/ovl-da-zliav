/**
 * Aura Zľavy — SMOKE TEST NAD ZBUILDOVANOU APPKOU (odporúčanie F.7 z
 * `docs/13-OVERENIE.md`, D100).
 *
 * Jediný test v repe, ktorý ide HTTP-om proti PRODUKČNÉMU ARTEFAKTU
 * (`next build` → `node .next/standalone/server.js`), nie proti zdrojáku
 * skompilovanému vitestom. Presne táto medzera pustila do produkcie miscompile
 * Turbopacku v `src/lib/repo/api-key.repo.ts` (`if (!row)` vyhodnotené ako
 * compile-time falsy → `GET /api/key` padalo na 500 vždy, keď nebol uložený
 * kľúč) a nechala `next build` štyri vlny rozbitý.
 *
 * NIE JE súčasťou `npm run test` (build je pomalý) — spúšťa sa
 * `npm run test:build`, v CI na každom PR.
 *
 * Čo sa overuje:
 *   1. `next build` prejde a vyrobí `.next/standalone/server.js`,
 *   2. boot fail-fast pri `PUBLIC_BIND=0.0.0.0` (I5, I14) — proces skončí exit 1,
 *   3. `/api/health` 200 bez auth, nič citlivé v odpovedi (I1),
 *   4. **appka odpovedá BEZ prihlásenia** (D99): `/` je 200, nie presmerovanie
 *      na `/login`, a žiadna odpoveď neposiela session cookie,
 *   5. **`GET /api/key` bez uloženého kľúča vracia 200, NIE 500** — regresia §A.3,
 *      a je dostupný bez akejkoľvek autentifikácie (D99),
 *   6. zápisová route bez potvrdenia je odmietnutá (I3),
 *   7. **origin check (D72) drží aj v zbuildovanej appke** — mutácia bez
 *      hlavičky `Origin` aj mutácia s CUDZÍM `Origin` skončí 403.
 *
 * Body 4, 5 a 7 nahradili 27. 8. 2026 (D99) pôvodný login flow a tvrdenie
 * „bez session cookie je `/api/key` 401". Zmysel testu sa nemenil: je to
 * poistka proti celej triede chýb nasadenia (viď vyššie) a po zrušení
 * prihlásenia musí dokazovať práve to, čo sa zmenilo.
 *
 * INVARIANT I6: appka v tomto teste nemá nastavenú doménu shopu ani
 * `SHOP_BASE_URL_OVERRIDE` (v produkcii zakázaný) — nemá teda kam volať.
 * INVARIANT I13: `WRITES_ENABLED=false` → ostrý zápis je fyzicky vypnutý.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BASE_URL,
  SMOKE,
  call,
  ensureDatabase,
  ensureSecrets,
  runMigrations,
  runNextBuild,
  seedBaseline,
  startStandalone,
  waitForHealth,
  productionEnv,
  STANDALONE_SERVER,
  type StartedServer,
} from './harness';
import { spawn } from 'node:child_process';

let server: StartedServer | null = null;

beforeAll(async () => {
  ensureSecrets();
  await ensureDatabase();
  runMigrations();
  await seedBaseline();

  runNextBuild();

  server = startStandalone();
  await waitForHealth(server);
}, 1_200_000);

afterAll(async () => {
  await server?.stop();
});

describe('smoke nad produkčným buildom', () => {
  it('build vyrobil standalone server a ten nabehol', () => {
    expect(STANDALONE_SERVER).toMatch(/\.next[\\/]standalone[\\/]server\.js$/);
    expect(server?.child.exitCode).toBeNull();
    // `boot_start` → `boot_ok`, žiadne `boot_assertions_failed` (I14).
    expect(server?.output()).toContain('boot_ok');
    expect(server?.output()).not.toContain('boot_assertions_failed');
  });

  it('GET /api/health je 200 bez auth a neprezradí nič citlivé (I1)', async () => {
    const res = await call('GET', '/api/health');
    expect(res.status).toBe(200);
    const body = res.json as {
      ok: boolean;
      data: {
        status: string;
        db: boolean;
        key: unknown;
        writesEnabled: boolean;
        writesLocked: boolean;
        version: string;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.db).toBe(true);
    expect(body.data.status).toBe('ok');
    // I13 — dve env poistky: `WRITES_ENABLED` nie je zapnuté.
    expect(body.data.writesEnabled).toBe(false);

    /* I1 — kľúč sa hlási VÝHRADNE ako `{present, expiresAt}` (§5): žiadny
     * `last4`, žiadny plaintext, žiadne ďalšie pole. Bez uloženého kľúča je
     * `present:false`. Redaktor (`redact()`, D66) prepustí len tento presný
     * bezpečný tvar — akékoľvek iné pole pod menom `key` by zamaskoval celé. */
    expect(body.data.key).toEqual({ present: false, expiresAt: null });

    /* I1 — v celej odpovedi sa nesmie objaviť nič, čo pripomína tajomstvo. */
    for (const forbidden of [
      'last4',
      'apiKey',
      'api_key',
      'x-api-key',
      'authorization',
      'password',
      'secret',
      'token',
      'master',
    ]) {
      expect(res.text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('D99: appka odpovedá bez prihlásenia — `/` je 200, nie presmerovanie na /login', async () => {
    /* `redirect: 'manual'` je tu podstatné: s automatickým nasledovaním by aj
     * presmerovanie na prihlásenie skončilo ako 200 a test by nič nestrážil. */
    const res = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
    expect(res.status, `Location: ${res.headers.get('location') ?? '—'}`).toBe(200);
    expect(res.headers.get('location')).toBeNull();

    const html = await res.text();
    // K2 — do prihlásenia nevedie ani odkaz; stránka `/login` neexistuje.
    expect(html).not.toContain('/login');

    // Appka nemá session, takže nesmie posielať ani jej cookie.
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.includes('ovl_zliav_session'))).toBe(false);
  });

  it('D99: /api/key je dostupný bez akejkoľvek autentifikácie', async () => {
    const res = await call('GET', '/api/key');
    expect(res.status, res.text).toBe(200);
    expect(res.setCookie.some((c) => c.includes('ovl_zliav_session'))).toBe(false);
  });

  it('REGRESIA §A.3: GET /api/key bez uloženého kľúča vracia 200, nie 500', async () => {
    const res = await call('GET', '/api/key');
    // Toto presne padalo na 500 kvôli miscompile Turbopacku — a padalo LEN
    // v zbuildovanej appke, nikdy v testoch nad zdrojákom.
    expect(res.status, res.text).toBe(200);
    const body = res.json as { ok: boolean; data: { present: boolean; last4: string | null } };
    expect(body.ok).toBe(true);
    expect(body.data.present).toBe(false);
    expect(body.data.last4).toBeNull();
  });

  it('I3: POST /api/campaigns bez potvrdenia je odmietnutý', async () => {
    const res = await call('POST', '/api/campaigns', {
      body: { name: 'Smoke bez potvrdenia', mode: 'eager' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = res.json as { ok: boolean; error?: { code?: string } };
    expect(body.ok).toBe(false);
    // Chýba `previewToken` aj `acknowledgements` → zod schéma to zastaví
    // ešte pred handlerom; iný kód než 2xx je jediné prijateľné vyústenie.
    expect(body.error?.code).toBeTruthy();
  });

  it('D72: mutácia bez hlavičky Origin je odmietnutá (CSRF)', async () => {
    const res = await fetch(`${BASE_URL}/api/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bez originu', mode: 'eager' }),
    });
    expect(res.status).toBe(403);
    expect((await res.text()).includes('origin_missing')).toBe(true);
  });

  /*
   * Toto je po D99 JEDINÁ brána, ktorá cudzej stránke bráni zapísať do
   * produkčného eshopu (§2 a §3 kontraktu `KONTRAKT-BEZ-LOGINU-2026-08-27.md`).
   * Preto ju smoke test overuje aj v zbuildovanom artefakte, nielen nad
   * zdrojákom: keby ju build zahodil tak, ako Turbopack zahodil null-guard
   * (§A.3), nezostalo by nič.
   */
  it('D72: mutácia s CUDZÍM Origin je odmietnutá aj v zbuildovanej appke', async () => {
    const res = await fetch(`${BASE_URL}/api/campaigns`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Cudzia stránka. Host sa nerovná hostu požiadavky → fail-closed.
        Origin: 'https://zlomyselna.example',
      },
      body: JSON.stringify({ name: 'cudzi origin', mode: 'eager' }),
    });
    expect(res.status).toBe(403);
    expect((await res.text()).includes('origin_mismatch')).toBe(true);
  });

  it('I5/I14: PUBLIC_BIND=0.0.0.0 zhodí boot zbuildovanej appky (exit 1)', async () => {
    const child = spawn(process.execPath, [STANDALONE_SERVER], {
      cwd: process.cwd(),
      // Iný port, aby to nekolidovalo s bežiacou instanciou.
      env: productionEnv({ PUBLIC_BIND: '0.0.0.0', PORT: String(SMOKE.port + 1) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    const exitCode = await new Promise<number | null>((done) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        done(null);
      }, 60_000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        done(code);
      });
    });
    expect(out).toContain('boot_assertions_failed');
    expect(out).toContain('PUBLIC_BIND');
    expect(exitCode).toBe(1);
  }, 120_000);
});
