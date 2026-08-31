/**
 * Aura Zľavy — DOŤAHOVANIE DETAILOV PRODUKTOV (`product-details.ts`
 * + `POST /api/catalog/details`).
 *
 * Cesta je nová (19.–20. 8. 2026) a dovtedy ju nedržal ani jeden behový test.
 * Tento súbor pokrýva štyri veci, ktoré sa na nej dajú pokaziť ticho:
 *
 *  A. **Rozpočet.** Anonymné čítanie je 30/min a 300/UTC deň na IP; po rezerve
 *     `RATE_SAFETY_FACTOR` appka počíta s 24 a 240. Dávka rozpočet NEŠETRÍ —
 *     `k` položiek stojí `k + 1`, takže do jednej minúty sa zmestí jedna dávka
 *     s najviac 23 položkami. Keď rozpočet nestačí, appka to POVIE
 *     (`outcome`, `notFilledReason`) a nedoplní; nikdy nevráti ticho prázdno.
 *  B. **Tri prázdna sa nesmú zliať.** `not_fetched` (ešte sa nedoťahovalo),
 *     `needs_product_read` (chýba oprávnenie) a `shop_has_none` (shop nič
 *     nevedie) idú cez repozitár aj cez odpoveď route až do `rowAbsence()`,
 *     kde z nich je `pending` · `locked` · `none`. Tri, nikdy dva.
 *  C. **`get` verzus `getFull`.** Verejný `get` dá kód, EAN a sklad len NA
 *     VARIANTOCH; `getFull` (scope `product:read`) ich dá na produkte a pridá
 *     nákupnú cenu, maržu, sklad, dodávateľa, skutočnú zľavu a kategórie.
 *     Rozhoduje sa na jednom mieste — `chooseDetailRoute()`.
 *  D. **Doťahovanie NEZAKLADÁ riadok v zrkadle.** `upsertMany` je
 *     `ON DUPLICATE KEY UPDATE`, takže produkt mimo zrkadla by vložilo ako
 *     nový riadok a nafúklo `COUNT(*)`, z ktorého sa ráta, koľko katalógu
 *     chýba. Zrkadlo napĺňa VÝHRADNE synchronizácia.
 *
 * Nič sa tu nefejkuje viac, než treba: rozpočet je skutočný `createReadBudget()`
 * nad pamäťovým úložiskom, zrkadlo je mapa, ktorá sa správa ako
 * `ON DUPLICATE KEY UPDATE` (a preto sa na nej dá zmerať, či sa riadok
 * ZALOŽIL), a medzery počíta skutočný `catalogDetailFromRecord()`. Žiadna DB,
 * žiadny `fetch` (I6).
 *
 * Vlastník: D4 (doťahovanie detailov).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  DateOnly,
  MoneyString,
  ProductDetail,
  ProductFullDetail,
  SecretHandle,
  SecretRef,
  ShopError,
} from '@/contracts';

import {
  createCatalogDetailsPost,
  type CatalogDetailsDeps,
} from '@/app/api/catalog/details/route';
import { rowAbsence } from '@/components/products/extras-api';
import {
  ANON_BURST_CAP,
  DETAIL_FILL_MAX,
  DETAIL_FULL_MAX,
  anonReadCost,
  chooseDetailRoute,
  fillProductDetails,
  type ProductDetailsDeps,
  type ProductDetailsResult,
} from '@/lib/catalog/product-details';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import {
  catalogDetailFromRecord,
  emptyCatalogDetail,
  type CatalogCacheRecordV3,
  type CatalogDetailRow,
  type CatalogShopStatus,
  type CatalogUpsertInput,
} from '@/lib/repo/catalog.repo';
import { BATCH_MAX_ITEMS, type ShopScope } from '@/lib/shop/client';
import { ShopRequestError, makeShopError } from '@/lib/shop/errors';
import {
  ANON_READS_PER_MINUTE,
  ANON_READS_PER_UTC_DAY,
  MIN_ANON_READ_PAUSE_MS,
  RATE_SAFETY_FACTOR,
  SHOP_ANON_LIMIT,
} from '@/lib/shop/rate-limits';
import {
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudget,
  type ReadBudgetStore,
} from '@/lib/shop/read-budget';

/* ═══════════════════════════ 1. Prostredie ════════════════════════════════ */

const NOW = new Date('2026-08-17T09:00:00.000Z');
const now = (): Date => NOW;
const TODAY = '2026-08-17' as DateOnly;

/*
 * `POST /api/catalog/details` má od 31. 8. 2026 minútový strop na IP a čas je
 * v testoch zamrznutý, takže bez tohto by okno nikdy neuplynulo a siedmy dopyt
 * v súbore by skončil na 429. Limiter je zámerne bez perzistencie.
 */
beforeEach(() => {
  resetRateLimiter();
});

function memoryBudget(store: ReadBudgetStore = createMemoryReadBudgetStore()): ReadBudget {
  return createReadBudget({ store, lane: 'anon', now });
}

/**
 * Počítadlo dráhy `product_read` — kvóta ZÁPISOVÉHO kľúča, do ktorej sa od
 * 31. 8. 2026 účtuje cesta `getFull`. Je to iná dráha než anonymná (`memoryBudget`)
 * a preto aj iné počítadlo; zliať ich by znamenalo, že doťahovanie detailov si
 * berie strop katalógovej synchronizácie.
 */
function keyedBudget(store: ReadBudgetStore = createMemoryReadBudgetStore()): ReadBudget {
  return createReadBudget({ store, lane: 'product_read', now });
}

/** Počítadlo, ktoré sa nedá prečítať — „nevieme, koľko dnes odišlo" (I11). */
function brokenStore(): ReadBudgetStore {
  return {
    async used() {
      throw new Error('DB nie je dostupná');
    },
    async add() {
      throw new Error('DB nie je dostupná');
    },
  };
}

/**
 * Chyby zo shopu sa NEIMITUJÚ vlastnou triedou — modul sa rozhoduje cez
 * `isShopRequestError` (`instanceof`), takže podvrhnutý objekt by prepustil aj
 * kód, ktorý v produkcii spadne do vetvy „neznáma chyba".
 */
const notFoundThrow = (): ShopRequestError =>
  new ShopRequestError(makeShopError({ kind: 'not_found', code: 'not found' }));

const brokenThrow = (): ShopRequestError =>
  new ShopRequestError(makeShopError({ kind: 'server_error', code: 'boom' }));

const notFoundValue = (): ShopError => makeShopError({ kind: 'not_found', code: 'not found' });

/** `SecretRef` nad textom — kľúč v testoch nikdy nie je skutočný. */
const testKey: SecretRef = async (): Promise<SecretHandle> => ({
  value: Buffer.from('test-key', 'utf8'),
  release: () => undefined,
});

/* ─────────────────────────── zrkadlo ──────────────────────────────────── */

/** Riadok, aký po sebe necháva zoznamový prechod: názov, cena, nič viac. */
function listRow(productId: number): CatalogCacheRecordV3 {
  return {
    productId,
    name: `Zrkadlo ${productId}`,
    price: '19.90' as MoneyString,
    hasAttributes: false,
    shopStatus: 'ok',
    source: 'list',
    fetchedAt: new Date('2026-08-16T03:00:00.000Z'),
    raw: null,
  };
}

interface MirrorLog {
  /** Dávky, ktoré prišli do `upsertMany`. */
  readonly upserts: number[][];
  /** ID, ktoré `upsertMany` do zrkadla ZALOŽIL (riadok predtým neexistoval). */
  readonly created: number[];
  readonly statuses: Array<{ productId: number; status: CatalogShopStatus }>;
}

interface FakeMirror {
  readonly catalog: ProductDetailsDeps['catalog'];
  readonly rows: Map<number, CatalogCacheRecordV3>;
  readonly log: MirrorLog;
}

/**
 * Zrkadlo ako mapa, ktorá sa správa ako `ON DUPLICATE KEY UPDATE`: chýbajúci
 * riadok VLOŽÍ. Práve preto sa na nej dá zmerať, či doťahovanie riadok
 * zakladá — fake, ktorý by neexistujúce ID ticho zahodil, by tú chybu skryl.
 */
function fakeMirror(seed: readonly CatalogCacheRecordV3[], budget: ReadBudget): FakeMirror {
  const rows = new Map<number, CatalogCacheRecordV3>(seed.map((row) => [row.productId, row]));
  const log: MirrorLog = { upserts: [], created: [], statuses: [] };

  const catalog: ProductDetailsDeps['catalog'] = {
    async detailsFor(productIds) {
      const out = new Map<number, CatalogDetailRow>();
      for (const id of productIds) {
        const row = rows.get(id);
        out.set(id, row === undefined ? emptyCatalogDetail(id) : catalogDetailFromRecord(row));
      }
      return out;
    },
    async upsertMany(records: CatalogUpsertInput[]) {
      log.upserts.push(records.map((record) => record.productId));
      for (const record of records) {
        if (!rows.has(record.productId)) log.created.push(record.productId);
        rows.set(record.productId, {
          productId: record.productId,
          name: record.name,
          price: record.price,
          hasAttributes: record.hasAttributes,
          shopStatus: record.shopStatus ?? 'ok',
          source: record.source,
          fetchedAt: record.fetchedAt ?? NOW,
          raw: record.raw,
        });
      }
      return records.length;
    },
    async markShopStatus(productId, status) {
      log.statuses.push({ productId, status });
      const row = rows.get(productId);
      // D49 — riadok zostáva, mení sa len stav. Neexistujúci sa nezakladá.
      if (row !== undefined) rows.set(productId, { ...row, shopStatus: status });
    },
    reserveShopReads: (count = 1) => budget.reserve(count),
    shopReadBudget: () => budget.status(),
  };

  return { catalog, rows, log };
}

/* ─────────────────────────── shop ─────────────────────────────────────── */

interface ShopCall {
  readonly kind: 'batch' | 'getFull';
  readonly ids: readonly number[];
}

interface FakeShopOptions {
  /** Čo pozná verejný `get`/`batch`. Čo tu nie je, je „taký produkt nemám". */
  readonly products?: Readonly<Record<number, ProductDetail>>;
  /** Čo pozná `getFull`. */
  readonly full?: Readonly<Record<number, ProductFullDetail>>;
  /** Dávka spadne pod modulom (nečitateľná doména shopu). */
  readonly batchThrows?: boolean;
  /** ID, na ktorých `getFull` spadne inak než na „nenašiel". */
  readonly fullBroken?: readonly number[];
  /** `via` v odpovedi dávky — `single` znamená rozpad na jednotlivé `get`. */
  readonly via?: 'batch' | 'single';
}

function fakeShop(options: FakeShopOptions = {}): {
  shop: ProductDetailsDeps['shop'];
  calls: ShopCall[];
} {
  const calls: ShopCall[] = [];
  return {
    calls,
    shop: {
      async batchGetProducts(ids) {
        calls.push({ kind: 'batch', ids: [...ids] });
        if (options.batchThrows === true) throw brokenThrow();
        const results = new Map<number, ProductDetail | ShopError>();
        for (const id of ids) {
          const product = (options.products ?? {})[id];
          results.set(id, product ?? notFoundValue());
        }
        return { results, via: options.via ?? 'batch' };
      },
      async getProductFull(id) {
        calls.push({ kind: 'getFull', ids: [id] });
        if ((options.fullBroken ?? []).includes(id)) throw brokenThrow();
        const product = (options.full ?? {})[id];
        if (product === undefined) throw notFoundThrow();
        return product;
      },
    },
  };
}

function fakeApiKey(
  scopes: readonly ShopScope[] | null,
  key: SecretRef | null = testKey,
): ProductDetailsDeps['apiKey'] {
  return {
    loadForUse: async () => key,
    recallScopes: () => ({ scopes, checkedAt: scopes === null ? null : NOW }),
  };
}

/* ─────────────────────────── produkty ─────────────────────────────────── */

/** Produkt s dvomi variantmi — jediný tvar, z ktorého `get` dá kód a sklad. */
function withVariants(id: number): ProductDetail {
  return {
    id,
    name: `Náramok ${id}`,
    price: 24.5,
    has_attributes: true,
    description: 'Popis',
    description_short: 'Krátky popis',
    attributes: [
      {
        id_product_attribute: id * 10 + 1,
        reference: `C16.19-${id}-S`,
        ean13: '8590000000017',
        quantity: 3,
        is_default: true,
        values: ['Zlatá', '52'],
      },
      {
        id_product_attribute: id * 10 + 2,
        reference: `C16.19-${id}-L`,
        ean13: '8590000000024',
        quantity: 4,
        is_default: false,
        values: ['Zlatá', '54'],
      },
    ],
  };
}

/** Produkt bez variantov — pri ceste `get` o jeho kóde nevieme NIČ. */
function plain(id: number): ProductDetail {
  return { id, name: `Prívesok ${id}`, price: 9.9, has_attributes: false };
}

function fullOf(id: number, patch: Partial<ProductFullDetail> = {}): ProductFullDetail {
  return {
    id,
    name: `Prívesok ${id}`,
    price: 9.9,
    has_attributes: false,
    reduction: { state: 'active', percent: 15, from: '2026-08-10' as DateOnly, to: '2026-08-20' as DateOnly },
    reference: `REF-${id}`,
    ean13: '8590000000031',
    purchase_price: 4.2,
    margin: 3.05,
    margin_percent: 42.07,
    sell_price: 8.25,
    sell_price_with_vat: 9.9,
    active: true,
    date_add: '2025-01-02 10:00:00',
    last_time_in_order: '2026-08-01',
    qty: 12,
    qty_in_orders: 41,
    supplier: 'Dodávateľ s.r.o.',
    categories: [2, 7],
    ...patch,
  };
}

/* ═════════════ 2. Rozpočet — najdrahšia časť doťahovania ══════════════════ */

describe('rozpočet na čítanie shopu', () => {
  it('stropy sú odvodené z 30/300 a rezervy, nie napísané ručne', () => {
    // Anonymný strop shopu je 30/min a 300/UTC deň; appka si z neho dovolí 80 %.
    expect(SHOP_ANON_LIMIT).toEqual({ perMinute: 30, perUtcDay: 300 });
    expect(ANON_READS_PER_MINUTE).toBe(Math.floor(30 * RATE_SAFETY_FACTOR));
    expect(ANON_READS_PER_MINUTE).toBe(24);
    expect(ANON_READS_PER_UTC_DAY).toBe(240);
    // `ANON_BURST_CAP` je tá istá záruka ako pauza 2 500 ms, len ako počet —
    // preto sa nesmie rozísť s ňou ani s minútovým stropom.
    expect(ANON_BURST_CAP).toBe(Math.floor(60_000 / MIN_ANON_READ_PAUSE_MS));
    expect(ANON_BURST_CAP).toBe(ANON_READS_PER_MINUTE);
  });

  it('dávka rozpočet NEŠETRÍ: `k` položiek stojí `k + 1`', () => {
    expect(anonReadCost(0)).toBe(0);
    expect(anonReadCost(1)).toBe(2);
    expect(anonReadCost(23)).toBe(24);
    expect(anonReadCost(BATCH_MAX_ITEMS)).toBe(BATCH_MAX_ITEMS + 1);
    // Stránka tabuľky má 50 riadkov. Na HTTP sú to dve dávky po 25 — ale
    // z rozpočtu to je 52 čítaní, nie 2. Kto počíta 2, počíta o 50 menej.
    expect(Math.ceil(50 / BATCH_MAX_ITEMS)).toBe(2);
    expect(anonReadCost(50)).toBe(52);
  });

  it('minutý denný rozpočet nič nevolá a POVIE to — nie tiché prázdno', async () => {
    const store = createMemoryReadBudgetStore();
    await store.add('anon', TODAY, ANON_READS_PER_UTC_DAY);
    const budget = memoryBudget(store);
    const mirror = fakeMirror([listRow(1), listRow(2)], budget);
    const { shop, calls } = fakeShop({ products: { 1: plain(1), 2: plain(2) } });

    const result = await fillProductDetails([1, 2], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    expect(result.outcome).toBe('budget_day');
    expect(result.notFilledReason).toBe('budget_day');
    expect(result.notFilled).toEqual([1, 2]);
    expect(result.filled).toEqual([]);
    expect(result.readsUsed).toBe(0);
    expect(result.error).toBeNull();
    expect(calls).toHaveLength(0);
    expect(mirror.log.upserts).toEqual([]);
    // Rozpočet ide von celý, aby obrazovka vedela povedať DOKEDY.
    expect(result.reads?.exhausted).toBe(true);
    expect(result.reads?.resetAt.toISOString()).toBe('2026-08-18T00:00:00.000Z');
  });

  it('nečitateľné počítadlo NIE JE minutý rozpočet (I11)', async () => {
    const budget = memoryBudget(brokenStore());
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop, calls } = fakeShop({ products: { 1: plain(1) } });

    const result = await fillProductDetails([1], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    // Dve rôzne vety: „dnes už nič" je meraný fakt, toto je medzera v poznaní.
    expect(result.outcome).toBe('budget_unknown');
    expect(result.outcome).not.toBe('budget_day');
    expect(result.notFilledReason).toBe('budget_unknown');
    expect(result.reads?.known).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('zvyšok denného rozpočtu pod cenu dávky je `budget_day`, nie minúta', async () => {
    // Deň má ešte 1 čítanie, minúta je čistá — dávka s jednou položkou stojí 2.
    const store = createMemoryReadBudgetStore();
    await store.add('anon', TODAY, ANON_READS_PER_UTC_DAY - 1);
    const budget = memoryBudget(store);
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop, calls } = fakeShop({ products: { 1: plain(1) } });

    const result = await fillProductDetails([1], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    expect(result.notFilledReason).toBe('budget_day');
    expect(result.notFilled).toEqual([1]);
    expect(result.readsUsed).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('stránka 50 riadkov sa do jednej minúty NEZMESTÍ a zvyšok sa PRIZNÁ', async () => {
    const ids = Array.from({ length: 50 }, (_, index) => index + 1);
    const budget = memoryBudget();
    const mirror = fakeMirror(ids.map(listRow), budget);
    const products = Object.fromEntries(ids.map((id) => [id, plain(id)]));
    const { shop, calls } = fakeShop({ products });

    const result = await fillProductDetails(ids, {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    // Jedno zavolanie = najviac jedna dávka. Cena dávky o `k` je `k + 1`,
    // do 24 sa teda zmestí 23 položiek — druhá dávka v tej istej minúte by
    // strop prekročila a shop by IP zabanoval aj so synchronizáciou.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ids).toHaveLength(ANON_BURST_CAP - 1);
    expect(result.readsUsed).toBe(anonReadCost(ANON_BURST_CAP - 1));
    expect(result.readsUsed).toBeLessThanOrEqual(ANON_READS_PER_MINUTE);
    expect(result.filled).toHaveLength(23);
    expect(result.notFilled).toHaveLength(27);
    // Zvyšok nie je zahodený a nie je to chyba — je to priznaná hranica.
    expect(result.notFilledReason).toBe('budget_minute');
    expect(result.error).toBeNull();
    // A minútový strop naozaj nikto neprekročil.
    const after = await budget.status();
    expect(after.usedThisMinute).toBeLessThanOrEqual(after.minuteLimit);
    expect(after.used).toBe(24);
  });

  it('rezervuje sa aj za obálku dávky, nie len za položky', async () => {
    const ids = [1, 2, 3, 4, 5];
    const store = createMemoryReadBudgetStore();
    // Do konca dňa ostávajú 4 čítania: obálka + 3 položky.
    await store.add('anon', TODAY, ANON_READS_PER_UTC_DAY - 4);
    const budget = memoryBudget(store);
    const mirror = fakeMirror(ids.map(listRow), budget);
    const { shop, calls } = fakeShop({
      products: Object.fromEntries(ids.map((id) => [id, plain(id)])),
    });

    const result = await fillProductDetails(ids, {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    expect(calls[0]?.ids).toEqual([1, 2, 3]);
    expect(result.readsUsed).toBe(4);
    expect(result.filled).toEqual([1, 2, 3]);
    expect(result.notFilled).toEqual([4, 5]);
    const after = await budget.status();
    expect(after.used).toBeLessThanOrEqual(ANON_READS_PER_UTC_DAY);
  });

  it('za detail, ktorý appka už má, sa druhýkrát neplatí', async () => {
    const budget = memoryBudget();
    const fetched: CatalogCacheRecordV3 = {
      ...listRow(1),
      source: 'batch',
      raw: withVariants(1),
    };
    const mirror = fakeMirror([fetched, listRow(2)], budget);
    const { shop, calls } = fakeShop({ products: { 1: withVariants(1), 2: plain(2) } });

    const result = await fillProductDetails([1, 2], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    expect(result.alreadyDetailed).toEqual([1]);
    expect(calls[0]?.ids).toEqual([2]);
    expect(result.readsUsed).toBe(anonReadCost(1));
  });
});

/* ═════════════ 3. Tri prázdna sa nesmú zliať ══════════════════════════════ */

type WireRowArg = Parameters<typeof rowAbsence>[0];
type Gap = 'not_fetched' | 'needs_product_read' | 'shop_has_none' | null;

/** Riadok v tvare, aký ide na drôte do UI. Meria sa `reference.gap`. */
function wireRow(gap: Gap): WireRowArg {
  const value = { value: null, gap };
  return {
    productId: 1,
    route: 'get',
    fetchedAt: null,
    reference: value,
    ean13: value,
    quantity: value,
    variantStock: value,
    variants: [],
    full: null,
  };
}

describe('tri prázdna: locked · pending · none', () => {
  it('repozitár dá tri RÔZNE dôvody podľa cesty, ktorou riadok prišiel', () => {
    // 1. Riadok zo zoznamového prechodu — detail sa nikdy nedoťahoval.
    const list = catalogDetailFromRecord(listRow(1));
    expect(list.route).toBe('list');
    expect(list.reference.gap).toBe('not_fetched');

    // 2. Riadok z verejného `get` — kód na úrovni produktu dáva len `getFull`.
    const viaGet = catalogDetailFromRecord({
      ...listRow(2),
      source: 'batch',
      raw: withVariants(2),
    });
    expect(viaGet.route).toBe('get');
    expect(viaGet.reference.gap).toBe('needs_product_read');

    // 3. Riadok z `getFull`, kde shop kód pri produkte proste nevedie.
    const viaFull = catalogDetailFromRecord({
      ...listRow(3),
      source: 'get',
      raw: fullOf(3, { reference: null }),
    });
    expect(viaFull.route).toBe('getFull');
    expect(viaFull.reference.gap).toBe('shop_has_none');

    // Produkt, ktorý zrkadlo vôbec nemá, je „ešte sme nepozerali", nie nula.
    expect(emptyCatalogDetail(9_999).reference.gap).toBe('not_fetched');

    const gaps = [list, viaGet, viaFull].map((row) => row.reference.gap);
    expect(new Set(gaps).size).toBe(3);
  });

  it('UI mapovanie drží tri stavy, nie dva', () => {
    expect(rowAbsence(wireRow('needs_product_read'))).toBe('locked');
    expect(rowAbsence(wireRow('not_fetched'))).toBe('pending');
    expect(rowAbsence(wireRow('shop_has_none'))).toBe('none');
    // Riadok, ktorý vôbec neprišiel, je „ešte sa nedoťahovalo".
    expect(rowAbsence(null)).toBe('pending');

    const kinds = (['needs_product_read', 'not_fetched', 'shop_has_none'] as const).map((gap) =>
      rowAbsence(wireRow(gap)),
    );
    expect(new Set(kinds).size).toBe(3);
  });

  it('známa hodnota nie je prázdno a nula nie je „nevieme"', () => {
    const row = catalogDetailFromRecord({
      ...listRow(4),
      source: 'get',
      raw: fullOf(4, { qty: 0 }),
    });
    // Sklad 0 je platná nula: hodnota je známa, `gap` je `null`.
    expect(row.quantity).toEqual({ value: 0, gap: null });
    expect(rowAbsence(wireRow(row.reference.gap))).toBe('none');
    expect(row.reference.value).toBe('REF-4');
  });

  it('cez celú cestu (route → drôt → UI) prídu všetky tri prázdna', async () => {
    // 1 sa doplní verejným `get` (kód je len na variantoch)  → locked
    // 2 v zrkadle NIE JE, takže sa nedoťahuje                → pending
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop } = fakeShop({ products: { 1: withVariants(1) } });
    const { body } = await callDetails([1, 2], { mirror, shop, scopes: [] });

    const gaps = body.data.rows.map((row) => (row === null ? null : row.reference.gap));
    expect(gaps).toEqual(['needs_product_read', 'not_fetched']);
    expect(gaps.map((gap) => rowAbsence(wireRow(gap as Gap)))).toEqual(['locked', 'pending']);

    // 3 sa doplní cez `getFull` a shop pri ňom kód nevedie → none
    const fullBudget = memoryBudget();
    const fullMirror = fakeMirror([listRow(3)], fullBudget);
    const fullShop = fakeShop({ full: { 3: fullOf(3, { reference: null }) } });
    const full = await callDetails([3], {
      mirror: fullMirror,
      shop: fullShop.shop,
      scopes: ['product:read'],
    });
    expect(full.body.data.rows[0]?.reference.gap).toBe('shop_has_none');
    expect(rowAbsence(wireRow('shop_has_none'))).toBe('none');
  });
});

/* ═════════════ 4. `get` verzus `getFull` ══════════════════════════════════ */

describe('`get` verzus `getFull`', () => {
  it('cesta sa rozhoduje na jednom mieste a `unknown` ide verejne', () => {
    expect(chooseDetailRoute({ state: 'available', requires: 'product:read', note: null })).toBe(
      'getFull',
    );
    expect(chooseDetailRoute({ state: 'locked', requires: 'product:read', note: 'x' })).toBe('get');
    // Neoverený kľúč ide verejnou cestou: `getFull` by vrátil `forbidden`,
    // minul kvótu kľúča a používateľ by nedostal ani kódy variantov.
    expect(chooseDetailRoute({ state: 'unknown', requires: 'product:read', note: 'x' })).toBe(
      'get',
    );
  });

  it('bez `product:read` ide verejný `get` a dá kód/EAN/sklad NA VARIANTOCH', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop, calls } = fakeShop({ products: { 1: withVariants(1) } });

    const result = await fillProductDetails([1], {
      shop,
      catalog: mirror.catalog,
      // Kľúč je, ale `product:read` v ňom nie je.
      apiKey: fakeApiKey(['product:edit']),
      now,
    });

    expect(result.route).toBe('get');
    expect(result.capability.state).toBe('locked');
    expect(calls.map((call) => call.kind)).toEqual(['batch']);
    expect(result.filled).toEqual([1]);

    const row = catalogDetailFromRecord(mirror.rows.get(1) as CatalogCacheRecordV3);
    expect(row.route).toBe('get');
    expect(row.variants.map((variant) => variant.reference)).toEqual([
      'C16.19-1-S',
      'C16.19-1-L',
    ]);
    expect(row.variants.map((variant) => variant.ean13)).toEqual([
      '8590000000017',
      '8590000000024',
    ]);
    expect(row.variants.map((variant) => variant.quantity)).toEqual([3, 4]);
    // Súčet skladu cez varianty je jediné skladové číslo bez `product:read`.
    expect(row.variantStock).toEqual({ value: 7, gap: null });
    // Na úrovni PRODUKTU appka o kóde nevie nič a nesmie predstierať, že áno.
    expect(row.reference.gap).toBe('needs_product_read');
    expect(row.full).toBeNull();
  });

  it('produkt bez variantov je pri `get` prázdny — a vie prečo', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(2)], budget);
    const { shop } = fakeShop({ products: { 2: plain(2) } });

    await fillProductDetails([2], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    const row = catalogDetailFromRecord(mirror.rows.get(2) as CatalogCacheRecordV3);
    // Bez variantov nie je čo sčítať — a čiastočná nula by bola tvrdenie.
    expect(row.variantStock).toEqual({ value: null, gap: 'shop_has_none' });
    expect(row.reference.gap).toBe('needs_product_read');
  });

  it('s `product:read` ide `getFull` a pridá maržu, sklad, dodávateľa aj zľavu', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(5)], budget);
    const { shop, calls } = fakeShop({ full: { 5: fullOf(5) } });

    const result = await fillProductDetails([5], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey(['product:read']),
      productReads: keyedBudget(),
      now,
    });

    expect(result.route).toBe('getFull');
    expect(result.capability.state).toBe('available');
    // Verejná dávka sa pri tejto ceste nesmie volať vôbec.
    expect(calls.map((call) => call.kind)).toEqual(['getFull']);
    expect(result.filled).toEqual([5]);
    // `getFull` míňa kvótu KĽÚČA, nie anonymné počítadlo na IP.
    expect(result.readsUsed).toBe(0);
    expect((await budget.status()).used).toBe(0);

    const row = catalogDetailFromRecord(mirror.rows.get(5) as CatalogCacheRecordV3);
    // Cestu prezradí pole `reduction`, ktoré `get` nikdy nenesie.
    expect(row.route).toBe('getFull');
    expect(row.reference).toEqual({ value: 'REF-5', gap: null });
    expect(row.ean13.value).toBe('8590000000031');
    expect(row.quantity).toEqual({ value: 12, gap: null });
    expect(row.full).toMatchObject({
      purchasePrice: 4.2,
      margin: 3.05,
      marginPercent: 42.07,
      supplier: 'Dodávateľ s.r.o.',
      categories: [2, 7],
      qtyInOrders: 41,
    });
    // Skutočná zľava zo shopu prežije v `raw` — bez nej by sa cesta nedala poznať.
    expect((mirror.rows.get(5)?.raw as ProductFullDetail).reduction).toEqual({
      state: 'active',
      percent: 15,
      from: '2026-08-10',
      to: '2026-08-20',
    });
  });

  it('`getFull` má vlastný nízky strop 10 a zvyšok priznáva', async () => {
    const ids = Array.from({ length: DETAIL_FULL_MAX + 2 }, (_, index) => index + 1);
    const budget = memoryBudget();
    const mirror = fakeMirror(ids.map(listRow), budget);
    const { shop, calls } = fakeShop({
      full: Object.fromEntries(ids.map((id) => [id, fullOf(id)])),
    });

    const result = await fillProductDetails(ids, {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey(['product:read']),
      productReads: keyedBudget(),
      now,
    });

    expect(calls).toHaveLength(DETAIL_FULL_MAX);
    expect(result.filled).toHaveLength(DETAIL_FULL_MAX);
    expect(result.notFilled).toEqual([DETAIL_FULL_MAX + 1, DETAIL_FULL_MAX + 2]);
    expect(result.notFilledReason).toBe('limit');
    expect(result.readsUsed).toBe(0);
  });

  it('`getFull` bez kľúča nevolá nič a povie `no_key`', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop, calls } = fakeShop({ full: { 1: fullOf(1) } });

    const result = await fillProductDetails([1], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey(['product:read'], null),
      now,
    });

    expect(result.outcome).toBe('no_key');
    expect(result.route).toBe('getFull');
    expect(calls).toHaveLength(0);
    expect(result.notFilled).toEqual([1]);
  });

  it('`getFull` sa zastaví na prvej chybe — ďalší pokus by ukrojil z kvóty fronty', async () => {
    const ids = [1, 2, 3];
    const budget = memoryBudget();
    const mirror = fakeMirror(ids.map(listRow), budget);
    const { shop, calls } = fakeShop({
      full: { 1: fullOf(1), 3: fullOf(3) },
      fullBroken: [2],
    });

    const result = await fillProductDetails(ids, {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey(['product:read']),
      productReads: keyedBudget(),
      now,
    });

    expect(calls.map((call) => call.ids[0])).toEqual([1, 2]);
    expect(result.filled).toEqual([1]);
    expect(result.notFilled).toEqual([2, 3]);
    expect(result.notFilledReason).toBe('failed');
    // Do stavu ide KÓD, nikdy text odpovede shopu (I1).
    expect(result.error).toBe('boom');
  });

  it('„taký produkt nemám" je vlastná skupina, nie chyba', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1), listRow(2)], budget);
    const { shop } = fakeShop({ products: { 1: plain(1) } });

    const result = await fillProductDetails([1, 2], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    expect(result.filled).toEqual([1]);
    expect(result.notInShop).toEqual([2]);
    expect(result.notFilled).toEqual([]);
    expect(result.error).toBeNull();
    // D49 — riadok zostáva, mení sa len stav. Nikdy sa nemaže.
    expect(mirror.log.statuses).toEqual([{ productId: 2, status: 'not_found' }]);
    expect(mirror.rows.has(2)).toBe(true);
  });

  it('modul NIKDY nehádže — pád dávky ide von ako kód', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop } = fakeShop({ batchThrows: true });

    const result = await fillProductDetails([1], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    expect(result.outcome).toBe('failed');
    expect(result.error).toBe('boom');
    expect(result.notFilled).toEqual([1]);
    expect(result.notFilledReason).toBe('failed');
  });
});

/* ═════════════ 5. Doťahovanie NEZAKLADÁ riadok v zrkadle ══════════════════ */

describe('doťahovanie zrkadlo nenapĺňa, len obohacuje', () => {
  it('ID mimo zrkadla sa nedoťahuje, riadok nevznikne a volajúci sa to dozvie', async () => {
    const budget = memoryBudget();
    // 1 zrkadlo má, 777 nie — prechod synchronizácie ho ešte nevidel.
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop, calls } = fakeShop({ products: { 1: plain(1), 777: plain(777) } });

    const result = await fillProductDetails([1, 777], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    // Toto je celé tvrdenie: `upsertMany` je `ON DUPLICATE KEY UPDATE`, takže
    // 777 by sa vložil ako nový riadok a nafúkol `COUNT(*)`, z ktorého sa ráta,
    // koľko katalógu ešte chýba (kontrakt UI, bod 16).
    expect(mirror.log.created).toEqual([]);
    expect([...mirror.rows.keys()]).toEqual([1]);
    expect(mirror.rows.size).toBe(1);
    // Nie je to chyba a nie je to „shop ho nepozná" — je to hranica.
    expect(result.notInMirror).toEqual([777]);
    expect(result.notInShop).toEqual([]);
    expect(result.filled).toEqual([1]);
    // Neplatí sa ani za jeho čítanie.
    expect(calls[0]?.ids).toEqual([1]);
    expect(result.readsUsed).toBe(anonReadCost(1));
  });

  it('`notInMirror` prežije aj vtedy, keď sa nakoniec nič nedoťahuje', async () => {
    const budget = memoryBudget();
    const detailed: CatalogCacheRecordV3 = { ...listRow(1), source: 'batch', raw: plain(1) };
    const mirror = fakeMirror([detailed], budget);
    const { shop, calls } = fakeShop({ products: { 1: plain(1) } });

    // 1 detail už má, 777 v zrkadle nie je → niet čo volať, ale hranica platí.
    const result = await fillProductDetails([1, 777], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
    });

    expect(result.outcome).toBe('done');
    expect(result.alreadyDetailed).toEqual([1]);
    expect(result.notInMirror).toEqual([777]);
    expect(calls).toHaveLength(0);
    expect(mirror.log.created).toEqual([]);
  });

  it('cesta `getFull` zrkadlo nezakladá takisto', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop, calls } = fakeShop({ full: { 1: fullOf(1), 777: fullOf(777) } });

    const result = await fillProductDetails([1, 777], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey(['product:read']),
      productReads: keyedBudget(),
      now,
    });

    expect(result.route).toBe('getFull');
    expect(mirror.log.created).toEqual([]);
    expect(mirror.rows.size).toBe(1);
    expect(result.notInMirror).toEqual([777]);
    expect(calls.map((call) => call.ids[0])).toEqual([1]);
  });

  it('ani ručná obnova (`force`) riadok nezaloží', async () => {
    const budget = memoryBudget();
    const detailed: CatalogCacheRecordV3 = { ...listRow(1), source: 'batch', raw: plain(1) };
    const mirror = fakeMirror([detailed], budget);
    const { shop, calls } = fakeShop({ products: { 1: plain(1), 777: plain(777) } });

    // `force` má prebiť „už to máme", nie hranicu zrkadla: obnoviť sa dá len
    // riadok, ktorý existuje. Inak by stačilo poslať cudzie ID s `force: true`
    // a `COUNT(*)` zrkadla by narástol o produkt, ktorý synchronizácia nevidela.
    const result = await fillProductDetails([1, 777], {
      shop,
      catalog: mirror.catalog,
      apiKey: fakeApiKey([]),
      now,
      force: true,
    });

    expect(mirror.log.created).toEqual([]);
    expect([...mirror.rows.keys()]).toEqual([1]);
    expect(result.notInMirror).toEqual([777]);
    // `force` pritom naozaj obnoví riadok, ktorý detail už mal.
    expect(result.alreadyDetailed).toEqual([]);
    expect(result.filled).toEqual([1]);
    expect(calls[0]?.ids).toEqual([1]);
  });
});

/* ═════════════ 6. Route `POST /api/catalog/details` ═══════════════════════ */

function sessionDeps(): RouteDeps {
  return {
    now,
    newRequestId: () => '01J000000000000000DETAIL',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

interface DetailsBody {
  ok: boolean;
  data: Pick<
    ProductDetailsResult,
    'route' | 'outcome' | 'filled' | 'notFilled' | 'notFilledReason' | 'readsUsed' | 'error'
  > & {
    capability: { state: string; note: string | null };
    at: string;
    rows: Array<{
      productId: number;
      route: string;
      reference: { value: string | null; gap: Gap };
      variantStock: { value: number | null; gap: Gap };
    } | null>;
  };
}

interface DetailsWorld {
  readonly mirror: FakeMirror;
  readonly shop: ProductDetailsDeps['shop'];
  readonly scopes: readonly ShopScope[] | null;
  readonly force?: boolean;
  /** Počítadlo dráhy `product_read`; default je čerstvé pamäťové. */
  readonly keyedReads?: ReadBudget;
}

async function callDetails(
  productIds: readonly number[],
  world: DetailsWorld,
): Promise<{ body: DetailsBody; status: number }> {
  const overrides: CatalogDetailsDeps = {
    catalogRepo: world.mirror.catalog as unknown as CatalogDetailsDeps['catalogRepo'],
    apiKeyRepo: fakeApiKey(world.scopes) as unknown as CatalogDetailsDeps['apiKeyRepo'],
    shopClient: world.shop,
    // Dráha `product_read` — bez nej by cesta `getFull` fail-closed nepustila
    // ani jedno volanie (neúčtované čítanie na zápisovom kľúči).
    productReads: world.keyedReads ?? keyedBudget(),
  };
  const response = await createCatalogDetailsPost(overrides, sessionDeps())(
    new Request('https://zlavy.local/api/catalog/details', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://zlavy.local',
        cookie: 'ovl_zliav_session=x',
      },
      body: JSON.stringify({
        productIds: [...productIds],
        ...(world.force === true ? { force: true } : {}),
      }),
    }),
  );
  return { body: (await response.json()) as DetailsBody, status: response.status };
}

describe('POST /api/catalog/details', () => {
  it('doplní stránku a vráti RIADKY, nie len súhrn', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1), listRow(2)], budget);
    const { shop } = fakeShop({ products: { 1: withVariants(1), 2: plain(2) } });

    const { body, status } = await callDetails([2, 1], { mirror, shop, scopes: [] });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.route).toBe('get');
    expect(body.data.outcome).toBe('done');
    expect(body.data.filled).toEqual([1, 2]);
    // Riadky idú von pre VŠETKY vyžiadané ID, zoradené — UI sa nesmie pýtať druhýkrát.
    expect(body.data.rows.map((row) => row?.productId)).toEqual([1, 2]);
    expect(body.data.rows[0]?.variantStock).toEqual({ value: 7, gap: null });
    // Konkrétny čas, nikdy „pred chvíľou" (kontrakt bod 10).
    expect(Number.isNaN(Date.parse(body.data.at))).toBe(false);
    expect(body.data.error).toBeNull();
  });

  it('minutý rozpočet vráti dôvod, nie prázdnu odpoveď a nie chybu', async () => {
    const store = createMemoryReadBudgetStore();
    await store.add('anon', TODAY, ANON_READS_PER_UTC_DAY);
    const budget = memoryBudget(store);
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop } = fakeShop({ products: { 1: plain(1) } });

    const { body, status } = await callDetails([1], { mirror, shop, scopes: [] });

    expect(status).toBe(200);
    expect(body.data.outcome).toBe('budget_day');
    expect(body.data.notFilledReason).toBe('budget_day');
    expect(body.data.notFilled).toEqual([1]);
    expect(body.data.readsUsed).toBe(0);
    // Riadok príde aj tak — s dôvodom, prečo je prázdny.
    expect(body.data.rows[0]?.reference.gap).toBe('not_fetched');
  });

  it('odpoveď vždy povie, čo appka nevie a prečo (oprávnenie)', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop } = fakeShop({ products: { 1: withVariants(1) } });

    const { body } = await callDetails([1], { mirror, shop, scopes: null });

    // Neoverený kľúč = NEVIEME, nie „nemá". Tretí stav sa nesmie stratiť.
    expect(body.data.capability.state).toBe('unknown');
    expect(body.data.capability.note).toContain('product:read');
    expect(body.data.route).toBe('get');
  });

  it('strop `DETAIL_FILL_MAX` drží route — väčšia stránka je 400, nie tichý orez', async () => {
    const ids = Array.from({ length: DETAIL_FILL_MAX + 1 }, (_, index) => index + 1);
    const budget = memoryBudget();
    const mirror = fakeMirror([], budget);
    const { shop } = fakeShop();

    const { status } = await callDetails(ids, { mirror, shop, scopes: [] });
    expect(status).toBe(400);
    expect(DETAIL_FILL_MAX).toBe(100);
  });

  it('cez route sa riadok mimo zrkadla nezaloží ani s `force`', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop } = fakeShop({ products: { 1: plain(1), 777: plain(777) } });

    await callDetails([1, 777], { mirror, shop, scopes: [], force: true });

    expect(mirror.log.created).toEqual([]);
    expect([...mirror.rows.keys()]).toEqual([1]);
  });

  /**
   * Bod E2 (24. 8. 2026). Keď `detailsFor()` hodí, appka NEVIE, ktoré ID sú
   * v zrkadle — a doťahovanie by práve preto založilo riadok pre každé z nich.
   * Do 24. 8. sa v tom stave doťahovalo ďalej („nanajvýš zaplatíme dvakrát"),
   * čím sa hranica zrkadla obchádzala rovnako, ako ju predtým obchádzal `force`.
   *
   * Meria sa zrkadlo a počet čítaní, nie text v zdroji.
   */
  it('nečitateľné zrkadlo doťahovanie ZASTAVÍ a riadok nezaloží', async () => {
    const budget = memoryBudget();
    const mirror = fakeMirror([listRow(1)], budget);
    const { shop, calls } = fakeShop({ products: { 1: plain(1), 777: plain(777) } });

    const broken: ProductDetailsDeps['catalog'] = {
      ...mirror.catalog,
      async detailsFor() {
        throw new Error('mirror down');
      },
    };

    const result = await fillProductDetails([1, 777], {
      shop,
      catalog: broken,
      apiKey: fakeApiKey([]),
      now: () => NOW,
    });

    // 1. Nič sa nezaložilo ani neprepísalo — to je jadro veci.
    expect(mirror.log.created).toEqual([]);
    expect(mirror.log.upserts).toEqual([]);
    expect([...mirror.rows.keys()]).toEqual([1]);
    // 2. Ani sa za to nezaplatilo čítanie shopu.
    expect(calls).toHaveLength(0);
    // 3. A volajúci dostane dôvod, nie tiché „done".
    expect(result.outcome).toBe('mirror_unreadable');
    expect(result.notFilledReason).toBe('mirror_unreadable');
    expect([...result.notFilled]).toEqual([1, 777]);
  });
});
