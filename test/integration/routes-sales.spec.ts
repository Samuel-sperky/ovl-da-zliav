/**
 * Aura Zľavy — integračné testy `GET /api/sales`
 * (KONTRAKT-PREDAJNOST-2026-08-06, P1, P3, akceptačné kritérium 7).
 *
 * Route beží celou `defineRoute()` pipeline; session vrstva je stubnutá (vlastní
 * ju A4) a dátová vrstva sú in-memory fakes — žiadna DB a žiadna sieť. Testy
 * pokrývajú aj stav „žiadne dáta", ktorý je najdôležitejší: vtedy sa NESMÚ
 * poslať nuly ako fakt (I11).
 */
import { describe, expect, it } from 'vitest';

import type { DiscountDepthRow } from '@/lib/repo/insights.repo';
import type { ProductSalesDay, SalesInsightsReport, SalesSyncDay } from '@/contracts';

import { createSalesGet, type SalesRouteDeps } from '@/app/api/sales/route';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';

/* ═════════════════════════════ pomôcky ════════════════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const NOW = new Date('2026-08-06T09:00:00.000Z');

/**
 * Deps pre `defineRoute()`. Do 27. 8. 2026 tu bol stub SESSION vrstvy
 * (`verifySession`) a testy si ním vedeli vyrobiť aj stav „bez session" alebo
 * „bez sudo okna". Prihlásenie zmizlo (D99, D100), takže tie stavy neexistujú
 * a stub sa zúžil na lokálneho actora, ktorého route potrebuje pre FK a audit.
 */
function routeDeps(): RouteDeps {
  return {
    now: () => NOW,
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

function depthRow(productId: number, overrides: Partial<DiscountDepthRow> = {}): DiscountDepthRow {
  return {
    productId,
    slot: productId - 200,
    label: `Šperk ${productId}`,
    name: `Prsteň ${productId}`,
    price: '100.00',
    hasAttributes: false,
    shopStatus: 'ok',
    lastOwnWrite: null,
    ...overrides,
  };
}

function syncDay(
  saleDay: string,
  status: SalesSyncDay['status'] = 'complete',
  ordersSeen = 6,
): SalesSyncDay {
  return {
    saleDay,
    status,
    finishedAt: status === 'complete' ? `${saleDay}T23:00:00.000Z` : null,
    updatedAt: `${saleDay}T23:30:00.000Z`,
    ordersSeen,
  };
}

interface WorldOptions {
  syncDays?: SalesSyncDay[];
  days?: ProductSalesDay[];
  products?: DiscountDepthRow[];
  syncEnabled?: boolean;
}

/** Zaznamenáva aj to, ČI sa dotaz na kusy vôbec spustil (bez pokrytia nesmie). */
function makeDeps(opts: WorldOptions = {}): { deps: SalesRouteDeps; unitsQueries: number } {
  const state = { unitsQueries: 0 };
  const deps: SalesRouteDeps = {
    now: () => NOW,
    timeZone: 'Europe/Bratislava',
    syncEnabled: opts.syncEnabled ?? true,
    windowDays: 3,
    insightsRepo: {
      discountDepth: async () => opts.products ?? [depthRow(201), depthRow(202)],
    },
    salesInsights: {
      syncDays: async () => opts.syncDays ?? [],
      dailyUnits: async (productIds, from, to) => {
        state.unitsQueries += 1;
        const ids = new Set(productIds);
        return (opts.days ?? []).filter(
          (row) => ids.has(row.productId) && row.saleDay >= from && row.saleDay <= to,
        );
      },
    },
  };
  return {
    deps,
    get unitsQueries() {
      return state.unitsQueries;
    },
  };
}

async function call(
  opts: WorldOptions = {},
): Promise<{ status: number; body: { ok: boolean; data?: SalesInsightsReport; error?: { code: string } } }> {
  resetRateLimiter();
  const world = makeDeps(opts);
  const handler = createSalesGet(world.deps, routeDeps());
  const response = await handler(new Request(`${APP_ORIGIN}/api/sales`, { method: 'GET' }));
  return {
    status: response.status,
    body: (await response.json()) as { ok: boolean; data?: SalesInsightsReport },
  };
}

/* ══════════════════════════════ 1. Auth ═══════════════════════════════════ */

/*
 * Test „bez session vráti 401" tu stál do 27. 8. 2026. Prihlásenie appka nemá
 * (D99), takže stav „bez session" neexistuje a test by meral vetvu, ktorá už
 * nie je v kóde. Čo z tejto oblasti PRETRVÁVA a je strážené inde: origin check
 * na mutáciách (`origin-check-po-loginu.spec.ts`) — čítanie ho nepotrebuje.
 */
describe('GET /api/sales — auth ako ostatné čítacie routy', () => {

  it('so session vráti 200', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('mutácia na tejto ceste neexistuje (405)', async () => {
    resetRateLimiter();
    const world = makeDeps();
    const handler = createSalesGet(world.deps, routeDeps());
    const response = await handler(
      new Request(`${APP_ORIGIN}/api/sales`, {
        method: 'POST',
        headers: { origin: APP_ORIGIN },
      }),
    );
    expect(response.status).toBe(405);
  });
});

/* ═══════════════════════ 2. Stav „žiadne dáta" ════════════════════════════ */

describe('GET /api/sales — bez dát sa nuly netvária ako fakt (I11)', () => {
  it('prázdny stav synchronizácie dá `hasData: false` a prázdne pokrytie', async () => {
    const res = await call({ syncDays: [] });
    const coverage = res.body.data!.coverage;
    expect(coverage).toMatchObject({
      hasData: false,
      from: null,
      to: null,
      daysCovered: 0,
      lastSyncedAt: null,
      syncEnabled: true,
      windowDays: 3,
    });
  });

  it('bez pokrytia sú `unitsPerDay` a `daysSinceLastSale` null, nie 0', async () => {
    const res = await call({ syncDays: [] });
    expect(res.body.data!.products).toHaveLength(2);
    for (const row of res.body.data!.products) {
      expect(row.unitsPerDay).toBeNull();
      expect(row.daysSinceLastSale).toBeNull();
      expect(row.lastSaleDay).toBeNull();
    }
  });

  it('bez pokrytia sa dotaz na kusy ani nespustí', async () => {
    resetRateLimiter();
    const world = makeDeps({ syncDays: [] });
    const handler = createSalesGet(world.deps, routeDeps());
    await handler(new Request(`${APP_ORIGIN}/api/sales`, { method: 'GET' }));
    expect(world.unitsQueries).toBe(0);
  });

  it('deň v stave `pending` nie je pokrytie, ale čas synchronizácie hlási', async () => {
    const res = await call({ syncDays: [syncDay('2026-08-05', 'pending')] });
    expect(res.body.data!.coverage.hasData).toBe(false);
    expect(res.body.data!.coverage.lastSyncedAt).toBe('2026-08-05T23:30:00.000Z');
  });

  it('vypnutá synchronizácia je v odpovedi priznaná', async () => {
    const res = await call({ syncEnabled: false });
    expect(res.body.data!.coverage.syncEnabled).toBe(false);
  });
});

/* ══════════════════════ 3. Metriky s reálnymi dátami ══════════════════════ */

describe('GET /api/sales — kusy, kusy/deň, dni od posledného predaja', () => {
  const world: WorldOptions = {
    syncDays: ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map((d) => syncDay(d)),
    days: [
      { productId: 201, saleDay: '2026-08-02', unitsSold: 4 },
      { productId: 201, saleDay: '2026-08-05', unitsSold: 2 },
      { productId: 202, saleDay: '2026-08-03', unitsSold: 1 },
    ],
  };

  it('pokrytie hlási skutočné od–do, nie nastavené okno', async () => {
    const res = await call(world);
    expect(res.body.data!.coverage).toMatchObject({
      from: '2026-08-02',
      to: '2026-08-05',
      daysCovered: 4,
      daysPartial: 0,
      hasData: true,
      windowDays: 3,
    });
  });

  it('metriky sedia na produkt', async () => {
    const res = await call(world);
    const first = res.body.data!.products.find((p) => p.productId === 201)!;
    expect(first.unitsSold).toBe(6);
    expect(first.unitsPerDay).toBe(1.5);
    expect(first.lastSaleDay).toBe('2026-08-05');
    expect(first.daysSinceLastSale).toBe(1);
  });

  it('`not_found` produkt sa nevráti — v shope neexistuje', async () => {
    const res = await call({
      ...world,
      products: [depthRow(201), depthRow(202, { shopStatus: 'not_found' })],
    });
    expect(res.body.data!.products.map((p) => p.productId)).toEqual([201]);
  });

  it('čiastočne dopočítané dni sú v odpovedi rozlíšené (P6)', async () => {
    const res = await call({
      ...world,
      syncDays: [syncDay('2026-08-04'), syncDay('2026-08-05', 'partial')],
    });
    expect(res.body.data!.coverage.daysCovered).toBe(2);
    expect(res.body.data!.coverage.daysPartial).toBe(1);
  });

  it('deň, na ktorom sťahovanie spadlo skôr než čokoľvek prinieslo, pokrytie NIE JE', async () => {
    const res = await call({
      ...world,
      syncDays: [syncDay('2026-08-04'), syncDay('2026-08-05', 'partial', 0)],
    });
    expect(res.body.data!.coverage.daysCovered).toBe(1);
    expect(res.body.data!.coverage.daysPartial).toBe(0);
  });

  it('odpoveď neobsahuje peniaze, krajinu ani nič zákaznícke (I8′ bod 3, P4)', async () => {
    const res = await call(world);
    const json = JSON.stringify(res.body.data);
    for (const forbidden of [
      'total_paid',
      'totalPaid',
      'country',
      'krajina',
      'email',
      'phone',
      'address',
      'orderId',
      'invoice',
      'price',
      'revenue',
      'obrat',
    ]) {
      expect(json.toLowerCase(), `odpoveď nesmie nesť ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it('odpoveď nikde nehovorí o obrátkovosti', async () => {
    const res = await call(world);
    expect(JSON.stringify(res.body.data).toLowerCase()).not.toContain('obrátkov');
  });
});
