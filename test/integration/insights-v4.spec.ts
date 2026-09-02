/**
 * Aura Zľavy — ČÍTACIE ENDPOINTY PRE OBRAZOVKY V4 (D113–D119).
 *
 * Testujú sa TVRDENIA, ktoré tie endpointy o svete robia, nie tvar JSON-u:
 *
 *  A. **Medzera nie je nula.** Deň, ktorý sa nesťahoval, nesmie z odpovede
 *     vyjsť ako `0` — ani v krivke kusov, ani v tržbe, ani v KPI riadku. Toto
 *     je najčastejšia chyba tohto repa a už raz sa dostala do produkcie.
 *  B. **Priznaná medzera je PRVOTRIEDNY údaj.** `gaps.unknownDays` a
 *     `gaps.missing` musia v odpovedi naozaj byť — obrazovka ich má vykresliť,
 *     takže ich musí dostať.
 *  C. **Tržba je EŠOPOVÁ.** V odpovedi `revenue-daily` nesmie byť ani jedno
 *     pole, z ktorého by sa dala prečítať ako tržba produktu (D117), a meny sa
 *     nesčítavajú.
 *  D. **Top/flop stojí na meraní.** Produkt bez dát nie je „0 predaných" a
 *     nepatrí ani do topu, ani do flopu.
 *  E. **KPI je trojstavové.** Hodnota / nula / „nevieme" sa nesmú zliať, a
 *     stránka 100 produktov nesmie vyrobiť N+1.
 *  F. **Žiadne volanie shopu (K8).** Na render ceste nesmie odísť ani jeden
 *     request. Meria sa to dvakrát: podvrhnutým `fetch`-om, ktorý pri volaní
 *     ZHODÍ test, a čítaním zdrojov route-ov (žiadny import shop klienta).
 *
 * Bez DB a bez siete: repozitáre sú náhradné závislosti, čas je vpichnutý.
 * Uplift (D115) má vlastný súbor `uplift-okna.spec.ts`.
 *
 * Vlastník: vlna V4-ENDPOINTY.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CatalogCacheRecord,
  CatalogEnrichmentRecord,
  DateOnly,
  MoneyString,
  ProductSalesDay,
  Queryable,
  SalesDayCoverage,
  SalesSyncDay,
  ShopRevenueDayRecord,
} from '@/contracts';
import type {
  CatalogCounts,
  CatalogKpiRow,
  CatalogSearchResult,
  CatalogSearchRow,
  CatalogShopStatus,
} from '@/lib/repo/catalog.repo';
import type { ShopRevenueReadStateRecord } from '@/lib/repo/sales.repo';
import type { RouteDeps } from '@/lib/http/define-route';

import { emptyCatalogEnrichment } from '@/lib/repo/catalog.repo';
import { resetRateLimiter } from '@/lib/http/define-route';

import {
  createInsightsSalesDailyGet,
  type SalesDailyResponse,
} from '@/app/api/insights/sales-daily/route';
import {
  createInsightsRevenueDailyGet,
  type RevenueDailyResponse,
} from '@/app/api/insights/revenue-daily/route';
import {
  createInsightsTopProductsGet,
  type TopProductsResponse,
} from '@/app/api/insights/top-products/route';
import {
  createInsightsProductKpiGet,
  type ProductKpiResponse,
} from '@/app/api/insights/product-kpi/route';
import { createInsightsTimelineGet } from '@/app/api/insights/timeline/route';

/* ════════════════════════════ 0. Spoločné ═════════════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
/** Kotva: 19. 8. 2026. Deň je vpichnutý, takže test neflakuje po 22:00 UTC. */
const TODAY = '2026-08-19' as DateOnly;
const NOW = new Date('2026-08-19T09:00:00.000Z');

function routeDeps(): RouteDeps {
  return { now: () => NOW, localActor: async () => ({ id: 1, username: 'samuel' }) };
}

function syncDay(
  saleDay: string,
  status: SalesSyncDay['status'] = 'complete',
  ordersSeen = 4,
): SalesSyncDay {
  return {
    saleDay: saleDay as DateOnly,
    status,
    finishedAt: status === 'complete' ? `${saleDay}T23:00:00.000Z` : null,
    updatedAt: `${saleDay}T23:30:00.000Z`,
    ordersSeen,
  };
}

/** Dni `[from, to]` ako `complete` — pohodlný spôsob, ako dať oknu pokrytie. */
function completeRange(from: string, to: string): SalesSyncDay[] {
  const out: SalesSyncDay[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    out.push(syncDay(cursor.toISOString().slice(0, 10)));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function sale(productId: number, saleDay: string, unitsSold: number): ProductSalesDay {
  return { productId, saleDay: saleDay as DateOnly, unitsSold };
}

async function body<T>(response: Response): Promise<T> {
  const parsed = (await response.json()) as { ok: boolean; data?: T };
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  return parsed.data as T;
}

/* ══════════════ 0b. Podvrhnutý `fetch`, ktorý pri volaní zhodí ════════════ */

let fetchCalls: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetRateLimiter();
  fetchCalls = [];
  globalThis.fetch = ((input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input);
    fetchCalls.push(url);
    throw new Error(`K8: čítacia route zavolala shop (${url})`);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  // Poistka pre prípad, že by testovaný kód výnimku prehltol vo `try/catch`.
  expect(fetchCalls, 'na render ceste nesmie odísť ani jeden request').toEqual([]);
});

/* ═════════════════ 1. `sales-daily` — okno a priznaná medzera ═════════════ */

interface SalesWorld {
  sync?: SalesSyncDay[];
  days?: ProductSalesDay[];
  unitsQueries: { count: number; ranges: Array<[string, string]> };
}

function salesWorld(sync: SalesSyncDay[], days: ProductSalesDay[]): SalesWorld {
  return { sync, days, unitsQueries: { count: 0, ranges: [] } };
}

async function callSalesDaily(
  world: SalesWorld,
  query = '',
): Promise<{ status: number; data: SalesDailyResponse }> {
  const handler = createInsightsSalesDailyGet(
    {
      now: () => NOW,
      timeZone: 'Europe/Bratislava',
      syncEnabled: true,
      windowDays: 30,
      salesInsights: {
        syncDays: async () => world.sync ?? [],
        dailyUnits: async (ids, from, to) => {
          world.unitsQueries.count += 1;
          world.unitsQueries.ranges.push([from, to]);
          const set = new Set(ids);
          return (world.days ?? []).filter(
            (row) => set.has(row.productId) && row.saleDay >= from && row.saleDay <= to,
          );
        },
      },
      insightsRepo: {
        discountDepth: async () => [
          {
            productId: 501,
            slot: 1,
            label: null,
            name: 'Prsteň',
            price: '100.00' as MoneyString,
            hasAttributes: false,
            shopStatus: 'ok',
            lastOwnWrite: null,
          },
        ],
      },
    },
    routeDeps(),
  );
  const response = await handler(
    new Request(`${APP_ORIGIN}/api/insights/sales-daily${query}`, { method: 'GET' }),
  );
  return { status: response.status, data: await body<SalesDailyResponse>(response) };
}

describe('GET /api/insights/sales-daily — okno 7/30/90 a medzera', () => {
  it('nesťahovaný deň v `days` NIE JE, ale v `gaps` je menovite', async () => {
    const world = salesWorld(
      [syncDay('2026-08-17'), syncDay('2026-08-18'), syncDay('2026-08-19', 'pending', 0)],
      [sale(501, '2026-08-17', 12)],
    );
    const { data } = await callSalesDaily(world, '?window=7');

    expect(data.window).toEqual({ days: 7, from: '2026-08-13', to: '2026-08-19' });
    // Stiahnutý deň bez predaja je nula (meraný fakt), nestiahnutý deň chýba.
    expect(data.days).toEqual([
      { day: '2026-08-17', units: 12, status: 'complete' },
      { day: '2026-08-18', units: 0, status: 'complete' },
    ]);
    expect(data.gaps.unknownDays).toBe(5);
    expect(data.gaps.missing).toEqual([
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
      '2026-08-19',
    ]);
    // Každý deň okna má riadok — graf vie, KDE dieru nakresliť.
    expect(data.gaps.days).toHaveLength(7);
    expect(data.gaps.hasGap).toBe(true);
  });

  it('okno mení rozsah aj počet chýbajúcich dní, nie semantiku riadku', async () => {
    const world = salesWorld(completeRange('2026-08-13', '2026-08-19'), [
      sale(501, '2026-08-15', 3),
    ]);
    const seven = await callSalesDaily(world, '?window=7');
    expect(seven.data.gaps.unknownDays).toBe(0);
    expect(seven.data.unitsState).toBe('measured');
    expect(seven.data.windowUnits).toBe(3);

    const thirty = await callSalesDaily(world, '?window=30');
    expect(thirty.data.window.days).toBe(30);
    // 23 dní pred 13. 8. appka nemá — a hovorí to číslom, nie nulami v rade.
    expect(thirty.data.gaps.unknownDays).toBe(23);
    expect(thirty.data.unitsState).toBe('lower_bound');
    expect(thirty.data.days).toHaveLength(7);
  });

  it('default je 30 dní a nepovolené okno je 400, nie tichý fallback', async () => {
    const world = salesWorld(completeRange('2026-08-13', '2026-08-19'), []);
    const { data } = await callSalesDaily(world);
    expect(data.window.days).toBe(30);

    resetRateLimiter();
    const handler = createInsightsSalesDailyGet(
      {
        now: () => NOW,
        salesInsights: { syncDays: async () => [], dailyUnits: async () => [] },
        insightsRepo: { discountDepth: async () => [] },
      },
      routeDeps(),
    );
    const bad = await handler(
      new Request(`${APP_ORIGIN}/api/insights/sales-daily?window=14`, { method: 'GET' }),
    );
    expect(bad.status).toBe(400);
  });

  it('bez jediného stiahnutého dňa je rad prázdny a súčet je `null`, nie 0', async () => {
    const world = salesWorld([syncDay('2026-08-19', 'pending', 0)], []);
    const { data } = await callSalesDaily(world, '?window=7');
    expect(data.days).toEqual([]);
    expect(data.windowUnits).toBeNull();
    expect(data.unitsState).toBe('unknown');
    expect(data.gaps.unknownDays).toBe(7);
    // Bez pokrytia sa na kusy ani nepýtame.
    expect(world.unitsQueries.count).toBe(0);
  });

  it('`partial` deň sa do súčtu okna NEPRIPOČÍTA (dolná hranica sa nesčítava)', async () => {
    const world = salesWorld(
      [...completeRange('2026-08-13', '2026-08-18'), syncDay('2026-08-19', 'partial', 2)],
      [sale(501, '2026-08-18', 10), sale(501, '2026-08-19', 4)],
    );
    const { data } = await callSalesDaily(world, '?window=7');
    expect(data.days.find((row) => row.day === '2026-08-19')?.status).toBe('partial');
    // Riadok v rade zostáva (číslo je pravdivé), ale súčet okna ho neberie.
    expect(data.windowUnits).toBe(10);
    expect(data.unitsState).toBe('lower_bound');
  });

  it('dotaz na kusy ide na PRIESEČNÍK okna a pokrytia, nie na celé okno', async () => {
    const world = salesWorld(completeRange('2026-08-17', '2026-08-19'), []);
    await callSalesDaily(world, '?window=30');
    expect(world.unitsQueries.ranges).toEqual([['2026-08-17', '2026-08-19']]);
  });
});

/* ═══════════════ 2. `revenue-daily` — tržba je EŠOPOVÁ (D117) ═════════════ */

function revenueDay(
  day: string,
  currency: string,
  totalPaidSum: string,
  ordersCount: number,
  dayComplete = true,
): ShopRevenueDayRecord {
  return {
    day: day as DateOnly,
    currency,
    totalPaidSum: totalPaidSum as MoneyString,
    ordersCount,
    dayComplete,
    pagesRead: 1,
    updatedAt: new Date(`${day}T23:00:00.000Z`),
  };
}

/**
 * Príznak prečítanosti dňa (`shop_revenue_read_state`, 0016). Deň bez tohto
 * riadku appka NEPOZNÁ; deň s `dayComplete: true` a bez sumy je PREČÍTANÝ deň,
 * v ktorom sa nepredalo nič.
 */
function revenueRead(
  day: string,
  dayComplete: boolean,
  ordersSeen: number,
): ShopRevenueReadStateRecord {
  return {
    day: day as DateOnly,
    dayComplete,
    ordersSeen,
    pagesRead: 1,
    lastError: null,
    firstReadAt: new Date(`${day}T23:00:00.000Z`),
    updatedAt: new Date(`${day}T23:00:00.000Z`),
  };
}

async function callRevenue(
  rows: ShopRevenueDayRecord[],
  query = '?window=7',
  states: ShopRevenueReadStateRecord[] = [],
): Promise<RevenueDailyResponse> {
  const handler = createInsightsRevenueDailyGet(
    {
      now: () => NOW,
      timeZone: 'Europe/Bratislava',
      salesRepo: {
        listRevenue: async () => rows,
        listRevenueReadStates: async () => states,
      },
    },
    routeDeps(),
  );
  const response = await handler(
    new Request(`${APP_ORIGIN}/api/insights/revenue-daily${query}`, { method: 'GET' }),
  );
  return body<RevenueDailyResponse>(response);
}

describe('GET /api/insights/revenue-daily — eshopová tržba, nikdy produktová', () => {
  it('vracia denný rad za menu a súčet sčíta v centoch', async () => {
    const data = await callRevenue([
      revenueDay('2026-08-17', 'EUR', '120.55', 3),
      revenueDay('2026-08-18', 'EUR', '0.10', 1),
      revenueDay('2026-08-19', 'EUR', '9.35', 2),
    ]);
    expect(data.scope).toBe('eshop');
    expect(data.currencies).toEqual(['EUR']);
    expect(data.series[0]?.sum).toBe('130.00');
    expect(data.series[0]?.days.map((row) => row.day)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
    ]);
  });

  it('v odpovedi nie je ANI JEDNO pole s produktom (D117)', async () => {
    const data = await callRevenue([revenueDay('2026-08-19', 'EUR', '10.00', 1)]);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/productId/i);
    expect(text).not.toMatch(/product_id/i);
    // A ani nič, čo by tržbu vydávalo za obrat položky.
    expect(text).not.toMatch(/perUnit|unitPrice|revenuePerProduct/i);
  });

  it('dve meny = dva rady a nikde nevznikne ich súčet', async () => {
    const data = await callRevenue([
      revenueDay('2026-08-19', 'EUR', '125.50', 2),
      revenueDay('2026-08-19', 'CZK', '2500.00', 1),
    ]);
    expect(data.currencies).toEqual(['CZK', 'EUR']);
    expect(data.series.map((row) => row.sum)).toEqual(['2500.00', '125.50']);
    expect(JSON.stringify(data)).not.toContain('2625.50');
  });

  it('deň bez riadku je „nevieme", nie nula', async () => {
    const data = await callRevenue([revenueDay('2026-08-19', 'EUR', '10.00', 1)]);
    expect(data.series[0]?.days).toHaveLength(1);
    expect(data.missing).toEqual([
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
      '2026-08-17',
      '2026-08-18',
    ]);
    expect(data.readDays).toBe(1);
    expect(data.series[0]?.sumState).toBe('lower_bound');
  });

  it('nedočítaný deň je dolná hranica a hovorí to `dayComplete` aj `sumState`', async () => {
    const rows = [
      ...['13', '14', '15', '16', '17', '18'].map((d) =>
        revenueDay(`2026-08-${d}`, 'EUR', '10.00', 1),
      ),
      revenueDay('2026-08-19', 'EUR', '2.00', 1, false),
    ];
    const data = await callRevenue(rows);
    expect(data.series[0]?.missing).toEqual([]);
    expect(data.series[0]?.lowerBoundDays).toBe(1);
    expect(data.series[0]?.sumState).toBe('lower_bound');
    expect(data.hasGap).toBe(true);

    const complete = await callRevenue(
      rows.map((row) => ({ ...row, dayComplete: true })),
    );
    expect(complete.series[0]?.sumState).toBe('measured');
    expect(complete.hasGap).toBe(false);
    expect(complete.series[0]?.sum).toBe('62.00');
  });

  it('prázdne okno nevracia nulu, ale prázdny rad', async () => {
    const data = await callRevenue([]);
    expect(data.currencies).toEqual([]);
    expect(data.series).toEqual([]);
    expect(data.readDays).toBe(0);
    expect(data.missing).toHaveLength(7);
  });

  /* ── 0016: „prečítané, nič sa nepredalo" verzus „nečítané, nevieme" ──── */

  /**
   * Okno smie byť len 7/30/90 (`windowQuery`), takže všetko nižšie beží nad
   * SIEDMIMI dňami `2026-08-13` … `2026-08-19`. Dni, o ktorých test nič nepovie,
   * zostávajú `unknown` — a to je zámer: ticho v DB je nevedomosť, nie nula.
   */
  const WEEK = ['13', '14', '15', '16', '17', '18', '19'].map((d) => `2026-08-${d}`);

  it('tri stavy dňa sa dajú rozlíšiť naraz (suma · prečítaná nula · nevieme)', async () => {
    const data = await callRevenue([revenueDay('2026-08-19', 'EUR', '10.00', 1)], '?window=7', [
      revenueRead('2026-08-18', true, 0),
      revenueRead('2026-08-19', true, 1),
    ]);
    expect(data.dayStates.map((row) => [row.day, row.state])).toEqual([
      // 13.–17. 8. sa nikdy nesťahovali — ani riadok tržby, ani stav čítania.
      ['2026-08-13', 'unknown'],
      ['2026-08-14', 'unknown'],
      ['2026-08-15', 'unknown'],
      ['2026-08-16', 'unknown'],
      ['2026-08-17', 'unknown'],
      // 18. 8. sa PREČÍTAL a objednávka v ňom nebola. Meraná nula.
      ['2026-08-18', 'empty'],
      // 19. 8. sa prečítal a objednávky boli. Suma je celý deň.
      ['2026-08-19', 'measured'],
    ]);
    expect(data.emptyDays).toEqual(['2026-08-18']);
    expect(data.missing).toEqual(WEEK.slice(0, 5));
    expect(data.readDays).toBe(2);
  });

  it('prečítaný deň bez objednávok NIE JE „nevieme" (0016)', async () => {
    const data = await callRevenue(
      [revenueDay('2026-08-19', 'EUR', '10.00', 1)],
      '?window=7',
      WEEK.map((day) => revenueRead(day, true, day === '2026-08-19' ? 1 : 0)),
    );
    expect(data.missing).toEqual([]);
    expect(data.emptyDays).toHaveLength(6);
    expect(data.readDays).toBe(7);
    expect(data.hasGap).toBe(false);
    // Celé okno je známe, takže súčet je MERANIE, nie dolná hranica.
    expect(data.series[0]?.sumState).toBe('measured');
    expect(data.series[0]?.sum).toBe('10.00');
    expect(data.series[0]?.measuredZeroDays).toHaveLength(6);
    expect(data.series[0]?.missing).toEqual([]);
  });

  it('ČIASTOČNE prečítaný deň bez objednávok zostáva „nevieme" (≥ 0 je prázdna veta)', async () => {
    const data = await callRevenue([], '?window=7', [revenueRead('2026-08-18', false, 0)]);
    expect(data.dayStates.every((row) => row.state === 'unknown')).toBe(true);
    expect(data.emptyDays).toEqual([]);
    expect(data.missing).toHaveLength(7);
  });

  it('deň s riadkami z času PRED 0016 (bez stavu) zostáva čítaný, bez backfillu', async () => {
    const data = await callRevenue([revenueDay('2026-08-19', 'EUR', '10.00', 1)], '?window=7', []);
    expect(data.dayStates[6]).toEqual({
      day: '2026-08-19',
      state: 'measured',
      ordersSeen: null,
    });
    expect(data.emptyDays).toEqual([]);
    // Zvyšok okna zostáva „nevieme" — stav sa dozadu NEDOPLŇUJE.
    expect(data.missing).toEqual(WEEK.slice(0, 6));
  });

  it('dva fakty o dni musia súhlasiť OBA — nedočítaný riadok prebije „dočítaný" stav', async () => {
    /*
     * Deň mal dočítanú NULU (stav áno, riadok nie) a neskoršie ČIASTOČNÉ čítanie
     * v ňom našlo objednávku. Riadok je preto nedočítaný, kým stav ešte hovorí
     * „dočítané". Suma NIE JE celý deň — a route to musí povedať.
     */
    const data = await callRevenue(
      [revenueDay('2026-08-19', 'EUR', '2.00', 1, false)],
      '?window=7',
      [revenueRead('2026-08-19', true, 0)],
    );
    expect(data.dayStates[6]?.state).toBe('lower_bound');
    expect(data.emptyDays).toEqual([]);
    expect(data.series[0]?.sumState).toBe('lower_bound');
    // A pre ostatné dni okna sa taký deň nesmie počítať ako „prečítaný".
    expect(data.series[0]?.measuredZeroDays).toEqual([]);
  });

  it('prečítaná nula JEDNEJ meny je nula aj pre DRUHÚ menu toho istého dňa', async () => {
    const data = await callRevenue(
      [revenueDay('2026-08-19', 'EUR', '10.00', 1), revenueDay('2026-08-18', 'CZK', '250.00', 1)],
      '?window=7',
      WEEK.map((day) => revenueRead(day, true, day >= '2026-08-18' ? 1 : 0)),
    );
    const czk = data.series.find((row) => row.currency === 'CZK');
    const eur = data.series.find((row) => row.currency === 'EUR');
    // Celé okno je dočítané, takže deň bez riadku meny je MERANÁ nula.
    expect(czk?.missing).toEqual([]);
    expect(czk?.measuredZeroDays).toEqual([...WEEK.slice(0, 5), '2026-08-19']);
    expect(czk?.sumState).toBe('measured');
    expect(eur?.missing).toEqual([]);
    expect(eur?.measuredZeroDays).toEqual([...WEEK.slice(0, 5), '2026-08-18']);
    expect(eur?.sumState).toBe('measured');
    // A ich súčet nikde nevznikne (D117).
    expect(JSON.stringify(data)).not.toContain('260.00');
  });

  it('chýbajúci deň NEDOSTANE nulu ani vtedy, keď iný deň prečítaný je', async () => {
    const data = await callRevenue([revenueDay('2026-08-19', 'EUR', '10.00', 1)], '?window=7', [
      revenueRead('2026-08-19', true, 1),
    ]);
    expect(data.missing).toEqual(WEEK.slice(0, 6));
    expect(data.series[0]?.days.map((row) => row.day)).toEqual(['2026-08-19']);
    expect(data.series[0]?.sumState).toBe('lower_bound');
    expect(data.series[0]?.measuredZeroDays).toEqual([]);
  });
});

/* ═════════════════ 3. `top-products` — top/flop stojí na meraní ═══════════ */

function catalogRow(productId: number, units: number, name = `Šperk ${productId}`): CatalogSearchRow {
  const base: CatalogCacheRecord = {
    productId,
    name,
    price: '49.90' as MoneyString,
    hasAttributes: false,
    source: 'list',
    fetchedAt: new Date('2026-08-18T00:13:00.000Z'),
    raw: {},
  };
  return {
    ...base,
    shopStatus: 'ok' as CatalogShopStatus,
    unitsSold: units,
    everDiscounted: false,
    discountedNow: false,
  };
}

function searchResult(rows: CatalogSearchRow[], total = rows.length): CatalogSearchResult {
  return {
    data: rows,
    page: 1,
    perPage: 200,
    total,
    soldWindowDays: 30,
    // Celé okno dočítané: `unitsSold` je meraný počet, nie dolná hranica (D121).
    soldCoverage: { windowDays: 30, completeDays: 30, unknownDays: 0 },
    soldFrom: '2026-07-21' as DateOnly,
    soldTo: TODAY,
    lockedFilters: [],
    enrichedOnly: [],
  };
}

function counts(
  cohort: number,
  over: { soldUnknown?: number; soldWindowDays?: number } = {},
): CatalogCounts {
  const soldUnknown = over.soldUnknown ?? 0;
  return {
    total: 41_348,
    sold: { none: 41_348 - cohort - soldUnknown, low: cohort, mid: 0, high: 0 },
    soldUnknown,
    neverDiscounted: 41_348,
    discountedNow: 0,
    shopDiscountedNow: 0,
    enrichedRows: 0,
    soldWindowDays: over.soldWindowDays ?? 30,
    soldFrom: '2026-07-21' as DateOnly,
    soldTo: TODAY,
    lockedFilters: [],
    enrichedOnly: [],
  };
}

interface TopWorld {
  searchCalls: Array<Record<string, unknown>>;
  enrichCalls: number[][];
  /** Filtre, s ktorými route žiadala počty zrkadla (D121, čísla vylúčených). */
  countsCalls: Array<Record<string, unknown>>;
}

async function callTop(
  opts: {
    sync?: SalesSyncDay[];
    rows?: CatalogSearchRow[];
    days?: ProductSalesDay[];
    cohort?: number;
    enrichment?: Map<number, CatalogEnrichmentRecord>;
    query?: string;
    /** Koľko riadkov zrkadla má za okno predaj NEZNÁMY (D121). */
    soldUnknown?: number;
    /** Za aké okno zrkadlo počty naozaj spočítalo — pozri `excludesOf()`. */
    countsWindowDays?: number;
  } = {},
): Promise<{ data: TopProductsResponse; world: TopWorld }> {
  const world: TopWorld = { searchCalls: [], enrichCalls: [], countsCalls: [] };
  const rows = opts.rows ?? [];
  const handler = createInsightsTopProductsGet(
    {
      now: () => NOW,
      timeZone: 'Europe/Bratislava',
      catalogRepo: {
        search: async (filter) => {
          world.searchCalls.push({ ...filter });
          const sorted = [...rows].sort((a, b) =>
            filter.sort === 'sold_asc'
              ? (a.unitsSold ?? 0) - (b.unitsSold ?? 0)
              : (b.unitsSold ?? 0) - (a.unitsSold ?? 0),
          );
          return searchResult(sorted.slice(0, filter.perPage ?? 50), rows.length);
        },
        counts: async (filter) => {
          world.countsCalls.push({ ...filter });
          return counts(opts.cohort ?? rows.length, {
            soldUnknown: opts.soldUnknown,
            soldWindowDays: opts.countsWindowDays,
          });
        },
        enrichmentFor: async (ids) => {
          world.enrichCalls.push([...ids]);
          const out = new Map<number, CatalogEnrichmentRecord>();
          for (const id of ids) {
            out.set(id, opts.enrichment?.get(id) ?? emptyCatalogEnrichment(id));
          }
          return out;
        },
      },
      salesInsights: {
        syncDays: async () => opts.sync ?? completeRange('2026-05-22', '2026-08-19'),
        dailyUnits: async (ids, from, to) => {
          const set = new Set(ids);
          return (opts.days ?? []).filter(
            (row) => set.has(row.productId) && row.saleDay >= from && row.saleDay <= to,
          );
        },
      },
    },
    routeDeps(),
  );
  const response = await handler(
    new Request(`${APP_ORIGIN}/api/insights/top-products${opts.query ?? '?window=30'}`, {
      method: 'GET',
    }),
  );
  return { data: await body<TopProductsResponse>(response), world };
}

describe('GET /api/insights/top-products — kto do rebríčka patrí', () => {
  it('okno 30/90 triedi zrkadlo a nulové vedro je z dotazu vylúčené', async () => {
    const { data, world } = await callTop({
      rows: [catalogRow(11, 40), catalogRow(12, 7), catalogRow(13, 1)],
      query: '?window=30&limit=2',
    });

    expect(data.available).toBe(true);
    expect(data.top.map((row) => row.productId)).toEqual([11, 12]);
    expect(data.flop.map((row) => row.productId)).toEqual([13, 12]);
    expect(data.cohort.size).toBe(3);
    /*
     * Príznaky NEZOSLABLI a pribudli k nim ČÍSLA (D121, 2. 9. 2026). Tvrdenie
     * je ďalej `toEqual`, teda nad CELÝM objektom: keby sa niektoré číslo
     * prestalo posielať, test to musí zhodiť, nie prehliadnuť.
     */
    expect(data.excludes).toEqual({
      zeroSales: true,
      notFound: true,
      unknownSales: 0,
      measuredZeroSales: 41_345,
    });

    // Vedro `none` (nula predaných) sa do dotazu nedostane ANI RAZ.
    for (const call of world.searchCalls) {
      expect(call.soldBuckets).toEqual(['low', 'mid', 'high']);
    }
    // Jediný dotaz na obohatenie pre oba rebríčky — žiadne N+1.
    expect(world.enrichCalls).toHaveLength(1);
    expect(world.enrichCalls[0]?.sort((a, b) => a - b)).toEqual([11, 12, 13]);
  });

  it('bez jediného dočítaného dňa sa nevráti ani jeden riadok', async () => {
    const { data } = await callTop({
      sync: [syncDay('2026-08-19', 'partial', 0)],
      rows: [catalogRow(11, 40)],
    });
    expect(data.available).toBe(false);
    expect(data.reason).toBe('no_coverage');
    expect(data.top).toEqual([]);
    expect(data.flop).toEqual([]);
    expect(data.rankingState).toBe('unknown');
  });

  it('okno 7 dní počíta presné súčty nad nadmnožinovou kohortou', async () => {
    // Kohorta 30 dní: 11 (starý predaj), 12 a 13 (predaj v posledných 7 dňoch).
    const { data } = await callTop({
      rows: [catalogRow(11, 50), catalogRow(12, 9), catalogRow(13, 4), catalogRow(14, 3)],
      days: [
        sale(11, '2026-07-30', 50),
        sale(12, '2026-08-18', 9),
        sale(13, '2026-08-17', 4),
        // Riadok s NULOU v okne (po korekcii dňa) — do rebríčka tiež nepatrí.
        sale(14, '2026-08-15', 0),
      ],
      query: '?window=7',
    });

    expect(data.window).toEqual({ days: 7, from: '2026-08-13', to: '2026-08-19' });
    // 11 v skutočnom okne nepredal NIČ, takže v rebríčku nie je vôbec —
    // ani na dne flopu (nie je to „0 predaných").
    expect(data.top.map((row) => row.productId)).toEqual([12, 13]);
    expect(data.flop.map((row) => row.productId)).toEqual([13, 12]);
    expect(data.top.every((row) => row.units > 0)).toBe(true);
    expect(data.flop.map((row) => row.productId)).not.toContain(14);
    expect(data.cohort.size).toBe(2);
  });

  it('príliš veľká kohorta rebríček NEVRÁTI, namiesto orezania', async () => {
    const { data } = await callTop({
      rows: [catalogRow(11, 5)],
      cohort: 5_000,
      query: '?window=7',
    });
    expect(data.available).toBe(false);
    expect(data.reason).toBe('cohort_too_large');
    expect(data.cohort.size).toBe(5_000);
    expect(data.top).toEqual([]);
  });

  it('neobohatený riadok má maržu a sklad „nevieme", nie nulu', async () => {
    const enrichment = new Map<number, CatalogEnrichmentRecord>([
      [
        11,
        {
          ...emptyCatalogEnrichment(11),
          reference: 'AU-0011',
          marginPercent: 42.5,
          qty: 0,
          enrichedAt: new Date('2026-08-19T07:00:00.000Z'),
        },
      ],
    ]);
    const { data } = await callTop({
      rows: [catalogRow(11, 40), catalogRow(12, 7)],
      enrichment,
    });

    const first = data.top.find((row) => row.productId === 11);
    const second = data.top.find((row) => row.productId === 12);
    expect(first?.reference).toBe('AU-0011');
    expect(first?.marginPercent).toBe(42.5);
    // `qty: 0` je platná nula (vypredané), nie „nevieme".
    expect(first?.qty).toBe(0);
    expect(first?.enriched).toBe(true);

    expect(second?.reference).toBeNull();
    expect(second?.marginPercent).toBeNull();
    expect(second?.qty).toBeNull();
    expect(second?.enriched).toBe(false);
  });

  /* ═════ D121 v TELE ODPOVEDE, nie len v modeli (2. 9. 2026) ═══════════════
   *
   * Príznak `excludes.zeroSales: true` je pravda a je NEMERATEĽNÝ: obrazovka
   * z neho nevie, či sa vylúčenie týka desiatich produktov, alebo štyridsiatich
   * tisíc. Preto odpoveď nesie dve čísla a preto sa merajú TU — na tele
   * odpovede. D121 raz už end-to-end neplatil práve preto, že sa meral len
   * model (`/api/catalog/search` posielala `unitsSold: 0` namiesto `null`).
   */
  it('odpoveď hovorí ČÍSLOM, koľkých produktov sa vylúčenie týka', async () => {
    const { data, world } = await callTop({
      rows: [catalogRow(11, 40), catalogRow(12, 7)],
      cohort: 2,
      soldUnknown: 38_900,
      query: '?window=30',
    });

    expect(data.available).toBe(true);
    // „Nemerali sme" a „namerali sme nulu" sú DVE čísla, nie jedno.
    expect(data.excludes.unknownSales).toBe(38_900);
    expect(data.excludes.measuredZeroSales).toBe(41_348 - 2 - 38_900);
    // Ani jedno z nich nie je nula len preto, že sa pole nepridalo.
    expect(data.excludes.unknownSales).not.toBeNull();

    /*
     * Počty sa žiadajú za OKNO ODPOVEDE a BEZ filtra vedier. S vedrami
     * `low/mid/high` by `soldUnknown` vyšlo nula — teda „netýka sa to nikoho" —
     * a to je práve tá nepravda, ktorú číslo má odstrániť.
     */
    expect(world.countsCalls).toHaveLength(1);
    expect(world.countsCalls[0]?.soldWindowDays).toBe(30);
    expect(world.countsCalls[0]?.soldBuckets).toBeUndefined();
  });

  it('počty za INÉ okno sú `null`, nie vydávané za okno odpovede', async () => {
    /*
     * `counts()` vie triediť len okná z `ALLOWED_SOLD_WINDOWS` a mimo nich si
     * okno TICHO prepíše na predvolené. Pri okne 7 dní (cesta B) preto počty
     * platia za 30 dní; poslať ich ako sedemdňové by bolo vymyslené číslo.
     */
    const { data } = await callTop({
      rows: [catalogRow(11, 50), catalogRow(12, 9)],
      days: [sale(11, '2026-08-18', 50), sale(12, '2026-08-17', 9)],
      soldUnknown: 38_900,
      query: '?window=7',
    });

    expect(data.window.days).toBe(7);
    expect(data.available).toBe(true);
    expect(data.excludes.unknownSales).toBeNull();
    expect(data.excludes.measuredZeroSales).toBeNull();
    // Príznaky platia ďalej — vylučuje sa, len sa nevie koľkých.
    expect(data.excludes.zeroSales).toBe(true);
  });

  it('bez jediného dočítaného dňa sú počty `null` — vylučuje sa VŠETKO', async () => {
    const { data, world } = await callTop({
      sync: [syncDay('2026-08-19', 'partial', 0)],
      rows: [catalogRow(11, 40)],
      soldUnknown: 41_348,
    });
    expect(data.reason).toBe('no_coverage');
    expect(data.excludes.unknownSales).toBeNull();
    expect(data.excludes.measuredZeroSales).toBeNull();
    // Nula by tvrdila „nevylučuje sa nič", a pritom sa vylučuje celý katalóg.
    expect(world.countsCalls).toHaveLength(0);
  });

  it('rozchod okna počtov a okna rebríčka zhodí čísla, nie tvrdenie', async () => {
    /*
     * Poistka proti tichému rozchodu: keby zrkadlo počty spočítalo za iné okno
     * než za aké je rebríček (a stalo by sa to práve rozšírením
     * `ALLOWED_SOLD_WINDOWS`), route ich MUSÍ zahodiť. Rozhoduje o tom
     * `counts.soldWindowDays`, nie druhá kópia zoznamu povolených okien.
     */
    const { data } = await callTop({
      rows: [catalogRow(11, 40)],
      soldUnknown: 12,
      countsWindowDays: 90,
      query: '?window=30',
    });
    expect(data.available).toBe(true);
    expect(data.excludes.unknownSales).toBeNull();
    expect(data.excludes.measuredZeroSales).toBeNull();
  });

  it('medzera okna sa priznáva aj vtedy, keď rebríček vyjde', async () => {
    const { data } = await callTop({
      sync: completeRange('2026-08-13', '2026-08-19'),
      rows: [catalogRow(11, 40)],
      query: '?window=30',
    });
    expect(data.available).toBe(true);
    expect(data.rankingState).toBe('lower_bound');
    expect(data.gaps.unknownDays).toBe(23);
  });
});

/* ═══════════════ 4. `product-kpi` — trojstavovosť a žiadne N+1 ════════════ */

/**
 * Route KPI NEPOČÍTA — deleguje na `productKpis()` z `lib/sales/insights.ts`.
 * Test preto beží nad SKUTOČNÝM výpočtom a podvrhuje mu len tri zdroje:
 * riadky zrkadla (`kpiRowsFor`), pokrytie dní (`coverageFor`) a spojenie, na
 * ktorom sa vykoná dotaz na kusy. Fake spojenie ignoruje text SQL a odpovedá
 * podľa tvaru riadku (`product_id`, `units_short`, `units_long`) — takže test
 * nie je pripútaný k SQL cudzej vlny, ale prejde celým skladaním KPI aj
 * pipeline `defineRoute()`.
 */
interface KpiWorld {
  kpiRowsCalls: number;
  coverageCalls: number;
  unitsQueries: number;
}

/** Riadok zrkadla + obohatenie pre `kpiRowsFor()`. */
function kpiRow(
  productId: number,
  enrichment: Partial<CatalogEnrichmentRecord> = {},
  name: string | null = `Šperk ${productId}`,
): CatalogKpiRow {
  return {
    productId,
    missing: false,
    name,
    price: '49.90' as MoneyString,
    enrichment: { ...emptyCatalogEnrichment(productId), ...enrichment },
  };
}

async function callKpi(opts: {
  ids: string;
  rows?: CatalogKpiRow[];
  /** Pokrytie dlhého okna po dňoch; chýbajúci deň je `missing`. */
  coverage?: Map<string, SalesDayCoverage>;
  /** `product_id → [kusy krátkeho okna, kusy dlhého okna]`. */
  units?: Map<number, [number, number]>;
  query?: string;
}): Promise<{ status: number; data: ProductKpiResponse; world: KpiWorld }> {
  const world: KpiWorld = { kpiRowsCalls: 0, coverageCalls: 0, unitsQueries: 0 };

  const conn: Queryable = {
    query: async <T>(): Promise<T> => {
      world.unitsQueries += 1;
      return [...(opts.units ?? new Map()).entries()].map(([productId, [short, long]]) => ({
        product_id: productId,
        units_short: short,
        units_long: long,
      })) as unknown as T;
    },
  };

  const handler = createInsightsProductKpiGet(
    {
      now: () => NOW,
      timeZone: 'Europe/Bratislava',
      kpiSources: {
        conn,
        catalog: {
          kpiRowsFor: async (ids) => {
            world.kpiRowsCalls += 1;
            const out = new Map<number, CatalogKpiRow>();
            const byId = new Map((opts.rows ?? []).map((row) => [row.productId, row]));
            for (const id of ids) {
              const row = byId.get(id);
              if (row !== undefined) out.set(id, row);
              else if (opts.rows === undefined) out.set(id, kpiRow(id));
            }
            return out;
          },
        },
        sales: {
          coverageFor: async (from, to) => {
            world.coverageCalls += 1;
            const days: Array<{ day: DateOnly; coverage: SalesDayCoverage; ordersSeen: number }> = [];
            let completeDays = 0;
            let unknownDays = 0;
            const cursor = new Date(`${from}T00:00:00.000Z`);
            const end = new Date(`${to}T00:00:00.000Z`);
            while (cursor <= end) {
              const day = cursor.toISOString().slice(0, 10) as DateOnly;
              const coverage = opts.coverage?.get(day) ?? 'complete';
              if (coverage === 'complete') completeDays += 1;
              else unknownDays += 1;
              days.push({ day, coverage, ordersSeen: 0 });
              cursor.setUTCDate(cursor.getUTCDate() + 1);
            }
            return { from, to, days, completeDays, unknownDays };
          },
        },
      },
    },
    routeDeps(),
  );

  const response = await handler(
    new Request(`${APP_ORIGIN}/api/insights/product-kpi?ids=${opts.ids}${opts.query ?? ''}`, {
      method: 'GET',
    }),
  );
  if (response.status !== 200) {
    return { status: response.status, data: {} as ProductKpiResponse, world };
  }
  return { status: response.status, data: await body<ProductKpiResponse>(response), world };
}

describe('GET /api/insights/product-kpi — KPI riadku (D114)', () => {
  it('sto ID = TRI dotazy, nie sto (žiadne N+1)', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => 1000 + i);
    const { data, world } = await callKpi({ ids: ids.join(',') });

    expect(data.rows).toHaveLength(100);
    expect(world.kpiRowsCalls).toBe(1);
    expect(world.coverageCalls).toBe(1);
    expect(world.unitsQueries).toBe(1);
  });

  it('nad 100 ID je 400 — stránka je rozhodnutie, nie parameter', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => 1000 + i);
    const { status } = await callKpi({ ids: ids.join(',') });
    expect(status).toBe(400);
  });

  it('TRI stavy kusov: číslo, meraná nula, „nevieme"', async () => {
    /* (a) celé okno dočítané → číslo aj nula sú merania. */
    const measured = await callKpi({
      ids: '11,12',
      rows: [kpiRow(11), kpiRow(12)],
      units: new Map([[11, [6, 11]]]),
    });
    const first = measured.data.rows.find((row) => row.productId === 11);
    const second = measured.data.rows.find((row) => row.productId === 12);

    expect(measured.data.window30.unknownDays).toBe(0);
    expect(first?.units30.units).toEqual({ value: 6, gap: null });
    expect(first?.units90.units).toEqual({ value: 11, gap: null });
    expect(first?.units30.lowerBound).toBe(false);
    // Produkt bez predaja má MERANÚ nulu — `gap: null` to hovorí nahlas.
    expect(second?.units30.units).toEqual({ value: 0, gap: null });
    expect(second?.units90.units).toEqual({ value: 0, gap: null });

    /* (b) bez jediného dočítaného dňa → `null` s dôvodom, NIKDY nula. */
    const nothing = new Map<string, SalesDayCoverage>();
    const cursor = new Date('2026-05-22T00:00:00.000Z');
    while (cursor <= new Date('2026-08-19T00:00:00.000Z')) {
      nothing.set(cursor.toISOString().slice(0, 10), 'pending');
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const unknown = await callKpi({
      ids: '11',
      rows: [kpiRow(11)],
      coverage: nothing,
      units: new Map([[11, [6, 11]]]),
    });
    expect(unknown.data.rows[0]?.units30.units).toEqual({ value: null, gap: 'days_missing' });
    expect(unknown.data.rows[0]?.units90.units).toEqual({ value: null, gap: 'days_missing' });
    expect(unknown.data.window90.completeDays).toBe(0);
  });

  it('čiastočne dočítané okno dáva DOLNÚ HRANICU, a priznáva to', async () => {
    const { data } = await callKpi({
      ids: '11',
      rows: [kpiRow(11)],
      coverage: new Map<string, SalesDayCoverage>([['2026-08-19', 'partial']]),
      units: new Map([[11, [6, 11]]]),
    });
    expect(data.window30.unknownDays).toBe(1);
    expect(data.rows[0]?.units30.lowerBound).toBe(true);
    /*
     * Číslo sa nezahodí, ale NESIE si dôvod: 6 je dolná hranica, nie súčet
     * okna. Obrazovka ho preto nesmie nakresliť bez značky medzery.
     */
    expect(data.rows[0]?.units30.units).toEqual({ value: 6, gap: 'days_missing' });
  });

  it('neobohatený produkt má „nevieme" s DÔVODOM, nie nulu', async () => {
    const { data } = await callKpi({
      ids: '11,12',
      rows: [
        kpiRow(11, {
          reference: 'AU-0011',
          margin: 7.77,
          marginPercent: 15.5,
          qty: 0,
          qtyInOrders: 0,
          enrichedAt: new Date('2026-08-19T07:00:00.000Z'),
        }),
        kpiRow(12),
      ],
    });
    const rich = data.rows.find((row) => row.productId === 11);
    const poor = data.rows.find((row) => row.productId === 12);

    expect(rich?.reference).toEqual({ value: 'AU-0011', gap: null });
    expect(rich?.margin).toEqual({ value: 7.77, gap: null });
    // Nula zo shopu prežije ako NULA (vypredané / nikdy neobjednané).
    expect(rich?.stock).toEqual({ value: 0, gap: null });
    expect(rich?.soldTotal).toEqual({ value: 0, gap: null });
    expect(rich?.enrichedAt).not.toBeNull();

    expect(poor?.reference).toEqual({ value: null, gap: 'not_enriched' });
    expect(poor?.margin).toEqual({ value: null, gap: 'not_enriched' });
    expect(poor?.stock).toEqual({ value: null, gap: 'not_enriched' });
    expect(poor?.enrichedAt).toBeNull();
  });

  it('aktívna zľava je stav PODĽA SHOPU aj s časom merania (I11)', async () => {
    const { data } = await callKpi({
      ids: '11,12',
      rows: [
        kpiRow(11, {
          reductionPercent: 20,
          reductionFrom: new Date('2026-08-15T00:00:00.000Z'),
          reductionTo: new Date('2026-08-25T00:00:00.000Z'),
          enrichedAt: new Date('2026-08-19T07:00:00.000Z'),
        }),
        kpiRow(12),
      ],
    });
    const running = data.rows.find((row) => row.productId === 11);
    expect(running?.discount.state).toBe('running');
    expect(running?.discount.activePercent).toEqual({ value: 20, gap: null });
    // Bez času merania by odpoveď tvrdila stav zľavy v shope TERAZ.
    expect(running?.discount.measuredAt).not.toBeNull();

    const unknown = data.rows.find((row) => row.productId === 12);
    expect(unknown?.discount.state).toBe('unknown');
    expect(unknown?.discount.activePercent).toEqual({ value: null, gap: 'not_enriched' });
    expect(unknown?.discount.measuredAt).toBeNull();
  });

  it('značka „bez predaja" vzniká len s dôkazom (D119)', async () => {
    /*
     * Okno je ZÁMERNE nedočítané (jeden `partial` deň), takže z lokálnych
     * predajov dôkaz vzniknúť nemôže. Zostáva len dôkaz zo shopu — a presne to
     * je rozdiel medzi „ležiak" a „o tomto produkte nič nevieme".
     */
    const gap = new Map<string, SalesDayCoverage>([['2026-08-19', 'partial']]);
    const { data } = await callKpi({
      ids: '11,12',
      coverage: gap,
      rows: [
        kpiRow(11, {
          qty: 3,
          qtyInOrders: 0,
          lastTimeInOrder: null,
          enrichedAt: new Date('2026-08-19T07:00:00.000Z'),
        }),
        kpiRow(12),
      ],
    });
    expect(data.rows.find((row) => row.productId === 11)?.noSale).toEqual({
      mark: true,
      proof: 'shop_never_ordered',
    });
    // Neobohatený produkt NIE JE mŕtvy produkt — je to neznámy produkt.
    expect(data.rows.find((row) => row.productId === 12)?.noSale).toEqual({
      mark: false,
      proof: null,
    });

    /*
     * A naopak: keď je DLHÉ okno celé dočítané a v ňom nula kusov, dôkaz vzniká
     * z lokálnych predajov aj pre neobohatený produkt — nula je vtedy meranie.
     */
    const covered = await callKpi({ ids: '12', rows: [kpiRow(12)] });
    expect(covered.data.rows[0]?.noSale).toEqual({
      mark: true,
      proof: 'no_sale_in_covered_days',
    });
  });

  it('v odpovedi nie je ANI JEDNO pole s tržbou produktu (D117)', async () => {
    const { data } = await callKpi({ ids: '11', rows: [kpiRow(11)] });
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/revenue|totalPaid|turnoverRate/i);
  });

  it('`?window=7` posúva KRÁTKE okno a odpoveď to priznáva v `requested`', async () => {
    const { data } = await callKpi({ ids: '11', rows: [kpiRow(11)], query: '&window=7' });
    expect(data.requested).toEqual({ shortWindowDays: 7, longWindowDays: 90 });
    // Menovka `window30` zostáva, ale `windowDays` hovorí pravdu.
    expect(data.window30.windowDays).toBe(7);
    expect(data.window30.from).toBe('2026-08-13');
    expect(data.window90.windowDays).toBe(90);
  });

  it('ID, ktoré zrkadlo nemá, riadok NEDOSTANE — a nie je to nula', async () => {
    const { data } = await callKpi({ ids: '11,12', rows: [kpiRow(11)] });
    expect(data.rows.map((row) => row.productId)).toEqual([11]);
  });

  it('duplikát a nezmysel sa nezahodia ticho, ale sa vypíšu', async () => {
    const { data } = await callKpi({ ids: '11,11,-3', rows: [kpiRow(11)] });
    expect(data.rows.map((row) => row.productId)).toEqual([11]);
    expect(data.skippedIds).toEqual([11, -3]);
  });
});


/* ═══════════════════ 5. `timeline` — okná zliav pod krivku ════════════════ */

describe('GET /api/insights/timeline — os okna pre graf Prehľadu', () => {
  const campaign = {
    id: 7,
    name: 'Ležiaky — 10 %',
    status: 'done',
    percent: 10 as never,
    dateFrom: '2026-08-10' as DateOnly,
    dateTo: '2026-08-24' as DateOnly,
    mode: 'now',
    fireAt: null,
    productIds: [11, 12],
  };

  async function call(query: string): Promise<{
    from: string;
    to: string;
    windowDays: number | null;
    campaigns: unknown[];
  }> {
    resetRateLimiter();
    const handler = createInsightsTimelineGet(
      {
        now: () => NOW,
        timeZone: 'Europe/Bratislava',
        insightsRepo: {
          campaignWindows: async () => [campaign],
          discountDepth: async () => [],
          productWrites: async () => [],
          writeActivity: async (from, to) => ({ from, to, days: [], truncated: false }),
          campaignItemTally: async () => ({
            tally: {
              pending: 0,
              skipped: 0,
              ok: 0,
              failed: 0,
              uncertain: 0,
              interrupted: 0,
              not_found: 0,
              blocked: 0,
            },
            unrecognized: 0,
          }),
        },
      },
      routeDeps(),
    );
    const response = await handler(
      new Request(`${APP_ORIGIN}/api/insights/timeline${query}`, { method: 'GET' }),
    );
    return body(response);
  }

  it('bez `window` zostáva pôvodná 3-mesačná os', async () => {
    const data = await call('');
    expect(data.windowDays).toBeNull();
    expect(data.from).toBe('2026-07-01');
    expect(data.to).toBe('2026-09-30');
  });

  it('s `window` sa os zúži presne na okno krivky', async () => {
    const data = await call('?window=30');
    expect(data.windowDays).toBe(30);
    expect(data.from).toBe('2026-07-21');
    expect(data.to).toBe('2026-08-19');
    expect(data.campaigns).toHaveLength(1);
  });
});

/* ══════════════ 6. K8 — na render ceste nie je shop ANI V IMPORTE ═════════ */

describe('K8 — čítacie endpointy V4 nevedia, ako sa shop volá', () => {
  const files = [
    '_shared.ts',
    'sales-daily/route.ts',
    'revenue-daily/route.ts',
    'top-products/route.ts',
    'product-kpi/route.ts',
    'product/[productId]/route.ts',
    'timeline/route.ts',
  ];

  const read = (rel: string): string =>
    readFileSync(
      fileURLToPath(new URL(`../../src/app/api/insights/${rel}`, import.meta.url)),
      'utf8',
    );

  it('sanity — zdroje sa naozaj čítajú', () => {
    for (const file of files) expect(read(file).length).toBeGreaterThan(500);
  });

  it('žiadny import shop klienta, kľúča ani rozpočtu čítaní', () => {
    for (const file of files) {
      // Komentáre smú shop menovať (a menujú, aby bolo jasné PREČO tu nie je);
      // zakázaný je IMPORT, teda cesta ku kódu, ktorý vie poslať request.
      const imports = read(file)
        .split('\n')
        .filter((line) => /^\s*import\b/.test(line) || /^\s*}\s*from\s/.test(line) || /from '/.test(line));
      const joined = imports.join('\n');
      expect(joined, file).not.toMatch(/@\/lib\/shop\//);
      expect(joined, file).not.toMatch(/api-key\.repo/);
      expect(joined, file).not.toMatch(/createShopClient/);
    }
  });

  /**
   * KÓD (bez komentárov) nesmie spomenúť cestu k API shopu ani po zlepení
   * z častí (`'/api' + '/products'`). Komentáre sa odstrihnú zámerne: hlavičky
   * tých súborov shop MENUJÚ, a to je správne — vysvetľujú, prečo tam nie je.
   * Odstrihnutie je jednoduché (riadky komentárov v štýle tohto repa), takže
   * cestu skrytú v premennej neuvidí — pred tým chráni test importov vyššie.
   */
  it('a ani jedna z nich nespomína cestu k API shopu (v kóde)', () => {
    const codeOnly = (source: string): string =>
      source
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join('\n')
        .replace(/['"`+\s]/g, '');

    // Poistka na poistku: keby filter prestal fungovať, tento fragment prejde.
    expect(codeOnly("const x = '/api' + '/products';")).toContain('/api/products');
    expect(codeOnly(' * volá /api/products/getFull')).toBe('');

    for (const file of files) {
      expect(codeOnly(read(file)), file).not.toMatch(/\/api\/(products|order|batch)/);
      expect(codeOnly(read(file)), file).not.toMatch(/setReduction/);
    }
  });
});
