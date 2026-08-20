/**
 * Aura Zľavy — DÔKAZ KONTRAKTU V3 NA PRODUKČNÝCH ADAPTÉROCH (V14, K12).
 *
 * Prečo ešte jeden súbor, keď K1–K6 už testy majú
 * ─────────────────────────────────────────────────
 * Majú — ale skoro všetky nad in-memory repozitármi z `lib/engine/testing.ts`.
 * A práve to je pasca, ktorá v tomto repe už raz prežila do produkcie:
 * integračné testy s fake závislosťou tvrdili, že scheduler zapisuje, kým
 * v produkcii nezapísal nikdy (nález E1, CLAUDE.md). Report agenta nie je dôkaz.
 *
 * Tento súbor preto nemockuje nič, čo sa mockovať nemusí. Beží nad:
 *   · SKUTOČNOU MariaDB so všetkými migráciami (`test/helpers/db.ts`),
 *   · produkčnými repozitármi (`campaignsRepoV3`, `campaignItemsRepo`,
 *     `settingsRepo`, `allowlistRepo`, `auditRepo`) — sú to DEFAULTY
 *     `createExecutor()`, takže sa ani neinjektujú,
 *   · produkčným zapisovačom auditu (`auditWriter`) a rozpočtom, ktorý
 *     spotrebu číta SELECTom z toho istého `audit_log` (K2),
 *   · produkčným wiringom fronty z `scheduler/boot.ts`
 *     (`createSchedulerQueueExecutor` + `processQueue`),
 *   · reálnym shop klientom proti reálnemu mock shopu (I6).
 *
 * Jediné, čo je fake, je úložisko kľúča (`createMemoryApiKeyRepo`) — šifrovanie
 * kľúča má vlastné testy (`routes-key`, `ttl-wipe`, `orders-key`) a master key
 * v tomto behu nemá čo dokazovať.
 *
 * Čo sa tu dokazuje (V14, bod 3):
 *   K2 — vyčerpaný rozpočet dá `queued` (nie `failed`) a druhý deň sa pokračuje
 *        PRESNE tam, kde sa skončilo: žiadny duplikát, žiadne preskočenie,
 *   K3 — do shopu ide percento POLOŽKY, nie hlavičkové percento zľavy,
 *   K5 — meškajúca fronta dostane `late` a okno platnosti sa NEZMENÍ,
 *   K4 — potvrdzovací hash sa počíta zo SKUTOČNÝCH riadkov v DB; zmena jedinej
 *        ceny zastaví zápis PRED prvým requestom na shop,
 *   K1 — posledná brzda je DB, nie aplikačná validácia (ENUM + CHECK).
 *
 * K6 (kľúč kratší než fronta) je route-ová vec a má vlastný súbor
 * `kontrakt-v3-kluc.spec.ts`.
 *
 * Vlastník: V14.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CreateCampaignInput, DiscountPercent, MoneyString } from '@/contracts';

import { closePool } from '@/db/pool';
import { auditWriter } from '@/lib/audit/write';
import { computePayloadHash, payloadHashItemsFromRows } from '@/lib/crypto/preview-token';
import { createBudget } from '@/lib/engine/budget';
import { createExecutor, resetGracefulStop, type ExecutorFlags } from '@/lib/engine/executor';
import { createLogger } from '@/lib/log/logger';
import { allowlistRepo } from '@/lib/repo/allowlist.repo';
import { campaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepoV3 } from '@/lib/repo/campaigns.repo';
import { settingsRepo } from '@/lib/repo/settings.repo';
import { tiersRepo } from '@/lib/repo/tiers.repo';
import { createSchedulerQueueExecutor } from '@/lib/scheduler/boot';
import { resetQueueGate } from '@/lib/scheduler/pause';
import { processQueue, resetQueueReport } from '@/lib/scheduler/queue';
import { createShopClient } from '@/lib/shop/client';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';
import { useMockShop, VALID_API_KEY } from '../helpers/mock';
import { testUlid } from '../helpers/factories';
import { createMemoryApiKeyRepo } from '@/lib/engine/testing';

const available = await dbAvailable();
const mock = useMockShop();

/* ═══════════════════════════ 1. Čas, dni, sada ════════════════════════════ */

/**
 * Fixný čas testu: dnešný UTC deň o 09:00 UTC (11:00 v Bratislave).
 *
 * Prečo nie „teraz": `audit_log` píše DB vlastným `UTC_TIMESTAMP`, takže
 * rozpočtový deň injektovaného času sa MUSÍ zhodovať so skutočným UTC dňom
 * riadkov — inak by test počítal spotrebu za iný deň, než v akom vznikla.
 * Prečo nie polnoc: o polnoci zamŕzajú zápisy (D59) a test by bol flaky presne
 * medzi 22:00 a 24:00 UTC, čo je pasca vymenovaná v CLAUDE.md.
 */
const DAY_MS = 86_400_000;
const BASE_NOW = new Date(`${new Date().toISOString().slice(0, 10)}T09:00:00.000Z`);

/** Deň v logickej zóne (D31) — nikdy `toISOString()` v UTC. */
const zonedDay = (offset: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(
    new Date(BASE_NOW.getTime() + offset * DAY_MS),
  );

/** Posuvné „teraz" — druhý deň fronty je posun UTC dňa, nie `setTimeout`. */
let clock = BASE_NOW;
const now = (): Date => clock;

const PRODUCT_IDS = [601, 602, 603, 604, 605];

/** K3 — dve pásma v jednej zľave. Hlavička nesie NAJVYŠŠIE percento. */
const TIER_PERCENT: Readonly<Record<number, number>> = {
  601: 30,
  602: 30,
  603: 20,
  604: 20,
  605: 20,
};
const HEADER_PERCENT = 30;
const PRICE: MoneyString = '19.99';

/** Okno, ktoré už BEŽÍ — kvôli K5 (fronta doň nestihla dobehnúť). */
const DATE_FROM = zonedDay(0);
const DATE_TO = zonedDay(30);

const FLAGS: ExecutorFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  // Runaway je poistka proti splašeniu, nie rozpočet (K2) — 5 zápisov v hodine
  // ju nesmie spustiť.
  runawayLimitPerHour: 240,
  dailyWriteBudget: 2,
  // Pauza ≥ 3 s je injektovaná závislosť; produkčnú podlahu drží
  // `executorFlagsFromEnv()` a overuje ju `fronta-rozpocet.spec.ts`.
  writePauseMs: 0,
};

const log = createLogger({ module: 'v14-dokaz' });

function shopClient() {
  return createShopClient({
    baseUrl: () => mock.baseUrl,
    version: '0.1.0-test',
    readTimeoutMs: 2000,
    writeTimeoutMs: 2000,
    policy: { maxAttempts: 2, backoffMs: [5, 5], retryAfterCapSeconds: 1 },
  });
}

/* ═══════════════════════ 2. Príprava sveta v DB ═══════════════════════════ */

async function cleanV3Tables(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query('DELETE FROM campaign_tiers');
    await conn.query('DELETE FROM product_sales_daily');
  });
}

async function seedUser(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const result = (await conn.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [
      'samuel-v14',
      '$argon2id$fake-hash-for-tests',
    ])) as { insertId?: number | bigint };
    return Number(result.insertId ?? 0);
  });
}

/**
 * „Ďalší deň" bez posúvania hodín: histórii auditu sa uberie jeden deň.
 *
 * Prečo takto a nie posunom `now()`: spotrebu rozpočtu počíta PRODUKČNÝ SELECT
 * nad `audit_log` a `ts` do neho píše DB vlastným `UTC_TIMESTAMP`. Keby test
 * posunul len injektovaný čas, počítadlo by sa pýtalo na deň, v ktorom žiadne
 * riadky nikdy nevzniknú — a „rozpočet sa obnovil" by dokazoval iba to, že
 * test počíta prázdnu množinu. Zostarnutím riadkov sa mení HISTÓRIA, kód
 * zostáva nedotknutý; presne to sa stane aj na produkcii o polnoci.
 *
 * `UPDATE` beží migračným userom — aplikačný user `audit_log` meniť nesmie (I4)
 * a to je zámer, ktorý stráži `audit-append-only.spec.ts`.
 */
async function ageAuditByOneDay(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query('UPDATE audit_log SET ts = ts - INTERVAL 1 DAY');
  });
}

/** Počet `write_attempt` v SKUTOČNOM audite za daný UTC deň. */
async function writeAttemptsOn(day: string): Promise<number> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query(
      'SELECT COUNT(*) AS total FROM audit_log WHERE event_type = ? AND ts >= ? AND ts < ?',
      ['write_attempt', `${day} 00:00:00.000`, `${day} 23:59:59.999`],
    )) as Array<{ total: unknown }>;
    return Number(rows[0]?.total ?? 0);
  });
}

/**
 * Potvrdená zľava s dvoma pásmami priamo v DB — presne tak, ako ju tam nechá
 * `POST /api/campaigns` po overení tokenu (I3, K3).
 */
async function seedConfirmedCampaign(userId: number, opts: { status?: 'queued' } = {}) {
  const items = PRODUCT_IDS.map((productId, index) => ({
    productId,
    position: index + 1,
    percent: TIER_PERCENT[productId] as DiscountPercent,
    priceAtPreview: PRICE,
    hasAttributes: false,
  }));

  const input: CreateCampaignInput = {
    operationId: testUlid(),
    name: 'Letné ležiaky',
    kind: 'new',
    parentCampaignId: null,
    percent: HEADER_PERCENT as DiscountPercent,
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
    mode: 'eager',
    status: 'scheduled',
    fireAt: null,
    scheduledAt: clock,
    confirmedAt: clock,
    // K4 — hash nad trojicami `id:percent:price`, presne tie, čo idú do DB.
    confirmPayloadHash: computePayloadHash({
      kind: 'new',
      from: DATE_FROM,
      to: DATE_TO,
      items: items.map((item) => ({
        productId: item.productId,
        percent: item.percent,
        priceAtPreview: item.priceAtPreview,
      })),
    }),
    sudoAt: clock,
    createdBy: userId,
  };

  const campaign = await campaignsRepoV3.create(input);
  await campaignItemsRepo.createMany(campaign.id, items);
  await tiersRepo.createMany(campaign.id, [
    { ord: 1, label: '0 predaných za 360 dní', percent: 30 as DiscountPercent, itemsCount: 2 },
    { ord: 2, label: '0 predaných za 180 dní', percent: 20 as DiscountPercent, itemsCount: 3 },
  ]);
  await campaignsRepoV3.setStatus(campaign.id, opts.status ?? 'queued', {
    itemsTotal: items.length,
  });
  return campaign;
}

/** Stav položiek podľa `position` — dôkaz, že sa nič nepreskočilo (I10). */
async function itemStates(campaignId: number): Promise<Array<[number, string]>> {
  const rows = await campaignItemsRepo.listByCampaign(campaignId);
  return rows.map((row) => [row.position, row.status]);
}

/* ═════════════════════════════════ testy ══════════════════════════════════ */

describe.skipIf(!available)('V14 — kontrakt V3 na produkčných adaptéroch', () => {
  let userId = 0;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    clock = BASE_NOW;
    resetGracefulStop();
    resetQueueGate();
    resetQueueReport();
    await truncateAll();
    await cleanV3Tables();
    userId = await seedUser();
    for (const productId of PRODUCT_IDS) {
      await allowlistRepo.addProduct(productId, `Šperk ${productId}`);
    }
    await settingsRepo.setDailyWriteBudget(2);
    mock.state.setProducts(
      PRODUCT_IDS.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
    );
  });

  afterAll(async () => {
    await closePool();
  });

  /* ══════════ K2 + K3 — fronta cez produkčný executor nad DB ═══════════ */

  describe('K2 — vyčerpaný rozpočet vracia zľavu do fronty (produkčné repozitáre)', () => {
    /** Executor, ktorý si repozitáre NEinjektuje — berie svoje produkčné defaulty. */
    function productionExecutor() {
      return createExecutor({
        shopClient: shopClient(),
        apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
        // K2 — spotreba sa počíta SELECTom nad skutočným `audit_log`.
        budget: createBudget({ dailyBudget: FLAGS.dailyWriteBudget, now }),
        audit: auditWriter,
        flags: FLAGS,
        sleepFn: async () => {},
        now,
        logger: log,
        timeZone: 'Europe/Bratislava',
      });
    }

    it('prvý deň zapíše presne rozpočet, kampaň je `queued` a nič nie je chyba', async () => {
      const campaign = await seedConfirmedCampaign(userId);

      const result = await productionExecutor().executeCampaign(campaign.id, {
        actor: 'scheduler',
      });

      // K2: vyčerpaný rozpočet je informácia, nie chyba.
      expect(result.status).toBe('queued');
      expect(result.itemsOk).toBe(2);
      expect(result.itemsFailed).toBe(0);

      const stored = await campaignsRepoV3.getById(campaign.id);
      expect(stored?.status).toBe('queued');

      // Zvyšok naozaj čaká — v DB, nie v pamäti testu.
      expect(await itemStates(campaign.id)).toEqual([
        [1, 'ok'],
        [2, 'ok'],
        [3, 'pending'],
        [4, 'pending'],
        [5, 'pending'],
      ]);

      // Na shop odišli PRÁVE dva zápisy a audit ich vidí rovnako (K2).
      expect(mock.state.writeRequests()).toHaveLength(2);
      expect(await writeAttemptsOn(BASE_NOW.toISOString().slice(0, 10))).toBe(2);
    });

    it('druhý a tretí deň sa pokračuje PRESNE tam, kde sa skončilo', async () => {
      const campaign = await seedConfirmedCampaign(userId);

      await productionExecutor().executeCampaign(campaign.id, { actor: 'scheduler' });
      await ageAuditByOneDay();
      await productionExecutor().executeCampaign(campaign.id, { actor: 'scheduler' });

      expect(await itemStates(campaign.id)).toEqual([
        [1, 'ok'],
        [2, 'ok'],
        [3, 'ok'],
        [4, 'ok'],
        [5, 'pending'],
      ]);
      expect((await campaignsRepoV3.getById(campaign.id))?.status).toBe('queued');

      await ageAuditByOneDay();
      const last = await productionExecutor().executeCampaign(campaign.id, { actor: 'scheduler' });

      expect(last.status).toBe('done');
      expect((await campaignsRepoV3.getById(campaign.id))?.status).toBe('done');

      // Žiadny duplikát a žiadne preskočenie: každý produkt práve raz,
      // v poradí podľa `position` (I10).
      const written = mock.state.writeRequests().map((r) => Number(r.body.id));
      expect(written).toEqual(PRODUCT_IDS);
      expect(new Set(written).size).toBe(PRODUCT_IDS.length);
    });

    it('K3 — do shopu ide percento POLOŽKY, nie hlavičkové percento zľavy', async () => {
      const campaign = await seedConfirmedCampaign(userId);

      for (let day = 0; day < 3; day += 1) {
        if (day > 0) await ageAuditByOneDay();
        await productionExecutor().executeCampaign(campaign.id, { actor: 'scheduler' });
      }

      const sent = new Map(
        mock.state.writeRequests().map((r) => [Number(r.body.id), Number(r.body.reduction)]),
      );
      expect(sent.get(601)).toBe(30);
      expect(sent.get(602)).toBe(30);
      expect(sent.get(603)).toBe(20);
      expect(sent.get(604)).toBe(20);
      expect(sent.get(605)).toBe(20);
      // Keby executor bral percento z hlavičky, všetkých päť by malo 30.
      expect([...sent.values()].filter((p) => p === HEADER_PERCENT)).toHaveLength(2);
    });

    it('okno zľavy sa počas celej fronty NEZMENÍ (I7, K5)', async () => {
      const campaign = await seedConfirmedCampaign(userId);

      for (let day = 0; day < 3; day += 1) {
        if (day > 0) await ageAuditByOneDay();
        await productionExecutor().executeCampaign(campaign.id, { actor: 'scheduler' });
      }

      const stored = await campaignsRepoV3.getById(campaign.id);
      expect(stored?.dateFrom).toBe(DATE_FROM);
      expect(stored?.dateTo).toBe(DATE_TO);
    });
  });

  /* ═════════ K5 — meškanie cez PRODUKČNÝ wiring fronty (boot.ts) ═══════ */

  describe('K5 — meškajúca fronta cez produkčný wiring `scheduler/boot.ts`', () => {
    function queueDeps() {
      return {
        campaigns: campaignsRepoV3,
        // Fronta kľúč nepoužíva, len sa pýta, či je použiteľný (K6, krok 4
        // v `queue.ts`): musí byť prítomný, overený a ešte platný.
        apiKey: {
          getMeta: async () => ({
            present: true,
            last4: VALID_API_KEY.slice(-4),
            savedAt: clock,
            expiresAt: new Date(clock.getTime() + 48 * 3_600_000),
            secondsLeft: 48 * 3600,
            verifyStatus: 'valid' as const,
            lastUsedAt: null,
          }),
        },
        settings: settingsRepo,
        budget: createBudget({ dailyBudget: 2, now }),
        audit: auditWriter,
        // TOTO je produkčný adaptér scheduler → engine (nález E1).
        executor: createSchedulerQueueExecutor({
          shopClient: shopClient(),
          apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
          budget: createBudget({ dailyBudget: 2, now }),
          audit: auditWriter,
          flags: FLAGS,
          sleepFn: async () => {},
          now,
          logger: log,
        }),
        log,
      };
    }

    const config = {
      writesEnabledByEnv: true,
      timeZone: 'Europe/Bratislava',
      maxCampaignsPerTick: 10,
    };

    it('kampaň s otvoreným oknom a čakajúcimi položkami dostane `late`, okno zostáva', async () => {
      const campaign = await seedConfirmedCampaign(userId);
      const before = await campaignsRepoV3.getById(campaign.id);
      expect(before?.late).toBe(false);

      const outcome = await processQueue(
        queueDeps() as unknown as Parameters<typeof processQueue>[0],
        config,
        clock,
      );

      expect(outcome.markedLate).toBe(1);
      const after = await campaignsRepoV3.getById(campaign.id);
      expect(after?.late).toBe(true);
      // K5/I7 — appka okno kvôli meškaniu NIKDY neposúva ani neskracuje.
      expect(after?.dateFrom).toBe(before?.dateFrom);
      expect(after?.dateTo).toBe(before?.dateTo);
    });

    it('fronta cez produkčný wiring naozaj ZAPÍŠE — a rozpočet ju vráti do `queued`', async () => {
      const campaign = await seedConfirmedCampaign(userId);

      const outcome = await processQueue(
        queueDeps() as unknown as Parameters<typeof processQueue>[0],
        config,
        clock,
      );

      // Nález E1: „scheduler beží" bez jediného requestu na shop je presne to,
      // čo fake executor kedysi zamaskoval.
      expect(outcome.processed).toBe(1);
      expect(mock.state.writeRequests()).toHaveLength(2);
      expect((await campaignsRepoV3.getById(campaign.id))?.status).toBe('queued');
      expect(outcome.skipped).toBe('budget_exhausted');
    });

    it('druhý príznak `late` sa už nenastavuje (markLate je jednorazový)', async () => {
      await seedConfirmedCampaign(userId);
      await processQueue(
        queueDeps() as unknown as Parameters<typeof processQueue>[0],
        config,
        clock,
      );
      const second = await processQueue(
        queueDeps() as unknown as Parameters<typeof processQueue>[0],
        config,
        clock,
      );
      expect(second.markedLate).toBe(0);
    });
  });

  /* ═══════════ K4 — hash sa počíta zo skutočných riadkov v DB ══════════ */

  describe('K4 — potvrdenie sa prepočítava z riadkov `campaign_items`', () => {
    it('hash z DB sa zhoduje s hashom potvrdenia a je citlivý na zmenu ceny', async () => {
      const campaign = await seedConfirmedCampaign(userId);
      const stored = await campaignsRepoV3.getById(campaign.id);
      const rows = await campaignItemsRepo.listByCampaign(campaign.id);

      const fromDb = computePayloadHash({
        kind: 'new',
        from: DATE_FROM,
        to: DATE_TO,
        items: payloadHashItemsFromRows(rows),
      });
      expect(fromDb).toBe(stored?.confirmPayloadHash);

      // Zmena JEDINEJ ceny (D39c) musí hash rozbiť — inak by sa dalo potvrdiť
      // jedno a zapísať iné.
      const mutated = computePayloadHash({
        kind: 'new',
        from: DATE_FROM,
        to: DATE_TO,
        items: payloadHashItemsFromRows(rows).map((item, index) =>
          index === 2 ? { ...item, priceAtPreview: '18.99' as MoneyString } : item,
        ),
      });
      expect(mutated).not.toBe(fromDb);
    });

    it('podvrhnutá cena v DB zastaví zápis PRED prvým requestom na shop (I3)', async () => {
      const campaign = await seedConfirmedCampaign(userId);
      await withMigrationConn(async (conn) => {
        await conn.query(
          'UPDATE campaign_items SET price_at_preview = ? WHERE campaign_id = ? AND position = 1',
          ['18.99', campaign.id],
        );
      });

      const executor = createExecutor({
        shopClient: shopClient(),
        apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
        budget: createBudget({ dailyBudget: 200, now }),
        audit: auditWriter,
        flags: FLAGS,
        sleepFn: async () => {},
        now,
        logger: log,
      });

      await expect(
        executor.executeCampaign(campaign.id, { actor: 'scheduler' }),
      ).rejects.toMatchObject({ code: 'confirmation_mismatch' });
      expect(mock.state.writeRequests()).toHaveLength(0);
    });
  });

  /* ═════════════ K1 — poslednou brzdou je DB, nie validácia ════════════ */

  describe('K1 — strop a režim drží aj samotná databáza', () => {
    it('`scope_mode` je ENUM: neznámu hodnotu DB neprijme (fail-closed pri zdroji)', async () => {
      await expect(
        withMigrationConn(async (conn) => {
          await conn.query('UPDATE settings SET scope_mode = ? WHERE id = 1', ['vsetko']);
        }),
      ).rejects.toBeTruthy();
      // A čo je v DB, sa aj tak číta fail-closed.
      expect((await settingsRepo.readScope()).mode).toBe('pilot');
    });

    it('CHECK na `campaigns.items_total` odmietne 10 001 (K1 bod 3)', async () => {
      const campaign = await seedConfirmedCampaign(userId);
      await expect(
        withMigrationConn(async (conn) => {
          await conn.query('UPDATE campaigns SET items_total = ? WHERE id = ?', [
            10_001,
            campaign.id,
          ]);
        }),
      ).rejects.toBeTruthy();

      // 10 000 je ešte v poriadku — strop je presne ten z kontraktu.
      await withMigrationConn(async (conn) => {
        await conn.query('UPDATE campaigns SET items_total = ? WHERE id = ?', [
          10_000,
          campaign.id,
        ]);
      });
      expect((await campaignsRepoV3.getById(campaign.id))?.itemsTotal).toBe(10_000);
    });

    it('CHECK na `campaign_items.percent` odmietne 31 aj 0 (I9, K3)', async () => {
      const campaign = await seedConfirmedCampaign(userId);
      for (const percent of [0, 31]) {
        await expect(
          withMigrationConn(async (conn) => {
            await conn.query('UPDATE campaign_items SET percent = ? WHERE campaign_id = ?', [
              percent,
              campaign.id,
            ]);
          }),
        ).rejects.toBeTruthy();
      }
    });
  });
});
