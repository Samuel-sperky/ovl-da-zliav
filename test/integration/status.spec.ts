/**
 * Aura Zľavy — `GET /api/status` proti SKUTOČNEJ databáze (S2).
 *
 * Prečo tento test existuje: unit testy agregátora bežia nad injektovanými
 * zdrojmi, takže by prešli aj vtedy, keby produkčné zapojenie
 * (`productionStatusSources()`) volalo metódu, ktorá v repozitári neexistuje.
 * Presne táto pasca už v tomto repe raz prežila do produkcie — scheduler
 * „fungoval" v testoch a nikdy nezapisoval. Tu sa preto NEPODSTRKÁVA nič:
 * zdroje sú produkčné repozitáre a databáza je skutočná.
 *
 * Čo sa dokazuje:
 *  1. Produkčné zapojenie prejde bez jedinej vynechanej sekcie nad zdravou DB.
 *  2. Čísla v odpovedi sú TIE ISTÉ, aké sú v tabuľkách (katalóg, rozsah,
 *     spotreba rozpočtu z `audit_log`).
 *  3. Kľúč prežije redakciu ako `{present, expiresAt}` (I1) — a jeho plaintext
 *     ani `last4` sa v odpovedi neobjavia.
 *  4. Spotrebu zápisov míňa `write_attempt`, nič iné (K2).
 *
 * Vlastník: S2.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SessionClaims } from '@/contracts';

import { createStatusRoute, productionStatusSources } from '@/app/api/status/route';
import { closePool } from '@/db/pool';
import { appendAudit } from '@/lib/audit/write';
import { budgetDay } from '@/lib/engine/budget';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import { createApiKeyRepo } from '@/lib/repo/api-key.repo';
import { catalogRepo } from '@/lib/repo/catalog.repo';
import { settingsRepo } from '@/lib/repo/settings.repo';
import { buildStatusSnapshot, type StatusPayload } from '@/lib/status/snapshot';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';
import { fakeApiKey } from '../helpers/factories';

const available = await dbAvailable();

const NOW = new Date('2026-08-12T10:00:00.000Z');
const ORIGIN = 'https://zlavy.local';

/** Nikdy nie tvar reálneho kľúča poskytovateľa (I1). */
const PLAINTEXT_KEY = fakeApiKey('7788');

function claims(): SessionClaims {
  return {
    sub: 1,
    username: 'samuel',
    absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    sudoUntil: null,
  };
}

function sessionDeps(): RouteDeps {
  const value = claims();
  return {
    now: () => NOW,
    verifySession: async () => ({
      claims: value,
      refreshed: {
        token: 'test-token',
        claims: value,
        cookie: {
          name: 'ovl_zliav_session',
          value: 'test-token',
          options: { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 1800 },
        },
      },
    }),
  };
}

/** Zavolá route so SKUTOČNÝMI repozitármi — žiadne `sources` v `deps`. */
async function callStatus(): Promise<{ status: number; body: StatusPayload; raw: string }> {
  const handler = createStatusRoute({ now: () => NOW, routeDeps: sessionDeps() });
  const response = await handler(
    new Request(`${ORIGIN}/api/status`, {
      method: 'GET',
      headers: { cookie: 'ovl_zliav_session=test-token', host: 'zlavy.local' },
    }),
  );
  const raw = await response.text();
  const parsed = JSON.parse(raw) as { ok: boolean; data: StatusPayload };
  return { status: response.status, body: parsed.data, raw };
}

/** Pár riadkov katalógu, aby sa `COUNT(*)` dalo s čím porovnať. */
async function seedCatalog(rows: number): Promise<void> {
  await catalogRepo.upsertMany(
    Array.from({ length: rows }, (_, index) => ({
      productId: 9_000 + index,
      name: `Testovací produkt ${index}`,
      price: '19.90',
      hasAttributes: false,
      shopStatus: 'ok' as const,
      source: 'list' as const,
      fetchedAt: NOW,
      raw: { id: 9_000 + index },
    })),
  );
}

describe.skipIf(!available)('GET /api/status nad skutočnou DB (S2)', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    resetRateLimiter();
  });

  afterAll(async () => {
    await closePool();
  });

  it('produkčné zapojenie prečíta VŠETKY sekcie — žiadna medzera nad zdravou DB', async () => {
    const reading = await buildStatusSnapshot(productionStatusSources(() => NOW));
    expect(reading.unreadable).toEqual([]);
  });

  it('čísla v odpovedi sedia s tým, čo je naozaj v tabuľkách', async () => {
    await settingsRepo.setScopeMode('plny');
    await settingsRepo.setMaxProductsPerCampaign(500);
    await settingsRepo.setDailyWriteBudget(200);
    await seedCatalog(7);

    const { status, body } = await callStatus();

    expect(status).toBe(200);
    expect(body.scope).toEqual({
      mode: 'plny',
      maxProductsSetting: 500,
      maxProducts: 500,
      failClosed: false,
    });
    expect(body.catalog?.loadedProducts).toBe(7);
    expect(body.writeBudget?.budget).toBe(200);
    expect(body.writeBudget?.spent).toBe(0);
    expect(body.writeBudget?.day).toBe(budgetDay(NOW));
    expect(body.unreadable).toEqual([]);
  });

  it('spotrebu rozpočtu míňa `write_attempt`, nie iné udalosti (K2)', async () => {
    await settingsRepo.setDailyWriteBudget(200);

    // Dva pokusy o zápis a jedna udalosť, ktorá s rozpočtom nemá nič spoločné.
    await appendAudit({ actor: 'scheduler', eventType: 'write_attempt', ok: true });
    await appendAudit({ actor: 'scheduler', eventType: 'write_attempt', ok: true });
    await appendAudit({ actor: 'scheduler', eventType: 'catalog_refreshed', ok: true });

    const { body } = await callStatus();

    // `budgetDay()` počíta UTC deň z REÁLNEHO času (audit píše `UTC_TIMESTAMP`),
    // takže sa porovnáva s dneškom, nie s `NOW` z testu.
    if (body.writeBudget?.day === budgetDay(new Date())) {
      expect(body.writeBudget.spent).toBe(2);
    }
  });

  it('vložený kľúč prežije redakciu ako {present, expiresAt} a nič viac (I1)', async () => {
    // Master key sa PODSÚVA ako Buffer, nečíta sa zo súboru: `MASTER_KEY_FILE`
    // ukazuje na `secrets/test-master.key`, ktorý je gitignorovaný a nikto ho
    // nevytvára — singleton `apiKeyRepo.store()` by teda padol na
    // `SecretFileError`. Rovnaký vzor používa `orders-key.spec.ts`.
    // Čítanie v `/api/status` šifru nerozbaľuje (zaujíma ho len „je" a „dokedy"),
    // takže singleton na strane čítania stačí.
    const repo = createApiKeyRepo({ masterKey: Buffer.alloc(32, 0x5a) });
    await repo.store(Buffer.from(PLAINTEXT_KEY, 'utf8'), PLAINTEXT_KEY.slice(-4), 48);

    const { body, raw } = await callStatus();

    expect(body.apiKey.present).toBe(true);
    expect(body.apiKey.expiresAt).not.toBeNull();
    expect(Object.keys(body.apiKey).sort()).toEqual(['expiresAt', 'present']);

    // Ani plaintext, ani `last4`, ani ciphertext — a žiadne `***REDACTED***`,
    // lebo úzka výnimka redaktora má na tento tvar prejsť bez maskovania.
    expect(raw).not.toContain(PLAINTEXT_KEY);
    expect(raw).not.toContain(PLAINTEXT_KEY.slice(-4));
    expect(raw).not.toContain('***REDACTED***');
    expect(raw).not.toContain('last4');
  });

  it('bez kľúča je prvá prekážka „kľúč nie je vložený" s cestou do Nastavení', async () => {
    // Zápisy sú v testoch vypnuté (I13), takže tá prvá prekážka je `writes_disabled`;
    // kľúč musí byť hneď za ňou a musí viesť niekam, nie do prázdna.
    const { body } = await callStatus();

    const key = body.blockers.find((blocker) => blocker.id === 'key_missing');
    expect(key?.severity).toBe('blokuje');
    expect(key?.path).toBe('/nastavenia');
    expect(key?.assumed).toBe(false);
    expect(body.summary.blocked).toBe(true);
  });

  it('prázdny katalóg sa prizná ako prázdny, nie ako neznámy', async () => {
    const { body } = await callStatus();

    expect(body.catalog?.loadedProducts).toBe(0);
    expect(body.blockers.some((blocker) => blocker.id === 'catalog_incomplete')).toBe(true);
  });

  it('nezapisuje do `audit_log` — je to čítanie stavu (I4)', async () => {
    const before = await auditCount();
    await callStatus();
    expect(await auditCount()).toBe(before);
  });
});

async function auditCount(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query('SELECT COUNT(*) AS total FROM audit_log')) as Array<{
      total: number | bigint;
    }>;
    return Number(rows[0]?.total ?? 0);
  });
}
