/**
 * Aura Zľavy — TESTY NOVÝCH CIEST V8 (`/api/catalog/search`, `/api/queue`,
 * `/api/settings/scope-mode`).
 *
 * Čo sa tu dokazuje a prečo práve to:
 *
 *  1. **K8 — zamknuté filtre.** Route vráti `{ locked: true }` za KAŽDÝ filter
 *     bez dát a filter, ktorý klient poslal, sa NEDOSTANE do repozitára.
 *     Bez tohto testu by stačilo jedno „veď to zatiaľ ignorujeme" a používateľ
 *     by dostal výsledok filtra, ktorý filter nikdy nevidel.
 *  2. **K2 — stav fronty.** `/api/queue` počíta „koľko dnes z rozpočtu",
 *     „koľko vo fronte" a odhad dobehnutia z DB, nie z in-process stavu
 *     schedulera (ten je v Next.js iný module graph — pasca z CLAUDE.md).
 *  3. **K1 bod 4 — asymetria rozsahu.** Do 27. 8. 2026 od nej záviselo, či sa
 *     vypýta heslo (uvoľnenie chcelo sudo). Sudo zrušilo D100, ROZLÍŠENIE ale
 *     zostalo: každá zmena je v audite so starou aj novou hodnotou a s tým, či
 *     rozsah ROZŠÍRILA (`looseningScope`) alebo zúžila. Bez toho sa o pol roka
 *     z auditu nedá zistiť, kto appku pustil z pilota do plného režimu.
 *
 * Na shop neodíde ani jeden request — všetky tri cesty sú lokálne (I6 tým
 * zostáva nedotknuté aj bez mock servera).
 *
 * Vlastník: V8.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { AuditInput } from '@/contracts';

import {
  createCatalogSearchRoute,
  type CatalogSearchRouteDeps,
} from '@/app/api/catalog/search/route';
import { createQueueRoute } from '@/app/api/queue/route';
import { createScopeModeRoute } from '@/app/api/settings/scope-mode/route';
import type { BudgetStatus } from '@/lib/engine/budget';
import type {
  CatalogCounts,
  CatalogSearchFilter,
  CatalogSearchResult,
  CatalogSearchRow,
  LockedCatalogFilter,
} from '@/lib/repo/catalog.repo';
import { FAIL_CLOSED_SCOPE, PILOT_MAX_PRODUCTS, type ScopeMode } from '@/lib/repo/settings.repo';

import { makeRequest, parse, actorRouteDeps } from './routes-harness';

/* ═══════════════════════ 1. `/api/catalog/search` (K8) ════════════════════ */

const LOCKED: LockedCatalogFilter[] = [
  'stock',
  'category',
  'metal',
  'jewelryType',
  'margin',
  'turnover',
];

function catalogFake(): {
  repo: CatalogSearchRouteDeps['catalog'];
  searched: CatalogSearchFilter[];
} {
  const searched: CatalogSearchFilter[] = [];
  return {
    searched,
    repo: {
      async search(filter: CatalogSearchFilter): Promise<CatalogSearchResult> {
        searched.push(filter);
        return {
          data: [],
          page: filter.page ?? 1,
          perPage: filter.perPage ?? 50,
          total: 0,
          soldWindowDays: 180,
          soldFrom: '2026-02-11',
          soldTo: '2026-08-10',
          soldCoverage: { windowDays: 180, completeDays: 180, unknownDays: 0 },
          lockedFilters: [...LOCKED],
          enrichedOnly: [],
        };
      },
      async counts(filter: CatalogSearchFilter): Promise<CatalogCounts> {
        searched.push(filter);
        return {
          total: 0,
          sold: { none: 0, low: 0, mid: 0, high: 0 },
          soldUnknown: 0,
          neverDiscounted: 0,
          discountedNow: 0,
          shopDiscountedNow: 0,
          enrichedRows: 0,
          soldWindowDays: filter.soldWindowDays ?? 180,
          soldFrom: '2026-02-11',
          soldTo: '2026-08-10',
          lockedFilters: [...LOCKED],
          enrichedOnly: [],
        };
      },
      async totalRows(): Promise<number> {
        return 40_483;
      },
      async lastFetchedAt(): Promise<Date | null> {
        return new Date('2026-08-10T01:00:00.000Z');
      },
    },
  };
}

/* ═══════════ 1b. D121 — `unitsSold: null` prežije až do odpovede ══════════ */

/*
 * MEDZERA, KTORÚ TENTO SÚBOR ZAVIERA (31. 8. 2026).
 *
 * Serverovú polovicu D121 kryl `predaje-brana-pokrytia.spec.ts`, ale ten meria
 * REPOZITÁR (`search()`, `factsFor()`). Prepis riadku na odpoveď robí route
 * (`mirrorRowView()`), a ten testovaný nebol: mutácia `unitsSold: row.unitsSold`
 * → `row.unitsSold ?? 0` nechala CELÝ balík zelený. Nula pritom znamená vedro
 * „0 predaných", a z neho 30 % zľavu na produkte, ktorý appka nikdy nezmerala.
 */
type CatalogDep = NonNullable<CatalogSearchRouteDeps['catalog']>;

function catalogWithRows(rows: readonly CatalogSearchRow[]): CatalogDep {
  const base = catalogFake().repo as CatalogDep;
  return {
    ...base,
    async search(filter: CatalogSearchFilter): Promise<CatalogSearchResult> {
      const result = await base.search(filter);
      return { ...result, data: [...rows], total: rows.length };
    },
  };
}

function mirrorRow(productId: number, unitsSold: number | null): CatalogSearchRow {
  return {
    productId,
    name: `Produkt ${productId}`,
    price: '19.90',
    hasAttributes: false,
    source: 'list',
    fetchedAt: new Date('2026-08-30T01:00:00.000Z'),
    raw: null,
    shopStatus: 'ok',
    unitsSold,
    everDiscounted: false,
    discountedNow: false,
  };
}

describe('GET /api/catalog/search — „nevieme" sa v odpovedi nemení na nulu (D121, I11)', () => {
  it('`unitsSold: null` z repozitára odchádza ako `null`, nie ako `0`', async () => {
    const route = createCatalogSearchRoute({
      catalog: catalogWithRows([mirrorRow(90501, null), mirrorRow(90502, 4), mirrorRow(90503, 0)]),
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(
      await route(makeRequest('GET', '/api/catalog/search?soldWindowDays=180&counts=0')),
    );
    expect(res.status).toBe(200);

    const rows = (res.body.data as { data: readonly { productId: number; unitsSold: unknown }[] })
      .data;
    const soldOf = (productId: number): unknown =>
      rows.find((row) => row.productId === productId)?.unitsSold;

    // „Za toto okno to nevieme" — pomlčka na povrchu, `null` na drôte.
    expect(soldOf(90501)).toBeNull();
    // Meraná hodnota prejde nezmenená…
    expect(soldOf(90502)).toBe(4);
    // …a meraná NULA je tiež fakt, takže sa na `null` nemení ani ona.
    expect(soldOf(90503)).toBe(0);

    // A explicitne to, čo mutácia `?? 0` spôsobí: nula tam, kde má byť `null`.
    expect(soldOf(90501)).not.toBe(0);
  });

  it('v route nestojí ani jedno `?? 0` nad `unitsSold` — brána sa nedá obnoviť ticho', () => {
    /*
     * Tvarová závora nad OBOMA miestami prepisu (riadok zrkadla aj riadok
     * dotiahnutý zo shopu cez `?lookup=1`). Druhé z nich sa integračne dosahuje
     * len s celou lookup mechanikou, takže tu stojí grep — rovnako, ako repo
     * grepuje `setReduction`.
     */
    const source = readFileSync(
      fileURLToPath(new URL('../../src/app/api/catalog/search/route.ts', import.meta.url)),
      'utf8',
    );
    const suspicious = source
      .split(/\r?\n/)
      // Komentáre o tej mutácii tam stáť SMÚ — práve ony jej bránia vrátiť sa.
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .filter((line) => line.includes('unitsSold') && line.includes('?? 0'));
    expect(suspicious).toEqual([]);
  });
});

describe('GET /api/catalog/search — zamknuté filtre (K8)', () => {
  it('vráti `locked: true` za každý filter bez dát a poslaný filter NEAPLIKUJE', async () => {
    const { repo, searched } = catalogFake();
    const route = createCatalogSearchRoute({ catalog: repo, routeDeps: actorRouteDeps() });

    const res = await parse(
      await route(
        makeRequest(
          'GET',
          '/api/catalog/search?q=prsten&category=prstene&margin=40&soldBuckets=none,low&page=2',
        ),
      ),
    );
    expect(res.status).toBe(200);

    const data = res.body.data as {
      lockedFilters: Record<string, { locked: boolean; requested: boolean }>;
      catalogTotal: number;
      dataAsOf: string | null;
      discountSource: string;
      soldWindowDays: number;
    };

    // Každý zamknutý filter je v odpovedi a je zamknutý — aj ten, o ktorý si
    // nikto nepýtal (UI ho má kresliť sivý, nie skrytý).
    for (const key of LOCKED) {
      expect(data.lockedFilters[key]?.locked).toBe(true);
    }
    // Poslané zamknuté filtre sú označené ako poslané…
    expect(data.lockedFilters.category?.requested).toBe(true);
    expect(data.lockedFilters.margin?.requested).toBe(true);
    expect(data.lockedFilters.metal?.requested).toBe(false);

    // …a do repozitára sa NEDOSTALI. Kľúč `category` v filtri neexistuje ani
    // ako `undefined`; keby sa filter aplikoval, výsledok by bol iný než ten,
    // o ktorý si používateľ pýtal, a on by o tom nevedel (K8).
    expect(searched).toHaveLength(2); // `search()` + `counts()`
    for (const filter of searched) {
      expect(Object.keys(filter)).not.toContain('category');
      expect(Object.keys(filter)).not.toContain('margin');
    }
    // Filtre, na ktoré dáta MÁME, prejdú nezmenené.
    expect(searched[0]?.query).toBe('prsten');
    expect(searched[0]?.soldBuckets).toEqual(['none', 'low']);
    expect(searched[0]?.page).toBe(2);

    // P7 — „Dáta k …" je meraný fakt z katalógu, nie odhad.
    expect(data.dataAsOf).toBe('2026-08-10T01:00:00.000Z');
    expect(data.catalogTotal).toBe(40_483);
    // I11 — „v zľave" znamená „podľa vlastného zápisu", nie podľa shopu.
    expect(data.discountSource).toBe('own_writes');
    expect(data.soldWindowDays).toBe(180);
  });

  it('neznáme hodnoty filtrov ticho zahodí, nezmení nimi zmysel otázky', async () => {
    const { repo, searched } = catalogFake();
    const route = createCatalogSearchRoute({ catalog: repo, routeDeps: actorRouteDeps() });

    const res = await parse(
      await route(
        makeRequest(
          'GET',
          '/api/catalog/search?soldBuckets=vymyslene&shopStatus=nezmysel&sort=DROP%20TABLE&counts=0',
        ),
      ),
    );
    expect(res.status).toBe(200);
    expect(searched).toHaveLength(1); // `counts=0` druhý dotaz nespustí
    expect(searched[0]?.soldBuckets).toBeUndefined();
    expect(searched[0]?.shopStatus).toBeUndefined();
    // Triedenie ide výhradne cez whitelist repozitára — nič iné sa nepredá ďalej.
    expect(searched[0]?.sort).toBeUndefined();
    expect((res.body.data as { counts: unknown }).counts).toBeNull();
  });
});

/* ═══════════════════════════ 2. `/api/queue` (K2) ═════════════════════════ */

const campaignRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  operationId: '01J000000000000000000QUEUE',
  name: 'Ležiaky striebro — jeseň',
  kind: 'new' as const,
  parentCampaignId: null,
  percent: 30,
  dateFrom: '2026-09-04',
  dateTo: '2026-09-18',
  dateFromOriginal: null,
  mode: 'eager' as const,
  status: 'running' as const,
  statusReason: null,
  late: false,
  fireAt: null,
  scheduledAt: null,
  needsKeySince: null,
  claimedAt: null,
  startedAt: null,
  finishedAt: null,
  itemsTotal: 8000,
  itemsOk: 3408,
  itemsFailed: 12,
  itemsUncertain: 0,
  confirmedAt: new Date(),
  confirmPayloadHash: 'a'.repeat(64),
  sudoAt: new Date(),
  resultAckAt: null,
  createdBy: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('GET /api/queue — stav fronty (K2, K5)', () => {
  const budgetStatus: BudgetStatus = {
    day: '2026-08-10',
    budget: 200,
    spent: 100,
    remaining: 100,
    exhausted: false,
  };

  it('povie koľko sa dnes zapísalo, koľko čaká, dokedy to potrvá a čoho sa to týka', async () => {
    const route = createQueueRoute({
      campaigns: {
        findRunningUnfinished: async () => [campaignRow()],
        findQueued: async () => [],
      } as never,
      items: {
        queueTotals: async () => ({ pending: 4580, total: 8000, campaigns: 1 }),
      } as never,
      schedulerState: {
        get: async () => ({
          id: 1 as const,
          lastTickAt: new Date('2026-08-10T11:39:00.000Z'),
          lastTickDurationMs: 12,
          tickCount: 5,
          lastError: null,
          updatedAt: new Date('2026-08-10T11:39:00.000Z'),
        }),
      },
      budget: {
        spentToday: async () => budgetStatus.spent,
        remainingToday: async () => budgetStatus,
      },
      gate: () => ({ paused: false, reason: null, since: null, downtimeMs: null }),
      lastRun: () => null,
      now: () => new Date('2026-08-10T11:40:00.000Z'),
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(await route(makeRequest('GET', '/api/queue')));
    expect(res.status).toBe(200);

    const data = res.body.data as {
      budget: BudgetStatus;
      queue: { pending: number; total: number; done: number; campaigns: number };
      current: { name: string; itemsPending: number; late: boolean } | null;
      estimate: { days: number; date: string; perDay: number } | null;
      heartbeat: { stale: boolean };
      gate: { paused: boolean; bestEffort: true };
    };

    // Rozpočet a fronta idú z DB, nie z in-process stavu schedulera.
    expect(data.budget.spent).toBe(100);
    expect(data.budget.budget).toBe(200);
    expect(data.queue).toEqual({ pending: 4580, total: 8000, done: 3420, campaigns: 1 });

    // Číslam vo fronte dáva meno zľava, ktorá sa práve zapisuje.
    expect(data.current?.name).toBe('Ležiaky striebro — jeseň');
    expect(data.current?.itemsPending).toBe(8000 - 3408 - 12);
    expect(data.current?.late).toBe(false);

    // K5 — odhad: dnes ešte 100, potom 200/deň. 4 580 − 100 = 4 480 → 23 dní.
    expect(data.estimate?.perDay).toBe(200);
    expect(data.estimate?.days).toBe(Math.ceil((4580 - 100) / 200));

    // Heartbeat je fakt z DB; brána je len best-effort (iný module graph).
    expect(data.heartbeat.stale).toBe(false);
    expect(data.gate.bestEffort).toBe(true);
  });

  it('bez čitateľného rozpočtu si odhad NEVYMYSLÍ (P7)', async () => {
    const route = createQueueRoute({
      campaigns: {
        findRunningUnfinished: async () => [],
        findQueued: async () => [campaignRow({ status: 'queued', late: true })],
      } as never,
      items: {
        queueTotals: async () => ({ pending: 10, total: 10, campaigns: 1 }),
      } as never,
      schedulerState: {
        get: async () => {
          throw new Error('DB je preč');
        },
      },
      budget: {
        spentToday: async () => 0,
        remainingToday: async () => {
          throw new Error('rozpočet sa nedá prečítať');
        },
      },
      gate: () => ({ paused: true, reason: 'pc_downtime', since: null, downtimeMs: null }),
      lastRun: () => null,
      now: () => new Date('2026-08-10T11:40:00.000Z'),
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(await route(makeRequest('GET', '/api/queue')));
    expect(res.status).toBe(200);
    const data = res.body.data as {
      budget: unknown;
      estimate: unknown;
      current: { late: boolean };
      heartbeat: { stale: boolean; lastTickAt: string | null };
    };
    expect(data.budget).toBeNull();
    expect(data.estimate).toBeNull();
    // K5 — príznak meškania sa nesie ďalej, aj keď rozpočet nevieme prečítať.
    expect(data.current.late).toBe(true);
    // Bez heartbeatu je fronta preukázateľne stojaca — fail-closed smerom k UI.
    expect(data.heartbeat.lastTickAt).toBeNull();
    expect(data.heartbeat.stale).toBe(true);
  });
});

/* ═════════════════ 3. `/api/settings/scope-mode` (K1 bod 4) ═══════════════ */

function scopeFake(initial: ScopeMode, initialMaxProducts = 10_000) {
  let mode: ScopeMode = initial;
  let maxProducts = initialMaxProducts;
  const audit: AuditInput[] = [];
  return {
    audit,
    get mode(): ScopeMode {
      return mode;
    },
    deps: {
      settings: {
        readScope: async () => ({
          mode,
          maxProductsPerCampaign: maxProducts,
          dailyWriteBudget: 200,
          failClosed: false,
        }),
        setScopeMode: async (next: ScopeMode) => {
          mode = next;
        },
        setMaxProductsPerCampaign: async (value: number) => {
          maxProducts = value;
        },
      },
      audit: async (input: AuditInput) => {
        audit.push(input);
      },
    },
  };
}

describe('POST /api/settings/scope-mode — uvoľnenie sa musí dať prečítať z auditu (K1 bod 4)', () => {
  /*
   * Test „`pilot → plny` bez sudo okna NEPREJDE" tu stál do 27. 8. 2026. Sudo
   * zrušilo D100, takže brána, ktorú tvrdil, už neexistuje — a tvrdiť ju ďalej
   * by znamenalo tvrdiť o produkčnej ceste nepravdu. Čo z K1 bodu 4 pretrváva,
   * je ROZLÍŠENIE uvoľnenia od sprísnenia v audite, a to strážia testy nižšie.
   * Vrátane zdvihnutia stropu v rámci `plny`: to je tiež rozšírenie rozsahu
   * a bolo to práve to, čo si sudo pýtalo aj bez zmeny režimu.
   */
  it('zdvihnutie stropu v rámci `plny` je UVOĽNENIE a audit to tak zapíše', async () => {
    const world = scopeFake('plny', 500);
    const route = createScopeModeRoute({
      ...world.deps,
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(
      await route(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 5_000,
          confirmed: true,
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect((res.body.data as { looseningScope: boolean }).looseningScope).toBe(true);
    expect((res.body.data as { maxProducts: number }).maxProducts).toBe(5_000);

    expect(world.audit).toHaveLength(1);
    const event = world.audit[0] as AuditInput;
    expect((event.beforeSnapshot as { effectiveMaxProducts: number }).effectiveMaxProducts).toBe(500);
    expect((event.afterSnapshot as { effectiveMaxProducts: number }).effectiveMaxProducts).toBe(5_000);
    expect((event.afterSnapshot as { looseningScope: boolean }).looseningScope).toBe(true);
  });

  it('zníženie stropu v rámci `plny` je SPRÍSNENIE a audit to tak zapíše', async () => {
    const world = scopeFake('plny', 5_000);
    const route = createScopeModeRoute({
      ...world.deps,
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(
      await route(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 500,
          confirmed: true,
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect((res.body.data as { looseningScope: boolean }).looseningScope).toBe(false);
    expect((world.audit[0]?.afterSnapshot as { looseningScope: boolean }).looseningScope).toBe(
      false,
    );
  });

  it('`pilot → plny` prejde a zapíše audit so starou aj novou hodnotou', async () => {
    const world = scopeFake('pilot');
    const route = createScopeModeRoute({
      ...world.deps,
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(
      await route(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 8000,
          confirmed: true,
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect((res.body.data as { scopeMode: string }).scopeMode).toBe('plny');
    expect((res.body.data as { maxProducts: number }).maxProducts).toBe(8000);
    expect(world.mode).toBe('plny');

    expect(world.audit).toHaveLength(1);
    const event = world.audit[0] as AuditInput;
    expect(event.eventType).toBe('scope_mode_changed');
    expect((event.beforeSnapshot as { scopeMode: string }).scopeMode).toBe('pilot');
    expect((event.afterSnapshot as { scopeMode: string }).scopeMode).toBe('plny');
    // Rozšírenie rozsahu sa musí dať z auditu prečítať ako rozšírenie (K1 bod 4)
    // a musí mať actora — po zrušení prihlásenia je to `samuel`, id 1 (D102, I11).
    expect((event.afterSnapshot as { looseningScope: boolean }).looseningScope).toBe(true);
    expect(event).toMatchObject({ actor: 'user', userId: 1 });
  });

  it('`plny → pilot` je sprísnenie — prejde vždy a audit ho tak označí', async () => {
    const world = scopeFake('plny');
    const route = createScopeModeRoute({
      ...world.deps,
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(
      await route(makeRequest('POST', '/api/settings/scope-mode', { mode: 'pilot' })),
    );
    expect(res.status).toBe(200);
    expect(world.mode).toBe('pilot');
    expect((res.body.data as { maxProducts: number }).maxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(world.audit).toHaveLength(1);
    expect((world.audit[0]?.afterSnapshot as { looseningScope: boolean }).looseningScope).toBe(
      false,
    );
  });

  it('fail-closed default z V4 je `pilot` so stropom 10 (K1 bod 1)', () => {
    expect(FAIL_CLOSED_SCOPE.mode).toBe('pilot');
    expect(FAIL_CLOSED_SCOPE.maxProductsPerCampaign).toBe(PILOT_MAX_PRODUCTS);
  });
});
