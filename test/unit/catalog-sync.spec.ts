/**
 * Aura Zľavy — synchronizácia katalógu a jej spúšťač
 * (V7; KONTRAKT V3 K7; KONTRAKT-DOKONCENIE-2026-08-12 A2–A5).
 *
 * Čo sa tu drží:
 *  - stránkovanie ide SEKVENČNE a beh POKRAČUJE tam, kde skončil (A2) — bez
 *    toho sa chvost 411-stránkového katalógu neprečíta nikdy,
 *  - beh sa zastaví PRED prekročením denného rozpočtu čítaní (A4) a skončí
 *    pokojne s časom, kedy pokračuje (polnoc UTC), nie chybou,
 *  - 429 pozastaví CELÝ beh podľa `Retry-After` (A3), neopakuje jednu stránku,
 *  - synchronizácia je ČÍTANIE: v module sa nevyskytuje `setReduction` ani
 *    `write_attempt`, takže nemá ako minúť zápisový rozpočet (K7 vs. K2),
 *  - zlyhanie uprostred nechá zapísané riadky platné (`partial`) a NIKDY
 *    nehádže,
 *  - shop, ktorý ignoruje `page`, sa nezacyklí,
 *  - spúšťač beží mimo špičky, ale „raz denne" nesmie znamenať „nikdy" na
 *    počítači, ktorý je v noci vypnutý — a nedokončený prechod nesmie čakať na
 *    nočné okno vôbec.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Paged, ProductListItem, ShopCtx } from '@/contracts';

import { todayInZone } from '@/lib/domain/dates';
import {
  DEFAULT_CATALOG_PER_PAGE,
  emptyCatalogProgress,
  type CatalogSyncProgress,
  type CatalogUpsertInput,
} from '@/lib/repo/catalog.repo';
import {
  isOffPeak,
  resetCatalogRunnerState,
  runCatalogSyncIfDue,
  runCatalogSyncNow,
  CATALOG_MIN_INTERVAL_MS,
  CATALOG_STALE_MS,
} from '@/lib/scheduler/catalog-runner';
import {
  syncCatalog,
  toCatalogRow,
  CATALOG_PAGE_SIZE,
  type CatalogProgressStore,
  type CatalogReadBudgetGate,
  type CatalogSyncSink,
} from '@/lib/shop/catalog-sync';
import { makeShopError, ShopRequestError } from '@/lib/shop/errors';
import { ANON_READS_PER_UTC_DAY, MIN_ANON_READ_PAUSE_MS } from '@/lib/shop/rate-limits';
import {
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudgetStore,
} from '@/lib/shop/read-budget';

/* ───────────────────────────── fake shop a sink ────────────────────────── */

const product = (id: number): ProductListItem => ({
  id,
  name: `Šperk ${id}`,
  price: 19.9,
  has_attributes: false,
});

interface FakeShop {
  listProducts(params: { page?: number; perPage?: number }, ctx: ShopCtx): Promise<Paged<ProductListItem>>;
  pagesRequested: number[];
}

interface FakeShopOptions {
  stuck?: boolean;
  failOnPage?: number;
  /** Stránka, na ktorej shop vráti 429 (s `Retry-After` v sekundách). */
  rateLimitOnPage?: number;
  retryAfterSeconds?: number;
}

function fakeShop(total: number, opts: FakeShopOptions = {}): FakeShop {
  const all = Array.from({ length: total }, (_, index) => product(1000 + index));
  const pagesRequested: number[] = [];
  return {
    pagesRequested,
    async listProducts(params) {
      const page = params.page ?? 1;
      const perPage = params.perPage ?? 100;
      pagesRequested.push(page);
      if (opts.failOnPage === page) throw new Error('shop_unreachable');
      if (opts.rateLimitOnPage === page) {
        throw new ShopRequestError(
          makeShopError({
            kind: 'rate_limited',
            httpStatus: 429,
            ...(opts.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: opts.retryAfterSeconds }
              : {}),
          }),
        );
      }
      const start = opts.stuck === true ? 0 : (page - 1) * perPage;
      return { data: all.slice(start, start + perPage), page, perPage, total: all.length };
    },
  };
}

/**
 * Katalóg v pamäti: zápis riadkov + TRVALÝ pokrok (prežije „reštart", teda ďalší
 * beh nad tou istou inštanciou) + zdieľaný rozpočet čítaní.
 */
interface FakeCatalog
  extends CatalogSyncSink,
    CatalogProgressStore,
    CatalogReadBudgetGate {
  rows: Map<number, CatalogUpsertInput>;
  calls: number;
  progress: CatalogSyncProgress;
  reads: number;
  lastFetchedAt(): Promise<Date | null>;
}

interface FakeCatalogOptions {
  failOnCall?: number;
  /** Kedy „teraz" — rozpočet sa počíta na UTC deň. */
  now?: () => Date;
  /** Koľko čítaní už dnes minul niekto iný (napr. predajnosť). */
  readsAlreadyUsed?: number;
  /** Prepis úložiska rozpočtu (test zdieľania medzi dvoma spotrebiteľmi). */
  budgetStore?: ReadBudgetStore;
  /** Východiskový pokrok (napr. rozbehnutý prechod). */
  progress?: Partial<CatalogSyncProgress>;
  lastFetchedAt?: Date | null;
}

function fakeCatalog(opts: FakeCatalogOptions = {}): FakeCatalog {
  const now = opts.now ?? ((): Date => new Date());
  const store = opts.budgetStore ?? createMemoryReadBudgetStore();
  const budget = createReadBudget({ store, lane: 'anon', now });
  const rows = new Map<number, CatalogUpsertInput>();

  if (opts.readsAlreadyUsed !== undefined && opts.readsAlreadyUsed > 0) {
    void store.add('anon', todayInZone(now(), 'UTC'), opts.readsAlreadyUsed);
  }

  const catalog: FakeCatalog = {
    rows,
    calls: 0,
    reads: 0,
    progress: { ...emptyCatalogProgress(), ...opts.progress },

    async upsertMany(records: CatalogUpsertInput[]): Promise<number> {
      catalog.calls += 1;
      if (opts.failOnCall === catalog.calls) throw new Error('DB je preč');
      for (const record of records) rows.set(record.productId, record);
      return records.length;
    },

    async loadSyncProgress(): Promise<CatalogSyncProgress> {
      return { ...catalog.progress };
    },

    async saveSyncProgress(progress: CatalogSyncProgress): Promise<void> {
      catalog.progress = { ...progress };
    },

    async reserveShopReads(count = 1) {
      const reservation = await budget.reserve(count);
      catalog.reads += reservation.granted;
      return reservation;
    },

    async lastFetchedAt(): Promise<Date | null> {
      return opts.lastFetchedAt ?? null;
    },
  };

  return catalog;
}

const noSleep = async (): Promise<void> => undefined;

/* ═════════════════════════════ mapovanie riadku ═══════════════════════════ */

describe('toCatalogRow — riadok katalógu', () => {
  it('cena ide do DECIMAL ako string, nie ako float', () => {
    const fetchedAt = new Date('2026-08-10T10:00:00.000Z');
    const row = toCatalogRow({ id: 42, name: 'Prsteň', price: 1234.5, has_attributes: true }, fetchedAt);

    expect(row.price).toBe('1234.50');
    expect(typeof row.price).toBe('string');
    expect(row.productId).toBe(42);
    expect(row.hasAttributes).toBe(true);
    expect(row.source).toBe('list');
    // K1 bod 2 — produkt, ktorý zoznam vrátil, v shope existuje.
    expect(row.shopStatus).toBe('ok');
    // K7 — `fetched_at` je meraný fakt, nie odhad.
    expect(row.fetchedAt).toBe(fetchedAt);
  });

  it('krátka stránka uprostred katalógu NIE JE koniec — je to výpadok', async () => {
    // Našli obaja recenzenti 12. 8. nezávisle: shop na strane 2 z 5 vráti
    // prázdnu alebo neúplnú stránku (deploy, chyba stránkovania) a beh to
    // označí za „dočítané". Chvost katalógu sa tým zahodí a appka o polovici
    // dát tvrdí, že má všetko — presne to, čo I11 zakazuje.
    const shop = fakeShop(23);
    const povodne = shop.listProducts.bind(shop);
    let volanie = 0;
    const dieravy = {
      pagesRequested: shop.pagesRequested,
      async listProducts(params: { page?: number; perPage?: number }, ctx: ShopCtx) {
        volanie += 1;
        // Druhá stránka príde prázdna, hoci `total` hovorí 23.
        if (volanie === 2) return { data: [], page: params.page ?? 1, perPage: 5, total: 23 };
        return povodne(params, ctx);
      },
    };
    const catalog = fakeCatalog();

    const result = await syncCatalog({
      shopClient: dieravy,
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(catalog.progress.completed).toBe(false);
    expect(result.outcome).not.toBe('ok');
    expect(catalog.progress.lastError).toBe('short_page');
  });

  it('zrkadlená veľkosť stránky v repozitári sa nerozišla s modulom', () => {
    // `catalog.repo.ts` si `CATALOG_PAGE_SIZE` zrkadlí, aby nezáviselo na module
    // synchronizácie. Keby sa čísla rozišli, pokrok by ukazoval na iné stránky.
    expect(DEFAULT_CATALOG_PER_PAGE).toBe(CATALOG_PAGE_SIZE);
  });
});

/* ═════════════════════════════ stránkovanie ═══════════════════════════════ */

describe('syncCatalog — stránkovanie celého katalógu (K7)', () => {
  it('prejde všetky stránky sekvenčne a zapíše každý produkt práve raz', async () => {
    const shop = fakeShop(23);
    const catalog = fakeCatalog();

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      pausePerPageMs: 0,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('ok');
    expect(result.products).toBe(23);
    expect(result.total).toBe(23);
    expect(result.pages).toBe(5);
    expect(result.completed).toBe(true);
    expect(result.stoppedBy).toBe('done');
    expect(catalog.rows.size).toBe(23);
    // Stránky idú po sebe a v poradí — žiadny paralelný výbuch requestov.
    expect(shop.pagesRequested).toEqual([1, 2, 3, 4, 5]);
    // A4 — každé čítanie sa zaúčtovalo do zdieľaného rozpočtu.
    expect(catalog.reads).toBe(5);
  });

  it('prázdny katalóg je `empty`, nie chyba', async () => {
    const catalog = fakeCatalog();
    const result = await syncCatalog({
      shopClient: fakeShop(0),
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('empty');
    expect(result.products).toBe(0);
    expect(result.error).toBeNull();
  });

  it('shop, ktorý ignoruje `page`, sa nezacyklí', async () => {
    const shop = fakeShop(50, { stuck: true });
    const catalog = fakeCatalog();

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      maxPages: 100,
      sleepFn: noSleep,
    });

    expect(result.error).toBe('pagination_stuck');
    expect(result.outcome).toBe('partial');
    // Druhá stránka odhalila, že sa nič neposunulo — ďalej sa nešlo.
    expect(shop.pagesRequested).toEqual([1, 2]);
  });

  it('výpadok shopu uprostred nechá zapísané riadky platné (partial) a nehádže', async () => {
    const shop = fakeShop(23, { failOnPage: 3 });
    const catalog = fakeCatalog();

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('partial');
    expect(result.error).toContain('shop_unreachable');
    expect(result.products).toBe(10);
    expect(catalog.rows.size).toBe(10);
    // A2 — pokrok ostal na poslednej ÚSPEŠNE zapísanej stránke.
    expect(catalog.progress.lastPage).toBe(2);
    expect(catalog.progress.completed).toBe(false);
  });

  it('zlyhanie prvej stránky je `failed`, nie výnimka', async () => {
    const catalog = fakeCatalog();
    const result = await syncCatalog({
      shopClient: fakeShop(23, { failOnPage: 1 }),
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('failed');
    expect(result.products).toBe(0);
  });

  it('zlyhanie zápisu do DB zastaví beh, ale nezhodí ho', async () => {
    const catalog = fakeCatalog({ failOnCall: 2 });
    const result = await syncCatalog({
      shopClient: fakeShop(23),
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('partial');
    expect(result.error).toContain('upsert_failed');
    expect(result.products).toBe(5);
  });

  it('medzi stránkami sa čaká — anonymný limit shopu je 30/min a 300/UTC deň', async () => {
    const pauses: number[] = [];
    const catalog = fakeCatalog();
    await syncCatalog({
      shopClient: fakeShop(12),
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      // Zámerne podliezame podlahu — modul ju musí zdvihnúť späť. Kratšia
      // pauza znamená viac než 24 volaní za minútu, čo shop odmení banom.
      pausePerPageMs: 250,
      sleepFn: async (ms) => {
        pauses.push(ms);
      },
    });

    // Tri stránky = dve pauzy; po poslednej sa nečaká.
    expect(pauses).toEqual([MIN_ANON_READ_PAUSE_MS, MIN_ANON_READ_PAUSE_MS]);
    expect(MIN_ANON_READ_PAUSE_MS).toBe(2_500);
  });
});

/* ══════════════ A2 — pokračovanie od poslednej stránky ════════════════════ */

describe('syncCatalog — pokračovanie od poslednej stránky (A2)', () => {
  it('druhý beh nezačína od stránky 1, ale tam, kde prvý skončil', async () => {
    const catalog = fakeCatalog();
    const first = fakeShop(50);

    const firstRun = await syncCatalog({
      shopClient: first,
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      maxPages: 3,
      sleepFn: noSleep,
    });

    expect(firstRun.stoppedBy).toBe('page_limit');
    expect(firstRun.completed).toBe(false);
    expect(firstRun.lastPage).toBe(3);
    expect(first.pagesRequested).toEqual([1, 2, 3]);

    // Druhý beh nad TOU ISTOU pamäťou — presne to, čo sa stane po reštarte appky.
    const second = fakeShop(50);
    const secondRun = await syncCatalog({
      shopClient: second,
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      maxPages: 3,
      sleepFn: noSleep,
    });

    expect(secondRun.startPage).toBe(4);
    expect(second.pagesRequested).toEqual([4, 5, 6]);
    expect(secondRun.lastPage).toBe(6);
  });

  it('tri dávky dočítajú celý katalóg a označia ho ako dokončený', async () => {
    const catalog = fakeCatalog();
    let last = null;
    for (let i = 0; i < 3; i += 1) {
      last = await syncCatalog({
        shopClient: fakeShop(50),
        catalog,
        progress: catalog,
        budget: catalog,
        perPage: 5,
        maxPages: 4,
        sleepFn: noSleep,
      });
    }

    expect(last?.completed).toBe(true);
    expect(catalog.rows.size).toBe(50);
    expect(catalog.progress.completed).toBe(true);
  });

  it('dokončený prechod začne ďalším behom odznova od stránky 1', async () => {
    const catalog = fakeCatalog();
    await syncCatalog({
      shopClient: fakeShop(12),
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      sleepFn: noSleep,
    });
    expect(catalog.progress.completed).toBe(true);

    const again = fakeShop(12);
    const result = await syncCatalog({
      shopClient: again,
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.startPage).toBe(1);
    expect(again.pagesRequested[0]).toBe(1);
  });

  it('zmena veľkosti stránky začne odznova — inak by beh preskočil kus katalógu', async () => {
    const catalog = fakeCatalog({ progress: { lastPage: 7, perPage: 5, completed: false } });
    const shop = fakeShop(50);

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      perPage: 10,
      maxPages: 1,
      sleepFn: noSleep,
    });

    expect(result.startPage).toBe(1);
    expect(shop.pagesRequested).toEqual([1]);
  });

  it('nečitateľný pokrok beh NESPUSTÍ — začať od stránky 1 by bola tá istá chyba', async () => {
    const shop = fakeShop(50);
    const catalog = fakeCatalog();

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: {
        async loadSyncProgress(): Promise<CatalogSyncProgress> {
          throw new Error('DB je preč');
        },
        async saveSyncProgress(): Promise<void> {
          /* nikdy sa nezavolá */
        },
      },
      budget: catalog,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('failed');
    expect(result.stoppedBy).toBe('error');
    expect(shop.pagesRequested).toHaveLength(0);
  });
});

/* ══════════════ A4 — denný rozpočet čítaní (zdieľaný) ═════════════════════ */

describe('syncCatalog — denný rozpočet čítaní (A4)', () => {
  const now = (): Date => new Date('2026-08-12T10:00:00.000Z');

  it('beh sa zastaví PRED prekročením denného stropu a povie, kedy pokračuje', async () => {
    // Rozpočet nechá voľné presne dve čítania.
    const catalog = fakeCatalog({ now, readsAlreadyUsed: ANON_READS_PER_UTC_DAY - 2 });
    const shop = fakeShop(50);

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      now,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(shop.pagesRequested).toEqual([1, 2]);
    expect(result.stoppedBy).toBe('daily_budget');
    // Minutý rozpočet NIE JE chyba.
    expect(result.error).toBeNull();
    expect(result.outcome).toBe('partial');
    expect(result.resumeAt?.toISOString()).toBe('2026-08-13T00:00:00.000Z');
    expect(catalog.progress.pauseReason).toBe('daily_budget');
    expect(catalog.progress.lastPage).toBe(2);
  });

  it('minutý rozpočet ešte pred prvou stránkou skončí ako `paused`, nie `failed`', async () => {
    const catalog = fakeCatalog({ now, readsAlreadyUsed: ANON_READS_PER_UTC_DAY });
    const shop = fakeShop(50);

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      now,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(shop.pagesRequested).toHaveLength(0);
    expect(result.outcome).toBe('paused');
    expect(result.stoppedBy).toBe('daily_budget');
    expect(result.error).toBeNull();
  });

  it('rozpočet je ZDIEĽANÝ — čo minie predajnosť, katalógu už nezostane', async () => {
    // Jedno úložisko, dvaja spotrebitelia: „predajnosť" (dráha `orders` má
    // vlastný strop, preto sa tu delíme o dráhu `anon`) a katalóg.
    const store = createMemoryReadBudgetStore();
    const other = createReadBudget({ store, lane: 'anon', now });
    const reserved = await other.reserve(ANON_READS_PER_UTC_DAY - 1);
    expect(reserved.granted).toBe(ANON_READS_PER_UTC_DAY - 1);

    const catalog = fakeCatalog({ now, budgetStore: store });
    const shop = fakeShop(50);

    await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      now,
      perPage: 5,
      sleepFn: noSleep,
    });

    // Zostalo jediné čítanie — katalóg prečítal presne jednu stránku.
    expect(shop.pagesRequested).toEqual([1]);
  });

  it('celý katalóg (41 082 produktov) sa dočíta počas dvoch UTC dní', async () => {
    // Akceptačné kritérium kontraktu: 411 stránok pri 240 povolených čítaniach
    // na deň je dvojdňový beh — a ten musí prežiť polnoc bez zásahu človeka.
    let clock = new Date('2026-08-12T06:00:00.000Z');
    const clockNow = (): Date => clock;
    const catalog = fakeCatalog({ now: clockNow });

    const dayOne = await syncCatalog({
      shopClient: fakeShop(41_082),
      catalog,
      progress: catalog,
      budget: catalog,
      now: clockNow,
      perPage: 100,
      sleepFn: noSleep,
    });

    expect(dayOne.pages).toBe(ANON_READS_PER_UTC_DAY);
    expect(dayOne.stoppedBy).toBe('daily_budget');
    expect(dayOne.completed).toBe(false);
    expect(dayOne.error).toBeNull();

    // Polnoc UTC — rozpočet je znova plný a beh pokračuje sám.
    clock = new Date('2026-08-13T06:00:00.000Z');
    const dayTwo = await syncCatalog({
      shopClient: fakeShop(41_082),
      catalog,
      progress: catalog,
      budget: catalog,
      now: clockNow,
      perPage: 100,
      sleepFn: noSleep,
    });

    expect(dayTwo.startPage).toBe(ANON_READS_PER_UTC_DAY + 1);
    expect(dayTwo.completed).toBe(true);
    expect(dayTwo.stoppedBy).toBe('done');
    expect(catalog.rows.size).toBe(41_082);
  });

  it('audit povie, že sa pokračuje po polnoci UTC — nie že sa niečo pokazilo', async () => {
    const catalog = fakeCatalog({ now, readsAlreadyUsed: ANON_READS_PER_UTC_DAY - 1 });
    const messages: Array<{ ok: boolean | null | undefined; message: string | null | undefined }> =
      [];

    await syncCatalog({
      shopClient: fakeShop(50),
      catalog,
      progress: catalog,
      budget: catalog,
      audit: {
        async appendAudit(input): Promise<void> {
          messages.push({ ok: input.ok, message: input.message });
        },
      },
      now,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ok).toBe(true);
    expect(messages[0]?.message).toContain('pokračujem po polnoci UTC');
    // Veta nesie aj to, KDE beh stojí — inak je pri dvojdňovom behu nečitateľná.
    expect(messages[0]?.message).toContain('z 10');
  });

  it('účtuje sa POKUS, nie úspech — neúspešné volanie tiež minie rozpočet', async () => {
    const catalog = fakeCatalog({ now });
    const result = await syncCatalog({
      shopClient: fakeShop(50, { failOnPage: 2 }),
      catalog,
      progress: catalog,
      budget: catalog,
      now,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.pages).toBe(1);
    // Dve rezervácie: úspešná stránka 1 aj neúspešná stránka 2.
    expect(catalog.reads).toBe(2);
  });
});

/* ══════════════ A3 — `Retry-After` pozastaví celý beh ═════════════════════ */

describe('syncCatalog — 429 pozastaví celý beh (A3)', () => {
  const now = (): Date => new Date('2026-08-12T10:00:00.000Z');

  it('stránku neopakuje trikrát, ale beh pozastaví do času z `Retry-After`', async () => {
    const catalog = fakeCatalog({ now });
    const shop = fakeShop(50, { rateLimitOnPage: 3, retryAfterSeconds: 45 });

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      now,
      perPage: 5,
      sleepFn: noSleep,
    });

    // Stránka 3 sa skúsila PRÁVE RAZ.
    expect(shop.pagesRequested).toEqual([1, 2, 3]);
    expect(result.stoppedBy).toBe('rate_limited');
    expect(result.error).toBeNull();
    expect(result.outcome).toBe('partial');
    expect(result.resumeAt?.toISOString()).toBe('2026-08-12T10:00:45.000Z');
    expect(catalog.progress.pauseReason).toBe('rate_limited');
    // Pokrok ostal pred spornou stránkou — vráti sa k nej po pauze.
    expect(catalog.progress.lastPage).toBe(2);
  });

  it('bez hlavičky `Retry-After` sa čaká celé minútové okno', async () => {
    const catalog = fakeCatalog({ now });
    const result = await syncCatalog({
      shopClient: fakeShop(50, { rateLimitOnPage: 1 }),
      catalog,
      progress: catalog,
      budget: catalog,
      now,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.resumeAt?.toISOString()).toBe('2026-08-12T10:01:00.000Z');
    expect(result.outcome).toBe('paused');
  });

  it('kým pauza beží, ďalší beh na shop vôbec nesiahne', async () => {
    const catalog = fakeCatalog({
      now,
      progress: {
        lastPage: 2,
        pausedUntil: new Date('2026-08-12T10:00:30.000Z'),
        pauseReason: 'rate_limited',
      },
    });
    const shop = fakeShop(50);

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      now,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(shop.pagesRequested).toHaveLength(0);
    expect(result.outcome).toBe('paused');
    expect(result.stoppedBy).toBe('rate_limited');
    expect(catalog.reads).toBe(0);
  });

  it('po vypršaní pauzy beh pokračuje tam, kde stál', async () => {
    const catalog = fakeCatalog({
      now,
      progress: {
        lastPage: 2,
        perPage: 5,
        pausedUntil: new Date('2026-08-12T09:59:00.000Z'),
        pauseReason: 'rate_limited',
      },
    });
    const shop = fakeShop(50);

    const result = await syncCatalog({
      shopClient: shop,
      catalog,
      progress: catalog,
      budget: catalog,
      now,
      perPage: 5,
      maxPages: 2,
      sleepFn: noSleep,
    });

    expect(shop.pagesRequested).toEqual([3, 4]);
    expect(result.startPage).toBe(3);
    expect(catalog.progress.pausedUntil).toBeNull();
  });
});

/* ═════════════ K7 vs. K2 — sync nesmie minúť zápisový rozpočet ════════════ */

describe('K7 — synchronizácia nekonzumuje zápisový rozpočet', () => {
  it('modul neobsahuje setReduction ani write_attempt', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/shop/catalog-sync.ts'),
      'utf8',
    );
    // Sken zdroja, nie správania: keby sem niekto pridal zápis alebo audit
    // event `write_attempt`, ticho by ukradol rozpočet fronte (K2) a žiadny
    // behový test by si toho nemusel všimnúť.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/setReduction/);
    expect(withoutComments).not.toMatch(/write_attempt/);
  });
});

/* ═══════════════════════════ okno mimo špičky ═════════════════════════════ */

describe('isOffPeak — okno sa počíta v miestnom čase, nikdy v UTC', () => {
  it('22:00 miestneho času je mimo špičky, 12:00 nie', () => {
    // August = UTC+2 v Bratislave.
    expect(isOffPeak(new Date('2026-08-05T20:00:00.000Z'))).toBe(true);
    expect(isOffPeak(new Date('2026-08-05T10:00:00.000Z'))).toBe(false);
  });

  it('okno prechádza polnocou — 05:00 miestneho času je stále mimo špičky', () => {
    expect(isOffPeak(new Date('2026-08-05T03:00:00.000Z'))).toBe(true);
    expect(isOffPeak(new Date('2026-08-05T05:30:00.000Z'))).toBe(false); // 07:30
  });

  it('v zime (UTC+1) sa okno posúva s časom, nie s UTC', () => {
    // 21:30 miestneho času v januári = 20:30 UTC.
    expect(isOffPeak(new Date('2026-01-15T20:30:00.000Z'))).toBe(true);
    expect(isOffPeak(new Date('2026-01-15T19:30:00.000Z'))).toBe(false); // 20:30
  });
});

/* ═════════════════════════════ spúšťač ════════════════════════════════════ */

describe('runCatalogSyncIfDue — kedy sa sync spustí (K7, A2)', () => {
  const peak = new Date('2026-08-05T10:00:00.000Z'); // 12:00 miestneho času
  const offPeak = new Date('2026-08-05T20:00:00.000Z'); // 22:00 miestneho času

  function deps(lastFetchedAt: Date | null, total = 12, progress?: Partial<CatalogSyncProgress>) {
    const shop = fakeShop(total);
    const catalog = fakeCatalog({
      lastFetchedAt,
      ...(progress !== undefined ? { progress } : {}),
    });
    return {
      shop,
      catalog,
      runner: {
        shopClient: shop,
        catalog,
        perPage: 5,
        pausePerPageMs: 0,
        sleepFn: noSleep,
      },
    };
  }

  beforeEach(() => {
    resetCatalogRunnerState();
  });

  it('prázdny katalóg sa načíta HNEĎ, aj v špičke — bez neho appka nemá z čoho vyberať', async () => {
    const { runner, catalog } = deps(null);

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('ran');
    expect(catalog.rows.size).toBe(12);
  });

  it('čerstvé dáta sa znova neťahajú', async () => {
    const { runner, catalog } = deps(new Date(peak.getTime() - 60_000));

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('too_soon');
    expect(catalog.calls).toBe(0);
  });

  it('NEDOKONČENÝ prechod pokračuje aj v špičke a aj pri čerstvých dátach', async () => {
    // Presne pôvodná chyba: `fetched_at` je čerstvé (práve sa zapísala stránka),
    // takže starý runner odpovedal „too_soon" a chvost katalógu sa nedočítal.
    const { runner, shop, catalog } = deps(new Date(peak.getTime() - 60_000), 50, {
      lastPage: 3,
      perPage: 5,
      completed: false,
    });

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('ran');
    expect(shop.pagesRequested[0]).toBe(4);
    expect(catalog.progress.lastPage).toBeGreaterThan(3);
  });

  it('prechod zastavený ešte pred prvou stránkou tiež pokračuje, nečaká 20 hodín', async () => {
    // Rozpočet sa minul skôr, než odišla prvá stránka: `lastPage` je 0, ale
    // prechod už beží. Bez tohto pravidla by čakal na 20-hodinový odstup.
    const { runner, shop } = deps(new Date(peak.getTime() - 60_000), 50, {
      lastPage: 0,
      perPage: 5,
      completed: false,
      startedAt: new Date(peak.getTime() - 3_600_000),
    });

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('ran');
    expect(shop.pagesRequested[0]).toBe(1);
  });

  it('pauza po 429 sa rešpektuje a runner povie, dokedy', async () => {
    const until = new Date(peak.getTime() + 30_000);
    const { runner, shop } = deps(new Date(peak.getTime() - 60_000), 50, {
      lastPage: 3,
      perPage: 5,
      pausedUntil: until,
      pauseReason: 'rate_limited',
    });

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('paused');
    expect(report.resumeAt?.getTime()).toBe(until.getTime());
    expect(shop.pagesRequested).toHaveLength(0);
  });

  it('minutý denný rozpočet je vlastný stav, nie chyba', async () => {
    const until = new Date('2026-08-06T00:00:00.000Z');
    const { runner, shop } = deps(new Date(peak.getTime() - 60_000), 50, {
      lastPage: 3,
      perPage: 5,
      pausedUntil: until,
      pauseReason: 'daily_budget',
    });

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('budget_exhausted');
    expect(report.resumeAt?.getTime()).toBe(until.getTime());
    expect(shop.pagesRequested).toHaveLength(0);
  });

  it('v špičke sa NOVÝ prechod nespustí, mimo špičky áno', async () => {
    const lastFetched = new Date(peak.getTime() - (CATALOG_MIN_INTERVAL_MS + 60_000));

    const inPeak = deps(lastFetched);
    expect((await runCatalogSyncIfDue(inPeak.runner, { now: peak })).outcome).toBe('peak_hours');
    expect(inPeak.catalog.calls).toBe(0);

    resetCatalogRunnerState();
    const outOfPeak = deps(new Date(offPeak.getTime() - (CATALOG_MIN_INTERVAL_MS + 60_000)));
    expect((await runCatalogSyncIfDue(outOfPeak.runner, { now: offPeak })).outcome).toBe('ran');
    expect(outOfPeak.catalog.rows.size).toBe(12);
  });

  it('staré dáta sa načítajú aj v špičke — počítač býva v noci vypnutý', async () => {
    const { runner, catalog } = deps(new Date(peak.getTime() - (CATALOG_STALE_MS + 60_000)));

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('ran');
    expect(catalog.rows.size).toBe(12);
  });

  it('zápisy majú prednosť — keď fronta pracuje, sync čaká', async () => {
    const { runner, catalog } = deps(new Date(offPeak.getTime() - (CATALOG_STALE_MS + 60_000)));

    const report = await runCatalogSyncIfDue(runner, { now: offPeak, queueBusy: true });

    expect(report.outcome).toBe('writes_first');
    expect(catalog.calls).toBe(0);
  });

  it('zápisy majú prednosť aj pred pokračovaním rozbehnutého prechodu', async () => {
    const { runner, shop } = deps(new Date(offPeak.getTime() - 60_000), 50, {
      lastPage: 3,
      perPage: 5,
      completed: false,
    });

    const report = await runCatalogSyncIfDue(runner, { now: offPeak, queueBusy: true });

    expect(report.outcome).toBe('writes_first');
    expect(shop.pagesRequested).toHaveLength(0);
  });

  it('po dokončenom prechode sa ďalší pokus odloží', async () => {
    const { runner, catalog } = deps(new Date(offPeak.getTime() - (CATALOG_STALE_MS + 60_000)));

    expect((await runCatalogSyncIfDue(runner, { now: offPeak })).outcome).toBe('ran');
    const second = await runCatalogSyncIfDue(runner, { now: new Date(offPeak.getTime() + 60_000) });

    expect(second.outcome).toBe('too_soon');
    expect(catalog.calls).toBe(3); // 12 produktov po 5 = 3 dávky z prvého behu
  });

  it('manuálne načítanie ignoruje špičku aj odstup', async () => {
    const { runner, catalog } = deps(new Date(peak.getTime() - 60_000));

    const report = await runCatalogSyncNow(runner, { now: peak });

    expect(report.outcome).toBe('ran');
    expect(catalog.rows.size).toBe(12);
  });

  it('manuálny reštart zahodí pokrok a začne od stránky 1', async () => {
    const { runner, shop } = deps(new Date(peak.getTime() - 60_000), 50, {
      lastPage: 6,
      perPage: 5,
      completed: false,
    });

    await runCatalogSyncNow(runner, { now: peak, restart: true });

    expect(shop.pagesRequested[0]).toBe(1);
  });

  it('nečitateľná DB sync nespustí — fail-closed', async () => {
    const shop = fakeShop(12);
    const catalog = fakeCatalog();
    const report = await runCatalogSyncIfDue(
      {
        shopClient: shop,
        catalog: {
          ...catalog,
          async loadSyncProgress(): Promise<CatalogSyncProgress> {
            throw new Error('DB je preč');
          },
        },
        sleepFn: noSleep,
      },
      { now: offPeak },
    );

    expect(report.outcome).toBe('failed');
    expect(shop.pagesRequested).toHaveLength(0);
  });
});
