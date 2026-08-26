/**
 * Aura Zľavy — VLOŽENIE POTVRDENEJ ZĽAVY JE ATOMICKÉ (nález B3, audit 30).
 *
 * Beží proti SKUTOČNEJ testovacej MariaDB (`test/helpers/db.ts`), pretože práve
 * to sa tu dokazuje: `withTransaction()` a `ck_campaigns_items_total`. Fake
 * repozitár rollback nemá, takže nad in-memory svetom by tento test dokazoval
 * len sám seba (`createMemoryTx()` to má napísané v komentári).
 *
 * Čo sa dokazuje:
 *  - **§3/D63** — pád uprostred dávok `campaign_items` nesmie nechať v DB ani
 *    kampaň, ani pásma, ani položky, ani auditný riadok „zľava vznikla".
 *    Kampaň totiž vzniká rovno ako `queued` s hashom nad CELOU sadou (I3):
 *    živá kampaň s neúplnou sadou je presne to, čo scheduler zoberie a
 *    executor odmietne — a tak dokola každý tick (L5).
 *  - **K1 bod 3** — `items_total` je v riadku už pri vzniku, takže DB poistka
 *    `CHECK (items_total <= 10000)` sa vyhodnotí PRED zápisom do shopu, nie až
 *    vo `finishCampaign()`, keď je I7 („cesta späť nie je") už v hre.
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
import { campaignItemsRepo, type NewCampaignItem } from '@/lib/repo/campaign-items.repo';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';
import { testUlid } from '../helpers/factories';

const available = await dbAvailable();

/** Fixný „teraz" — dátumové okno kampane je voči nemu v budúcnosti. */
const NOW = new Date('2026-08-10T08:00:00.000Z');

/** Hash potvrdenej sady (I3). Tu je to len obsah stĺpca `CHAR(64)`. */
const PAYLOAD_HASH = 'a'.repeat(64);

/** `campaign_tiers` a `product_sales_daily` `truncateAll()` ešte nepozná. */
async function cleanV3Tables(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query('DELETE FROM campaign_tiers');
    await conn.query('DELETE FROM product_sales_daily');
  });
}

async function seedUser(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const result = (await conn.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      ['samuel-atomicke', '$argon2id$fake-hash-for-tests'],
    )) as { insertId?: number | bigint };
    return Number(result.insertId ?? 0);
  });
}

/** Koľko riadkov je v tabuľke. Čítame pod migračným userom, nie cez repozitár. */
async function countRows(table: string): Promise<number> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query(`SELECT COUNT(*) AS n FROM ${table}`)) as Array<{
      n: number | bigint;
    }>;
    return Number(rows[0]?.n ?? 0);
  });
}

/** Koľko auditných riadkov daného typu eventu v DB je (I4 — len INSERT). */
async function countAudit(eventType: string): Promise<number> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query('SELECT COUNT(*) AS n FROM audit_log WHERE event_type = ?', [
      eventType,
    ])) as Array<{ n: number | bigint }>;
    return Number(rows[0]?.n ?? 0);
  });
}

function claimsFor(productIds: number[]): PreviewTokenClaims {
  return {
    jti: testUlid(),
    sub: 1,
    kind: 'new',
    productIds,
    percent: 20,
    from: '2026-08-20',
    to: '2026-08-30',
    pricesAtPreview: Object.fromEntries(productIds.map((id) => [String(id), '19.99'])),
    payloadHash: PAYLOAD_HASH,
  };
}

function argsFor(productIds: number[], createdBy: number): InsertCampaignArgs {
  return {
    claims: claimsFor(productIds),
    tiers: [{ ord: 1, label: '20 % pásmo', percent: 20 }],
    name: 'Atomická akcia',
    kind: 'new',
    mode: 'eager',
    status: QUEUED,
    fireAt: null,
    createdBy,
  };
}

describe.skipIf(!available)('vloženie potvrdenej zľavy je atomické (B3)', () => {
  let userId = 0;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    await cleanV3Tables();
    userId = await seedUser();
  });

  afterAll(async () => {
    await closePool();
  });

  it('pád uprostred dávok položiek nenechá v DB ani kampaň, ani pásma, ani audit', async () => {
    /* Presne priebeh z nálezu: časť položiek už v DB je a ďalšia dávka padne.
     * `campaign_items.createMany()` vkladá po 500 riadkoch, takže pri veľkej
     * sade je toto normálny scenár (spadnuté spojenie, timeout, deadlock). */
    const failingItemsRepo = {
      ...campaignItemsRepo,
      async createMany(
        campaignId: number,
        items: NewCampaignItem[],
        conn?: Queryable,
      ): Promise<void> {
        await campaignItemsRepo.createMany(campaignId, items.slice(0, 1), conn);
        throw new Error('simulovaný pád uprostred dávok položiek');
      },
    };
    const d = resolveRoutesDeps({
      campaignItemsRepo: failingItemsRepo,
      now: () => NOW,
    });

    await expect(insertConfirmedCampaign(d, argsFor([301, 302, 303], userId))).rejects.toThrow(
      'simulovaný pád uprostred dávok položiek',
    );

    expect(await countRows('campaigns')).toBe(0);
    expect(await countRows('campaign_items')).toBe(0);
    expect(await countRows('campaign_tiers')).toBe(0);
    // Zľava, ktorá sa odrolovala, nesmie po sebe nechať záznam, že vznikla.
    expect(await countAudit('campaign_created')).toBe(0);
  });

  it('úspešné vloženie zapíše kampaň, pásma, položky aj audit', async () => {
    const d = resolveRoutesDeps({ now: () => NOW });

    const record = await insertConfirmedCampaign(d, argsFor([301, 302, 303], userId));

    expect(record.status).toBe('queued');
    expect(await countRows('campaigns')).toBe(1);
    expect(await countRows('campaign_items')).toBe(3);
    expect(await countRows('campaign_tiers')).toBe(1);
    expect(await countAudit('campaign_created')).toBe(1);
  });

  it('items_total je v riadku kampane hneď po vložení (K1 bod 3)', async () => {
    const d = resolveRoutesDeps({ now: () => NOW });

    const record = await insertConfirmedCampaign(d, argsFor([301, 302, 303], userId));

    expect(record.itemsTotal).toBe(3);
    /* Nie len návratová hodnota — stĺpec v DB. Kým `items_total` v INSERTe
     * nebolo, riadok mal nulu až do `finishCampaign()`. */
    const stored = await withMigrationConn(async (conn) => {
      const rows = (await conn.query('SELECT items_total FROM campaigns WHERE id = ?', [
        record.id,
      ])) as Array<{ items_total: number | bigint }>;
      return Number(rows[0]?.items_total ?? -1);
    });
    expect(stored).toBe(3);
  });

  it('sadu nad 10 000 položiek odmietne DB poistka už pri vzniku kampane (K1 bod 3)', async () => {
    /* Aplikačná validácia v `campaign_items.createMany()` má ten istý strop,
     * takže by tento test prešiel aj bez DB poistky — a práve preto tu položky
     * NEVKLADÁ nikto. K1 bod 3 nominuje `ck_campaigns_items_total` ako DB
     * backstop pre prípad, že sa aplikačná validácia obíde; nad natvrdo
     * nulovým `items_total` sa taký backstop nevyhodnotí vôbec. */
    const noopItemsRepo = {
      ...campaignItemsRepo,
      async createMany(): Promise<void> {},
    };
    const d = resolveRoutesDeps({ campaignItemsRepo: noopItemsRepo, now: () => NOW });
    const productIds = Array.from({ length: 10_001 }, (_, i) => 100_000 + i);

    await expect(insertConfirmedCampaign(d, argsFor(productIds, userId))).rejects.toThrow();

    expect(await countRows('campaigns')).toBe(0);
    expect(await countAudit('campaign_created')).toBe(0);
  });
});
