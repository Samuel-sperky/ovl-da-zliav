/**
 * Aura Zľavy — OBOHATENIE STRANY NA DOPYT (KONTRAKT-V5-2026-09-01: D123, R2;
 * I1, I11).
 *
 * D118 poznalo dve cesty: jeden produkt na klik a nočnú dávku. Pri kvóte
 * 20/min a 200/deň sa nič iné nezmestilo, takže tabuľka Produktov bola prázdna
 * bez ohľadu na to, ako dobre bola navrhnutá. 1. 9. 2026 správca shopu zdvihol
 * kvótu na 150/min a 1000/deň (appka si berie 120/min a 800/deň) a strana po
 * 100 produktoch spadla zo 6,3 min na ~50 s — preto D123.
 *
 * Čo sa tu dokazuje a prečo práve to:
 *
 *  1. **Už obohatené riadky NEVOLAJÚ `getFull` vôbec.** Dokazuje to počítadlo
 *     volaní fake klienta, nie tvrdenie o kóde. Je to jediná brána, ktorá drží
 *     kvótu pri preklikávaní tabuľky: bez nej by šesť obnovení tej istej strany
 *     minulo dennú kvótu celú.
 *  2. **Sviežosť sa zisťuje JEDNÝM dotazom.** Sto riadkov na obrazovke znamená
 *     jeden dotaz do zrkadla, nie sto (N+1 by z lacnej brány urobil drahú).
 *  3. **Vyčerpaný denný cieľ NEOBOHACUJE a POVIE TO ČÍSLOM** (R2). Mlčanie by
 *     znamenalo, že človek vidí pomlčky a nevie, či je appka pokazená alebo
 *     len na strope dňa.
 *  4. **`ip_banned` neoznačí NIČ** — ani ako obohatené, ani ako pokus (D120).
 *     Ban je výrok o ceste k shopu, nie o produkte; dôvod si zapíše do stavu,
 *     aby o ňom vedela aj nočná dávka.
 *  5. **Chýbajúci kľúč je ČITATEĽNÝ DÔVOD, nie chyba appky.** Toto je dnešná
 *     realita: `shop_write` kľúč 1. 9. 2026 v appke NIE JE (`present: false`),
 *     takže cesta „nie je kľúč" je bežný stav, nie výnimka.
 *  6. **Čas jedného volania je zastropovaný.** Keď sa strana do stropu
 *     nezmestí, vráti sa, čo sa stihlo, a zvyšok ID ide von v `skipped` —
 *     obrazovka nesmie visieť na otvorenom spojení.
 *  7. **Dve strany naraz nebežia.** Pauzy medzi čítaniami platia na beh, takže
 *     dva behy by minútový strop kľúča rozbili.
 *
 * Shop je fake klient (počítadlo volaní je celá pointa bodov 1, 3, 4 a 5);
 * zrkadlo katalógu je pamäťová náhrada. PRODUKČNÝ ESHOP SA TU NEVOLÁ (I6).
 * Že to isté prežije MariaDB a skutočná route, dokazuje
 * `test/integration/obohacovanie-dopyt.spec.ts`.
 *
 * Vlastník: V5 (obohacovanie strany).
 */
import { describe, expect, it } from 'vitest';

import type {
  CatalogEnrichmentRecord,
  DateOnly,
  ProductFullDetail,
  SecretHandle,
  SecretRef,
  UtcDate,
} from '@/contracts';

import {
  ENRICH_PAGE_MAX_MS,
  ENRICH_PAGE_MAX_PRODUCTS,
  MIN_ENRICH_READ_PAUSE_MS,
  enrichPageOnDemand,
  type EnrichCatalogRepo,
  type EnrichPageDeps,
  type EnrichPageResult,
} from '@/lib/engine/catalog-enrich';
import {
  DEFAULT_ENRICH_DAILY_TARGET,
  ENRICH_PRIORITY_REST,
  emptyCatalogEnrichState,
  type CatalogEnrichState,
  type CatalogEnrichWrite,
} from '@/lib/repo/catalog.repo';
import type { ShopScope } from '@/lib/shop/client';
import { makeShopError, ShopRequestError } from '@/lib/shop/errors';
import { KEYED_FALLBACK_PER_MINUTE } from '@/lib/shop/rate-limits';
import {
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudget,
} from '@/lib/shop/read-budget';

const NOW = new Date('2026-09-01T09:00:00.000Z');
const TODAY = '2026-09-01';
const SCOPES: readonly ShopScope[] = ['product:read', 'product:edit'];

/** `SecretRef` nad textom — kľúč v testoch nikdy nie je skutočný (I1). */
const testKey: SecretRef = async (): Promise<SecretHandle> => {
  const value = Buffer.from('test-key', 'utf8');
  return { value, release: () => value.fill(0) };
};

/* ═══════════════════ 1. Pamäťové zrkadlo obohatenia ═══════════════════════ */

interface MirrorRow {
  enrichedAt: UtcDate | null;
  attemptedAt: UtcDate | null;
  write: CatalogEnrichWrite | null;
}

interface Mirror extends EnrichCatalogRepo {
  readonly rows: Map<number, MirrorRow>;
  /** Koľkokrát sa niekto pýtal na sviežosť — dôkaz, že strana je JEDEN dotaz. */
  enrichmentCalls: number;
  state: CatalogEnrichState;
}

function mirror(opts: {
  productIds: readonly number[];
  /** Ktoré riadky sú už obohatené (a odkedy). */
  enrichedAt?: (productId: number) => UtcDate | null;
  state?: Partial<CatalogEnrichState>;
}): Mirror {
  const rows = new Map<number, MirrorRow>(
    opts.productIds.map((id) => [
      id,
      { enrichedAt: opts.enrichedAt?.(id) ?? null, attemptedAt: null, write: null },
    ]),
  );
  const self: Mirror = {
    rows,
    enrichmentCalls: 0,
    state: { ...emptyCatalogEnrichState(), ...opts.state },

    async saveEnrichment(productId, data) {
      const row = rows.get(productId);
      // Turbopack tu už raz zahodil `if (!row)` ako compile-time falsy.
      if (row === undefined) return false;
      const at = data.enrichedAt ?? NOW;
      row.write = data;
      row.enrichedAt = at;
      row.attemptedAt = at;
      return true;
    },

    async enrichmentFor(productIds) {
      self.enrichmentCalls += 1;
      const out = new Map<number, CatalogEnrichmentRecord>();
      for (const productId of productIds) out.set(productId, toRecord(productId, rows.get(productId)));
      return out;
    },

    async markEnrichAttempt(productId, at) {
      const row = rows.get(productId);
      if (row === undefined) return;
      row.attemptedAt = at ?? NOW;
    },

    async nextToEnrich() {
      throw new Error('strana na dopyt sa frontu NIKDY nepýta');
    },

    async refreshEnrichPriority() {
      throw new Error('strana na dopyt priority NEPREPOČÍTAVA');
    },

    async loadEnrichState() {
      return { ...self.state };
    },

    async saveEnrichState(next) {
      self.state = { ...next };
    },
  };
  return self;
}

/** Prázdny riadok obohatenia = samé `null`, teda „nevieme" (I11). */
function toRecord(productId: number, row: MirrorRow | undefined): CatalogEnrichmentRecord {
  const write = row?.write ?? null;
  return {
    productId,
    reference: write?.reference ?? null,
    ean13: write?.ean13 ?? null,
    purchasePrice: write?.purchasePrice ?? null,
    margin: write?.margin ?? null,
    marginPercent: write?.marginPercent ?? null,
    sellPriceWithVat: write?.sellPriceWithVat ?? null,
    lastTimeInOrder: null,
    qty: write?.qty ?? null,
    qtyInOrders: write?.qtyInOrders ?? null,
    supplier: write?.supplier ?? null,
    reductionPercent: write?.reductionPercent ?? null,
    reductionFrom: null,
    reductionTo: null,
    active: typeof write?.active === 'boolean' ? write.active : null,
    categories: write?.categories === undefined ? null : (write.categories ?? null),
    enrichedAt: row?.enrichedAt ?? null,
    enrichAttemptedAt: row?.attemptedAt ?? null,
    enrichPriority: ENRICH_PRIORITY_REST,
  };
}

/* ═══════════════════════════ 2. Fake shop ═════════════════════════════════ */

const shopError = (
  kind: Parameters<typeof makeShopError>[0]['kind'],
  code: string,
  httpStatus: number,
): ShopRequestError => new ShopRequestError(makeShopError({ kind, code, httpStatus }));

const ipBanned = (): ShopRequestError => shopError('forbidden', 'ip_banned', 403);
const notFound = (): ShopRequestError => shopError('not_found', 'not_found', 404);

interface FakeShop {
  readonly calls: number[];
  getProductFull(id: number, key: SecretRef): Promise<ProductFullDetail>;
}

function fakeShop(
  reply: (id: number, call: number) => ProductFullDetail | ShopRequestError = (id) => plainFull(id),
): FakeShop {
  const calls: number[] = [];
  return {
    calls,
    async getProductFull(id: number, key: SecretRef): Promise<ProductFullDetail> {
      calls.push(id);
      // Kľúč sa dešifruje a uvoľní rovnako ako v produkcii (I1, D64).
      const handle = await key();
      handle.release();
      const value = reply(id, calls.length);
      if (value instanceof ShopRequestError) throw value;
      return value;
    },
  };
}

const plainFull = (id: number): ProductFullDetail => ({
  id,
  name: `Šperk ${String(id)}`,
  price: 19.99,
  has_attributes: false,
  reference: `REF-${String(id)}`,
  qty: 0,
  reduction: { state: 'none' },
});

/** Skutočný rozpočet nad pamäťou — aritmetika je tá, ktorá chráni produkciu. */
function memoryBudget(usedToday = 0, now: () => UtcDate = () => NOW): ReadBudget {
  const store = createMemoryReadBudgetStore();
  const budget = createReadBudget({ store, lane: 'product_read', now });
  if (usedToday > 0) void store.add('product_read', TODAY as DateOnly, usedToday);
  return budget;
}

function deps(opts: {
  shop: FakeShop;
  catalog: Mirror;
  reads?: ReadBudget;
  scopes?: readonly ShopScope[] | null;
  hasKey?: boolean;
  freshMs?: number;
  maxMs?: number;
  now?: () => UtcDate;
  sleepFn?: (ms: number) => Promise<void>;
}): EnrichPageDeps {
  return {
    shop: opts.shop,
    catalog: opts.catalog,
    reads: opts.reads ?? memoryBudget(0, opts.now ?? ((): UtcDate => NOW)),
    apiKey: {
      loadForUse: async () => (opts.hasKey === false ? null : testKey),
      recallScopes: () => ({
        scopes: opts.scopes === undefined ? SCOPES : opts.scopes,
        checkedAt: opts.scopes === null ? null : NOW,
      }),
    },
    now: opts.now ?? ((): UtcDate => NOW),
    // Testy nespomalia: tempo drží PAUZA v produkcii, tu si podsúvame vlastný spánok.
    sleepFn: opts.sleepFn ?? (async () => {}),
    ...(opts.freshMs !== undefined ? { freshMs: opts.freshMs } : {}),
    ...(opts.maxMs !== undefined ? { maxMs: opts.maxMs } : {}),
  };
}

/** Sto ID ako na jednej strane tabuľky. */
const PAGE = Array.from({ length: ENRICH_PAGE_MAX_PRODUCTS }, (_, i) => 70_000 + i);

/** Dnešný stav dávky — bez neho by `enriched_today` patrilo inému dňu. */
const todayState = (patch: Partial<CatalogEnrichState> = {}): Partial<CatalogEnrichState> => ({
  batchDay: TODAY,
  enrichedToday: 0,
  dailyTarget: DEFAULT_ENRICH_DAILY_TARGET,
  ...patch,
});

/* ══════════════ 3. Svieže riadky nevolajú shop (body 1 a 2) ═══════════════ */

describe('strana na dopyt: platí sa len za to, čo appka nevie', () => {
  it('obohatí LEN neobohatené riadky — svieže nevolajú `getFull` vôbec', async () => {
    // Prvých 40 riadkov je obohatených pred hodinou, zvyšok nikdy.
    const hourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    const catalog = mirror({
      productIds: PAGE,
      enrichedAt: (id) => (PAGE.indexOf(id) < 40 ? hourAgo : null),
    });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(PAGE, deps({ shop, catalog }));

    expect(result.outcome).toBe('done');
    expect(result.requested).toBe(ENRICH_PAGE_MAX_PRODUCTS);
    expect(result.fresh).toBe(40);
    expect(result.stale).toBe(60);
    expect(result.enriched).toBe(60);
    expect(result.readsUsed).toBe(60);
    expect(result.skipped).toEqual([]);
    // Celý dôkaz: klient dostal PRESNE nesvieže ID a ani jedno svieže.
    expect(shop.calls).toEqual(PAGE.slice(40));
    // A sviežosť sa zisťovala JEDNÝM dotazom, nie dotazom na produkt (N+1).
    expect(catalog.enrichmentCalls).toBe(1);
  });

  it('celá strana svieža = `fresh_only` a ANI JEDEN request', async () => {
    const catalog = mirror({ productIds: PAGE, enrichedAt: () => NOW });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(PAGE, deps({ shop, catalog }));

    expect(result.outcome).toBe('fresh_only');
    expect(result.fresh).toBe(ENRICH_PAGE_MAX_PRODUCTS);
    expect(result.stale).toBe(0);
    expect(result.attempted).toBe(0);
    expect(result.readsUsed).toBe(0);
    // `fresh_only` NIE JE chyba — je to nezaplatená kvóta.
    expect(result.error).toBeNull();
    expect(shop.calls).toEqual([]);
  });

  it('duplikáty a neplatné ID sa zahodia, strop je 100 ID', async () => {
    const many = [...PAGE, ...PAGE.slice(0, 10), 0, -5, 1.5];
    const catalog = mirror({ productIds: PAGE });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(many, deps({ shop, catalog }));

    expect(result.requested).toBe(ENRICH_PAGE_MAX_PRODUCTS);
    expect(result.dropped).toBe(many.length - ENRICH_PAGE_MAX_PRODUCTS);
    expect(shop.calls).toHaveLength(ENRICH_PAGE_MAX_PRODUCTS);
  });

  it('prázdny zoznam nič nevolá a nie je to chyba', async () => {
    const catalog = mirror({ productIds: PAGE });
    const shop = fakeShop();

    const result = await enrichPageOnDemand([], deps({ shop, catalog }));

    expect(result.outcome).toBe('no_ids');
    expect(shop.calls).toEqual([]);
    expect(catalog.enrichmentCalls).toBe(0);
  });
});

/* ══════════════ 4. Denný cieľ: strop, ktorý sa povie ČÍSLOM ═══════════════ */

describe('strana na dopyt: vyčerpaný denný cieľ (R2)', () => {
  it('naplnený cieľ NEOBOHACUJE a odpoveď nesie čísla, nie mlčanie', async () => {
    const catalog = mirror({
      productIds: PAGE,
      state: todayState({ enrichedToday: DEFAULT_ENRICH_DAILY_TARGET }),
    });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(PAGE, deps({ shop, catalog }));

    expect(result.outcome).toBe('target_reached');
    expect(result.enriched).toBe(0);
    expect(result.readsUsed).toBe(0);
    // Toto je celý bod R2: obrazovka má čím povedať PREČO sú tam pomlčky.
    expect(result.day.enrichedTodayByBatch).toBe(DEFAULT_ENRICH_DAILY_TARGET);
    expect(result.day.dailyTarget).toBe(DEFAULT_ENRICH_DAILY_TARGET);
    expect(result.day.targetLeft).toBe(0);
    expect(result.day.readsUsedToday).toBe(0);
    expect(result.day.readsLeftToday).toBeGreaterThan(0);
    // Nesvieže ID sa priznajú ako „nedostalo sa na ne", nie ako obohatené.
    expect(result.skipped).toEqual(PAGE);
    expect(shop.calls).toEqual([]);
  });

  it('zvyšok cieľa je strop strany — zvyšok ID ide do `skipped`', async () => {
    const catalog = mirror({
      productIds: PAGE,
      state: todayState({ enrichedToday: DEFAULT_ENRICH_DAILY_TARGET - 5 }),
    });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(PAGE, deps({ shop, catalog }));

    expect(result.outcome).toBe('target_reached');
    expect(result.enriched).toBe(5);
    expect(shop.calls).toEqual(PAGE.slice(0, 5));
    expect(result.skipped).toEqual(PAGE.slice(5));
    expect(result.day.targetLeft).toBe(5);
  });

  it('počítadlo z INÉHO dňa nie je dnešok — cieľ neblokuje a číslo je `null`', async () => {
    const catalog = mirror({
      productIds: PAGE.slice(0, 3),
      state: { batchDay: '2026-08-31', enrichedToday: DEFAULT_ENRICH_DAILY_TARGET },
    });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(PAGE.slice(0, 3), deps({ shop, catalog }));

    expect(result.outcome).toBe('done');
    expect(result.enriched).toBe(3);
    // I11 — „dnes nebežala" nie je nula.
    expect(result.day.enrichedTodayByBatch).toBeNull();
    expect(result.day.targetLeft).toBe(DEFAULT_ENRICH_DAILY_TARGET);
  });

  it('progres DÁVKY strana nikdy neprepíše (jeden zapisovateľ)', async () => {
    const catalog = mirror({
      productIds: PAGE.slice(0, 4),
      state: todayState({ enrichedToday: 11, enrichedTotal: 111 }),
    });

    await enrichPageOnDemand(PAGE.slice(0, 4), deps({ shop: fakeShop(), catalog }));

    expect(catalog.state.enrichedToday).toBe(11);
    expect(catalog.state.enrichedTotal).toBe(111);
  });
});

/* ══════════════ 5. Fail-closed: shop nedosiahnuteľný, kľúč chýba ══════════ */

describe('strana na dopyt: nedosiahnuteľný shop neoznačí NIČ', () => {
  it('`ip_banned` zastaví stranu, nič neoznačí a dôvod zapíše (D120)', async () => {
    const ids = PAGE.slice(0, 5);
    const catalog = mirror({ productIds: ids, state: todayState() });
    const banned = ipBanned();
    const shop = fakeShop(() => banned);

    const result = await enrichPageOnDemand(ids, deps({ shop, catalog }));

    expect(result.outcome).toBe('ip_banned');
    expect(result.error).toBe('ip_banned');
    expect(result.enriched).toBe(0);
    // Ban platí pre celú cestu — druhý produkt sa už neskúša.
    expect(shop.calls).toEqual([ids[0]]);
    for (const id of ids) {
      const row = catalog.rows.get(id);
      expect(row?.enrichedAt ?? null).toBeNull();
      // Ani ako POKUS: ban nie je vina produktu (poradie fronty sa nemení).
      expect(row?.attemptedAt ?? null).toBeNull();
    }
    // Dôvod si zapíše do stavu, aby o ňom vedela aj nočná dávka.
    expect(catalog.state.pauseReason).toBe('ip_banned');
    expect(catalog.state.pausedUntil).toBeNull();
    // Zvyšok ID sa priznáva ako nespracovaný.
    expect(result.skipped).toEqual(ids);
  });

  it('stojaca pauza od shopu stranu vôbec nepustí k `getFull`', async () => {
    const ids = PAGE.slice(0, 3);
    const catalog = mirror({
      productIds: ids,
      state: todayState({ pauseReason: 'ip_banned', pausedUntil: null }),
    });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(ids, deps({ shop, catalog }));

    expect(result.outcome).toBe('paused');
    expect(result.error).toBe('ip_banned');
    expect(shop.calls).toEqual([]);
  });

  it('CHÝBAJÚCI KĽÚČ je čitateľný dôvod, nie chyba appky (dnešný stav)', async () => {
    const ids = PAGE.slice(0, 7);
    const catalog = mirror({ productIds: ids, state: todayState() });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(ids, deps({ shop, catalog, hasKey: false }));

    // `no_key` je MERANÝ stav, nie výnimka: `shop_write` kľúč 1. 9. 2026 chýba.
    expect(result.outcome).toBe('no_key');
    expect(result.enriched).toBe(0);
    expect(result.readsUsed).toBe(0);
    expect(shop.calls).toEqual([]);
    // Pauza sa NEZAPISUJE — kľúč vloží človek a ďalší klik to má skúsiť znova.
    expect(catalog.state.pauseReason).toBeNull();
    // A čísla dňa idú von aj tu, aby obrazovka mala čo povedať.
    expect(result.day.dailyTarget).toBe(DEFAULT_ENRICH_DAILY_TARGET);
  });

  it('neoverený kľúč je „nevieme", nie „nemá oprávnenie" (I11)', async () => {
    const ids = PAGE.slice(0, 3);
    const catalog = mirror({ productIds: ids, state: todayState() });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(ids, deps({ shop, catalog, scopes: null }));

    expect(result.outcome).toBe('unknown_scope');
    expect(shop.calls).toEqual([]);
  });

  it('minutý denný rozpočet čítaní neobohatí nič a povie kedy sa obnoví', async () => {
    const ids = PAGE.slice(0, 3);
    const catalog = mirror({ productIds: ids, state: todayState() });
    const shop = fakeShop();
    // Dráha `product_read` je vyčerpaná — rezerva na dopyt je TU nulová, takže
    // strop drží samotný denný rozpočet.
    const reads = memoryBudget(10_000);

    const result = await enrichPageOnDemand(ids, deps({ shop, catalog, reads }));

    expect(result.outcome).toBe('budget_day');
    expect(result.resumeAt).not.toBeNull();
    expect(shop.calls).toEqual([]);
    expect(result.day.readsLeftToday).toBe(0);
  });

  it('`not_found` je odpoveď o JEDNOM produkte — strana pokračuje', async () => {
    const ids = PAGE.slice(0, 4);
    const catalog = mirror({ productIds: ids, state: todayState() });
    const shop = fakeShop((id) => (id === ids[1] ? notFound() : plainFull(id)));

    const result = await enrichPageOnDemand(ids, deps({ shop, catalog }));

    expect(result.outcome).toBe('done');
    expect(result.notFound).toBe(1);
    expect(result.enriched).toBe(3);
    expect(shop.calls).toEqual(ids);
    // Neexistujúci produkt sa označí ako POKUS, aby nezjedol kvótu opakovaním.
    expect(catalog.rows.get(ids[1] as number)?.attemptedAt).not.toBeNull();
    expect(catalog.rows.get(ids[1] as number)?.enrichedAt ?? null).toBeNull();
  });
});

/* ══════════════ 6. Čas a súbežnosť (body 6 a 7) ═══════════════════════════ */

describe('strana na dopyt: strop času a jedna strana naraz', () => {
  it('pri dosiahnutom strope času vráti, čo stihlo, a zvyšok prizná', async () => {
    // Hodiny sa hýbu len spánkom medzi čítaniami — presne ako v produkcii.
    let clock = NOW.getTime();
    const now = (): UtcDate => new Date(clock);
    const sleepFn = async (ms: number): Promise<void> => {
      clock += ms;
    };
    const ids = PAGE.slice(0, 20);
    const catalog = mirror({ productIds: ids, state: todayState() });
    const shop = fakeShop();

    const result = await enrichPageOnDemand(
      ids,
      deps({
        shop,
        catalog,
        now,
        sleepFn,
        reads: memoryBudget(0, now),
        // Strop na 5 pauz: šiesty produkt sa už do času nezmestí.
        maxMs: 5 * MIN_ENRICH_READ_PAUSE_MS + 1,
      }),
    );

    expect(result.outcome).toBe('deadline');
    expect(result.enriched).toBe(6);
    expect(result.attempted).toBe(6);
    expect(shop.calls).toHaveLength(6);
    expect(result.skipped).toEqual(ids.slice(6));
    // Čo sa stihlo, je uložené — čiastočná strana nie je zahodená práca.
    expect(catalog.rows.get(ids[0] as number)?.enrichedAt).not.toBeNull();
  });

  it('strop času sa nedá cez `deps` zdvihnúť nad `ENRICH_PAGE_MAX_MS`', async () => {
    // Podlaha aj strop sú v engine, nie v route: cudzie číslo ich nepodlezie.
    expect(ENRICH_PAGE_MAX_MS).toBe(
      ENRICH_PAGE_MAX_PRODUCTS * Math.ceil(60_000 / KEYED_FALLBACK_PER_MINUTE) + 15_000,
    );

    const ids = PAGE.slice(0, 2);
    const catalog = mirror({ productIds: ids, state: todayState() });
    const shop = fakeShop();
    const result = await enrichPageOnDemand(
      ids,
      deps({ shop, catalog, maxMs: 10 * ENRICH_PAGE_MAX_MS }),
    );
    expect(result.outcome).toBe('done');
    expect(result.durationMs).toBeLessThanOrEqual(ENRICH_PAGE_MAX_MS);
  });

  it('druhá strana počas prvej dostane `busy`, nie druhú dávku requestov', async () => {
    const ids = PAGE.slice(0, 3);
    const catalog = mirror({ productIds: ids, state: todayState() });
    /*
     * Výsledok druhého behu držíme v OBJEKTE, nie v `let`. Priradenie sa
     * odohráva v callbacku, takže analýza toku TypeScriptu si `let` zúži na
     * `never` (vidí len vetvu `=== null`) a čítanie potom neprejde ani cez
     * typovanú kópiu. Vlastnosť objektu sa takto nezúžuje.
     */
    const captured: { value: EnrichPageResult | null } = { value: null };
    // Druhé volanie sa spustí PRESNE vtedy, keď prvé drží beh (v spánku).
    const shop = fakeShop();
    const sleepFn = async (): Promise<void> => {
      if (captured.value === null) {
        captured.value = await enrichPageOnDemand(ids, deps({ shop: fakeShop(), catalog }));
      }
    };

    const first = await enrichPageOnDemand(ids, deps({ shop, catalog, sleepFn }));

    const parallel = captured.value;
    expect(first.outcome).toBe('done');
    expect(parallel).not.toBeNull();
    expect(parallel?.outcome).toBe('busy');
    expect(parallel?.attempted).toBe(0);
  });
});
