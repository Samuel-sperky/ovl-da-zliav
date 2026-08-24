/**
 * Aura Zľavy — ZĽAVY A PRODUKTY ČÍTAJÚ ODPOVEĎ, NIE TYP (B6, vlna 24. 8. 2026).
 *
 * ČO SA STALO
 * -----------
 * `campaigns/zlavy-api.ts` a `products/catalog-api.ts` brali celé telo odpovede
 * jedným `as` a vydávali ho za overený pohľad:
 *
 *     const body = (await res.json()) as Result<T>;   // catalog-api
 *     return getJson<DiscountDetailData>(url);        // zlavy-api
 *
 * `T` za behu neexistuje, takže sa neoverilo NIČ. Tadiaľto prišiel kód stavu
 * `writing`, ktorý zhodil tab Zľavy na bielu stránku, a tou istou dierou by
 * prešlo čokoľvek — reťazec namiesto počtu, chýbajúci blok kľúča, pole
 * namiesto objektu. Prehľad (`dashboard/api.ts`, `dashboard/status-api.ts`) to
 * robil správne od začiatku: `fetchJson<unknown>` + `parseX` nad primitívami
 * z `dashboard/json.ts`. Tieto dva moduly sú odteraz na tom istom vzore.
 *
 * ČO TENTO SÚBOR MERIA
 * --------------------
 * Správanie s podstrčeným `fetch`, nie text zdroja. Pretypovanie je práve to,
 * čo v TypeScripte NEVYVOLÁ žiadnu udalosť — `grep` po `as` by o ňom nepovedal
 * nič a mutácia zdroja by test falošne potvrdila.
 *
 *  A. **Nečitateľná odpoveď je CHYBA S VETOU, nie prázdny pohľad.** Prázdna
 *     tabuľka tvrdí „nič také nemáme"; to sa z neznalosti povedať nesmie (P7).
 *  B. **Nečitateľný RIADOK sa zahodí, zvyšok stránky prežije.**
 *  C. **Čísla sú čísla.** Reťazec z odpovede sa nesmie dostať do poľa, ktoré
 *     obrazovka počíta — `'12' - 1` je matematika, ktorá nikoho nevaruje.
 *  D. **Uzavreté zoznamy sa overujú.** Neznámy kód dostane fail-closed hodnotu,
 *     nie surovú — kľúč do tabuľky vzhľadu, ktorý v nej nie je, je `undefined`
 *     a odtiaľ vedie priama cesta k prázdnej obrazovke.
 *  E. **Kód STAVU zľavy sa naopak preberá surový.** Rieši ho slovník, ktorý ho
 *     prizná; keby ho zahodil parser, obrazovka by o zľave tvrdila viac, než
 *     z odpovede vyplýva.
 *  F. **`/api/status` sa dá bezpečne prepočítať.** `statusSnapshotFromPayload()`
 *     siaha rovno na `payload.apiKey.expiresAt`; neúplný payload bol `TypeError`
 *     a biela obrazovka, nie „menej dát".
 *
 * Vlastník: B6, vlna 24. 8. 2026.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getDiscount,
  keyMeta,
  listDiscounts,
  scopeLimits,
  searchCatalog as searchCatalogZlavy,
  fetchStatus,
} from '@/components/campaigns/zlavy-api';
import { sentenceOf } from '@/components/campaigns/discounts-model';
import {
  appStatus,
  catalogSyncStatus,
  isAborted,
  runCatalogBatch,
  searchCatalog,
} from '@/components/products/catalog-api';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';
import { statusSnapshotFromPayload } from '@/lib/status/snapshot';
import { SURFACE_STATES } from '@/lib/ui/vocabulary';

/* ═══════════════════════ 0. Podstrčený `fetch` ════════════════════════════ */

/** Server odpovie týmto telom. Bez siete, bez DB. */
function serverSays(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response),
  );
}

/** Server odpovie obálkou `{ok:true,data:…}` — bežná úspešná cesta. */
const wrapped = (data: unknown): void => serverSays({ ok: true, data });

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Riadok zľavy, ktorý je celý v poriadku. */
function discountRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 11,
    name: 'Letná zľava',
    status: 'queued',
    percent: 20,
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31',
    mode: 'eager',
    itemsTotal: 10,
    itemsOk: 3,
    itemsFailed: 0,
    itemsUncertain: 0,
    itemsPending: 7,
    late: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    tiers: [],
    estimate: null,
    ...patch,
  };
}

/* ═════════ A. Nečitateľná odpoveď je chyba s vetou, nie prázdno ═══════════ */

describe('nečitateľná odpoveď nekončí ako prázdny pohľad', () => {
  it('zoznam zliav bez poľa `data` je chyba, nie „žiadne zľavy"', async () => {
    wrapped({ data: 'toto nie je pole', total: 0 });
    const res = await listDiscounts();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Vetu kreslí obrazovka — prázdna by bola prázdny riadok bez vysvetlenia.
    expect(res.error.message.length).toBeGreaterThan(0);
  });

  it('detail zľavy bez zľavy je chyba, nie prázdny detail', async () => {
    wrapped({ items: [], auditTrail: [] });
    const res = await getDiscount(11);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message.length).toBeGreaterThan(0);
  });

  it('strop na jednu zľavu sa nevymýšľa — bez čísla je to chyba (K1)', async () => {
    wrapped({ dailyWriteBudget: 200, writesLocked: false });
    const res = await scopeLimits();
    expect(res.ok).toBe(false);
  });

  it('katalóg tabu Produkty bez poľa riadkov je chyba, nie prázdny katalóg', async () => {
    wrapped({ total: 0 });
    const res = await searchCatalog(DEFAULT_CATALOG_FILTER);
    expect(res.ok).toBe(false);
  });

  it('zrušený dotaz zostáva zrušený, nie „server odpovedal inak"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError');
      }),
    );
    const res = await searchCatalog(DEFAULT_CATALOG_FILTER);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(isAborted(res.error)).toBe(true);
  });
});

/* ═════════ B. Nečitateľný riadok sa zahodí, stránka prežije ═══════════════ */

describe('jeden pokazený riadok nezhodí celú stránku', () => {
  it('zľava bez `id` vypadne, ostatné zostanú', async () => {
    wrapped({ data: [discountRow(), discountRow({ id: undefined, name: 'Bez identity' })] });
    const res = await listDiscounts();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data).toHaveLength(1);
    expect(res.data.data[0]?.name).toBe('Letná zľava');
  });

  it('rozpočet, ktorý sa nedá prečítať, je `null` — nie samé nuly (P7)', async () => {
    wrapped({ data: [], budget: { day: '2026-08-24', spent: 'veľa' } });
    const res = await listDiscounts();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.budget).toBeNull();
  });
});

/* ═══════════════════════ C. Čísla sú čísla ════════════════════════════════ */

describe('čo obrazovka počíta, musí byť číslo', () => {
  it('reťazec namiesto počtu položiek sa ďalej neposiela', async () => {
    wrapped({ data: [discountRow({ itemsOk: '12', itemsFailed: null })] });
    const res = await listDiscounts();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = res.data.data[0]!;
    expect(typeof row.itemsOk).toBe('number');
    expect(typeof row.itemsFailed).toBe('number');
    expect(Number.isFinite(row.itemsOk)).toBe(true);
  });

  it('„koľko sekúnd platí kľúč" je `null`, keď sa to nedá prečítať', async () => {
    wrapped({ present: true, expiresAt: '2026-09-01T00:00:00.000Z', secondsLeft: 'veľa' });
    const res = await keyMeta();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // `null` = nevieme. Nula by tvrdila, že kľúč vypršal PRÁVE TERAZ.
    expect(res.data.secondsLeft).toBeNull();
    expect(res.data.present).toBe(true);
  });
});

/* ═══════════════ D. Uzavreté zoznamy sa overujú ═══════════════════════════ */

describe('kód z uzavretého zoznamu sa nepreberá surový', () => {
  it('neznámy `shopStatus` padá na „nevieme", nie na svoju surovú hodnotu', async () => {
    wrapped({
      data: [{ productId: 900, name: 'Prsteň', shopStatus: 'nieco_uplne_ine' }],
      total: 1,
    });
    const res = await searchCatalog(DEFAULT_CATALOG_FILTER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data[0]?.shopStatus).toBe('unknown');
    expect(res.data.data[0]?.origin).toBe('mirror');
  });

  it('beh synchronizácie s neznámym výsledkom je chyba, nie tichý `undefined`', async () => {
    wrapped({ outcome: 'nieco_nove', sync: null, catalog: { loadedProducts: 10 } });
    const res = await runCatalogBatch();
    expect(res.ok).toBe(false);
  });

  it('nečitateľný rozpočet čítaní katalógu sa PRIZNÁ cez `known: false`', async () => {
    wrapped({ catalog: { loadedProducts: 2900, reads: 'toto nie je objekt' } });
    const res = await catalogSyncStatus();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.catalog.reads.known).toBe(false);
    expect(res.data.catalog.shopTotalProducts).toBeNull();
  });
});

/* ═══════ E. Kód stavu zľavy sa preberá surový — rieši ho slovník ══════════ */

describe('kód stavu zľavy prejde parserom nedotknutý', () => {
  it('`writing` sa nezahodí ani nenahradí už v čítaní odpovede', async () => {
    wrapped({ data: [discountRow({ status: 'writing' })] });
    const res = await listDiscounts();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data[0]?.status).toBe('writing');
  });

  it('a obrazovka z neho aj tak dostane slovo, nie prázdno', async () => {
    wrapped({ data: [discountRow({ status: 'writing' })] });
    const res = await listDiscounts();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const veta = sentenceOf(res.data.data[0]!, '2026-08-24');
    expect(SURFACE_STATES).toContain(veta.state);
    expect(veta.text).not.toContain('writing');
  });

  it('zľava bez kódu stavu je nečitateľný riadok a vypadne', async () => {
    wrapped({ data: [discountRow({ status: undefined })] });
    const res = await listDiscounts();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data).toHaveLength(0);
  });
});

/* ═══════ F. `/api/status` sa dá prepočítať bez pádu ═══════════════════════ */

/** Payload, ktorý je celý v poriadku. */
function statusBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    now: '2026-08-24T09:00:00.000Z',
    writes: { enabled: true, locked: false, lockedReason: null, lockedAt: null },
    apiKey: { present: true, expiresAt: '2026-09-01T00:00:00.000Z' },
    writeBudget: { day: '2026-08-24', budget: 200, spent: 10, remaining: 190, exhausted: false },
    scope: { mode: 'pilot', maxProductsSetting: 10, maxProducts: 10, failClosed: false },
    catalog: { loadedProducts: 2900, shopTotalProducts: 41082, lastFetchedAt: null },
    catalogReads: null,
    salesSync: null,
    blockers: [],
    summary: {
      blocked: false,
      blockingCount: 0,
      worstBlockerId: null,
      waitUntil: null,
      anyAssumed: false,
    },
    unreadable: [],
    ...patch,
  };
}

describe('stav appky sa dá prepočítať nad vlastným výberom', () => {
  it('payload bez bloku kľúča sa prepočíta a nespadne', async () => {
    // PRESNE tento tvar bol predtým `TypeError` v `statusSnapshotFromPayload()`:
    // `payload.apiKey.expiresAt` nad `undefined`.
    wrapped(statusBody({ apiKey: undefined, writes: undefined }));
    const res = await appStatus();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(() => statusSnapshotFromPayload(res.data)).not.toThrow();
    // „Nevieme" nie je „nie": chýbajúci blok je `null`, nie `false`.
    expect(res.data.apiKey.present).toBeNull();
    expect(res.data.writes.enabled).toBeNull();
  });

  it('rovnaká odpoveď v tabe Zľavy sa číta rovnako', async () => {
    wrapped(statusBody({ apiKey: undefined }));
    const res = await fetchStatus();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(() => statusSnapshotFromPayload(res.data)).not.toThrow();
  });

  it('prekážka s neznámym spôsobom riešenia dostane fail-closed hodnotu', async () => {
    wrapped(
      statusBody({
        blockers: [
          {
            id: 'key_missing',
            area: 'kluc',
            severity: 'nieco',
            subject: 'operacia',
            productIds: [],
            what: 'Chýba kľúč na zápis.',
            nextStep: 'Vložte kľúč v Nastaveniach.',
            path: '/nastavenia',
            resolution: 'nieco',
            passableNow: false,
            clearsAt: null,
          },
        ],
      }),
    );
    const res = await appStatus();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const blocker = res.data.blockers[0]!;
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.resolution).toBe('mimo_appky');
    // Keď sa nedá prečítať, či veta stojí na domnienke, JE to domnienka.
    expect(blocker.assumed).toBe(true);
  });

  it('odpoveď bez zhrnutia je chyba — poloprázdny stav vyzerá ako pokoj', async () => {
    wrapped(statusBody({ summary: undefined }));
    const res = await appStatus();
    expect(res.ok).toBe(false);
  });
});

/* ═══════ G. Katalóg v sprievodcovi zľavy číta rovnako prísne ══════════════ */

describe('katalóg v sprievodcovi novej zľavy', () => {
  it('riadok bez `productId` vypadne, ostatné zostanú', async () => {
    wrapped({
      data: [{ productId: 900, name: 'Prsteň' }, { name: 'Bez identity' }],
      total: 2,
    });
    const res = await searchCatalogZlavy(DEFAULT_CATALOG_FILTER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.data).toHaveLength(1);
    expect(res.data.data[0]?.productId).toBe(900);
  });
});
