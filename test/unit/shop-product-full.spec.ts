/**
 * Aura Zľavy — `GET /api/products/getFull` (API v5, bod A1 kontraktu).
 *
 * ČO TENTO SÚBOR STRÁŽI
 * ---------------------
 * `getFull` je jediný endpoint, ktorý appke povie SKUTOČNÝ stav zľavy na
 * produkte (bod B1). Doteraz vedela len to, čo sama zapísala, a všetkých
 * 17 miest v UI preto nieslo výhradu „podľa vlastných zápisov" (I11).
 * Testy tu overujú tri veci, na ktorých to celé stojí:
 *
 *  1. **„žiadna zľava nebeží" a „nevieme" sa NIKDY nezlejú.** Trojica
 *     `reduction_*` v `null` je MERANÝ fakt (`none`); chýbajúca, polovičná
 *     alebo nezmyselná odpoveď je medzera v poznaní (`unknown`). Keby sa
 *     zliali, appka by o produkčnom shope tvrdila niečo, čo nikto nepremeral.
 *  2. **Kľúč sa nedostane nikam inam než do hlavičky** (I1). `getFull` je
 *     prvé ČÍTANIE s kľúčom, takže sa tu overuje aj to, čo pri zápisoch:
 *     hlavička áno, URL nie, Buffer vynulovaný.
 *  3. **Obe tvarové konvencie shopu** — `{"result":…}` aj holé telo (D54).
 *
 * Kľúč so scope `product:read` v čase písania NEMÁME, takže naostro sa to
 * vyskúšať nedá. Všetko beží proti fixtúram podľa `docs/api/sperky-api-v5.md`
 * a fake fetch — žiadny request neopustí proces (I6).
 *
 * Vlastník: A3.
 */
import { describe, expect, it, vi } from 'vitest';

import type { SecretRef, ShopClient, ShopCtx, ShopReductionState } from '@/contracts';

import { createShopClient, type FetchLike } from '@/lib/shop/client';
import { newOperationContext } from '@/lib/shop/correlation';
import { ShopRequestError } from '@/lib/shop/errors';
import {
  parseShopPayload,
  productFullSchema,
  toProductFull,
  toShopReduction,
} from '@/lib/shop/schemas';

/* ═════════════════════════ 0. Testovací harness ═══════════════════════════ */

/** Loopback base URL — ani omylom sa nedá trafiť reálna doména (I6). */
const BASE = 'https://127.0.0.1:8443';

const TEST_KEY = 'TESTKEY-product-read-0123456789';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

interface Harness {
  fetchImpl: FetchLike;
  calls: Recorded[];
}

function harness(handler: (req: Recorded, index: number) => Response): Harness {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    const record: Recorded = {
      url: input,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : null,
    };
    calls.push(record);
    return handler(record, calls.length - 1);
  };
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FakeKey {
  ref: SecretRef;
  releases: number;
  zeroed: boolean[];
}

/** `SecretRef`, ktorý si pamätá, či bol Buffer po `release()` naozaj vynulovaný. */
function fakeKey(value = TEST_KEY): FakeKey {
  const state: FakeKey = {
    releases: 0,
    zeroed: [],
    ref: async () => {
      const buf = Buffer.from(value, 'utf8');
      return {
        value: buf,
        release: () => {
          buf.fill(0);
          state.releases += 1;
          state.zeroed.push(buf.every((b) => b === 0));
        },
      };
    },
  };
  return state;
}

function client(
  fetchImpl: FetchLike,
  extra: Partial<Parameters<typeof createShopClient>[0]> = {},
): ShopClient {
  return createShopClient({
    baseUrl: BASE,
    fetchImpl,
    version: '0.0.0-test',
    readTimeoutMs: 5000,
    writeTimeoutMs: 5000,
    timeZone: 'Europe/Bratislava',
    sleepFn: async () => {},
    policy: { maxAttempts: 3, retryAfterCapSeconds: 90, backoffMs: [1, 1, 1] },
    ...extra,
  });
}

const ctx = (): ShopCtx => newOperationContext();

/** Ten istý payload zabalený tak, ako ho posiela produkčný shop. */
const wrapped = (payload: unknown): { result: unknown } => ({ result: payload });

/* ═══════════════════════════ 0b. Fixtúry z v5 ═════════════════════════════ */

/**
 * Kompletná odpoveď podľa `docs/api/sperky-api-v5.md`. Peniaze zámerne ako
 * stringy (PHP `DECIMAL`), jedna z nich s desatinnou čiarkou — tak ich shop
 * naozaj posiela.
 */
const FULL_PAYLOAD = {
  ok: true,
  id: 49,
  name: 'Náramok z chirurgickej ocele',
  price: '12.30',
  description: '<h3>Náramok</h3>',
  description_short: 'Krátky popis',
  has_attributes: true,
  attributes: [
    {
      id_product_attribute: 112,
      price_impact: 0,
      reference: 'C16.19',
      ean13: '1020738',
      quantity: 0,
      is_default: false,
      values: ['Oranzova - Zlta'],
    },
  ],
  ean13: '1020738',
  reference: 'C16.19',
  purchase_price: '5,40',
  margin: '6.90',
  margin_percent: '56.10',
  sell_price: '12.30',
  sell_price_with_vat: '14.76',
  active: 1,
  date_add: '2024-03-01 09:12:00',
  last_time_in_order: '2026-07-28 12:29:28',
  qty: '7',
  qty_in_orders: '134',
  supplier: 'Dodávateľ s.r.o.',
  reduction_percent: '15',
  reduction_from: '2026-08-14 00:00:00',
  reduction_to: '2026-09-14 00:00:00',
  categories: [2, 15, '31'],
};

/** Minimum, ktoré appka potrebuje: základ z `get` + trojica `reduction_*`. */
const MINIMAL_PAYLOAD = {
  id: 49,
  name: 'Náramok',
  price: 12.3,
  has_attributes: false,
  reduction_percent: null,
  reduction_from: null,
  reduction_to: null,
};

/* ═════════════ 1. Obálka `{"result":…}` aj holé telo (D54) ════════════════ */

describe('getProductFull — obálka `{"result":…}` aj bare objekt', () => {
  it('rozbalí obálku (produkčný tvar) a namapuje back-office polia', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() => json(wrapped(FULL_PAYLOAD)));
    const full = await client(fetchImpl).getProductFull(49, key.ref, ctx());

    expect(full.id).toBe(49);
    expect(full.name).toBe('Náramok z chirurgickej ocele');
    expect(full.price).toBe(12.3);
    expect(full.has_attributes).toBe(true);
    expect(full.description).toBe('<h3>Náramok</h3>');
    expect(full.attributes?.[0]?.id_product_attribute).toBe(112);

    expect(full.purchase_price).toBe(5.4);
    expect(full.margin).toBe(6.9);
    expect(full.margin_percent).toBe(56.1);
    expect(full.sell_price).toBe(12.3);
    expect(full.sell_price_with_vat).toBe(14.76);
    expect(full.active).toBe(true);
    expect(full.qty).toBe(7);
    expect(full.qty_in_orders).toBe(134);
    expect(full.supplier).toBe('Dodávateľ s.r.o.');
    expect(full.ean13).toBe('1020738');
    expect(full.reference).toBe('C16.19');
    expect(full.categories).toEqual([2, 15, 31]);
    expect(full.last_time_in_order).toBe('2026-07-28 12:29:28');
  });

  it('holé telo bez obálky (mock, starší kontrakt) funguje rovnako', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() => json(FULL_PAYLOAD));
    const full = await client(fetchImpl).getProductFull(49, key.ref, ctx());

    expect(full.id).toBe(49);
    expect(full.qty).toBe(7);
    expect(full.reduction).toEqual({
      state: 'active',
      percent: 15,
      from: '2026-08-14',
      to: '2026-09-14',
    });
  });

  it('obálka nesie aj `ok` zvonku — `{ok:true, result:{…}}` prejde', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() => json({ ok: true, result: MINIMAL_PAYLOAD }));
    const full = await client(fetchImpl).getProductFull(49, key.ref, ctx());
    expect(full.reduction).toEqual({ state: 'none' });
  });
});

/* ═══════ 2. Stav zľavy — „nebeží" a „nevieme" sú DVE RÔZNE veci (B1) ══════ */

describe('stav zľavy — `none` a `unknown` sa nikdy nezlejú', () => {
  const stav = (
    percent: unknown,
    from: unknown,
    to: unknown,
  ): ShopReductionState | { drift: string[] } => {
    const parsed = parseShopPayload(productFullSchema, {
      ...MINIMAL_PAYLOAD,
      reduction_percent: percent,
      reduction_from: from,
      reduction_to: to,
    });
    return parsed.ok ? toProductFull(parsed.value).reduction : { drift: parsed.issues };
  };

  it('všetky tri `null` = shop povedal „žiadna zľava nebeží" (meraný fakt)', () => {
    expect(stav(null, null, null)).toEqual({ state: 'none' });
  });

  it('vyplnená trojica = konkrétna zľava s oknom', () => {
    expect(stav(20, '2026-08-14', '2026-09-01')).toEqual({
      state: 'active',
      percent: 20,
      from: '2026-08-14',
      to: '2026-09-01',
    });
  });

  it('`DATETIME` sa oreže na kalendárny deň (PrestaShop drží okno s časom)', () => {
    expect(stav('7.5', '2026-08-14 00:00:00', '2026-09-01 23:59:59')).toEqual({
      state: 'active',
      percent: 7.5,
      from: '2026-08-14',
      to: '2026-09-01',
    });
  });

  it('polovičná trojica je `unknown`, nikdy „15 % s neznámym oknom"', () => {
    expect(stav(15, null, null)).toEqual({ state: 'unknown', reason: 'partial' });
    expect(stav(null, '2026-08-14', '2026-09-01')).toEqual({ state: 'unknown', reason: 'partial' });
    expect(stav(15, '2026-08-14', null)).toEqual({ state: 'unknown', reason: 'partial' });
  });

  it('sentinel `0000-00-00` je `unknown/invalid`, nie „žiadna zľava"', () => {
    // Toto je presne to miesto, kde by sa „nevieme" najľahšie zamenilo za
    // „nebeží": dátum vyzerá vyplnene, ale neexistuje.
    expect(stav(15, '0000-00-00', '0000-00-00')).toEqual({ state: 'unknown', reason: 'invalid' });
    expect(stav(15, '2026-02-30', '2026-09-01')).toEqual({ state: 'unknown', reason: 'invalid' });
    expect(stav(15, 'kedysi', '2026-09-01')).toEqual({ state: 'unknown', reason: 'invalid' });
  });

  it('percento mimo 0–100 už nie je percento — `unknown/invalid`', () => {
    expect(stav(-5, '2026-08-14', '2026-09-01')).toEqual({ state: 'unknown', reason: 'invalid' });
    expect(stav(101, '2026-08-14', '2026-09-01')).toEqual({ state: 'unknown', reason: 'invalid' });
  });

  it('percento MIMO nášho rozsahu 1–30 sa neprepisuje ani nezamlčuje', () => {
    // Zľavu mohla nastaviť ruka v admine alebo flash sale. Keby to mapper
    // zaokrúhlil alebo skryl, porovnávač (bod A2) by hlásil zhodu tam, kde
    // je rozdiel.
    expect(stav(60, '2026-08-14', '2026-09-01')).toEqual({
      state: 'active',
      percent: 60,
      from: '2026-08-14',
      to: '2026-09-01',
    });
  });

  it('`toShopReduction` je čistá funkcia a dá sa volať aj bez zvyšku produktu', () => {
    expect(
      toShopReduction({ reduction_percent: null, reduction_from: null, reduction_to: null }),
    ).toEqual({ state: 'none' });
    expect(
      toShopReduction({ reduction_percent: 10, reduction_from: '2026-08-14', reduction_to: '2026-08-20' }),
    ).toEqual({ state: 'active', percent: 10, from: '2026-08-14', to: '2026-08-20' });
  });
});

describe('zmiznutá trojica `reduction_*` je drift, nie ticho', () => {
  it('chýbajúce `reduction_percent` = `schema_drift` (D54), nie „žiadna zľava"', async () => {
    const key = fakeKey();
    const drifts: string[] = [];
    const bezZlavy = { ...MINIMAL_PAYLOAD } as Record<string, unknown>;
    delete bezZlavy.reduction_percent;

    const { fetchImpl } = harness(() => json(wrapped(bezZlavy)));
    const shop = client(fetchImpl, { onSchemaDrift: ({ path }) => drifts.push(path) });

    await expect(shop.getProductFull(49, key.ref, ctx())).rejects.toMatchObject({
      shopError: { kind: 'schema_drift' },
    });
    expect(drifts).toEqual(['/api/products/getFull']);
  });

  it('celá zmiznutá trojica je drift — inak by appka „nevedela" navždy', async () => {
    const key = fakeKey();
    const holy = {
      id: 49,
      name: 'Náramok',
      price: 12.3,
      has_attributes: false,
    };
    const { fetchImpl } = harness(() => json(wrapped(holy)));
    await expect(client(fetchImpl).getProductFull(49, key.ref, ctx())).rejects.toBeInstanceOf(
      ShopRequestError,
    );
  });

  it('zle typovaná trojica (`false` namiesto dátumu) je tiež drift', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() =>
      json(wrapped({ ...MINIMAL_PAYLOAD, reduction_from: false })),
    );
    await expect(client(fetchImpl).getProductFull(49, key.ref, ctx())).rejects.toMatchObject({
      shopError: { kind: 'schema_drift' },
    });
  });
});

/* ═════════ 3. Voliteľné polia smú chýbať, povinné nie (§2, D54) ═══════════ */

describe('voliteľné back-office polia', () => {
  it('môžu chýbať všetky naraz — stav zľavy sa prečíta aj tak', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() => json(wrapped(MINIMAL_PAYLOAD)));
    const full = await client(fetchImpl).getProductFull(49, key.ref, ctx());

    expect(full.reduction).toEqual({ state: 'none' });
    expect(full.purchase_price).toBeUndefined();
    expect(full.margin).toBeUndefined();
    expect(full.margin_percent).toBeUndefined();
    expect(full.qty).toBeUndefined();
    expect(full.qty_in_orders).toBeUndefined();
    expect(full.categories).toBeUndefined();
    expect(full.supplier).toBeUndefined();
    expect(full.ean13).toBeUndefined();
    expect(full.active).toBeUndefined();
    expect(full.attributes).toBeUndefined();
  });

  it('`null` od shopu sa nezamení za „pole neprišlo"', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() =>
      json(
        wrapped({
          ...MINIMAL_PAYLOAD,
          supplier: null,
          last_time_in_order: null,
          purchase_price: null,
          categories: null,
        }),
      ),
    );
    const full = await client(fetchImpl).getProductFull(49, key.ref, ctx());

    expect(full.supplier).toBeNull();
    expect(full.last_time_in_order).toBeNull();
    expect(full.purchase_price).toBeNull();
    expect(full.categories).toBeNull();
    // `margin` neprišlo vôbec — to je iný fakt než `null`.
    expect('margin' in full).toBe(false);
  });

  it('prázdne `attributes` u nevariantného produktu prejdú ako prázdne pole', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() =>
      json(wrapped({ ...MINIMAL_PAYLOAD, has_attributes: 0, attributes: [], qty: 12 })),
    );
    const full = await client(fetchImpl).getProductFull(49, key.ref, ctx());

    expect(full.has_attributes).toBe(false);
    expect(full.attributes).toEqual([]);
    // Bod C2: sklad vieme aj pre nevariantný produkt, kde `attributes` nič nenesú.
    expect(full.qty).toBe(12);
  });

  it('neznáme pole navyše nie je drift — shop smie pridávať (§2)', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() =>
      json(wrapped({ ...MINIMAL_PAYLOAD, uplne_nove_pole: 'čokoľvek' })),
    );
    await expect(client(fetchImpl).getProductFull(49, key.ref, ctx())).resolves.toMatchObject({
      id: 49,
    });
  });
});

/* ═══════════ 4. PHP `DECIMAL`: cena ako string aj ako číslo (§2) ══════════ */

describe('peniaze a počty prichádzajú ako string aj ako číslo', () => {
  const cena = (raw: unknown): number | null | undefined => {
    const parsed = parseShopPayload(productFullSchema, {
      ...MINIMAL_PAYLOAD,
      purchase_price: raw,
    });
    return parsed.ok ? toProductFull(parsed.value).purchase_price : null;
  };

  it('číslo aj bodkový string ostávajú, ako boli', () => {
    expect(cena(5.4)).toBe(5.4);
    expect(cena('5.40')).toBe(5.4);
  });

  it('desatinná čiarka a oddeľovač tisícov sa prečítajú správne', () => {
    expect(cena('5,40')).toBe(5.4);
    expect(cena('1 234,50')).toBe(1234.5);
    expect(cena('1,234.50')).toBe(1234.5);
  });

  it('nezmysel zostáva driftom — vlastný parser sa nepíše (§2)', () => {
    // `numberLike` je jediný parser peňazí v module; nejednoznačné `'1,234'`
    // (slovensky 1,234 vs. anglicky 1 234) sa zásadne nehádže.
    expect(cena('nie je cena')).toBeNull();
    expect(cena('1,234')).toBeNull();
    expect(cena('')).toBeNull();
  });

  it('sklad a kategórie znesú číselné stringy rovnako', () => {
    const parsed = parseShopPayload(productFullSchema, {
      ...MINIMAL_PAYLOAD,
      qty: '7',
      qty_in_orders: 134,
      categories: ['2', 15],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const full = toProductFull(parsed.value);
    expect(full.qty).toBe(7);
    expect(full.qty_in_orders).toBe(134);
    expect(full.categories).toEqual([2, 15]);
  });

  it('`active` znesie `1`/`0`, `true`/`false` aj ich stringové podoby', () => {
    const active = (raw: unknown): boolean | null | undefined => {
      const parsed = parseShopPayload(productFullSchema, { ...MINIMAL_PAYLOAD, active: raw });
      return parsed.ok ? toProductFull(parsed.value).active : null;
    };
    expect(active(1)).toBe(true);
    expect(active('0')).toBe(false);
    expect(active(true)).toBe(true);
    expect(active('false')).toBe(false);
  });
});

/* ═════════════ 5. Kľúč: čítanie S kľúčom, ale bez úniku (I1) ══════════════ */

describe('kľúč pri `getFull` — hlavička áno, nikde inde nie (I1, D64)', () => {
  it('pošle `X-Api-Key` v hlavičke a nič nedá do URL', async () => {
    const key = fakeKey();
    const { fetchImpl, calls } = harness(() => json(wrapped(MINIMAL_PAYLOAD)));
    await client(fetchImpl).getProductFull(49, key.ref, ctx());

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers['x-api-key']).toBe(TEST_KEY);
    expect(calls[0].url).toContain('/api/products/getFull?id=49');
    expect(calls[0].url).not.toContain(TEST_KEY);
    // GET nemá telo, do ktorého by kľúč mohol spadnúť.
    expect(calls[0].body).toBeNull();
  });

  it('`release()` prebehne práve raz a Buffer je vynulovaný', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() => json(wrapped(MINIMAL_PAYLOAD)));
    await client(fetchImpl).getProductFull(49, key.ref, ctx());

    expect(key.releases).toBe(1);
    expect(key.zeroed).toEqual([true]);
  });

  it('kľúč sa uvoľní aj keď volanie skončí chybou', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() => json({ ok: false, error: 'not found' }, 404));
    await expect(client(fetchImpl).getProductFull(49, key.ref, ctx())).rejects.toMatchObject({
      shopError: { kind: 'not_found' },
    });
    expect(key.releases).toBe(1);
    expect(key.zeroed).toEqual([true]);
  });

  it('čítania katalógu kľúč naďalej NEMAJÚ — anonymná cesta ostáva anonymná', async () => {
    const { fetchImpl, calls } = harness((req) => {
      if (req.url.includes('getFull')) return json(wrapped(MINIMAL_PAYLOAD));
      if (req.url.includes('/api/products/get')) {
        return json(wrapped({ id: 49, name: 'Náramok', price: 12.3, has_attributes: false }));
      }
      return json(wrapped({ data: [], page: 1, per_page: 1, total: 0 }));
    });
    const shop = client(fetchImpl);
    await shop.listProducts({ perPage: 1 }, ctx());
    await shop.getProduct(49, ctx());
    await shop.getProductFull(49, fakeKey().ref, ctx());

    expect(calls[0].headers['x-api-key']).toBeUndefined();
    expect(calls[1].headers['x-api-key']).toBeUndefined();
    expect(calls[2].headers['x-api-key']).toBe(TEST_KEY);
  });
});

/* ═════════════ 6. Chýbajúci scope `product:read` a spol. ══════════════════ */

describe('chýbajúce oprávnenie sa nesmie tváriť ako údaj', () => {
  it('403 skončí chybou `forbidden`, nikdy prázdnym produktom', async () => {
    const key = fakeKey();
    const { fetchImpl } = harness(() => json({ error: 'forbidden' }, 403));
    await expect(client(fetchImpl).getProductFull(49, key.ref, ctx())).rejects.toMatchObject({
      shopError: { kind: 'forbidden' },
    });
  });

  it('403 NEVOLÁ `onKeyRejected` — ten patrí zápisovému kľúču (D51/D52)', async () => {
    // `getFull` beží s kľúčom `product:read`. Keby sa callback spustil,
    // volajúci by wipol ZÁPISOVÝ kľúč, ktorý shop vôbec neodmietol.
    const key = fakeKey();
    const onKeyRejected = vi.fn();
    const { fetchImpl } = harness(() => json({ error: 'forbidden' }, 403));

    await expect(
      client(fetchImpl, { onKeyRejected }).getProductFull(49, key.ref, ctx()),
    ).rejects.toBeInstanceOf(ShopRequestError);
    expect(onKeyRejected).not.toHaveBeenCalled();
  });

  it('401 sa správa rovnako', async () => {
    const key = fakeKey();
    const onKeyRejected = vi.fn();
    const { fetchImpl } = harness(() => json({ error: 'forbidden' }, 401));

    await expect(
      client(fetchImpl, { onKeyRejected }).getProductFull(49, key.ref, ctx()),
    ).rejects.toMatchObject({ shopError: { kind: 'unauthorized' } });
    expect(onKeyRejected).not.toHaveBeenCalled();
  });
});

/* ═══════════════ 7. Lokálna validácia pred odoslaním (I9) ═════════════════ */

describe('nezmyselné id sa nikam neposiela', () => {
  it('id ≤ 0 a neceločíselné id skončia lokálne, bez requestu', async () => {
    const key = fakeKey();
    const { fetchImpl, calls } = harness(() => json(wrapped(MINIMAL_PAYLOAD)));
    const shop = client(fetchImpl);

    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(shop.getProductFull(bad, key.ref, ctx())).rejects.toMatchObject({
        shopError: { kind: 'bad_request', code: 'local_invalid_product_id' },
      });
    }
    expect(calls).toHaveLength(0);
    // Kľúč sa ani nedešifroval — nebolo čo posielať.
    expect(key.releases).toBe(0);
  });
});
