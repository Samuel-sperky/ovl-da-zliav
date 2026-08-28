/**
 * Aura Zľavy — LOKÁLNY ACTOR NA ZÁPISOVEJ CESTE, nad SKUTOČNOU DB
 * (K5 kontraktu KONTRAKT-BEZ-LOGINU-2026-08-27.md, D102, I11).
 *
 * PREČO TENTO SÚBOR VZNIKOL (27. 8. 2026)
 * ---------------------------------------
 * Prvá vlna sprintu skončila zelená a K5 („kampaň aj auditný riadok sa zapíšu
 * s `user_id = 1`") sa považovalo za splnené. Overovanie ukázalo, že dôkaz
 * neexistoval:
 *
 *  - `src/lib/auth/local-actor.ts` — 130 riadkov na ceste KAŽDÉHO requestu —
 *    nevolal ani jeden test. `grep resolveLocalActor test/` našiel len komentár.
 *  - Žiadny test nečítal `campaigns.created_by` ani `audit_log.user_id` z DB.
 *    Všetky tvrdenia `userId: 1` boli KRUHOVÉ: harness podstrčil
 *    `localActor: async () => ({ id: 1 })` a test potom overil jednotku, ktorú
 *    si sám dal.
 *  - A pod tým sa skrýval skutočný nález: `executor.ts` `userId` deklaroval,
 *    route ho posielali, ale objekt `commonAudit` ho NEOBSAHOVAL. Riadky
 *    `write_ok` / `write_failed` / `write_uncertain` — teda práve tie, ktoré
 *    dokladujú zápis do PRODUKČNÉHO shopu — mali `user_id = NULL`.
 *
 * Je to presne pasca zapísaná v CLAUDE.md: „integračné testy s fake závislosťou
 * zamaskovali, že produkčný wiring vôbec nefunguje. Vždy over aspoň jednu cestu
 * s PRODUKČNÝM adaptérom."
 *
 * ČO JE TU SKUTOČNÉ A ČO NIE (aby to nebol ďalší kruhový dôkaz)
 * -------------------------------------------------------------
 * SKUTOČNÉ: MariaDB, `resolveLocalActor()` bez podstrčeného actora, produkčné
 * `campaignsRepo` / `campaignItemsRepo` / `tiersRepo` / `settingsRepo` /
 * `auditRepo`, produkčný `appendAudit()`, produkčná transakcia
 * `insertConfirmedCampaign()`, produkčný `createShopClient()` a produkčný
 * `createExecutor()`. Tvrdenia sa čítajú `SELECT`-om z DB, nie z návratových
 * hodnôt.
 *
 * NAHRADENÉ: shop je mock shop (I6 — na skutočný eshop neodíde nič), kľúč a
 * allowlist sú in-memory (ani jedno nie je predmet K5), rozpočet je štedrý.
 *
 * Vlastník: G (druhá vlna sprintu bez prihlásenia).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PreviewTokenClaims, Queryable } from '@/contracts';

import {
  insertConfirmedCampaign,
  QUEUED,
  resolveRoutesDeps,
  type InsertCampaignArgs,
} from '@/app/api/campaigns/_shared';
import { closePool } from '@/db/pool';
import {
  FRESH_INSTALL_USERNAME,
  NO_LOGIN_SENTINEL,
  findLocalActor,
  localActor,
  resetLocalActorCache,
  resolveLocalActor,
} from '@/lib/auth/local-actor';
import { computePayloadHash } from '@/lib/crypto/preview-token';
import { createExecutor, type ExecutorFlags } from '@/lib/engine/executor';
import { createWriteMutex } from '@/lib/engine/mutex';
import { createMemoryAllowlistRepo, createMemoryApiKeyRepo } from '@/lib/engine/testing';
import { AppError } from '@/lib/http/errors';
import { createShopClient } from '@/lib/shop/client';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';
import { testUlid } from '../helpers/factories';
import { useMockShop, VALID_API_KEY } from '../helpers/mock';

const available = await dbAvailable();
const mock = useMockShop();

/** Actor, ktorý v tejto inštalácii existuje od čias, keď sa ešte prihlasovalo. */
const EXISTING_USERNAME = 'samuel';
const PRODUCT_IDS = [901, 902];
const PERCENT = 15;
const PRICE = '19.99';

/** Dátumové okno voči SKUTOČNÉMU dnes — guard `to ≥ dnes` je fail-closed. */
const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const FROM = day(1);
const TO = day(10);

const FLAGS: ExecutorFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  runawayLimitPerHour: 60,
  dailyWriteBudget: 200,
  // Pauza ≥ 3 s je injektovaná závislosť (K2) — inak by test bežal minúty.
  writePauseMs: 5,
};

/** Rozpočet, ktorý sa v tomto súbore nikdy neminie (K2 testuje iný súbor). */
const roomyBudget = {
  async spentToday() {
    return 0;
  },
  async remainingToday() {
    return { day: day(0), budget: 200, spent: 0, remaining: 200, exhausted: false };
  },
};

/* ═════════════════════════════ pomocníci DB ═══════════════════════════════ */

/** `campaign_tiers` a `product_sales_daily` `truncateAll()` ešte nepozná. */
async function cleanV3Tables(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query('DELETE FROM campaign_tiers');
    await conn.query('DELETE FROM product_sales_daily');
  });
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

async function listUsers(): Promise<UserRow[]> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query(
      'SELECT id, username, password_hash FROM users ORDER BY id ASC',
    )) as Array<{ id: number | bigint; username: string; password_hash: string }>;
    return rows.map((row) => ({
      id: Number(row.id),
      username: row.username,
      password_hash: row.password_hash,
    }));
  });
}

/** Vloží actora, ktorý v DB už je — presne ako táto inštalácia po D101. */
async function seedExistingActor(id: number): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)', [
      id,
      EXISTING_USERNAME,
      NO_LOGIN_SENTINEL,
    ]);
  });
}

async function campaignCreatedBy(campaignId: number): Promise<number | null> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query('SELECT created_by FROM campaigns WHERE id = ?', [
      campaignId,
    ])) as Array<{ created_by: number | bigint | null }>;
    const value = rows[0]?.created_by;
    return value === null || value === undefined ? null : Number(value);
  });
}

interface AuditUserRow {
  eventType: string;
  userId: number | null;
}

/** Auditné riadky s ich `user_id` — čítané priamo z tabuľky, nie z repa. */
async function auditUserIds(): Promise<AuditUserRow[]> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query(
      'SELECT event_type, user_id FROM audit_log ORDER BY id ASC',
    )) as Array<{ event_type: string; user_id: number | bigint | null }>;
    return rows.map((row) => ({
      eventType: row.event_type,
      userId: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
    }));
  });
}

/* ══════════════════════════ produkčná zápisová cesta ══════════════════════ */

function claimsFor(actorId: number): PreviewTokenClaims {
  return {
    jti: testUlid(),
    sub: actorId,
    kind: 'new',
    productIds: [...PRODUCT_IDS],
    percent: PERCENT,
    from: FROM,
    to: TO,
    pricesAtPreview: Object.fromEntries(PRODUCT_IDS.map((id) => [String(id), PRICE])),
    // I3/K4 — hash nad SKUTOČNÝMI trojicami `id:percent:price`, aby ho
    // `assertConfirmed()` v executore prepočítal a našel zhodu.
    payloadHash: computePayloadHash({
      kind: 'new',
      from: FROM,
      to: TO,
      items: PRODUCT_IDS.map((productId) => ({
        productId,
        percent: PERCENT,
        priceAtPreview: PRICE as never,
      })),
    }),
  };
}

function insertArgs(actorId: number): InsertCampaignArgs {
  return {
    claims: claimsFor(actorId),
    tiers: [{ ord: 1, label: `${PERCENT} % pásmo`, percent: PERCENT }],
    name: 'Zápis lokálneho actora',
    kind: 'new',
    mode: 'eager',
    status: QUEUED,
    fireAt: null,
    createdBy: actorId,
  };
}

/** Executor s PRODUKČNÝMI repozitármi a PRODUKČNÝM auditom nad MariaDB. */
function realExecutor() {
  return createExecutor({
    shopClient: createShopClient({
      baseUrl: () => mock.baseUrl,
      version: '0.1.0-test',
      readTimeoutMs: 2000,
      writeTimeoutMs: 2000,
      policy: { maxAttempts: 3, backoffMs: [5, 5, 5], retryAfterCapSeconds: 1 },
    }),
    // `campaignsRepo`, `campaignItemsRepo`, `settingsRepo`, `auditRepo` a
    // `audit` sa ZÁMERNE nepodávajú — default sú produkčné singletony nad DB.
    allowlistRepo: createMemoryAllowlistRepo([...PRODUCT_IDS]),
    apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
    mutex: createWriteMutex({ dbLock: null }),
    budget: roomyBudget,
    flags: FLAGS,
  });
}

/* ═══════════════════════════════ testy ════════════════════════════════════ */

describe.skipIf(!available)('K5 — lokálny actor na skutočnej zápisovej ceste', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    await cleanV3Tables();
    resetLocalActorCache();
    mock.state.setProducts(
      PRODUCT_IDS.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
    );
  });

  afterAll(async () => {
    await closePool();
  });

  /* ─────────────── a) produkčné resolveLocalActor() nad DB ──────────────── */

  it('existujúceho actora DOHĽADÁ a nikdy neprepíše (id 1, `samuel`)', async () => {
    await seedExistingActor(1);

    // Bez podstrčeného `localActor` — toto je produkčná jednotka nad DB poolom.
    const actor = await resolveLocalActor();

    expect(actor).toEqual({ id: 1, username: EXISTING_USERNAME });
    // Kontinuita auditu s obdobím, keď sa ešte prihlasovalo: žiadny nový riadok
    // a meno sa nemení na `local`.
    const users = await listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]?.username).toBe(EXISTING_USERNAME);
  });

  it('prázdna tabuľka `users` (čerstvá inštalácia) si actora vyrobí', async () => {
    expect(await listUsers()).toHaveLength(0);

    const actor = await resolveLocalActor();

    expect(actor.id).toBe(1);
    expect(actor.username).toBe(FRESH_INSTALL_USERNAME);
    const users = await listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe(1);
    expect(users[0]?.username).toBe(FRESH_INSTALL_USERNAME);
    // Sentinel ZÁMERNE nie je platný argon2/bcrypt hash — keby sa overovacia
    // cesta niekedy vrátila, neoverila by na ňom nič.
    expect(users[0]?.password_hash).toBe(NO_LOGIN_SENTINEL);
    expect(users[0]?.password_hash.startsWith('$')).toBe(false);
  });

  it('čítacia cesta actora NEVYROBÍ — `GET` nesmie zapisovať do `users`', async () => {
    // Toto je vetva, ktorou od 27. 8. 2026 chodí každý `GET` (define-route,
    // vrstva 1): na čerstvej inštalácii vráti `null` a tabuľku nechá prázdnu.
    expect(await findLocalActor()).toBeNull();
    expect(await localActor({ create: false })).toBeNull();
    expect(await listUsers()).toHaveLength(0);

    // A keď actor existuje, dohľadá ho — bez zápisu.
    await seedExistingActor(1);
    expect(await findLocalActor()).toEqual({ id: 1, username: EXISTING_USERNAME });
    expect(await listUsers()).toHaveLength(1);
  });

  /* ─────────────────── c) fail-closed, keď actora niet ──────────────────── */

  it('actor sa nedá nájsť ani vyrobiť => fail-closed AppError, nie zápis', async () => {
    /*
     * Táto vetva sa nad skutočnou DB vyvolať nedá bez mazania riadkov, a to je
     * zakázané (deštruktívne operácie na dátach len so záložkou a potvrdením).
     * Preto sa podáva minimálne spojenie: `SELECT` vracia prázdno a `INSERT`
     * nič nevytvorí. Kruhové to nie je — tvrdenie nie je „vráti id, ktoré som
     * mu dal", ale „NEVRÁTI actora a hodí".
     */
    const blindConn: Queryable = {
      async query<T = unknown>(): Promise<T> {
        return [] as unknown as T;
      },
    };

    await expect(resolveLocalActor({ conn: blindConn })).rejects.toBeInstanceOf(AppError);
    await expect(resolveLocalActor({ conn: blindConn })).rejects.toMatchObject({
      httpStatus: 500,
      code: 'local_actor_missing',
    });
  });

  it('výnimka z DB sa NEPREHLTNE — actor sa nikdy nevymyslí', async () => {
    const brokenConn: Queryable = {
      async query<T = unknown>(): Promise<T> {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3306');
      },
    };

    await expect(resolveLocalActor({ conn: brokenConn })).rejects.toThrow('ECONNREFUSED');
  });

  /* ───────── b) kampaň + audit z produkčnej cesty majú user_id = 1 ──────── */

  it('kampaň aj VŠETKY auditné riadky zápisu majú user_id = 1 (K5)', async () => {
    await seedExistingActor(1);

    // 1. Actor sa dohľadá produkčnou jednotkou. Žiadny harness, žiadny stub —
    //    `1` v tvrdeniach nižšie odteraz pochádza z DB, nie z tohto súboru.
    const actor = await resolveLocalActor();
    expect(actor.id).toBe(1);

    // 2. Vloženie potvrdenej kampane produkčnou transakciou (§3, D63).
    const deps = resolveRoutesDeps();
    const record = await insertConfirmedCampaign(deps, insertArgs(actor.id));

    // 3. Ostrý zápis produkčným executorom proti mock shopu (I6).
    const result = await realExecutor().executeCampaign(record.id, {
      actor: 'user',
      userId: actor.id,
    });

    expect(result.status).toBe('done');
    expect(result.itemsOk).toBe(PRODUCT_IDS.length);
    // Zápis sa naozaj odoslal — inak by nižšie nebolo čo pripisovať.
    expect(mock.state.writeRequests()).toHaveLength(PRODUCT_IDS.length);

    // 4. `campaigns.created_by` — SELECT z DB, nie návratová hodnota.
    expect(await campaignCreatedBy(record.id)).toBe(1);

    // 5. `audit_log.user_id` na KAŽDOM riadku. Toto je jadro nálezu: `write_ok`
    //    a spol. sem chodili s `user_id = NULL`, takže riadky dokladujúce zápis
    //    do produkcie nevedeli, kto ho spustil (D102, I11).
    const rows = await auditUserIds();
    const anonymous = rows.filter((row) => row.userId === null);
    expect(
      anonymous.map((row) => row.eventType),
      'auditné riadky bez user_id — audit nevie, kto zapisoval (D102, I11)',
    ).toEqual([]);
    expect(rows.every((row) => row.userId === 1)).toBe(true);

    // Menovite tie, ktoré dokladujú vznik zľavy a jej zápis do shopu.
    const events = rows.map((row) => row.eventType);
    expect(events).toContain('campaign_created');
    expect(events).toContain('write_attempt');
    expect(events).toContain('write_ok');
    expect(events).toContain('campaign_finished');
    expect(rows.filter((row) => row.eventType === 'write_ok')).toHaveLength(PRODUCT_IDS.length);
  });

  it('schedulerový fire BEZ userId sa pripíše autorovi kampane (D108)', async () => {
    await seedExistingActor(1);
    const actor = await resolveLocalActor();
    const deps = resolveRoutesDeps();
    const record = await insertConfirmedCampaign(deps, insertArgs(actor.id));

    /*
     * Scheduler `userId` NEPOSIELA — dávku nespustil človek. Do 28. 8. 2026
     * tým každý auditný riadok dávkového zápisu skončil s `user_id = NULL`,
     * a to sú práve riadky dokladujúce zápis do PRODUKČNÉHO eshopu. D108 dáva
     * fallback na `campaigns.created_by`, teda na toho, kto kampaň POTVRDIL.
     *
     * Všimni si, čo sa NEZLIEVA: `actor` zostáva `scheduler` (kto to spustil),
     * `user_id` je autor (kto to autorizoval). Dva stĺpce, dve otázky — keby
     * test tvrdil len `user_id`, dal by sa splniť aj prepísaním `actor` na
     * `user`, čo by bola lož o tom, kto zápis vyvolal.
     */
    const result = await realExecutor().executeCampaign(record.id, {
      actor: 'scheduler',
    });

    expect(result.status).toBe('done');
    expect(mock.state.writeRequests()).toHaveLength(PRODUCT_IDS.length);

    const rows = await auditUserIds();
    const anonymous = rows.filter((row) => row.userId === null);
    expect(
      anonymous.map((row) => row.eventType),
      'schedulerový zápis nechal anonymné auditné riadky (D108, D102, I11)',
    ).toEqual([]);
    expect(rows.every((row) => row.userId === 1)).toBe(true);
    expect(rows.map((row) => row.eventType)).toContain('write_ok');
  });

  it('zlyhaný zápis sa pripíše rovnako — `write_failed` nesmie byť anonymný', async () => {
    await seedExistingActor(1);
    const actor = await resolveLocalActor();
    const record = await insertConfirmedCampaign(resolveRoutesDeps(), insertArgs(actor.id));

    // Druhý zápis padne 500 vo všetkých troch pokusoch retry politiky (D34).
    mock.state.failNth(2, 'server_error', { target: 'write', times: 3 });

    const result = await realExecutor().executeCampaign(record.id, {
      actor: 'user',
      userId: actor.id,
    });

    expect(result.status).toBe('partial');
    const rows = await auditUserIds();
    const failed = rows.filter((row) => row.eventType === 'write_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.userId).toBe(1);
    expect(rows.filter((row) => row.userId === null)).toEqual([]);
  });
});
