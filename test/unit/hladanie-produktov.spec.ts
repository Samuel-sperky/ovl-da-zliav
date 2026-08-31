/**
 * Aura Zľavy — HĽADANIE PRODUKTOV (KONTRAKT-UI-2026-08-13, body 20, 25–28).
 *
 * Akceptačné kritérium 6 kontraktu znie: „Hľadanie nájde produkt, ktorý NIE JE
 * v zrkadle katalógu — vrátane hľadania podľa kódu — a povie, odkiaľ výsledok
 * je." Tento súbor to dokazuje, a k tomu tri veci, ktoré sa pri takom hľadaní
 * dajú pokaziť ticho:
 *
 *  A. **Rozpočet.** Dohľadanie je platené (anonymné čítania 30/min, 300/UTC deň
 *     na IP) a delí sa o počítadlo so synchronizáciou katalógu. Rezervuje sa
 *     PRED volaním, minutý rozpočet neznamená chybu, a **nečitateľné počítadlo
 *     nie je minutý rozpočet** — to sú dve rôzne vety (I11).
 *  B. **Odkiaľ je riadok.** Na jednej obrazovke stoja vedľa seba údaje zo
 *     zrkadla (posledný prechod synchronizácie) a údaje vypýtané z eshopu pred
 *     sekundou. Bez `origin` vyzerajú rovnako.
 *  C. **Čo appka nevie a prečo.** Presné filtre, kategórie a kód produktu čakajú
 *     na oprávnenie `product:read`. Tri stavy, nikdy dva: má · nemá · NEVIEME.
 *
 * Rozpočet sa NEFEJKUJE — beží skutočný `createReadBudget()` nad pamäťovým
 * úložiskom, takže testy merajú tú istú aritmetiku, ktorá chráni produkciu.
 * Žiadna DB, žiadny `fetch` (I6): shop je `fetchImpl`, zrkadlo je mapa.
 *
 * Vlastník: V15 (hľadanie).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  MoneyString,
  ProductDetail,
  ProductFullDetail,
  SecretHandle,
  SecretRef,
  ShopCtx,
} from '@/contracts';

import {
  createCatalogSearchRoute,
  type CatalogSearchRouteDeps,
} from '@/app/api/catalog/search/route';
import {
  CODE_LOOKUP_MAX,
  recalledScopes,
  resolveProductCodes,
  shopCapabilities,
} from '@/lib/catalog/product-codes';
import {
  LOOKUP_RESOLVE_MAX,
  lookupProductsInShop,
  type ShopLookupDeps,
} from '@/lib/catalog/shop-lookup';
import type { RouteDeps } from '@/lib/http/define-route';
import type {
  CatalogFactsResult,
  CatalogSearchFilter,
  CatalogSearchResult,
  CatalogSearchRow,
  CatalogCacheRecordV3,
} from '@/lib/repo/catalog.repo';
import { createShopClient, type ShopScope } from '@/lib/shop/client';
import { ShopRequestError, makeShopError } from '@/lib/shop/errors';
import {
  READ_LANE_LIMITS,
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudget,
  type ReadBudgetStore,
} from '@/lib/shop/read-budget';

/* ═══════════════════════════ 1. Prostredie ════════════════════════════════ */

const NOW = new Date('2026-08-17T09:00:00.000Z');
const now = (): Date => NOW;

const ANON = READ_LANE_LIMITS.anon;

function memoryBudget(store: ReadBudgetStore = createMemoryReadBudgetStore()): ReadBudget {
  return createReadBudget({ store, lane: 'anon', now });
}

/** Úložisko, ktoré sa nedá prečítať — „nevieme, koľko dnes odišlo". */
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

interface ShopCall {
  readonly kind: 'searchIndex' | 'get';
  readonly detail: string;
}

interface FakeShopOptions {
  /** ID, ktoré `searchIndex` vráti (v poradí relevancie). */
  readonly ids?: readonly number[];
  readonly total?: number;
  /** Produkty, ktoré `get` pozná. Čo tu nie je, je „taký produkt nemám". */
  readonly products?: Readonly<Record<number, { name: string; price: number }>>;
  /** ID, na ktorých `get` spadne inak než na „nenašiel". */
  readonly broken?: readonly number[];
  /** `searchIndex` spadne. */
  readonly indexFails?: boolean;
}

/**
 * Chyby zo shopu sa v testoch NEIMITUJÚ vlastnou triedou — hádže sa skutočný
 * `ShopRequestError`, lebo modul sa podľa neho rozhoduje (`isShopRequestError`
 * je `instanceof`). Podvrhnutý objekt s rovnakými poliami by test prepustil aj
 * kód, ktorý v produkcii spadne do vetvy „neznáma chyba".
 */
const notFound = (): ShopRequestError =>
  new ShopRequestError(makeShopError({ kind: 'not_found', code: 'not found' }));

const broken = (): ShopRequestError =>
  new ShopRequestError(makeShopError({ kind: 'server_error', code: 'boom' }));

function fakeShop(options: FakeShopOptions = {}): {
  shop: ShopLookupDeps['shop'];
  calls: ShopCall[];
} {
  const calls: ShopCall[] = [];
  return {
    calls,
    shop: {
      async searchIndex(params) {
        calls.push({ kind: 'searchIndex', detail: params.search ?? '' });
        if (options.indexFails === true) throw broken();
        const ids = options.ids ?? [];
        return { ids: [...ids], page: 1, perPage: params.perPage ?? 25, total: options.total ?? ids.length };
      },
      async getProduct(id: number): Promise<ProductDetail> {
        calls.push({ kind: 'get', detail: String(id) });
        if ((options.broken ?? []).includes(id)) throw broken();
        const product = (options.products ?? {})[id];
        if (product === undefined) throw notFound();
        return { id, name: product.name, price: product.price, has_attributes: false };
      },
    },
  };
}

function mirrorRecord(productId: number, name: string): CatalogCacheRecordV3 {
  return {
    productId,
    name,
    price: '19.90' as MoneyString,
    hasAttributes: false,
    shopStatus: 'ok',
    source: 'list',
    fetchedAt: new Date('2026-08-16T03:00:00.000Z'),
    raw: null,
  };
}

function mirrorRow(productId: number, name: string, unitsSold = 0): CatalogSearchRow {
  return { ...mirrorRecord(productId, name), unitsSold, everDiscounted: false, discountedNow: false };
}

interface FakeCatalogOptions {
  /** ID, ktoré zrkadlo má. */
  readonly mirror?: readonly number[];
  readonly budget?: ReadBudget;
  readonly facts?: CatalogFactsResult['facts'];
}

function fakeCatalog(options: FakeCatalogOptions = {}): ShopLookupDeps['catalog'] {
  const budget = options.budget ?? memoryBudget();
  const known = new Set(options.mirror ?? []);
  return {
    async getMany(productIds: number[]) {
      const out = new Map<number, CatalogCacheRecordV3>();
      for (const id of productIds) {
        if (known.has(id)) out.set(id, mirrorRecord(id, `Zrkadlo ${id}`));
      }
      return out;
    },
    reserveShopReads: (count = 1) => budget.reserve(count),
    shopReadBudget: () => budget.status(),
  };
}

/* ═════════ 2. Klient: `searchIndex` je verejný, `search` nie je ═══════════ */

interface CapturedRequest {
  readonly url: string;
  readonly hasKey: boolean;
}

function shopHarness(body: unknown, status = 200): {
  client: ReturnType<typeof createShopClient>;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const client = createShopClient({
    baseUrl: 'https://shop.test',
    policy: { maxAttempts: 1, retryAfterCapSeconds: 1 },
    fetchImpl: async (url, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      requests.push({ url, hasKey: headers['X-Api-Key'] !== undefined });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, requests };
}

/** `SecretRef` nad textom — kľúč v testoch nikdy nie je skutočný. */
const testKey: SecretRef = async (): Promise<SecretHandle> => ({
  value: Buffer.from('test-key', 'utf8'),
  release: () => undefined,
});

const CTX: ShopCtx = { operationId: '01J0000000000000000FIND01' };

const ID_PAGE = { result: { ok: true, data: [618, 49, 112], page: 1, per_page: 25, total: 1523 } };

describe('klient shopu — hľadanie (API v5)', () => {
  it('`searchIndex` ide BEZ kľúča a vráti ID v poradí relevancie', async () => {
    const { client, requests } = shopHarness(ID_PAGE);
    const page = await client.searchIndex({ search: 'C16.19', perPage: 25 }, CTX);

    expect(page.ids).toEqual([618, 49, 112]);
    // `total` je počet, ktorý eshop naozaj vrátil — meraný fakt nad CELÝM
    // katalógom, nie odhad zo zrkadla.
    expect(page.total).toBe(1523);
    expect(requests).toHaveLength(1);
    // Najdôležitejšie tvrdenie: verejná čítacia cesta zostáva anonymná (D48, I1).
    expect(requests[0]?.hasKey).toBe(false);
    expect(requests[0]?.url).toContain('/api/products/searchIndex');
    expect(requests[0]?.url).toContain('search=C16.19');
  });

  it('`search` a `categories` kľúč pošlú — sú za oprávnením', async () => {
    const search = shopHarness(ID_PAGE);
    await search.client.searchProducts({ search: 'náramok' }, testKey, CTX);
    expect(search.requests[0]?.hasKey).toBe(true);
    expect(search.requests[0]?.url).toContain('/api/products/search');

    const categories = shopHarness({
      result: { ok: true, data: [{ id: 2, name: 'Oceľové šperky', id_parent: 1, level_depth: 1 }] },
    });
    const list = await categories.client.listCategories(testKey, CTX);
    expect(categories.requests[0]?.hasKey).toBe(true);
    expect(list).toEqual([{ id: 2, name: 'Oceľové šperky', parentId: 1, depth: 1 }]);
  });

  it('zoznamové filtre idú ako opakovaný kľúč a `false` sa neposiela', async () => {
    const { client, requests } = shopHarness(ID_PAGE);
    await client.searchProducts(
      { search: 'x', categories: [2, 7], manufacturers: [], onlyDiscounted: false },
      testKey,
      CTX,
    );

    const url = new URL(requests[0]?.url ?? '');
    // Dve kategórie musia prežiť obe — `set()` by z nich nechal jednu.
    expect(url.searchParams.getAll('categories[]')).toEqual(['2', '7']);
    // Prázdny zoznam sa neposiela vôbec: `manufacturers[]=` by shop mohol
    // prečítať ako „výrobca 0" a vrátiť nič.
    expect(url.searchParams.has('manufacturers[]')).toBe(false);
    // „Nechcem len zlacnené" a „je mi to jedno" je pre shop tá istá otázka.
    expect(url.searchParams.has('onlyDiscounted')).toBe(false);
  });

  it('odpoveď v inom tvare je „stav neistý", nikdy tichý úspech (D54)', async () => {
    const { client } = shopHarness({ result: { ok: true, data: ['nie je ID'], page: 1, per_page: 25, total: 1 } });
    await expect(client.searchIndex({ search: 'x' }, CTX)).rejects.toMatchObject({
      shopError: { kind: 'schema_drift' },
    });
  });
});

/* ═════════ 3. Dohľadanie: nájde to, čo zrkadlo nemá, a povie odkiaľ ═══════ */

describe('dohľadanie v eshope — akceptačné kritérium 6', () => {
  it('nájde produkt podľa KÓDU, ktorý zrkadlo nemá, a povie, že je z eshopu', async () => {
    const { shop, calls } = fakeShop({
      ids: [30582],
      total: 1,
      products: { 30582: { name: 'Náramok C16.19', price: 24.5 } },
    });
    const result = await lookupProductsInShop(
      { query: 'C16.19' },
      { shop, catalog: fakeCatalog({ mirror: [] }), now },
    );

    expect(result.outcome).toBe('done');
    // Eshop pozná celý katalóg, nielen tých 2 900 riadkov zrkadla.
    expect(result.shopTotal).toBe(1);
    expect(result.missingIds).toEqual([30582]);
    expect(result.fetched).toEqual([
      {
        productId: 30582,
        name: 'Náramok C16.19',
        // Cena je DECIMAL ako string — nikdy float (§2).
        price: '24.50',
        hasAttributes: false,
        fetchedAt: NOW,
      },
    ]);
    // Dve čítania: jedno hľadanie a jeden názov. Nič navyše.
    expect(result.readsUsed).toBe(2);
    expect(calls.map((c) => c.kind)).toEqual(['searchIndex', 'get']);
  });

  it('za to, čo zrkadlo už má, sa NEPLATÍ druhýkrát', async () => {
    const { shop, calls } = fakeShop({ ids: [1, 2, 3], total: 3, products: {} });
    const result = await lookupProductsInShop(
      { query: 'náramok' },
      { shop, catalog: fakeCatalog({ mirror: [1, 2, 3] }), now },
    );

    expect(result.knownIds).toEqual([1, 2, 3]);
    expect(result.missingIds).toEqual([]);
    expect(result.readsUsed).toBe(1);
    expect(calls.filter((c) => c.kind === 'get')).toHaveLength(0);
  });

  it('„taký produkt nemám" je vlastná skupina a zvyšok pokračuje', async () => {
    const { shop } = fakeShop({
      ids: [10, 11, 12],
      total: 3,
      products: { 10: { name: 'A', price: 1 }, 12: { name: 'C', price: 3 } },
    });
    const result = await lookupProductsInShop(
      { query: 'x' },
      { shop, catalog: fakeCatalog(), now },
    );

    expect(result.fetched.map((p) => p.productId)).toEqual([10, 12]);
    // Nie je to chyba ani nedotiahnutý produkt — je to tretia možnosť.
    expect(result.notInShopIds).toEqual([11]);
    expect(result.notFetchedIds).toEqual([]);
    expect(result.notFetchedReason).toBe('none');
    expect(result.error).toBeNull();
  });

  it('iná chyba zastaví zvyšok — každý ďalší pokus by stál čítanie', async () => {
    const { shop, calls } = fakeShop({
      ids: [10, 11, 12],
      total: 3,
      products: { 10: { name: 'A', price: 1 }, 12: { name: 'C', price: 3 } },
      broken: [11],
    });
    const result = await lookupProductsInShop(
      { query: 'x' },
      { shop, catalog: fakeCatalog(), now },
    );

    expect(result.fetched.map((p) => p.productId)).toEqual([10]);
    expect(result.notFetchedReason).toBe('failed');
    expect(result.notFetchedIds).toEqual([11, 12]);
    // Do stavu ide KÓD, nikdy text odpovede shopu (I1).
    expect(result.error).toBe('boom');
    expect(calls.filter((c) => c.kind === 'get').map((c) => c.detail)).toEqual(['10', '11']);
  });
});

/* ═══════════════════ 4. Rozpočet — to najdrahšie na hľadaní ═══════════════ */

describe('dohľadanie a zdieľaný rozpočet čítaní', () => {
  it('minutý denný rozpočet neposiela na shop nič a NIE JE to chyba', async () => {
    const budget = memoryBudget();
    await budget.reserve(ANON.perUtcDay);
    const { shop, calls } = fakeShop({ ids: [1], total: 1 });

    const result = await lookupProductsInShop(
      { query: 'x' },
      { shop, catalog: fakeCatalog({ budget }), now },
    );

    expect(result.outcome).toBe('budget_day');
    expect(result.error).toBeNull();
    expect(result.readsUsed).toBe(0);
    expect(calls).toHaveLength(0);
    // Rozpočet sa vracia celý, aby obrazovka vedela povedať dokedy.
    expect(result.reads?.resetAt.toISOString()).toBe('2026-08-18T00:00:00.000Z');
  });

  it('nečitateľné počítadlo NIE JE minutý rozpočet (I11)', async () => {
    const { shop, calls } = fakeShop({ ids: [1], total: 1 });
    const result = await lookupProductsInShop(
      { query: 'x' },
      { shop, catalog: fakeCatalog({ budget: memoryBudget(brokenStore()) }), now },
    );

    // Dva rôzne výsledky, nie jeden: „dnes už nič" je meraný fakt, toto je
    // medzera v poznaní. Zliať ich by znamenalo tvrdiť číslo, ktoré nepoznáme.
    expect(result.outcome).toBe('budget_unknown');
    expect(result.reads?.known).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('rezervuje sa PRED volaním — aj volanie, ktoré spadne, sa počíta', async () => {
    const budget = memoryBudget();
    const { shop } = fakeShop({ indexFails: true });

    const result = await lookupProductsInShop(
      { query: 'x' },
      { shop, catalog: fakeCatalog({ budget }), now },
    );

    expect(result.outcome).toBe('failed');
    expect(result.readsUsed).toBe(1);
    // Shop si neúspešné volanie do stropu započítal tiež — inak by sa strop
    // prekročil práve vtedy, keď shop hlási, že sme na hrane.
    expect((await budget.status()).used).toBe(1);
  });

  it('minútový strop plán SKRÁTI, nezruší celé hľadanie', async () => {
    const budget = memoryBudget();
    // Do minúty zostávajú tri čítania: jedno na hľadanie, dve na názvy.
    await budget.reserve(ANON.perMinute - 3);
    const { shop } = fakeShop({
      ids: [1, 2, 3, 4],
      total: 4,
      products: {
        1: { name: 'A', price: 1 },
        2: { name: 'B', price: 2 },
        3: { name: 'C', price: 3 },
        4: { name: 'D', price: 4 },
      },
    });

    const result = await lookupProductsInShop(
      { query: 'x' },
      { shop, catalog: fakeCatalog({ budget }), now },
    );

    expect(result.outcome).toBe('done');
    expect(result.fetched.map((p) => p.productId)).toEqual([1, 2]);
    // Dôvod je „o chvíľu to pôjde", nie „spresni otázku" — sú to iné vety.
    expect(result.notFetchedReason).toBe('budget_minute');
    expect(result.notFetchedIds).toEqual([3, 4]);
  });

  it('vyčerpaná minúta zruší hľadanie skôr, než sa čokoľvek pošle', async () => {
    const budget = memoryBudget();
    await budget.reserve(ANON.perMinute);
    const { shop, calls } = fakeShop({ ids: [1], total: 1 });

    const result = await lookupProductsInShop(
      { query: 'x' },
      { shop, catalog: fakeCatalog({ budget }), now },
    );

    expect(result.outcome).toBe('budget_minute');
    expect(calls).toHaveLength(0);
  });

  it('strop jedného hľadania sa nedá prekročiť parametrom', async () => {
    const ids = Array.from({ length: 25 }, (_, index) => index + 1);
    const products = Object.fromEntries(ids.map((id) => [id, { name: `P${id}`, price: id }]));
    const { shop } = fakeShop({ ids, total: 41_082, products });

    const result = await lookupProductsInShop(
      { query: 'x' },
      { shop, catalog: fakeCatalog(), now, resolveLimit: 999 },
    );

    // 41 082 volaní `get` nie je hľadanie, to je sťahovanie katalógu — a to
    // dokumentácia shopu výslovne zakazuje.
    expect(result.fetched).toHaveLength(LOOKUP_RESOLVE_MAX);
    expect(result.readsUsed).toBe(LOOKUP_RESOLVE_MAX + 1);
    expect(result.notFetchedReason).toBe('limit');
    expect(result.shopTotal).toBe(41_082);
  });

  it('prázdna otázka nespotrebuje nič', async () => {
    const { shop, calls } = fakeShop({ ids: [1] });
    const result = await lookupProductsInShop(
      { query: '   ' },
      { shop, catalog: fakeCatalog(), now },
    );
    expect(result.outcome).toBe('no_query');
    expect(calls).toHaveLength(0);
  });
});

/* ══════════ 5. Čo appka nevie a prečo — tri stavy, nikdy dva ══════════════ */

interface FakeKeyOptions {
  readonly scopes?: readonly ShopScope[] | null;
  readonly hasKey?: boolean;
  readonly full?: Readonly<Record<number, Partial<ProductFullDetail>>>;
}

function fakeKeyWorld(options: FakeKeyOptions = {}): {
  deps: Parameters<typeof resolveProductCodes>[1];
  fullCalls: number[];
} {
  const fullCalls: number[] = [];
  return {
    fullCalls,
    deps: {
      shop: {
        async getProductFull(id: number): Promise<ProductFullDetail> {
          fullCalls.push(id);
          const patch = (options.full ?? {})[id] ?? {};
          return {
            id,
            name: `P${id}`,
            price: 10,
            has_attributes: false,
            reduction: { state: 'none' },
            ...patch,
          };
        },
      },
      apiKey: {
        loadForUse: async () => (options.hasKey === false ? null : testKey),
        recallScopes: () => ({
          scopes: options.scopes === undefined ? null : options.scopes,
          checkedAt: options.scopes === undefined ? null : NOW,
        }),
      },
      now,
    },
  };
}

describe('zamknuté funkcie — `product:read`', () => {
  it('bez overeného kľúča je stav NEVIEME, nie „nemá"', () => {
    const capabilities = shopCapabilities(null);
    expect(capabilities.exactFilters.state).toBe('unknown');
    expect(capabilities.categories.state).toBe('unknown');
    expect(capabilities.productCode.state).toBe('unknown');
    // Veta musí byť, mlčanie je najhoršia možnosť.
    expect(capabilities.exactFilters.note).toContain('Nevieme');
    expect(capabilities.exactFilters.requires).toBe('product:read');
  });

  it('kľúč bez oprávnenia je `locked` a veta povie, čo si vypýtať', () => {
    const capabilities = shopCapabilities(['product:edit']);
    expect(capabilities.categories.state).toBe('locked');
    expect(capabilities.categories.note).toContain('product:read');
  });

  it('kľúč s oprávnením funkcie odomkne a veta zmizne', () => {
    const capabilities = shopCapabilities(['product:edit', 'product:read']);
    expect(capabilities.exactFilters.state).toBe('available');
    expect(capabilities.exactFilters.note).toBeNull();
  });

  it('chýbajúca metóda `recallScopes` znamená NEVIEME, nie „nemá"', () => {
    expect(recalledScopes({})).toBeNull();
    expect(shopCapabilities(recalledScopes({})).productCode.state).toBe('unknown');
  });
});

describe('kód produktu — len pre vybrané produkty (bod 20)', () => {
  it('bez známych scopes sa `getFull` NEVOLÁ', async () => {
    const { deps, fullCalls } = fakeKeyWorld();
    const result = await resolveProductCodes([1, 2], deps);

    expect(result.outcome).toBe('unknown_scope');
    expect(result.capability.state).toBe('unknown');
    expect(result.skippedIds).toEqual([1, 2]);
    expect(fullCalls).toEqual([]);
  });

  it('bez oprávnenia sa `getFull` NEVOLÁ a odpoveď povie prečo', async () => {
    const { deps, fullCalls } = fakeKeyWorld({ scopes: ['product:edit'] });
    const result = await resolveProductCodes([1], deps);

    expect(result.outcome).toBe('locked');
    expect(result.capability.note).toContain('product:read');
    expect(fullCalls).toEqual([]);
  });

  it('s oprávnením dotiahne kód produktu aj kódy variantov', async () => {
    const { deps, fullCalls } = fakeKeyWorld({
      scopes: ['product:read'],
      full: {
        49: {
          reference: 'C16.19',
          attributes: [
            { id_product_attribute: 112, reference: 'C16.19-A' },
            { id_product_attribute: 113, reference: null },
          ],
        },
        50: { reference: null },
      },
    });
    const result = await resolveProductCodes([49, 50], deps);

    expect(result.outcome).toBe('done');
    expect(result.codes).toEqual([
      { productId: 49, reference: 'C16.19', variantReferences: ['C16.19-A'] },
      // Shop kód pri produkte nevedie — `null` je odpoveď, nie prázdny string.
      { productId: 50, reference: null, variantReferences: [] },
    ]);
    expect(fullCalls).toEqual([49, 50]);
  });

  it('strop jedného volania sa nedá prekročiť parametrom', async () => {
    const ids = Array.from({ length: 40 }, (_, index) => index + 1);
    const { deps, fullCalls } = fakeKeyWorld({ scopes: ['product:read'] });
    const result = await resolveProductCodes(ids, { ...deps, limit: 999 });

    // Kód sa doťahuje pre VÝBER, nikdy pre katalóg — a `getFull` ide s kľúčom,
    // teda z tej istej kvóty, z ktorej zapisuje fronta.
    expect(fullCalls).toHaveLength(CODE_LOOKUP_MAX);
    expect(result.skippedIds).toHaveLength(ids.length - CODE_LOOKUP_MAX);
  });

  it('chýbajúci kľúč nie je chyba hľadania, je to „nedá sa"', async () => {
    const { deps, fullCalls } = fakeKeyWorld({ scopes: ['product:read'], hasKey: false });
    const result = await resolveProductCodes([1], deps);
    expect(result.outcome).toBe('no_key');
    expect(fullCalls).toEqual([]);
  });
});

/* ═══════════════════ 6. Route — čo dostane obrazovka ══════════════════════ */

function sessionDeps(): RouteDeps {
  return {
    now,
    newRequestId: () => '01J0000000000000000FIND02',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

interface RouteWorld {
  /** Riadky, ktoré vráti textové hľadanie nad zrkadlom. */
  readonly page?: readonly CatalogSearchRow[];
  readonly shop?: FakeShopOptions;
  readonly mirror?: readonly number[];
  readonly budget?: ReadBudget;
}

function routeDepsFor(world: RouteWorld): {
  deps: CatalogSearchRouteDeps;
  calls: ShopCall[];
} {
  const { shop, calls } = fakeShop(world.shop ?? {});
  const lookupCatalog = fakeCatalog({
    ...(world.mirror !== undefined ? { mirror: world.mirror } : {}),
    ...(world.budget !== undefined ? { budget: world.budget } : {}),
  });

  const searchResult = (filter: CatalogSearchFilter): CatalogSearchResult => ({
    data:
      filter.productIds === undefined
        ? [...(world.page ?? [])]
        : filter.productIds.map((id) => mirrorRow(id, `Zrkadlo ${id}`, 4)),
    page: filter.page ?? 1,
    perPage: filter.perPage ?? 50,
    total: (world.page ?? []).length,
    soldWindowDays: 180,
    soldFrom: '2026-02-18',
    soldTo: '2026-08-17',
    lockedFilters: ['stock', 'category', 'metal', 'jewelryType', 'margin', 'turnover'],
    enrichedOnly: ['referenceSearch', 'ean13Search', 'shopDiscounted'],
  });

  return {
    calls,
    deps: {
      routeDeps: sessionDeps(),
      now,
      shop: { ...shop, getProductFull: async () => { throw new Error('nemá sa volať'); } },
      apiKey: { loadForUse: async () => testKey, recallScopes: () => ({ scopes: null, checkedAt: null }) },
      catalog: {
        search: async (filter) => searchResult(filter),
        counts: async () => ({
          total: 0,
          sold: { none: 0, low: 0, mid: 0, high: 0 },
          neverDiscounted: 0,
          discountedNow: 0,
          shopDiscountedNow: 0,
          enrichedRows: 0,
          soldWindowDays: 180,
          soldFrom: '2026-02-18',
          soldTo: '2026-08-17',
          lockedFilters: [],
          enrichedOnly: [],
        }),
        totalRows: async () => 2_900,
        lastFetchedAt: async () => new Date('2026-08-16T03:00:00.000Z'),
      },
      catalogLookup: {
        ...lookupCatalog,
        search: async (filter) => searchResult(filter),
        factsFor: async (productIds) => ({
          facts: new Map(
            [...productIds].map((id) => [
              id,
              { unitsSold: 0, everDiscounted: false, discountedNow: false },
            ]),
          ),
          soldWindowDays: 180,
          soldFrom: '2026-02-18',
          soldTo: '2026-08-17',
        }),
      },
    },
  };
}

interface RouteBody {
  ok: boolean;
  data: {
    data: Array<{ productId: number; origin: string; name: string | null }>;
    total: number;
    totalSource: string;
    lookup: Record<string, unknown>;
    codes: Record<string, unknown>;
    capabilities: Record<string, { state: string; note: string | null }>;
  };
}

async function callSearch(query: string, world: RouteWorld = {}): Promise<{
  body: RouteBody;
  calls: ShopCall[];
}> {
  const { deps, calls } = routeDepsFor(world);
  const response = await createCatalogSearchRoute(deps)(
    new Request(`https://zlavy.local/api/catalog/search${query}`, {
      headers: { cookie: 'ovl_zliav_session=x' },
    }),
  );
  expect(response.status).toBe(200);
  return { body: (await response.json()) as RouteBody, calls };
}

describe('GET /api/catalog/search — hľadanie na obrazovke', () => {
  it('predvolene sa na shop NESIAHNE a každý riadok povie, odkiaľ je', async () => {
    const { body, calls } = await callSearch('?q=naramok', {
      page: [mirrorRow(1, 'Náramok'), mirrorRow(2, 'Náramok II')],
    });

    // Dohľadanie míňa rozpočet, takže sa nesmie spustiť samo (kontrakt bod 4).
    expect(calls).toHaveLength(0);
    expect(body.data.lookup.outcome).toBe('off');
    expect(body.data.lookup.requested).toBe(false);
    expect(body.data.totalSource).toBe('mirror');
    expect(body.data.data.map((row) => row.origin)).toEqual(['mirror', 'mirror']);
  });

  it('`lookup=1` pripojí dohľadané NA KONIEC v poradí relevancie', async () => {
    const { body } = await callSearch('?q=C16.19&lookup=1', {
      // Textové hľadanie nad názvom v zrkadle nenájde nič — kód v ňom nie je.
      page: [],
      mirror: [77],
      shop: {
        // Eshop hľadá aj v kóde: 30582 zrkadlo nemá, 77 má.
        ids: [30582, 77],
        total: 2,
        products: { 30582: { name: 'Náramok C16.19', price: 24.5 } },
      },
    });

    expect(body.data.data.map((row) => [row.productId, row.origin])).toEqual([
      [30582, 'shop'],
      [77, 'mirror'],
    ]);
    expect(body.data.lookup).toMatchObject({
      requested: true,
      outcome: 'done',
      shopTotal: 2,
      candidates: 2,
      inMirror: 1,
      missingFromMirror: 1,
      addedRows: 2,
      addedFromShop: 1,
      addedFromMirror: 1,
      readsUsed: 2,
    });
    // Konkrétny čas, nikdy „pred chvíľou" (kontrakt bod 10).
    expect(body.data.lookup.at).toBe('2026-08-17T09:00:00.000Z');
    // `total` ostáva počtom v ZRKADLE; koľko ich má eshop, hovorí `shopTotal`.
    expect(body.data.total).toBe(0);
  });

  it('ten istý produkt sa nezobrazí dvakrát', async () => {
    const { body } = await callSearch('?q=naramok&lookup=1', {
      page: [mirrorRow(5, 'Náramok')],
      mirror: [5],
      shop: { ids: [5], total: 1 },
    });

    expect(body.data.data).toHaveLength(1);
    expect(body.data.lookup.addedRows).toBe(0);
  });

  it('dohľadanie je doplnok PRVEJ stránky, na ďalších sa nespúšťa', async () => {
    const { body, calls } = await callSearch('?q=x&lookup=1&page=2', { page: [] });
    expect(body.data.lookup.outcome).toBe('not_first_page');
    expect(calls).toHaveLength(0);
  });

  it('odpoveď vždy povie, čo appka nevie a prečo', async () => {
    const { body } = await callSearch('?q=x', { page: [] });
    expect(body.data.capabilities.exactFilters?.state).toBe('unknown');
    expect(body.data.capabilities.categories?.state).toBe('unknown');
    expect(body.data.capabilities.productCode?.note).toContain('product:read');
    expect(body.data.codes.outcome).toBe('off');
  });

  it('kód produktu bez oprávnenia nespustí ani jedno volanie', async () => {
    const { body } = await callSearch('?productIds=1,2&codes=1', { page: [] });
    // Kľúč v tomto teste hlási neznáme scopes, takže sa `getFull` nesmie volať —
    // fake by na ňom spadol.
    expect(body.data.codes.outcome).toBe('unknown_scope');
    expect(body.data.codes.skipped).toEqual([1, 2]);
  });
});

/* ═════════ 7. Poistka: hľadanie NIČ nezapisuje — ani do DB, ani do shopu ══ */

describe('hľadanie je čisté čítanie', () => {
  it('moduly hľadania neobsahujú zápis do zrkadla ani do shopu', () => {
    const dir = resolve(process.cwd(), 'src/lib/catalog');

    /*
     * ZÁKAZ PLATÍ NA HĽADACIE MODULY, NIE NA CELÝ PRIEČINOK.
     *
     * Pôvodne sa skenovalo všetko v `src/lib/catalog` — vtedy tam boli len
     * hľadacie moduly. 20. 8. 2026 pribudol `product-details.ts`, ktorý
     * detaily do zrkadla ZÁMERNE zapisuje: bez toho by sa kód a EAN museli
     * doťahovať znova pri každom prelistovaní stránky.
     *
     * Zákaz sa preto nezrušil, ale zúžil — a to, čo chránil, sa pre
     * `product-details.ts` tvrdí PRÍSNEJŠIE inde: nesmie riadok ZALOŽIŤ, len
     * obohatiť existujúci. Práve zakladanie by nafúklo `COUNT(*)`, z ktorého
     * sa ráta, koľko katalógu chýba (bod 16). Stráži to `detaily-produktov.spec.ts`
     * skutočným behom `fillProductDetails()` nad zrkadlom, ktoré sa správa ako
     * `ON DUPLICATE KEY UPDATE`.
     */
    const VYNIMKA = new Set(['product-details.ts']);
    const files = readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && !VYNIMKA.has(name),
    );
    expect(files.length).toBeGreaterThan(0);
    // Poistka: výnimka smie menovať len súbor, ktorý naozaj existuje.
    for (const name of VYNIMKA) {
      expect(readdirSync(dir), `výnimka ${name} je pre neexistujúci súbor`).toContain(name);
    }

    for (const name of files) {
      const code = readFileSync(join(dir, name), 'utf8');
      /*
       * `upsert` by nafúklo `COUNT(*)` zrkadla bez toho, aby prechod
       * synchronizácie čokoľvek prečítal — a práve z toho počtu sa ráta
       * „koľko katalógu chýba" a „dokedy to potrvá" (kontrakt bod 16).
       * `setReduction` v čítacej ceste je I10/K11.
       */
      expect(code, `${name} zapisuje do zrkadla`).not.toMatch(/upsert/i);
      expect(code, `${name} siaha na zápis zľavy`).not.toMatch(/setReduction/);
    }
  });

  it('anonymná vetva hľadania nemá kadiaľ podstrčiť kľúč (D48, I1)', () => {
    const raw = readFileSync(resolve(process.cwd(), 'src/lib/catalog/shop-lookup.ts'), 'utf8');
    // Komentáre sa vyhadzujú zámerne: vysvetliť invariant slovami je správne,
    // a doc-blok modulu ten istý invariant popisuje aj s názvom typu. Skener
    // má merať KÓD, nie text o kóde — inak by pípal práve na dobrý komentár.
    // Modul nemá regulárne výrazy ani reťazce s `//`, takže tento orez stačí.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

    // `searchIndex` aj `get` sú verejné. Keby modul vedel o `SecretRef` alebo
    // si kľúč vedel načítať sám, anonymná cesta by prestala byť anonymná —
    // a rozpočet by sa ticho presunul z IP na kľúč.
    expect(code).not.toMatch(/SecretRef|loadForUse|apiKeyRepo/);
    // Poistka, že orez naozaj nechal kód: hľadanie samo v ňom byť musí.
    expect(code).toMatch(/searchIndex/);
  });

  /*
   * TU BÝVAL SKENER ZDROJOVÉHO TEXTU `product-details.ts`
   * („doťahovanie detailov riadok NEZAKLADÁ, len obohatí existujúci").
   *
   * Hľadal v kóde reťazce `notInMirror =`, `row === undefined || row.missing`
   * a `!outside.has(id)`. Všetky tri tam boli — a napriek tomu ručná obnova
   * (`force: true`, ktorú `POST /api/catalog/details` prijíma z tela
   * požiadavky) celý ten filter obchádzala a cudzie ID do zrkadla VLOŽILA.
   * Test bol zelený po celý čas, lebo meral prítomnosť riadkov v súbore,
   * nie správanie funkcie.
   *
   * Nahradil ho behový test v `test/unit/detaily-produktov.spec.ts`
   * (sekcia „doťahovanie zrkadlo nenapĺňa, len obohacuje"): pustí
   * `fillProductDetails()` s ID mimo zrkadla — obe cesty aj s `force` —
   * nad zrkadlom, ktoré sa správa ako `ON DUPLICATE KEY UPDATE`, a zmeria,
   * že žiadny riadok nevznikol a že ID prišlo späť v `notInMirror`.
   * Druhá kópia tu by už len brzdila refaktor toho istého správania.
   */
});
