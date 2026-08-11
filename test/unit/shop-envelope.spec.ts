/**
 * Aura Zľavy — obálka `{"result":…}` v odpovediach shopu (D54).
 *
 * Produkčný shop obaľuje úspešné telá do `{"result":{…}}`:
 *
 * ```
 * GET /api/products  →  200  {"result":{"data":[…],"page":1,"per_page":100,"total":40483}}
 * ```
 *
 * Mock (`test/mock-shop/`) aj staršia dokumentácia kontraktu vracajú payload
 * priamo, bez obalu. Klient MUSÍ zvládnuť OBA tvary — preto má každý test tu
 * dvojičku „s obálkou“ / „bez obálky“. Keď sa obal neroz balí, zod padne na
 * koreňovom kľúči a D54 to klasifikuje ako `schema_drift`, takže katalógová
 * synchronizácia skončí `outcome=failed pages=0 products=0` — presne to sa
 * dialo naživo 11. 8. 2026.
 *
 * Obal NIE JE drift, je to konvencia (rovnaké rozhodnutie ako
 * `unwrapEnvelope()` v `orders-client.ts`). Skutočný drift — chýbajúci alebo
 * zle typovaný povinný kľúč — musí zostať driftom, aj keď príde v obale; na to
 * je posledný blok testov.
 *
 * Beží s fake fetch, žiadny request neopustí proces (I6).
 *
 * Vlastník: A3.
 */
import { describe, expect, it } from 'vitest';

import type { ProductDetail, ShopClient, ShopCtx } from '@/contracts';

import { createShopClient, type FetchLike } from '@/lib/shop/client';
import { newOperationContext } from '@/lib/shop/correlation';
import { ShopRequestError } from '@/lib/shop/errors';
import {
  bodySignalsFailure,
  parseShopPayload,
  productListItemSchema,
  readErrorBody,
} from '@/lib/shop/schemas';

/* ═════════════════════════ 0. Testovací harness ═══════════════════════════ */

const BASE = 'https://127.0.0.1:8443';

/** Telo, aké vracia produkčný `GET /api/products` — bez obalu. */
const LIST_PAYLOAD = {
  data: [
    { id: 11, name: 'Náušnice', price: '12.50', has_attributes: 0 },
    { id: 12, name: 'Prsteň', price: 89, has_attributes: 1 },
  ],
  page: 1,
  per_page: 100,
  total: 40_483,
};

const DETAIL_PAYLOAD = {
  ok: true,
  id: 11,
  name: 'Náušnice',
  price: '12.50',
  has_attributes: 0,
  description: 'Strieborné náušnice',
};

/** Ten istý payload zabalený tak, ako ho posiela reálny shop. */
const wrapped = (payload: unknown): { result: unknown } => ({ result: payload });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Klient, ktorý na KAŽDÉ volanie vráti to isté telo. */
function clientReturning(body: unknown, status = 200): ShopClient {
  const fetchImpl: FetchLike = async () => json(body, status);
  return createShopClient({
    baseUrl: BASE,
    fetchImpl,
    version: '0.0.0-test',
    readTimeoutMs: 5000,
    writeTimeoutMs: 5000,
    timeZone: 'Europe/Bratislava',
    sleepFn: async () => {},
  });
}

const ctx = (): ShopCtx => newOperationContext();

const isDetail = (value: ProductDetail | { kind: string }): value is ProductDetail =>
  !('kind' in value);

/* ═══════════════════ 1. Zoznam produktov — obe konvencie ══════════════════ */

describe('listProducts — obálka `{"result":…}` aj bare objekt', () => {
  it('rozbalí obálku a vráti produkty (produkčný tvar)', async () => {
    const shop = clientReturning(wrapped(LIST_PAYLOAD));
    const page = await shop.listProducts({ page: 1, perPage: 100 }, ctx());

    expect(page.total).toBe(40_483);
    expect(page.page).toBe(1);
    expect(page.perPage).toBe(100);
    expect(page.data.map((p) => p.id)).toEqual([11, 12]);
    expect(page.data[0].price).toBe(12.5);
    expect(page.data[0].has_attributes).toBe(false);
    expect(page.data[1].has_attributes).toBe(true);
  });

  it('bare objekt bez obálky funguje ďalej (mock, starší kontrakt)', async () => {
    const shop = clientReturning(LIST_PAYLOAD);
    const page = await shop.listProducts({ page: 1, perPage: 100 }, ctx());

    expect(page.total).toBe(40_483);
    expect(page.data.map((p) => p.id)).toEqual([11, 12]);
  });
});

/* ═══════════════════ 2. Detail produktu — obe konvencie ═══════════════════ */

describe('getProduct — obálka `{"result":…}` aj bare objekt', () => {
  it('rozbalí obálku', async () => {
    const shop = clientReturning(wrapped(DETAIL_PAYLOAD));
    const detail = await shop.getProduct(11, ctx());

    expect(detail.id).toBe(11);
    expect(detail.price).toBe(12.5);
    expect(detail.description).toBe('Strieborné náušnice');
  });

  it('bare objekt bez obálky funguje ďalej', async () => {
    const shop = clientReturning(DETAIL_PAYLOAD);
    expect((await shop.getProduct(11, ctx())).id).toBe(11);
  });
});

/* ══════════════════════ 3. Canary — test pripojenia ═══════════════════════ */

describe('canary — obálka `{"result":…}` aj bare objekt', () => {
  it('rozbalí obálku a ohlási celkový počet produktov', async () => {
    const result = await clientReturning(wrapped(LIST_PAYLOAD)).canary(ctx());
    expect(result.ok).toBe(true);
    expect(result.total).toBe(40_483);
  });

  it('bare objekt bez obálky funguje ďalej', async () => {
    const result = await clientReturning(LIST_PAYLOAD).canary(ctx());
    expect(result.ok).toBe(true);
    expect(result.total).toBe(40_483);
  });
});

/* ═══════════════════════ 4. Dávka (D56) — obe konvencie ═══════════════════ */

describe('batchGetProducts — obálka na dávke aj na slote', () => {
  it('rozbalí obálku dávky aj obálku jednotlivého slotu', async () => {
    const shop = clientReturning(wrapped({ ok: true, results: [wrapped(DETAIL_PAYLOAD)] }));
    const { results, via } = await shop.batchGetProducts([11], ctx());

    expect(via).toBe('batch');
    const slot = results.get(11);
    expect(slot).toBeDefined();
    expect(isDetail(slot!)).toBe(true);
    expect((slot as ProductDetail).price).toBe(12.5);
  });

  it('bare dávka aj bare sloty fungujú ďalej', async () => {
    const shop = clientReturning({ ok: true, results: [DETAIL_PAYLOAD] });
    const { results, via } = await shop.batchGetProducts([11], ctx());

    expect(via).toBe('batch');
    expect((results.get(11) as ProductDetail).id).toBe(11);
  });
});

/* ═════════════════ 5. Chybové telá v obálke (§6, HTTP 200) ════════════════ */

describe('readErrorBody — chybový tvar prichádza tiež v obálke', () => {
  it('`{result:{ok:false,errors:[…]}}` je neúspech, nie prázdny nález', () => {
    const read = readErrorBody(wrapped({ ok: false, errors: ['invalid_dates'] }));
    expect(read.okFalse).toBe(true);
    expect(read.codes).toEqual(['invalid_dates']);
    expect(bodySignalsFailure(wrapped({ ok: false, errors: ['invalid_dates'] }))).toBe(true);
  });

  it('`{result:{error:…}}` (singulárny tvar) sa prečíta rovnako', () => {
    expect(readErrorBody(wrapped({ error: 'not_found' })).codes).toEqual(['not_found']);
    expect(bodySignalsFailure(wrapped({ error: 'not_found' }))).toBe(true);
  });

  it('bare chybové telá fungujú ďalej', () => {
    expect(readErrorBody({ ok: false, errors: ['invalid_dates'] }).okFalse).toBe(true);
    expect(bodySignalsFailure({ error: 'not_found' })).toBe(true);
  });

  it('`ok` na VONKAJŠEJ úrovni obálky sa rozbalením nesmie stratiť', () => {
    // `{ok:false, result:{…}}` — nesie `ok` vonku, payload vnútri. Keby sa
    // čítala len rozbalená úroveň, HTTP 200 s `ok:false` by prešlo ako úspech.
    const read = readErrorBody({ ok: false, error: 'invalid_dates', result: { id: 11 } });
    expect(read.okFalse).toBe(true);
    expect(read.codes).toEqual(['invalid_dates']);
    expect(bodySignalsFailure({ ok: false, result: { id: 11 } })).toBe(true);
  });

  it('kódy sa zoberú z oboch úrovní a neduplikujú sa', () => {
    const read = readErrorBody({ errors: ['vonku'], result: { errors: ['vonku', 'vnutri'] } });
    expect(read.codes).toEqual(['vonku', 'vnutri']);
  });

  it('úspešná obálka nesignalizuje chybu', () => {
    expect(bodySignalsFailure(wrapped(LIST_PAYLOAD))).toBe(false);
    expect(readErrorBody(wrapped(LIST_PAYLOAD)).okFalse).toBe(false);
  });
});

/* ═══════════════ 6. Desatinná čiarka v PHP `DECIMAL` (§2) ═════════════════ */

describe('cena — PHP `DECIMAL` smie prísť s desatinnou čiarkou', () => {
  const price = (raw: unknown): number | null => {
    const parsed = parseShopPayload(productListItemSchema, {
      id: 1,
      name: 'x',
      price: raw,
      has_attributes: 0,
    });
    return parsed.ok ? parsed.value.price : null;
  };

  it('číslo aj bodkový string ostávajú, ako boli', () => {
    expect(price(12.5)).toBe(12.5);
    expect(price('12.50')).toBe(12.5);
  });

  it('čiarka je desatinný oddeľovač, nie oddeľovač tisícov', () => {
    expect(price('12,50')).toBe(12.5);
    expect(price(' 89,00 ')).toBe(89);
  });

  it('oddeľovač tisícov sa nezapočíta do hodnoty', () => {
    expect(price('1 234,50')).toBe(1234.5);
    expect(price('1,234.50')).toBe(1234.5);
  });

  it('nečíslo zostáva driftom — tolerancia nesmie prehltnúť nezmysel', () => {
    expect(price('nie je cena')).toBeNull();
    expect(price('')).toBeNull();
    expect(price(null)).toBeNull();
  });
});

/* ═════════════ 7. Skutočný drift zostáva driftom (D54) ════════════════════ */

describe('rozbalenie obálky nesmie prehltnúť skutočný drift', () => {
  it('chýbajúci povinný kľúč v obálke je stále `schema_drift`', async () => {
    const shop = clientReturning(wrapped({ data: [], page: 1, per_page: 100 })); // bez `total`
    await expect(shop.listProducts({}, ctx())).rejects.toMatchObject({
      shopError: { kind: 'schema_drift' },
    });
  });

  it('zle typovaný kľúč v obálke je stále `schema_drift`', async () => {
    const shop = clientReturning(wrapped({ ...LIST_PAYLOAD, data: 'nie je pole' }));
    await expect(shop.listProducts({}, ctx())).rejects.toBeInstanceOf(ShopRequestError);
  });

  it('nezmysel bez obálky je stále `schema_drift`', async () => {
    const shop = clientReturning('garbage');
    await expect(shop.listProducts({}, ctx())).rejects.toMatchObject({
      shopError: { kind: 'schema_drift' },
    });
  });
});
