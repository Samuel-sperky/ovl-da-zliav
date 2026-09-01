/**
 * Aura Zľavy — OBOHACOVANIE KATALÓGU: mapovanie, sviežosť, kvóta, pauzy
 * (KONTRAKT-V4-2026-08-28 §2b: D118, D119, D120; I1, I11).
 *
 * Čo sa tu dokazuje a prečo práve to:
 *
 *  1. **Odpoveď `getFull` sa uloží celá a bez domnienok.** Payload ide cez
 *     SKUTOČNÚ zod schému (`productFullSchema`) a skutočný prevod
 *     (`toProductFull`), nie cez ručne postavený objekt — inak by test
 *     dokazoval len to, čo si sám vymyslel. Chýbajúce pole, `null` aj PRÁZDNY
 *     STRING končia ako `null`, teda „nevieme", nikdy ako `0` ani `''` (I11).
 *  2. **Preklikávanie nesmie stáť kvótu.** Druhé otvorenie toho istého produktu
 *     nesmie poslať ANI JEDEN request. Overuje sa počítadlom volaní fake
 *     klienta, nie tvrdením o kóde.
 *  3. **Dávka nechá rezervu.** Z použiteľnej dennej kvóty si dávka nesmie vzať
 *     posledných 25 % — tie patria canary, sonde kľúča a obohateniu na dopyt.
 *     Konkrétne čísla sú odvodené (`ENRICH_DAILY_SHARE`), nie napísané.
 *     Keby si vzala všetko, obrazovka by po noci hlásila „nevieme" a nedalo by
 *     sa to obísť ani kliknutím.
 *  4. **`ip_banned` je DÔVOD PAUZY, nie zahodená chyba (D120).** Dávka stojí,
 *     dôvod si zapíše, `paused_until` zostane `NULL` („kým nezasiahne človek")
 *     a **žiadny produkt neoznačí ako obohatený ani ako pokus** — ban nie je
 *     vina produktu. Toto je dnešná realita: 28. 8. 2026 vracia shop `ip_banned`
 *     na všetko vrátane verejného čítania.
 *  5. **`Retry-After` po 429 sa rešpektuje** a zastropuje.
 *  6. **Nekonzistentná trojica `reduction_*` sa NEUKLADÁ.** V DB znamenajú tri
 *     `NULL` vetu „žiadna zľava nebeží"; uložiť ich pri `state: 'unknown'` by
 *     z medzery urobilo tvrdenie o produkčnom eshope.
 *  7. **Plošný prechod sa nedá zadať bez ceny.** Modul nemá funkciu „obohať
 *     všetko" a `enrichDaysNeeded()` povie počet dní.
 *
 * Shop je fake klient (počítadlo volaní je celá pointa bodov 2–5); zrkadlo
 * katalógu je pamäťová náhrada. Že to isté prežije MariaDB a že fronta vracia
 * poradie priority z indexu, dokazuje `test/integration/obohacovanie-dopyt.spec.ts`.
 * PRODUKČNÝ ESHOP SA TU NEVOLÁ — ani raz, ani na overenie (fakt 1 sondy).
 *
 * Vlastník: V4 (obohacovanie).
 */
import { describe, expect, it } from 'vitest';

import type {
  CatalogEnrichmentRecord,
  DateOnly,
  ProductFullDetail,
  SecretHandle,
  SecretRef,
  ShopError,
  UtcDate,
} from '@/contracts';

import {
  ENRICH_MAX_PER_RUN,
  ENRICH_QUOTA_RESERVE,
  MIN_ENRICH_FRESH_MS,
  MIN_ENRICH_READ_PAUSE_MS,
  enrichDaysNeeded,
  enrichProductOnDemand,
  isReductionStorable,
  runEnrichBatch,
  toEnrichWrite,
  type EnrichCatalogRepo,
} from '@/lib/engine/catalog-enrich';
import {
  DEFAULT_ENRICH_DAILY_TARGET,
  ENRICH_PRIORITY_ALLOWLIST,
  ENRICH_PRIORITY_REST,
  emptyCatalogEnrichState,
  type CatalogEnrichState,
  type CatalogEnrichWrite,
} from '@/lib/repo/catalog.repo';
import type { ShopScope } from '@/lib/shop/client';
import { makeShopError, ShopRequestError } from '@/lib/shop/errors';
import {
  KEYED_FALLBACK_PER_MINUTE,
  KEYED_FALLBACK_PER_UTC_DAY,
} from '@/lib/shop/rate-limits';
import {
  createMemoryReadBudgetStore,
  createReadBudget,
  READ_LANE_LIMITS,
  type ReadBudget,
} from '@/lib/shop/read-budget';
import { parseShopPayload, productFullSchema, toProductFull } from '@/lib/shop/schemas';

const NOW = new Date('2026-08-28T09:00:00.000Z');
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
  priority: number;
  write: CatalogEnrichWrite | null;
}

interface Mirror extends EnrichCatalogRepo {
  readonly rows: Map<number, MirrorRow>;
  readonly queue: number[];
  state: CatalogEnrichState;
  /** Koľkokrát sa fronta pýtala — na dôkaz, že dávka sa pýta raz na beh. */
  queueCalls: number;
}

/**
 * Zrkadlo v pamäti. `nextToEnrich()` NEROBÍ vlastné triedenie: vydáva presne to
 * poradie, ktoré mu test predpísal (`queue`), a len z neho vyhadzuje riadky, čo
 * už obohatené sú. Dôvod je zámerný — poradie priority je vlastnosť SQL a indexu
 * (0014), takže ho dokazuje integračný test nad MariaDB; keby si ho tu fake
 * reimplementoval, test by dokazoval sám seba.
 */
function mirror(opts: { productIds?: readonly number[]; state?: Partial<CatalogEnrichState> } = {}): Mirror {
  const ids = opts.productIds ?? [];
  const rows = new Map<number, MirrorRow>(
    ids.map((id) => [id, { enrichedAt: null, attemptedAt: null, priority: ENRICH_PRIORITY_REST, write: null }]),
  );
  const self: Mirror = {
    rows,
    queue: [...ids],
    queueCalls: 0,
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
      const out = new Map<number, CatalogEnrichmentRecord>();
      for (const productId of productIds) {
        const row = rows.get(productId);
        out.set(productId, toRecord(productId, row));
      }
      return out;
    },

    async markEnrichAttempt(productId, at) {
      const row = rows.get(productId);
      if (row === undefined) return;
      row.attemptedAt = at ?? NOW;
    },

    async nextToEnrich(limit) {
      self.queueCalls += 1;
      return self.queue
        .filter((id) => (rows.get(id)?.enrichedAt ?? null) === null)
        .slice(0, Math.max(0, limit));
    },

    async refreshEnrichPriority() {
      return { allowlist: 0, campaigns: 0, demoted: 0 };
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

function toRecord(productId: number, row: MirrorRow | undefined): CatalogEnrichmentRecord {
  const write = row?.write ?? null;
  const asNum = (value: number | null | undefined): number | null =>
    typeof value === 'number' ? value : null;
  const asText = (value: string | null | undefined): string | null =>
    typeof value === 'string' ? value : null;
  const asStamp = (value: string | UtcDate | null | undefined): UtcDate | null => {
    if (value == null) return null;
    if (value instanceof Date) return value;
    const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  return {
    productId,
    reference: asText(write?.reference),
    ean13: asText(write?.ean13),
    purchasePrice: asNum(write?.purchasePrice),
    margin: asNum(write?.margin),
    marginPercent: asNum(write?.marginPercent),
    sellPriceWithVat: asNum(write?.sellPriceWithVat),
    lastTimeInOrder: asStamp(write?.lastTimeInOrder),
    qty: asNum(write?.qty),
    qtyInOrders: asNum(write?.qtyInOrders),
    supplier: asText(write?.supplier),
    reductionPercent: asNum(write?.reductionPercent),
    reductionFrom: asStamp(write?.reductionFrom),
    reductionTo: asStamp(write?.reductionTo),
    active: typeof write?.active === 'boolean' ? write.active : null,
    categories: write?.categories === undefined ? null : (write.categories ?? null),
    enrichedAt: row?.enrichedAt ?? null,
    enrichAttemptedAt: row?.attemptedAt ?? null,
    enrichPriority: row?.priority ?? ENRICH_PRIORITY_REST,
  };
}

/* ═══════════════════════════ 2. Fake shop ═════════════════════════════════ */

const shopError = (
  kind: ShopError['kind'],
  code: string,
  extra: { httpStatus?: number; retryAfterSeconds?: number } = {},
): ShopRequestError => new ShopRequestError(makeShopError({ kind, code, ...extra }));

const ipBanned = (): ShopRequestError => shopError('forbidden', 'ip_banned', { httpStatus: 403 });
const rateLimited = (retryAfterSeconds: number): ShopRequestError =>
  shopError('rate_limited', 'rate_limited', { httpStatus: 429, retryAfterSeconds });
const notFound = (): ShopRequestError => shopError('not_found', 'not_found', { httpStatus: 404 });

interface FakeShop {
  readonly calls: number[];
  getProductFull(id: number, key: SecretRef): Promise<ProductFullDetail>;
}

/**
 * Fake `getFull`. Kľúč sa ZÁMERNE dešifruje a uvolní rovnako ako v produkcii —
 * test tým overuje, že volajúci naozaj podá `SecretRef`, nie hotový string (I1).
 */
function fakeShop(
  reply: (id: number, call: number) => ProductFullDetail | ShopRequestError,
): FakeShop {
  const calls: number[] = [];
  return {
    calls,
    async getProductFull(id: number, key: SecretRef): Promise<ProductFullDetail> {
      calls.push(id);
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
  reduction: { state: 'none' },
});

function deps(opts: {
  shop: FakeShop;
  catalog: Mirror;
  reads?: ReadBudget;
  scopes?: readonly ShopScope[] | null;
  hasKey?: boolean;
  freshMs?: number;
  now?: () => UtcDate;
}): Parameters<typeof enrichProductOnDemand>[1] {
  return {
    shop: opts.shop,
    catalog: opts.catalog,
    reads: opts.reads ?? memoryBudget(),
    apiKey: {
      loadForUse: async () => (opts.hasKey === false ? null : testKey),
      recallScopes: () => ({
        scopes: opts.scopes === undefined ? SCOPES : opts.scopes,
        checkedAt: opts.scopes === null ? null : NOW,
      }),
    },
    now: opts.now ?? ((): UtcDate => NOW),
    ...(opts.freshMs !== undefined ? { freshMs: opts.freshMs } : {}),
  };
}

/** Skutočný rozpočet nad pamäťou — aritmetika je tá, ktorá chráni produkciu. */
function memoryBudget(usedToday = 0, now: () => UtcDate = () => NOW): ReadBudget {
  const store = createMemoryReadBudgetStore();
  const budget = createReadBudget({ store, lane: 'anon', now });
  if (usedToday > 0) {
    const day = now().toISOString().slice(0, 10) as DateOnly;
    void store.add('anon', day, usedToday);
  }
  return budget;
}

/* ═══════════ 3. Mapovanie odpovede `getFull` na riadok obohatenia ═════════ */

/** Payload presne v tvare, aký zmerala sonda 28. 8. 2026 (fakt 4). */
const FULL_PAYLOAD = {
  ok: true,
  id: 18342,
  name: 'Strieborný prsteň',
  price: '24.90',
  has_attributes: 0,
  reference: 'SP-1042',
  ean13: '8595000000019',
  purchase_price: '11.20',
  margin: '13.70',
  margin_percent: '55.02',
  sell_price: '24.90',
  sell_price_with_vat: '29.88',
  last_time_in_order: '2026-07-28 12:29:28',
  qty: 0,
  qty_in_orders: 37,
  supplier: 'Kovoshop s.r.o.',
  reduction_percent: '15',
  reduction_from: '2026-08-20 00:00:00',
  reduction_to: '2026-09-02 00:00:00',
  categories: [11, 24],
  active: 1,
  date_add: '2024-02-11 08:00:00',
} as const;

function writeFromPayload(payload: Record<string, unknown>): CatalogEnrichWrite {
  const parsed = parseShopPayload(productFullSchema, payload);
  if (!parsed.ok) throw new Error(`payload neprešiel schémou: ${parsed.issues.join(', ')}`);
  return toEnrichWrite(toProductFull(parsed.value), NOW);
}

describe('obohatenie: odpoveď `getFull` → riadok katalógu', () => {
  it('uloží všetky polia z faktu 4 — vrátane `qty = 0` ako platnej nuly', () => {
    const write = writeFromPayload({ ...FULL_PAYLOAD });

    expect(write.reference).toBe('SP-1042');
    expect(write.ean13).toBe('8595000000019');
    expect(write.purchasePrice).toBe(11.2);
    expect(write.margin).toBe(13.7);
    expect(write.marginPercent).toBe(55.02);
    expect(write.sellPriceWithVat).toBe(29.88);
    expect(write.lastTimeInOrder).toBe('2026-07-28 12:29:28');
    // `0` je vypredaný sklad, NIE „nevieme" — jediné číslo, ktoré sa nesmie
    // zameniť za `null` (a naopak).
    expect(write.qty).toBe(0);
    expect(write.qtyInOrders).toBe(37);
    expect(write.supplier).toBe('Kovoshop s.r.o.');
    expect(write.reductionPercent).toBe(15);
    expect(write.reductionFrom).toBe('2026-08-20');
    expect(write.reductionTo).toBe('2026-09-02');
    expect(write.active).toBe(true);
    expect(write.categories).toEqual([11, 24]);
    expect(write.enrichedAt).toEqual(NOW);
  });

  it('marža sa NEPREPOČÍTAVA — uloží sa tá, ktorú poslal shop', () => {
    // Z cien by vyšlo 13,70; shop pošle 7,77 a appka ho NESMIE opravovať.
    const write = writeFromPayload({ ...FULL_PAYLOAD, margin: '7.77' });
    expect(write.margin).toBe(7.77);
    expect(write.purchasePrice).toBe(11.2);
    expect(write.sellPriceWithVat).toBe(29.88);
  });

  it('produkt bez referencie má `null`, nikdy prázdny string', () => {
    // Tri spôsoby, akými shop hovorí „referenciu nemám": prázdno, medzery, `null`.
    expect(writeFromPayload({ ...FULL_PAYLOAD, reference: '' }).reference).toBeNull();
    expect(writeFromPayload({ ...FULL_PAYLOAD, reference: '   ' }).reference).toBeNull();
    expect(writeFromPayload({ ...FULL_PAYLOAD, reference: null }).reference).toBeNull();
  });

  it('pole, ktoré shop vôbec neposlal, je `null` — nie `0` ani `undefined`', () => {
    const payload: Record<string, unknown> = { ...FULL_PAYLOAD };
    for (const key of [
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
      'categories',
      'active',
    ]) {
      delete payload[key];
    }
    const write = writeFromPayload(payload);

    expect(write.reference).toBeNull();
    expect(write.ean13).toBeNull();
    expect(write.purchasePrice).toBeNull();
    expect(write.margin).toBeNull();
    expect(write.marginPercent).toBeNull();
    expect(write.sellPriceWithVat).toBeNull();
    expect(write.lastTimeInOrder).toBeNull();
    expect(write.qty).toBeNull();
    expect(write.qtyInOrders).toBeNull();
    expect(write.supplier).toBeNull();
    expect(write.categories).toBeNull();
    expect(write.active).toBeNull();
    // Ani jedno pole nesmie byť nula — to je celý bod I11.
    expect(Object.values(write).some((value) => value === 0)).toBe(false);
  });

  it('`categories: []` je „shop hovorí, že do žiadnej", nie „nevieme"', () => {
    expect(writeFromPayload({ ...FULL_PAYLOAD, categories: [] }).categories).toEqual([]);
  });

  it('žiadna zľava = tri `null` naraz, nikdy len percento', () => {
    const write = writeFromPayload({
      ...FULL_PAYLOAD,
      reduction_percent: null,
      reduction_from: null,
      reduction_to: null,
    });
    expect(write.reductionPercent).toBeNull();
    expect(write.reductionFrom).toBeNull();
    expect(write.reductionTo).toBeNull();
  });

  it('nekonzistentná trojica `reduction_*` sa NESMIE uložiť (I11)', () => {
    // Percento bez dátumov: shop takú odpoveď nesľubuje, a práve preto ju treba
    // ošetriť. Tri `NULL` v DB znamenajú „žiadna zľava nebeží" — uložiť ich tu
    // by bolo tvrdenie o produkčnom eshope, ktoré nikto nepremeral.
    const parsed = parseShopPayload(productFullSchema, {
      ...FULL_PAYLOAD,
      reduction_from: null,
      reduction_to: null,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const full = toProductFull(parsed.value);
    expect(full.reduction.state).toBe('unknown');
    expect(isReductionStorable(full)).toBe(false);
  });
});

/* ═══════════ 4. Na dopyt: sviežosť drží cenu preklikávania na nule ════════ */

describe('obohatenie na dopyt (D118 bod 1)', () => {
  it('prvé otvorenie obohatí, druhé NEVOLÁ API vôbec', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [501] });
    const d = deps({ shop, catalog });

    const first = await enrichProductOnDemand(501, d);
    expect(first.outcome).toBe('enriched');
    expect(first.readsUsed).toBe(1);
    expect(shop.calls).toEqual([501]);

    const second = await enrichProductOnDemand(501, d);
    expect(second.outcome).toBe('fresh');
    expect(second.readsUsed).toBe(0);
    // Toto je celý dôkaz idempotencie: počítadlo volaní sa NEPOHNULO.
    expect(shop.calls).toEqual([501]);
    expect(second.enrichedAt).toEqual(NOW);

    const third = await enrichProductOnDemand(501, d);
    expect(third.outcome).toBe('fresh');
    expect(shop.calls).toHaveLength(1);
  });

  it('po uplynutí sviežosti sa API zavolá znova', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [502] });
    let clock = NOW;
    const d = deps({ shop, catalog, freshMs: 60 * 60 * 1000, now: () => clock });

    expect((await enrichProductOnDemand(502, d)).outcome).toBe('enriched');
    clock = new Date(NOW.getTime() + 59 * 60 * 1000);
    expect((await enrichProductOnDemand(502, d)).outcome).toBe('fresh');
    clock = new Date(NOW.getTime() + 61 * 60 * 1000);
    expect((await enrichProductOnDemand(502, d)).outcome).toBe('enriched');
    expect(shop.calls).toEqual([502, 502]);
  });

  it('sviežosť sa nedá podliezť pod podlahu (žiadne hameranie kvóty)', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [503] });
    // Volajúci si vyžiada „0 ms", teda „vždy volaj". Podlaha to prebije.
    const d = deps({ shop, catalog, freshMs: 0 });

    expect((await enrichProductOnDemand(503, d)).outcome).toBe('enriched');
    expect((await enrichProductOnDemand(503, d)).outcome).toBe('fresh');
    expect(shop.calls).toHaveLength(1);
    expect(MIN_ENRICH_FRESH_MS).toBeGreaterThan(0);
  });

  it('bez oprávnenia `product:read` neodíde ANI JEDEN request', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [504] });

    const locked = await enrichProductOnDemand(504, deps({ shop, catalog, scopes: [] }));
    expect(locked.outcome).toBe('locked');
    expect(locked.capability.state).toBe('locked');

    const unknown = await enrichProductOnDemand(504, deps({ shop, catalog, scopes: null }));
    // „Nevieme, či má" NIE JE „nemá" — dva rôzne stavy (I11).
    expect(unknown.outcome).toBe('unknown_scope');
    expect(unknown.capability.state).toBe('unknown');

    expect(shop.calls).toEqual([]);
  });

  it('bez kľúča sa nič nevolá a nič sa neuloží', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [505] });
    const result = await enrichProductOnDemand(505, deps({ shop, catalog, hasKey: false }));
    expect(result.outcome).toBe('no_key');
    expect(shop.calls).toEqual([]);
    expect(catalog.rows.get(505)?.enrichedAt).toBeNull();
  });

  it('produkt, ktorý zrkadlo nemá, je `not_in_mirror` a nie chyba', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [] });
    const result = await enrichProductOnDemand(9_999, deps({ shop, catalog }));
    expect(result.outcome).toBe('not_in_mirror');
    expect(result.readsUsed).toBe(1);
  });

  it('`reduction: unknown` neobohatí riadok, len zaznačí pokus', async () => {
    const shop = fakeShop((id) => ({
      ...plainFull(id),
      reduction: { state: 'unknown', reason: 'partial' } as const,
    }));
    const catalog = mirror({ productIds: [506] });
    const result = await enrichProductOnDemand(506, deps({ shop, catalog }));

    expect(result.outcome).toBe('reduction_unknown');
    expect(catalog.rows.get(506)?.enrichedAt).toBeNull();
    expect(catalog.rows.get(506)?.attemptedAt).toEqual(NOW);
  });

  it('`ip_banned` zapíše dôvod pauzy a produkt NEOZNAČÍ (D120)', async () => {
    const shop = fakeShop(() => ipBanned());
    const catalog = mirror({ productIds: [507] });
    const result = await enrichProductOnDemand(507, deps({ shop, catalog }));

    expect(result.outcome).toBe('ip_banned');
    expect(result.error).toBe('ip_banned');
    expect(catalog.state.pauseReason).toBe('ip_banned');
    // `null` = stojí, kým nezasiahne človek. Shop pri bane čas obnovenia nedáva.
    expect(catalog.state.pausedUntil).toBeNull();
    expect(catalog.rows.get(507)?.enrichedAt).toBeNull();
    expect(catalog.rows.get(507)?.attemptedAt).toBeNull();
  });

  it('kým `ip_banned` pauza platí, ďalší dopyt už nič neposiela', async () => {
    const shop = fakeShop(() => ipBanned());
    const catalog = mirror({ productIds: [508, 509] });
    const d = deps({ shop, catalog });

    expect((await enrichProductOnDemand(508, d)).outcome).toBe('ip_banned');
    const second = await enrichProductOnDemand(509, d);
    expect(second.outcome).toBe('paused');
    expect(second.error).toBe('ip_banned');
    expect(shop.calls).toEqual([508]);
  });

  it('úspešné čítanie uvoľní `ip_banned` pauzu — shop nám odpovedal', async () => {
    let banned = true;
    const shop = fakeShop((id) => (banned ? ipBanned() : plainFull(id)));
    const catalog = mirror({ productIds: [510, 511] });
    const d = deps({ shop, catalog });

    expect((await enrichProductOnDemand(510, d)).outcome).toBe('ip_banned');
    expect(catalog.state.pauseReason).toBe('ip_banned');

    // Človek zasiahol (IP odblokovaná) a otvoril produkt. Pauza musí padnúť,
    // inak by dávka po odblokovaní stála navždy.
    banned = false;
    catalog.state = { ...catalog.state, pausedUntil: null, pauseReason: null, lastError: null };
    expect((await enrichProductOnDemand(511, d)).outcome).toBe('enriched');
    expect(catalog.state.pauseReason).toBeNull();
  });

  it('429 vráti `Retry-After` ako čas, kedy sa smie skúsiť znova', async () => {
    const shop = fakeShop(() => rateLimited(45));
    const catalog = mirror({ productIds: [512] });
    const result = await enrichProductOnDemand(512, deps({ shop, catalog }));

    expect(result.outcome).toBe('rate_limited');
    expect(result.resumeAt?.getTime()).toBe(NOW.getTime() + 45_000);
    expect(catalog.state.pauseReason).toBe('rate_limited');
    expect(catalog.rows.get(512)?.enrichedAt).toBeNull();
  });

  it('minutý denný rozpočet nič nepošle a povie, kedy sa obnoví', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [513] });
    const reads = memoryBudget(READ_LANE_LIMITS.anon.perUtcDay);
    const result = await enrichProductOnDemand(513, deps({ shop, catalog, reads }));

    expect(result.outcome).toBe('budget_day');
    expect(result.resumeAt).not.toBeNull();
    expect(shop.calls).toEqual([]);
  });

  it('cesta na dopyt SMIE do rezervy — ona je ten, pre koho sa drží', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [514] });
    // Zostáva menej, než je rezerva dávky. Dávka by nešla; dopyt musí prejsť.
    const reads = memoryBudget(READ_LANE_LIMITS.anon.perUtcDay - (ENRICH_QUOTA_RESERVE - 10));
    const result = await enrichProductOnDemand(514, deps({ shop, catalog, reads }));

    expect(result.outcome).toBe('enriched');
    expect(shop.calls).toEqual([514]);
  });

  it('neplatné ID neposiela nič', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [] });
    for (const id of [0, -3, 1.5, Number.NaN]) {
      expect((await enrichProductOnDemand(id, deps({ shop, catalog }))).outcome).toBe('invalid_id');
    }
    expect(shop.calls).toEqual([]);
  });
});

/* ═══════════════════ 5. Dávka na pozadí (D118 bod 2) ══════════════════════ */

const noSleep = async (): Promise<void> => {};

function batchDeps(opts: Parameters<typeof deps>[0] & { maxProducts?: number }): Parameters<typeof runEnrichBatch>[0] {
  return {
    ...deps(opts),
    sleepFn: noSleep,
    refreshPriority: false,
    ...(opts.maxProducts !== undefined ? { maxProducts: opts.maxProducts } : {}),
  };
}

describe('dávka obohacovania (D118 bod 2)', () => {
  it('obohatí produkty v poradí, v akom ich vydala fronta', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [21, 22, 23] });
    const result = await runEnrichBatch(batchDeps({ shop, catalog }));

    expect(result.outcome).toBe('done');
    expect(result.enriched).toBe(3);
    expect(shop.calls).toEqual([21, 22, 23]);
    // Fronta sa pýta RAZ na beh, nie raz na produkt.
    expect(catalog.queueCalls).toBe(1);
  });

  it('nikdy nevezme viac, než je denný cieľ — a po naplnení stojí', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => 600 + index);
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({
      productIds: ids,
      state: { dailyTarget: 5, batchDay: '2026-08-28' },
    });

    const first = await runEnrichBatch(batchDeps({ shop, catalog }));
    expect(first.enriched).toBe(5);
    expect(catalog.state.enrichedToday).toBe(5);
    expect(first.targetLeft).toBe(0);

    const second = await runEnrichBatch(batchDeps({ shop, catalog }));
    expect(second.outcome).toBe('target_reached');
    expect(second.attempted).toBe(0);
    expect(shop.calls).toHaveLength(5);
  });

  it('rešpektuje kvótu a NECHÁ REZERVU pre canary a dopyt', async () => {
    const limit = READ_LANE_LIMITS.anon.perUtcDay;
    const ids = Array.from({ length: 40 }, (_, index) => 700 + index);
    const shop = fakeShop((id) => plainFull(id));
    // Do rezervy chýba 8 čítaní: dávka smie minúť presne 8 a ani jedno viac.
    const reads = memoryBudget(limit - ENRICH_QUOTA_RESERVE - 8);
    const catalog = mirror({ productIds: ids, state: { dailyTarget: 150 } });

    const result = await runEnrichBatch(batchDeps({ shop, catalog, reads }));

    expect(result.readsUsed).toBe(8);
    expect(result.outcome).toBe('budget_reserve');
    const status = await reads.status();
    // Rezerva zostala celá — presne to, čo z nej žije obohatenie na dopyt.
    expect(status.remaining).toBe(ENRICH_QUOTA_RESERVE);
    expect(status.exhausted).toBe(false);
  });

  it('keď je v rozpočte už len rezerva, dávka nepošle NIČ', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [801, 802] });
    const reads = memoryBudget(READ_LANE_LIMITS.anon.perUtcDay - ENRICH_QUOTA_RESERVE);

    const result = await runEnrichBatch(batchDeps({ shop, catalog, reads }));

    expect(result.outcome).toBe('budget_reserve');
    expect(result.readsUsed).toBe(0);
    expect(shop.calls).toEqual([]);
    // Pauza je do polnoci UTC — v rámci dňa sa rezerva neuvolní.
    expect(catalog.state.pauseReason).toBe('daily_budget');
    expect(catalog.state.pausedUntil).not.toBeNull();
    expect(catalog.state.lastError).toBe('quota_reserve');
  });

  it('`ip_banned` zastaví dávku, zapíše dôvod a NEOZNAČÍ nič (D120)', async () => {
    const ids = [901, 902, 903];
    // Prvý produkt prejde, druhý narazí na ban. Prvý musí ZOSTAŤ obohatený,
    // druhý a tretí nesmú byť ani obohatené, ani zaznačené ako pokus.
    const shop = fakeShop((id) => (id === 901 ? plainFull(id) : ipBanned()));
    const catalog = mirror({ productIds: ids });

    const result = await runEnrichBatch(batchDeps({ shop, catalog }));

    expect(result.outcome).toBe('ip_banned');
    expect(result.error).toBe('ip_banned');
    expect(result.enriched).toBe(1);
    expect(result.attempted).toBe(2);
    expect(shop.calls).toEqual([901, 902]);

    expect(catalog.rows.get(901)?.enrichedAt).toEqual(NOW);
    for (const id of [902, 903]) {
      expect(catalog.rows.get(id)?.enrichedAt).toBeNull();
      // Ban nie je vina produktu: pokus sa NEZAZNAČÍ, inak by mu fronta
      // prehodila poradie za chybu, ktorá platí pre všetko.
      expect(catalog.rows.get(id)?.attemptedAt).toBeNull();
    }

    expect(catalog.state.pauseReason).toBe('ip_banned');
    expect(catalog.state.pausedUntil).toBeNull();
    expect(catalog.state.lastError).toBe('ip_banned');
  });

  it('po `ip_banned` sa ďalší beh nepýta shopu vôbec, ani na druhý deň', async () => {
    const shop = fakeShop(() => ipBanned());
    const catalog = mirror({ productIds: [910, 911] });

    await runEnrichBatch(batchDeps({ shop, catalog }));
    expect(shop.calls).toHaveLength(1);

    const again = await runEnrichBatch(batchDeps({ shop, catalog }));
    expect(again.outcome).toBe('paused');
    expect(again.attempted).toBe(0);
    expect(shop.calls).toHaveLength(1);

    // Nový UTC deň uvoľní pauzu o rozpočte, ale NIE ban — ten čaká na človeka.
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const next = await runEnrichBatch(batchDeps({ shop, catalog, now: () => tomorrow }));
    expect(next.outcome).toBe('paused');
    expect(shop.calls).toHaveLength(1);
  });

  it('429 zastaví dávku a `Retry-After` určí, dokedy stojí', async () => {
    const shop = fakeShop((id) => (id === 920 ? plainFull(id) : rateLimited(90)));
    const catalog = mirror({ productIds: [920, 921, 922] });

    const result = await runEnrichBatch(batchDeps({ shop, catalog }));

    expect(result.outcome).toBe('rate_limited');
    expect(result.enriched).toBe(1);
    expect(catalog.state.pauseReason).toBe('rate_limited');
    expect(catalog.state.pausedUntil?.getTime()).toBe(NOW.getTime() + 90_000);
    expect(catalog.rows.get(921)?.attemptedAt).toBeNull();

    // Kým pauza beží, ďalší beh nič neposiela.
    const during = new Date(NOW.getTime() + 30_000);
    const paused = await runEnrichBatch(batchDeps({ shop, catalog, now: () => during }));
    expect(paused.outcome).toBe('paused');
    expect(shop.calls).toHaveLength(2);

    // Po pauze beh pokračuje — a `Retry-After` sa tým NEZAHODÍ, len uplynie.
    const after = new Date(NOW.getTime() + 91_000);
    const resumed = await runEnrichBatch(
      batchDeps({ shop: fakeShop((id) => plainFull(id)), catalog, now: () => after }),
    );
    expect(resumed.outcome).toBe('done');
    expect(resumed.enriched).toBe(2);
  });

  it('`not_found` je fakt o jednom produkte — dávka pokračuje', async () => {
    const shop = fakeShop((id) => (id === 931 ? notFound() : plainFull(id)));
    const catalog = mirror({ productIds: [930, 931, 932] });

    const result = await runEnrichBatch(batchDeps({ shop, catalog }));

    expect(result.outcome).toBe('done');
    expect(result.enriched).toBe(2);
    expect(shop.calls).toEqual([930, 931, 932]);
    // Neúspešný pokus produkt NEOZNAČÍ ako obohatený, len ho posunie dozadu.
    expect(catalog.rows.get(931)?.enrichedAt).toBeNull();
    expect(catalog.rows.get(931)?.attemptedAt).toEqual(NOW);
  });

  it('iná chyba dávku zastaví na chvíľu, nie navždy', async () => {
    const shop = fakeShop(() => shopError('server_error', 'server_error', { httpStatus: 500 }));
    const catalog = mirror({ productIds: [940, 941] });

    const result = await runEnrichBatch(batchDeps({ shop, catalog }));

    expect(result.outcome).toBe('failed');
    expect(catalog.state.pauseReason).toBe('error');
    // Čas obnovenia MUSÍ byť vyplnený: pauza, ktorú nemá kto uvoľniť, by dávku
    // zabila natrvalo kvôli jednej päťstovke.
    expect(catalog.state.pausedUntil).not.toBeNull();
    expect(catalog.state.pausedUntil?.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('bez oprávnenia ani bez kľúča dávka nedostane pauzu, len sa nespustí', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [950] });

    const locked = await runEnrichBatch(batchDeps({ shop, catalog, scopes: [] }));
    expect(locked.outcome).toBe('locked');
    // Pauza, ktorú by pri príchode kľúča nemal kto uvoľniť, sa NEZAPISUJE.
    expect(catalog.state.pauseReason).toBeNull();

    const noKey = await runEnrichBatch(batchDeps({ shop, catalog, hasKey: false }));
    expect(noKey.outcome).toBe('no_key');
    expect(catalog.state.pauseReason).toBeNull();
    expect(catalog.state.lastError).toBe('no_key');
    expect(shop.calls).toEqual([]);
  });

  it('po reštarte pokračuje tam, kde stála — nezačína odznova', async () => {
    const ids = Array.from({ length: 6 }, (_, index) => 960 + index);
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: ids, state: { dailyTarget: 4 } });

    // „Prvý proces" stihne dva a spadne (strop behu).
    await runEnrichBatch(batchDeps({ shop, catalog, maxProducts: 2 }));
    expect(catalog.state.enrichedToday).toBe(2);
    expect(catalog.state.batchDay).toBe('2026-08-28');

    // „Druhý proces" načíta stav z DB a doberie zvyšok denného cieľa.
    const after = await runEnrichBatch(batchDeps({ shop, catalog }));
    expect(after.enriched).toBe(2);
    expect(catalog.state.enrichedToday).toBe(4);
    expect(shop.calls).toEqual([960, 961, 962, 963]);
    // Už obohatené produkty sa NEČÍTAJÚ druhýkrát.
    expect(new Set(shop.calls).size).toBe(4);
  });

  it('nový UTC deň vynuluje denné počítadlo a uvoľní pauzu o rozpočte', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({
      productIds: [970, 971],
      state: {
        batchDay: '2026-08-27',
        enrichedToday: 150,
        dailyTarget: 150,
        pauseReason: 'daily_budget',
        pausedUntil: new Date('2026-08-28T00:00:00.000Z'),
      },
    });

    const result = await runEnrichBatch(batchDeps({ shop, catalog }));

    expect(result.outcome).toBe('done');
    expect(catalog.state.batchDay).toBe('2026-08-28');
    expect(catalog.state.enrichedToday).toBe(2);
    expect(catalog.state.pauseReason).toBeNull();
  });

  it('prázdna fronta nie je chyba', async () => {
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: [] });
    const result = await runEnrichBatch(batchDeps({ shop, catalog }));
    expect(result.outcome).toBe('no_ids');
    expect(shop.calls).toEqual([]);
  });
});

/* ═══════════════ 6. Plošný prechod sa nedá zadať bez ceny ═════════════════ */

describe('plošné obohatenie neexistuje — a cena je povedaná číslom', () => {
  it('`enrichDaysNeeded` povie, koľko dní by trval celý katalóg', () => {
    /*
     * 41 348 produktov je meraný fakt sondy z 28. 8. 2026. Počet dní je
     * ODVODENÝ od denného cieľa — po zdvihnutí kvóty 1. 9. 2026 (200 → 1000/deň,
     * teda cieľ 150 → 600) padol z 276 na 69 dní. Práve to je zmysel toho
     * zdvihnutia, takže test tvrdí aritmetiku, nie zapamätané číslo.
     */
    expect(enrichDaysNeeded(41_348, DEFAULT_ENRICH_DAILY_TARGET)).toBe(
      Math.ceil(41_348 / DEFAULT_ENRICH_DAILY_TARGET),
    );
    expect(enrichDaysNeeded(41_348, DEFAULT_ENRICH_DAILY_TARGET)).toBe(69);
    expect(enrichDaysNeeded(0)).toBe(0);
    /*
     * Rýchlosť si funkcia zastropuje na `KEYED_FALLBACK_PER_UTC_DAY`, teda na
     * to, čo appka naozaj minie — 20 % zo stropu je rezerva, ktorú si nikdy
     * neberie. Sľubovať dni tempom, ktorým sa nikdy nepôjde, by bol
     * optimistický odhad vydávaný za plán.
     */
    const stropRychlosti = Math.ceil(41_348 / KEYED_FALLBACK_PER_UTC_DAY);
    expect(enrichDaysNeeded(41_348, KEYED_FALLBACK_PER_UTC_DAY)).toBe(stropRychlosti);
    // Nikto nedostane „nula dní" tým, že si vyžiada nekonečnú rýchlosť.
    expect(enrichDaysNeeded(41_348, 10_000_000)).toBe(stropRychlosti);
  });

  it('jeden beh dávky má tvrdý strop, aj keď si volajúci vyžiada viac', async () => {
    const ids = Array.from({ length: ENRICH_MAX_PER_RUN + 20 }, (_, index) => 100_000 + index);
    const shop = fakeShop((id) => plainFull(id));
    const catalog = mirror({ productIds: ids, state: { dailyTarget: 100_000 } });

    const result = await runEnrichBatch(
      batchDeps({ shop, catalog, maxProducts: 100_000 }),
    );

    expect(result.planned).toBeLessThanOrEqual(ENRICH_MAX_PER_RUN);
    expect(shop.calls.length).toBeLessThanOrEqual(ENRICH_MAX_PER_RUN);
  });

  it('pauza medzi volaniami drží minútový strop kľúča', () => {
    // 60 000 / 16 = 3 750 ms. Menovateľ je KEYED strop, nie anonymný — `getFull`
    // ide s kľúčom a shop ho účtuje na kľúč.
    expect(MIN_ENRICH_READ_PAUSE_MS).toBe(Math.ceil(60_000 / KEYED_FALLBACK_PER_MINUTE));
    expect(MIN_ENRICH_READ_PAUSE_MS * KEYED_FALLBACK_PER_MINUTE).toBeGreaterThanOrEqual(60_000);
  });

  it('rezerva dávky a denný cieľ sa spolu zmestia do kvóty kľúča', () => {
    /*
     * Cieľ dávky + rezerva sa musia zmestiť do POUŽITEĽNEJ kvóty a ani o jeden
     * viac. Odvodené: do 1. 9. 2026 to bolo 150 + 50 = 200, dnes 600 + 200 = 800.
     */
    expect(DEFAULT_ENRICH_DAILY_TARGET + ENRICH_QUOTA_RESERVE).toBeLessThanOrEqual(
      KEYED_FALLBACK_PER_UTC_DAY,
    );
    expect(ENRICH_PRIORITY_ALLOWLIST).toBeLessThan(ENRICH_PRIORITY_REST);
  });
});
