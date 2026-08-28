/**
 * Aura Zľavy — migrácia 0014: obohatenie katalógu z `getFull`, fronta
 * obohacovania, stav dávky, denná tržba eshopu a rozlíšenie „0 predaných" od
 * „tento deň sa nesťahoval" (KONTRAKT-V4-2026-08-28 §2b: D116–D120; I11).
 *
 * Prečo tento súbor existuje popri unit testoch: unit test dokazuje správanie
 * nad pamäťou, tento dokazuje, že to prežije MariaDB — teda že stĺpce a indexy
 * naozaj vznikli, že `NULL` sa po ceste nestane nulou, že do nových tabuliek
 * smie písať APLIKAČNÝ user (D89, granty z 0014) a že fronta vracia poradie
 * z indexu, nie z náhody.
 *
 * Čo sa tu overuje:
 *  1. Všetky polia z `getFull` sú NULLABLE a bez defaultu — `NULL` je „nevieme"
 *     a `DEFAULT 0` by z chýbajúcej marže urobil nulovú maržu (I11).
 *  2. Indexy pre 41 348 riadkov existujú, vrátane poradia stĺpcov fronty.
 *  3. Repozitár zapíše aj prečíta `NULL` AJ hodnotu; `qty = 0` prežije ako nula.
 *  4. `margin` sa ukladá TAK, AKO PRIŠLA — appka si ju nepočíta (D117).
 *  5. Hodiny shopu sa uložia znak za znakom a round-trip ich nepohne.
 *  6. Fronta vracia najprv povolený zoznam, potom kampaňové produkty, potom
 *     zvyšok; obohatený a `not_found` produkt v nej NIE JE (D118).
 *  7. Stav dávky unesie `ip_banned` ako DÔVOD PAUZY bez času obnovenia (D120).
 *  8. `shop_revenue_daily` drží tržbu ESHOPU po dni a mene, s príznakom úplnosti
 *     dňa; dve meny sú dva riadky a upsert je idempotentný (D117).
 *  9. `coverageFor()` odlíši platnú nulu od nestiahnutého dňa (I11).
 *
 * Beží proti REÁLNEJ testovacej MariaDB tým istým runnerom ako produkcia.
 * Bez dostupnej DB sa blok korektne preskočí.
 *
 * OTVORENÁ KOLÍZIA S GUARDOM I8' (28. 8. 2026) — NEZATVORENÁ TÝMTO SÚBOROM
 * ------------------------------------------------------------------------
 * `test/unit/no-orders-scope.spec.ts` (vlastník A17) grepuje DDL všetkých
 * migrácií a zakazuje tokeny `order` / `orders` / `paid`. Migrácia 0014 ich má
 * v piatich identifikátoroch — `last_time_in_order`, `qty_in_orders`,
 * `ix_catalog_last_order`, `total_paid_sum`, `orders_count` — takže ten JEDEN
 * test je červený (ostatných osem v tom súbore prechádza).
 *
 * NIE JE to porušenie I8': ani jeden z tých stĺpcov nenesie zákaznícky údaj.
 * `total_paid_sum` a `orders_count` sú DENNÉ SÚČTY ZA CELÝ ESHOP (D117), nie
 * riadky objednávok; `last_time_in_order` a `qty_in_orders` sú polia produktu
 * z `getFull` (D119). Zákaz `total_paid` v tom guarde pochádza z času, keď
 * platilo „žiadne eurá" — D117 z 28. 8. 2026 to pre úroveň eshopu zmenilo.
 *
 * Guard má na presne tento prípad vlastný mechanizmus: `ALLOWED_DDL_IDENTIFIERS`
 * (dnes `['orders_seen']` z migrácie 0009). Zavrie sa doplnením piatich
 * identifikátorov vyššie — s odkazom na D117/D119. Tento súbor to NEROBÍ:
 * guard je mimo sady V4 a oslabovať cudzí invariantný test bez jeho vlastníka
 * sa nemá. Zákaz `email`, `country`, `address` ani holého `total_paid` sa
 * tým nedotkne — whitelist je na presné reťazce.
 *
 * Vlastník: V4 (schéma).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Connection } from 'mariadb';

import {
  createCatalogRepo,
  emptyCatalogEnrichState,
  ENRICH_PRIORITY_ALLOWLIST,
  ENRICH_PRIORITY_CAMPAIGN,
  ENRICH_PRIORITY_REST,
} from '@/lib/repo/catalog.repo';
import { createSalesRepo } from '@/lib/repo/sales.repo';

import { dbAvailable, setupTestDb, withAppConn, withMigrationConn } from '../helpers/db';

const available = await dbAvailable();

/* ── ID mimo dosahu ostatných testov — tento súbor po sebe upratuje sám ──── */

const P_ALLOW = 90_101; // v povolenom zozname → priorita 1
const P_CAMPAIGN = 90_102; // v plánovanej kampani → priorita 2
const P_REST = 90_103; // zvyšok katalógu → priorita 3
const P_ENRICHED = 90_104; // už obohatený → vo fronte NESMIE byť
const P_NOT_FOUND = 90_105; // shop ho nenašiel → vo fronte NESMIE byť (D49)
const P_MISSING = 90_106; // v zrkadle vôbec NIE JE
/**
 * Produkt pre neúspešný pokus. Má ZÁMERNE NAJNIŽŠIE id, takže vo fronte stojí
 * v rámci svojej priority prvý — a po neúspešnom pokuse musí spadnúť na konec.
 * Na inom id by sa posun nedal dokázať.
 */
const P_ATTEMPT = 90_100;
/**
 * Produkt, ktorý zostane NEOBOHATENÝ po celý beh. `P_REST` sa počas testov
 * obohatí (skúša sa na ňom zápis polí), takže z fronty vypadne — a práve to je
 * správne. Zástupcu „zvyšku katalógu" vo fronte preto potrebujeme vlastného.
 */
const P_PLAIN = 90_108;

const ALL_PRODUCTS = [
  P_ATTEMPT,
  P_ALLOW,
  P_CAMPAIGN,
  P_REST,
  P_ENRICHED,
  P_NOT_FOUND,
  P_MISSING,
  P_PLAIN,
];
const QUEUE_PRODUCTS = [
  P_ATTEMPT,
  P_ALLOW,
  P_CAMPAIGN,
  P_REST,
  P_ENRICHED,
  P_NOT_FOUND,
  P_PLAIN,
];

const USER_ID = 9801;
const CAMPAIGN_ID = 9802;

const DAY_COMPLETE = '2026-08-20';
const DAY_PARTIAL = '2026-08-21';
const DAY_MISSING = '2026-08-22';
const REVENUE_DAYS = [DAY_COMPLETE, DAY_PARTIAL, DAY_MISSING];

/** Zajtrajšok stačí na to, aby kampaň bola „plánovaná" bez ohľadu na deň behu. */
const CAMPAIGN_TO = '2099-12-31';

interface ColumnInfo {
  column_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function columnInfo(
  conn: Connection,
  table: string,
  column: string,
): Promise<ColumnInfo | null> {
  const rows = (await conn.query(
    `SELECT COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable,
            COLUMN_DEFAULT AS column_default
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  )) as ColumnInfo[];
  // Turbopack tu už raz zahodil null-guard cez `!row` — porovnávaj explicitne.
  const row = rows[0];
  return row === undefined ? null : row;
}

async function indexColumns(conn: Connection, table: string, index: string): Promise<string[]> {
  const rows = (await conn.query(
    `SELECT COLUMN_NAME AS name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND INDEX_NAME = ?
      ORDER BY SEQ_IN_INDEX ASC`,
    [table, index],
  )) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

async function seedCatalog(conn: Connection): Promise<void> {
  const repo = createCatalogRepo({ defaultConn: conn });
  await repo.upsertMany(
    QUEUE_PRODUCTS.map((productId) => ({
      productId,
      name: `Testovací šperk ${String(productId)}`,
      price: '19.99',
      hasAttributes: false,
      source: 'list' as const,
      raw: { id: productId },
    })),
  );
  await repo.markShopStatus(P_NOT_FOUND, 'not_found');
}

async function cleanup(): Promise<void> {
  await withMigrationConn(async (conn) => {
    const products = ALL_PRODUCTS.map(() => '?').join(', ');
    await conn.query(`DELETE FROM campaign_items WHERE campaign_id = ?`, [CAMPAIGN_ID]);
    await conn.query('DELETE FROM campaigns WHERE id = ?', [CAMPAIGN_ID]);
    await conn.query(`DELETE FROM products_allowlist WHERE product_id IN (${products})`, [
      ...ALL_PRODUCTS,
    ]);
    await conn.query(`DELETE FROM catalog_cache WHERE product_id IN (${products})`, [
      ...ALL_PRODUCTS,
    ]);
    await conn.query('DELETE FROM users WHERE id = ?', [USER_ID]);
    const days = REVENUE_DAYS.map(() => '?').join(', ');
    await conn.query(`DELETE FROM shop_revenue_daily WHERE revenue_day IN (${days})`, [
      ...REVENUE_DAYS,
    ]);
    await conn.query(`DELETE FROM sales_sync_state WHERE sale_day IN (${days})`, [...REVENUE_DAYS]);
    await conn.query(`DELETE FROM product_sales_daily WHERE sale_day IN (${days})`, [
      ...REVENUE_DAYS,
    ]);
    await conn.query(
      'UPDATE catalog_enrich_state SET batch_day = NULL, enriched_today = 0, ' +
        'daily_target = 150, last_product_id = NULL, enriched_total = 0, ' +
        'started_at = NULL, last_read_at = NULL, paused_until = NULL, ' +
        'pause_reason = NULL, last_error = NULL WHERE id = 1',
    );
  });
}

describe.skipIf(!available)('0014 — obohatenie katalógu, fronta, tržba a medzery', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  /* ══════════ 1. Schéma: NULL je „nevieme", nikdy nula (I11) ══════════════ */

  it('všetky polia z `getFull` sú NULLABLE a bez defaultu — nula nikde', async () => {
    const fields = [
      'reference',
      'ean13',
      'purchase_price',
      'margin',
      'margin_percent',
      'sell_price_with_vat',
      'last_time_in_order',
      'qty',
      'qty_in_orders',
      'supplier',
      'reduction_percent',
      'reduction_from',
      'reduction_to',
      'active',
      'categories',
      'enriched_at',
      'enrich_attempted_at',
    ];

    await withAppConn(async (conn) => {
      for (const field of fields) {
        const info = await columnInfo(conn, 'catalog_cache', field);
        expect(info, `stĺpec ${field} v catalog_cache neexistuje`).not.toBeNull();
        expect(info?.is_nullable, `${field} musí byť NULLABLE (I11)`).toBe('YES');
        /*
         * `DEFAULT 0` by z chýbajúcej marže urobil nulovú maržu a z chýbajúceho
         * skladu vypredaný produkt — presne to, čo I11 zakazuje.
         *
         * MariaDB 11.4 vracia pre nullable stĺpec bez defaultu literál `'NULL'`
         * (nie SQL NULL), takže sa pripúšťajú OBE podoby „žiadny default".
         * Podstatné je, že to nie je hodnota — preto ešte explicitne `not 0`.
         */
        expect([null, 'NULL'], `${field} nesmie mať default`).toContain(info?.column_default);
        expect(info?.column_default, `${field} nesmie mať default 0`).not.toBe('0');
      }
    });
  });

  it('`enrich_priority` je VLASTNÉ číslo appky — NOT NULL s defaultom 3', async () => {
    await withAppConn(async (conn) => {
      const info = await columnInfo(conn, 'catalog_cache', 'enrich_priority');
      expect(info).not.toBeNull();
      // Priorita nie je údaj zo shopu, takže „nevieme" pri nej nemá zmysel:
      // nový produkt patrí do zvyšku katalógu, kým sa nedokáže inak.
      expect(info?.is_nullable).toBe('NO');
      expect(info?.column_default).toBe(String(ENRICH_PRIORITY_REST));
    });
  });

  it('indexy pre 41 348 riadkov existujú a fronta má správne poradie stĺpcov', async () => {
    await withAppConn(async (conn) => {
      expect(await indexColumns(conn, 'catalog_cache', 'ix_catalog_reference')).toEqual([
        'reference',
      ]);
      expect(await indexColumns(conn, 'catalog_cache', 'ix_catalog_last_order')).toEqual([
        'last_time_in_order',
      ]);
      expect(await indexColumns(conn, 'catalog_cache', 'ix_catalog_qty')).toEqual(['qty']);
      /*
       * Poradie NIE JE kozmetika: `enriched_at` musí byť PRVÉ, aby bolo
       * `WHERE enriched_at IS NULL` vedúca podmienka a výber dávky bol range
       * scan bez filesortu. Pri opačnom poradí by fronta prechádzala celé
       * zrkadlo pri každom tiku.
       */
      expect(await indexColumns(conn, 'catalog_cache', 'ix_catalog_enrich_queue')).toEqual([
        'enriched_at',
        'enrich_priority',
        'enrich_attempted_at',
        'product_id',
      ]);
    });
  });

  /* ══════════ 2. Repozitár: zápis a čítanie NULL aj hodnoty ═══════════════ */

  it('neobohatený produkt je „nevieme" — všetko NULL, nič nie je nula', async () => {
    await withAppConn(async (conn) => {
      await seedCatalog(conn);
      const repo = createCatalogRepo({ defaultConn: conn });
      const map = await repo.enrichmentFor([P_REST]);
      const row = map.get(P_REST);

      expect(row).toBeDefined();
      expect(row?.enrichedAt).toBeNull();
      expect(row?.enrichAttemptedAt).toBeNull();
      expect(row?.reference).toBeNull();
      expect(row?.purchasePrice).toBeNull();
      expect(row?.margin).toBeNull();
      expect(row?.marginPercent).toBeNull();
      expect(row?.qty).toBeNull();
      expect(row?.qtyInOrders).toBeNull();
      expect(row?.lastTimeInOrder).toBeNull();
      expect(row?.categories).toBeNull();
      expect(row?.active).toBeNull();
      // Priorita existuje aj pre neobohatený produkt — to je celý dôvod, prečo
      // je to stĺpec zrkadla a nie riadok vlastnej tabuľky.
      expect(row?.enrichPriority).toBe(ENRICH_PRIORITY_REST);
    });
  });

  it('obohatenie prejde do DB a späť bez straty; `qty = 0` prežije ako nula', async () => {
    await withAppConn(async (conn) => {
      await seedCatalog(conn);
      const repo = createCatalogRepo({ defaultConn: conn });

      const written = await repo.saveEnrichment(P_ENRICHED, {
        reference: 'SPK-0014-TEST',
        ean13: '8595000000017',
        purchasePrice: 10.5,
        // Marža ZÁMERNE nesúhlasí s cenami: shop ju posiela hotovú a appka si ju
        // NEPOČÍTA. Keby si ju počítala, vyšlo by tu iné číslo (D117).
        margin: 7.77,
        marginPercent: 38.85,
        sellPriceWithVat: 24.19,
        lastTimeInOrder: '2026-07-28 12:29:28',
        // Platná nula: vypredané. `NULL` by znamenalo „sklad nevieme".
        qty: 0,
        qtyInOrders: 143,
        supplier: 'Testovací dodávateľ',
        reductionPercent: 15,
        reductionFrom: '2026-08-01',
        reductionTo: '2026-08-14',
        active: true,
        categories: [12, 34],
        enrichedAt: new Date('2026-08-28T10:00:00.000Z'),
      });
      expect(written).toBe(true);

      const row = (await repo.enrichmentFor([P_ENRICHED])).get(P_ENRICHED);
      expect(row?.reference).toBe('SPK-0014-TEST');
      expect(row?.ean13).toBe('8595000000017');
      expect(row?.purchasePrice).toBe(10.5);
      // Presne to, čo poslal shop — nie `sellPriceWithVat - purchasePrice`.
      expect(row?.margin).toBe(7.77);
      expect(row?.marginPercent).toBe(38.85);
      expect(row?.sellPriceWithVat).toBe(24.19);
      expect(row?.qty).toBe(0);
      expect(row?.qtyInOrders).toBe(143);
      expect(row?.supplier).toBe('Testovací dodávateľ');
      expect(row?.reductionPercent).toBe(15);
      expect(row?.active).toBe(true);
      expect(row?.categories).toEqual([12, 34]);
      expect(row?.enrichedAt?.toISOString()).toBe('2026-08-28T10:00:00.000Z');
      // Úspešné obohatenie je tiež pokus — inak by riadok tvrdil, že sa o
      // produkt nikto nikdy nepokúsil.
      expect(row?.enrichAttemptedAt?.toISOString()).toBe('2026-08-28T10:00:00.000Z');
    });
  });

  it('hodiny shopu sa uložia ZNAK ZA ZNAKOM a round-trip ich nepohne', async () => {
    await withAppConn(async (conn) => {
      await seedCatalog(conn);
      const repo = createCatalogRepo({ defaultConn: conn });
      await repo.saveEnrichment(P_REST, {
        ...emptyWrite(),
        // Shop posiela svoje hodiny ako text. Ide do `?` parametra NEDOTKNUTÝ.
        lastTimeInOrder: '2026-07-28 12:29:28',
      });

      const stored = async (): Promise<string | null> => {
        const rows = (await conn.query(
          'SELECT CAST(last_time_in_order AS CHAR) AS s FROM catalog_cache WHERE product_id = ?',
          [P_REST],
        )) as Array<{ s: string | null }>;
        return rows[0]?.s ?? null;
      };

      // TOTO je to tvrdenie, na ktorom záleží: v DB stojí presne ten čas, ktorý
      // povedal shop. Žiadny prepočet, žiadny posun o offset zóny.
      expect(await stored()).toBe('2026-07-28 12:29:28');

      // A round-trip je stabilný: `Date`, ktorý repozitár prečíta, sa dá zapísať
      // späť a hodnota v DB sa nepohne. Bez toho by sa čas poslednej objednávky
      // posúval pri každom ďalšom obohatení.
      const read = (await repo.enrichmentFor([P_REST])).get(P_REST)?.lastTimeInOrder ?? null;
      expect(read).not.toBeNull();
      await repo.saveEnrichment(P_REST, { ...emptyWrite(), lastTimeInOrder: read });
      expect(await stored()).toBe('2026-07-28 12:29:28');
    });
  });

  it('shop bez zľavy = tri NULL naraz, a to nie je to isté ako neobohatené', async () => {
    await withAppConn(async (conn) => {
      await seedCatalog(conn);
      const repo = createCatalogRepo({ defaultConn: conn });
      await repo.saveEnrichment(P_REST, { ...emptyWrite(), reference: 'BEZ-ZLAVY' });

      const row = (await repo.enrichmentFor([P_REST])).get(P_REST);
      expect(row?.reductionPercent).toBeNull();
      expect(row?.reductionFrom).toBeNull();
      expect(row?.reductionTo).toBeNull();
      // Rozdiel medzi „shop hovorí, že zľava nebeží" a „nevieme" nesie VÝHRADNE
      // `enrichedAt`. Bez neho sú obe vety na obrazovke rovnaká pomlčka.
      expect(row?.enrichedAt).not.toBeNull();
    });
  });

  it('obohatenie produktu, ktorý zrkadlo nemá, nezaloží poloprázdny riadok', async () => {
    await withAppConn(async (conn) => {
      await seedCatalog(conn);
      const repo = createCatalogRepo({ defaultConn: conn });

      const written = await repo.saveEnrichment(P_MISSING, emptyWrite());
      expect(written).toBe(false);

      const rows = (await conn.query('SELECT product_id FROM catalog_cache WHERE product_id = ?', [
        P_MISSING,
      ])) as Array<{ product_id: number }>;
      expect(rows).toHaveLength(0);

      // A napriek tomu je v mape — s prázdnym obohatením, nie s chýbajúcim
      // kľúčom: prázdno sa na obrazovke ľahko nakreslí ako nula (I11).
      const map = await repo.enrichmentFor([P_MISSING]);
      expect(map.has(P_MISSING)).toBe(true);
      expect(map.get(P_MISSING)?.enrichedAt).toBeNull();
    });
  });

  /* ══════════ 3. Fronta obohacovania (D118) ═══════════════════════════════ */

  it('fronta vracia najprv allowlist, potom kampane, potom zvyšok', async () => {
    await withAppConn(async (conn) => {
      await seedCatalog(conn);
      const repo = createCatalogRepo({ defaultConn: conn });

      // Povolený zoznam (I2 — aktívny záznam má slot a `removed_at IS NULL`).
      await conn.query(
        'INSERT INTO products_allowlist (product_id, slot, label) VALUES (?, 1, ?)',
        [P_ALLOW, 'test 0014'],
      );
      // Plánovaná kampaň s položkou. `password_hash` je výplň, nie tajomstvo —
      // appka heslá nemá (D99, D104).
      await conn.query(
        'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        [USER_ID, 'test-0014', 'nepouzite'],
      );
      await conn.query(
        'INSERT INTO campaigns (id, operation_id, name, percent, date_from, date_to, mode, ' +
          'status, created_by) VALUES (?, ?, ?, 10, ?, ?, ?, ?, ?)',
        [
          CAMPAIGN_ID,
          '01J0000000000000000TST14',
          'Test 0014',
          '2026-08-28',
          CAMPAIGN_TO,
          'scheduled',
          'scheduled',
          USER_ID,
        ],
      );
      // `percent` na položke je NOT NULL bez defaultu (K3, migrácia 0010) —
      // percento sa rozhoduje pri POTVRDENÍ, nie pri zápise.
      await conn.query(
        'INSERT INTO campaign_items (campaign_id, product_id, percent, position) ' +
          'VALUES (?, ?, 10, 1)',
        [CAMPAIGN_ID, P_CAMPAIGN],
      );

      // Obohatený produkt vo fronte nemá čo robiť.
      await repo.saveEnrichment(P_ENRICHED, emptyWrite());

      const refresh = await repo.refreshEnrichPriority({ today: '2026-08-28' });
      // Presné počty sa netvrdia: `UPDATE` beží nad celým zrkadlom a v testovacej
      // DB môže mať riadky aj iný súbor. Tvrdí sa PRIORITA MOJICH produktov.
      expect(refresh.allowlist).toBeGreaterThanOrEqual(1);
      expect(refresh.campaigns).toBeGreaterThanOrEqual(1);

      const priorities = await repo.enrichmentFor([P_ALLOW, P_CAMPAIGN, P_REST]);
      expect(priorities.get(P_ALLOW)?.enrichPriority).toBe(ENRICH_PRIORITY_ALLOWLIST);
      expect(priorities.get(P_CAMPAIGN)?.enrichPriority).toBe(ENRICH_PRIORITY_CAMPAIGN);
      expect(priorities.get(P_REST)?.enrichPriority).toBe(ENRICH_PRIORITY_REST);

      const queue = await repo.nextToEnrich(500);
      const mine = queue.filter((id) => QUEUE_PRODUCTS.includes(id));
      // Priorita 1, potom 2, a v rámci zvyšku podľa `product_id` — teda
      // deterministicky, nie podľa toho, ako sa DB práve rozhodne.
      expect(mine).toEqual([P_ALLOW, P_CAMPAIGN, P_ATTEMPT, P_PLAIN]);
      // Obohatený produkt kvótu druhýkrát platiť nemá — `P_ENRICHED` práve
      // teraz, `P_REST` z predchádzajúcich zápisov polí.
      expect(queue).not.toContain(P_ENRICHED);
      expect(queue).not.toContain(P_REST);
      // D49 — za produkt, o ktorom shop povedal, že neexistuje, sa neplatí vôbec.
      expect(queue).not.toContain(P_NOT_FOUND);
    });
  });

  it('produkt, ktorý stratil dôvod prednosti, spadne späť na zvyšok katalógu', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });

      // Odobranie z allowlistu (I2 — `slot` ide na NULL spolu s `removed_at`).
      await conn.query(
        'UPDATE products_allowlist SET slot = NULL, removed_at = NOW(3) WHERE product_id = ?',
        [P_ALLOW],
      );
      // Kampaň dobehla: okno je v minulosti.
      await conn.query('UPDATE campaigns SET date_from = ?, date_to = ?, status = ? WHERE id = ?', [
        '2026-01-01',
        '2026-01-10',
        'done',
        CAMPAIGN_ID,
      ]);

      const refresh = await repo.refreshEnrichPriority({ today: '2026-08-28' });
      expect(refresh.demoted).toBeGreaterThanOrEqual(2);

      const priorities = await repo.enrichmentFor([P_ALLOW, P_CAMPAIGN]);
      expect(priorities.get(P_ALLOW)?.enrichPriority).toBe(ENRICH_PRIORITY_REST);
      expect(priorities.get(P_CAMPAIGN)?.enrichPriority).toBe(ENRICH_PRIORITY_REST);
    });
  });

  it('neúspešný pokus posunie produkt na konec, ale NEOZNAČÍ ho ako obohatený', async () => {
    await withAppConn(async (conn) => {
      await seedCatalog(conn);
      const repo = createCatalogRepo({ defaultConn: conn });

      // Pred pokusom stojí `P_ATTEMPT` vo fronte prvý (najnižšie `product_id`).
      const before = (await repo.nextToEnrich(500)).filter((id) => QUEUE_PRODUCTS.includes(id));
      expect(before[0]).toBe(P_ATTEMPT);

      await repo.markEnrichAttempt(P_ATTEMPT, new Date('2026-08-28T11:00:00.000Z'));
      const row = (await repo.enrichmentFor([P_ATTEMPT])).get(P_ATTEMPT);

      expect(row?.enrichAttemptedAt?.toISOString()).toBe('2026-08-28T11:00:00.000Z');
      // Pokus NIE JE obohatenie — inak by produkt zmizol z fronty a jeho polia
      // by sa navždy čítali ako „shop o nich nič nevie" namiesto „nevieme".
      expect(row?.enrichedAt).toBeNull();

      // Jeden padajúci `getFull` nesmie zjesť celú dennú kvótu tým, že ho fronta
      // vyberá znova a znova — po pokuse ide na konec svojej priority.
      const after = (await repo.nextToEnrich(500)).filter((id) => QUEUE_PRODUCTS.includes(id));
      expect(after[after.length - 1]).toBe(P_ATTEMPT);
      expect(after).toContain(P_PLAIN);
    });
  });

  /* ══════════ 4. Stav dávky: `ip_banned` je dôvod pauzy (D120) ════════════ */

  it('stav dávky prežije reštart appky a `ip_banned` je DÔVOD, nie zahodená chyba', async () => {
    await withAppConn(async (conn) => {
      const writer = createCatalogRepo({ defaultConn: conn });
      await writer.saveEnrichState({
        ...emptyCatalogEnrichState(),
        batchDay: '2026-08-28',
        enrichedToday: 37,
        dailyTarget: 150,
        lastProductId: P_REST,
        enrichedTotal: 512,
        startedAt: new Date('2026-08-28T00:05:00.000Z'),
        lastReadAt: new Date('2026-08-28T09:12:00.000Z'),
        // Shop pri bane žiadny čas obnovenia nedáva a odblokovanie IP je akcia
        // používateľa — preto `pausedUntil` zostáva `null`.
        pausedUntil: null,
        pauseReason: 'ip_banned',
        lastError: 'ip_banned',
      });

      // Iná inštancia = to isté, čo appka po reštarte.
      const reader = createCatalogRepo({ defaultConn: conn });
      const state = await reader.loadEnrichState();

      expect(state.batchDay).toBe('2026-08-28');
      expect(state.enrichedToday).toBe(37);
      expect(state.dailyTarget).toBe(150);
      expect(state.lastProductId).toBe(P_REST);
      expect(state.enrichedTotal).toBe(512);
      expect(state.pauseReason).toBe('ip_banned');
      expect(state.pausedUntil).toBeNull();
      expect(state.lastReadAt?.toISOString()).toBe('2026-08-28T09:12:00.000Z');
    });
  });

  it('`last_error` je kód a orezáva sa na dĺžku stĺpca (I1)', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      await repo.saveEnrichState({ ...emptyCatalogEnrichState(), lastError: 'x'.repeat(500) });
      const state = await repo.loadEnrichState();
      expect(state.lastError?.length).toBe(200);
    });
  });

  it('stav dávky je singleton — druhý riadok DB odmietne', async () => {
    await withAppConn(async (conn) => {
      await expect(conn.query('INSERT INTO catalog_enrich_state (id) VALUES (2)')).rejects.toThrow();
    });
  });

  /* ══════════ 5. Denná tržba ESHOPU (D117) ════════════════════════════════ */

  it('tržba je po dni a mene; meny sú dva riadky a upsert je idempotentný', async () => {
    await withAppConn(async (conn) => {
      const repo = createSalesRepo({ defaultConn: conn });

      await repo.upsertRevenueDay(DAY_COMPLETE, 'EUR', {
        totalPaidSum: '1234.56',
        ordersCount: 21,
        dayComplete: true,
        pagesRead: 1,
      });
      await repo.upsertRevenueDay(DAY_COMPLETE, 'CZK', {
        totalPaidSum: '900.00',
        ordersCount: 3,
        dayComplete: true,
        pagesRead: 1,
      });
      // Rozbehnutý deň: súčet je zatiaľ len DOLNÁ HRANICA. Bez tohto príznaku by
      // posledný deň v grafe vždy vyzeral ako prudký pokles.
      await repo.upsertRevenueDay(DAY_PARTIAL, 'EUR', {
        totalPaidSum: 88.4,
        ordersCount: 2,
        dayComplete: false,
        pagesRead: 1,
      });

      // Idempotencia: ten istý deň znova nesmie sumu zdvojnásobiť.
      await repo.upsertRevenueDay(DAY_COMPLETE, 'EUR', {
        totalPaidSum: '1234.56',
        ordersCount: 21,
        dayComplete: true,
        pagesRead: 1,
      });

      const rows = await repo.listRevenue(DAY_COMPLETE, DAY_MISSING);
      expect(rows).toHaveLength(3);

      const eurComplete = rows.find((r) => r.day === DAY_COMPLETE && r.currency === 'EUR');
      const czkComplete = rows.find((r) => r.day === DAY_COMPLETE && r.currency === 'CZK');
      const eurPartial = rows.find((r) => r.day === DAY_PARTIAL);

      // Suma zostáva stringom až na obrazovku — float by z tržby urobil približnosť.
      expect(eurComplete?.totalPaidSum).toBe('1234.56');
      expect(eurComplete?.ordersCount).toBe(21);
      expect(eurComplete?.dayComplete).toBe(true);
      expect(czkComplete?.totalPaidSum).toBe('900.00');
      expect(eurPartial?.totalPaidSum).toBe('88.40');
      expect(eurPartial?.dayComplete).toBe(false);

      // Nestiahnutý deň NEMÁ riadok — nula sa nedopĺňa (I11).
      expect(rows.some((r) => r.day === DAY_MISSING)).toBe(false);
    });
  });

  it('tabuľka tržieb NEMÁ `product_id` — tržba per produkt je zakázaná (D117)', async () => {
    await withAppConn(async (conn) => {
      const rows = (await conn.query(
        `SELECT COLUMN_NAME AS name FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'shop_revenue_daily'`,
      )) as Array<{ name: string }>;
      const names = rows.map((row) => row.name);
      // API ceny položiek nevracia, takže rozdelenie `total_paid` medzi položky
      // by bolo vymyslené číslo (poštovné, zľavy, kupóny) — I11.
      expect(names).not.toContain('product_id');
      expect(names).toContain('total_paid_sum');
      expect(names).toContain('day_complete');
    });
  });

  /* ══════════ 6. „0 predaných" verzus „deň sa nesťahoval" (I11) ═══════════ */

  it('coverageFor odlíši platnú nulu od nestiahnutého a od čiastočného dňa', async () => {
    await withAppConn(async (conn) => {
      const repo = createSalesRepo({ defaultConn: conn });

      await repo.saveSyncState(DAY_COMPLETE, {
        ordersSeen: 21,
        status: 'complete',
        requestsUsed: 22,
        lastError: null,
        startedAt: new Date('2026-08-21T00:10:00.000Z'),
        finishedAt: new Date('2026-08-21T00:12:00.000Z'),
      });
      await repo.saveSyncState(DAY_PARTIAL, {
        ordersSeen: 2,
        status: 'partial',
        requestsUsed: 3,
        lastError: 'daily_budget',
        startedAt: new Date('2026-08-22T00:10:00.000Z'),
        finishedAt: null,
      });
      // DAY_MISSING zámerne BEZ riadku — to je „tento deň sa nesťahoval".

      const coverage = await repo.coverageFor(DAY_COMPLETE, DAY_MISSING);
      expect(coverage.days.map((d) => d.day)).toEqual([DAY_COMPLETE, DAY_PARTIAL, DAY_MISSING]);
      expect(coverage.days.map((d) => d.coverage)).toEqual(['complete', 'partial', 'missing']);
      // Jediný deň, o ktorom sa smie povedať „predalo sa 0 kusov".
      expect(coverage.completeDays).toBe(1);
      // Dva dni sú „nevieme": jeden nestiahnutý a jeden len dolná hranica.
      expect(coverage.unknownDays).toBe(2);
    });
  });

  it('deň bez predaja produktu je nula LEN nad dočítaným dňom (I11)', async () => {
    await withAppConn(async (conn) => {
      await seedCatalog(conn);
      const repo = createSalesRepo({ defaultConn: conn });

      // Dočítaný deň, v ktorom sa produkt nepredal: `product_sales_daily` nemá
      // riadok. To isté „nemá riadok" má nestiahnutý deň — rozhoduje až
      // `sales_sync_state`, a preto sa bez `coverageFor()` nesmie kresliť nula.
      await repo.replaceDayUnits(DAY_COMPLETE, []);
      const rows = (await conn.query(
        'SELECT product_id FROM product_sales_daily WHERE sale_day = ?',
        [DAY_COMPLETE],
      )) as Array<{ product_id: number }>;
      expect(rows).toHaveLength(0);

      const coverage = await repo.coverageFor(DAY_COMPLETE, DAY_MISSING);
      const complete = coverage.days.find((d) => d.day === DAY_COMPLETE);
      const missing = coverage.days.find((d) => d.day === DAY_MISSING);
      expect(complete?.coverage).toBe('complete');
      expect(missing?.coverage).toBe('missing');
    });
  });
});

/** Obohatenie, v ktorom shop nepovedal nič — všetko `null`, žiadna nula. */
function emptyWrite(): Parameters<
  ReturnType<typeof createCatalogRepo>['saveEnrichment']
>[1] {
  return {
    reference: null,
    ean13: null,
    purchasePrice: null,
    margin: null,
    marginPercent: null,
    sellPriceWithVat: null,
    lastTimeInOrder: null,
    qty: null,
    qtyInOrders: null,
    supplier: null,
    reductionPercent: null,
    reductionFrom: null,
    reductionTo: null,
    active: null,
    categories: null,
  };
}
