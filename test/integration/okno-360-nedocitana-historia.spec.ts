/**
 * Aura Zľavy — OKNO 360 DNÍ NAD NEDOČÍTANOU HISTÓRIOU (D149, K9; I11).
 *
 * Čo tento súbor dokazuje a prečo práve na TELE ODPOVEDE
 * -----------------------------------------------------
 * D149 zdvihol strop `SALES_WINDOW_DAYS` z 90 na 360, takže obrazovka si od
 * 3. 9. 2026 smie vypýtať okno, za ktoré appka takmer isto NEMÁ dáta —
 * sťahovanie histórie je dlhé (jedna objednávka je jeden request) a normálny
 * stav okna 360 dní je preto „dočítaných 90, zvyšok nevieme".
 *
 * Presne tu už raz v tomto repe vznikla lož, ktorú nenašlo 3756 testov: model
 * bol správny a dostal nepravdivý vstup, pretože route posielala `unitsSold: 0`
 * namiesto `null`. Trojstavovosť sa preto NEDÁ overiť na modeli — musí sa
 * overiť na TELE ODPOVEDE, ktoré obrazovka naozaj dostane. Tento súbor to robí:
 * ide cez `defineRoute()` pipeline a číta rozparsovaný JSON.
 *
 * Štyri tvrdenia:
 *  A. Vypýtané okno JE 360 dní a odpoveď hovorí, KOĽKO dní z neho je dočítaných
 *     (`completeDays` / `unknownDays`) — bez toho čísla obrazovka nemá čím
 *     povedať vetu, ktorú R3 kontraktu žiada.
 *  B. Súčet nad nedočítaným oknom je DOLNÁ HRANICA: `lowerBound: true` a
 *     `gap: 'days_missing'` aj vtedy, keď je hodnota nenulová.
 *  C. Nula nad nedočítaným oknom NIE JE fakt — nesie ten istý `gap`.
 *     Bez jediného dočítaného dňa je hodnota `null`, nikdy `0`.
 *  D. Krátke a dlhé okno sa hodnotia SAMOSTATNE: 30 dní môže byť celé
 *     dočítaných (meranie) v tej istej odpovedi, v ktorej je 360 dní dolná
 *     hranica. Keby sa pokrytie počítalo raz pre celú odpoveď, tento test
 *     zčervená.
 *
 * Bez DB a bez siete: `productKpis()` beží nad SKUTOČNÝM výpočtom a podvrhujú
 * sa mu len tri zdroje (riadky zrkadla, pokrytie dní, spojenie pre dotaz na
 * kusy) — rovnako ako v `insights-v4.spec.ts`. Žiadny shop (K8), žiadny kľúč
 * (I1). Deň je VPICHNUTÝ, takže test neflakuje medzi 22:00 a 24:00 UTC.
 *
 * Vlastník: V7 (D149, dátová cesta okna 180/360).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CatalogEnrichmentRecord,
  DateOnly,
  MoneyString,
  Queryable,
  SalesDayCoverage,
} from '@/contracts';
import type { CatalogKpiRow } from '@/lib/repo/catalog.repo';
import type { RouteDeps } from '@/lib/http/define-route';

import { emptyCatalogEnrichment } from '@/lib/repo/catalog.repo';
import { resetRateLimiter } from '@/lib/http/define-route';
import { addDays, diffDays } from '@/lib/domain/dates';
import {
  createInsightsProductKpiGet,
  type ProductKpiResponse,
} from '@/app/api/insights/product-kpi/route';

const APP_ORIGIN = 'https://zlavy.local';

/** Kotva: 3. 9. 2026. Deň je vpichnutý — nikdy `new Date()` bez argumentu. */
const TODAY = '2026-09-03' as DateOnly;
const NOW = new Date('2026-09-03T09:00:00.000Z');

/** Okno, o ktoré sa pýtame, a to, koľko z neho je naozaj stiahnuté. */
const LONG_DAYS = 360;
const READ_DAYS = 90;

/** Produkt s predajmi a produkt, ktorý sa v dočítaných dňoch nepredal. */
const P_SOLD = 90_601;
const P_QUIET = 90_602;

function routeDeps(): RouteDeps {
  return { now: () => NOW, localActor: async () => ({ id: 1, username: 'samuel' }) };
}

async function body<T>(response: Response): Promise<T> {
  const parsed = (await response.json()) as { ok: boolean; data?: T };
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  return parsed.data as T;
}

function kpiRow(
  productId: number,
  enrichment: Partial<CatalogEnrichmentRecord> = {},
): CatalogKpiRow {
  return {
    productId,
    missing: false,
    name: `Šperk ${String(productId)}`,
    price: '49.90' as MoneyString,
    enrichment: { ...emptyCatalogEnrichment(productId), ...enrichment },
  };
}

/**
 * Volanie route s pokrytím, ktoré rozhoduje DEŇ PO DNI.
 *
 * `readFrom` je prvý dočítaný deň; všetko pred ním je `missing`, teda deň, o
 * ktorom `sales_sync_state` nemá ani riadok. Práve to je stav, v akom bude
 * okno 360 dní po zdvihnutí stropu — a nie „nula predaných".
 */
async function callKpi(opts: {
  ids: string;
  query?: string;
  /** Odkedy sú dni dočítané. `null` = ani jeden deň nie je dočítaný. */
  readFrom: DateOnly | null;
  /** `product_id → [kusy krátkeho okna, kusy dlhého okna]`. */
  units?: Map<number, [number, number]>;
}): Promise<{ status: number; data: ProductKpiResponse }> {
  const conn: Queryable = {
    query: async <T>(): Promise<T> =>
      [...(opts.units ?? new Map<number, [number, number]>()).entries()].map(
        ([productId, [short, long]]) => ({
          product_id: productId,
          units_short: short,
          units_long: long,
        }),
      ) as unknown as T,
  };

  const handler = createInsightsProductKpiGet(
    {
      now: () => NOW,
      timeZone: 'Europe/Bratislava',
      kpiSources: {
        conn,
        catalog: {
          kpiRowsFor: async (ids) => {
            const out = new Map<number, CatalogKpiRow>();
            for (const id of ids) out.set(id, kpiRow(id));
            return out;
          },
        },
        sales: {
          coverageFor: async (from, to) => {
            const days: Array<{ day: DateOnly; coverage: SalesDayCoverage; ordersSeen: number }> =
              [];
            let completeDays = 0;
            let unknownDays = 0;
            let cursor: DateOnly = from;
            for (let i = 0; i <= diffDays(from, to); i += 1) {
              const read = opts.readFrom !== null && cursor >= opts.readFrom;
              const coverage: SalesDayCoverage = read ? 'complete' : 'missing';
              if (read) completeDays += 1;
              else unknownDays += 1;
              days.push({ day: cursor, coverage, ordersSeen: read ? 4 : 0 });
              cursor = addDays(cursor, 1);
            }
            return { from, to, days, completeDays, unknownDays };
          },
        },
      },
    },
    routeDeps(),
  );

  const response = await handler(
    new Request(`${APP_ORIGIN}/api/insights/product-kpi?ids=${opts.ids}${opts.query ?? ''}`, {
      method: 'GET',
    }),
  );
  if (response.status !== 200) {
    return { status: response.status, data: {} as ProductKpiResponse };
  }
  return { status: response.status, data: await body<ProductKpiResponse>(response) };
}

/* ══════════ Podvrhnutý `fetch` — na render ceste nesmie odísť request ═════ */

let fetchCalls: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetRateLimiter();
  fetchCalls = [];
  globalThis.fetch = ((input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input);
    fetchCalls.push(url);
    throw new Error(`K8: čítacia route zavolala shop (${url})`);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  expect(fetchCalls, 'na render ceste nesmie odísť ani jeden request').toEqual([]);
});

/* ═════════════════════════════════════════════════════════════════════════ */

describe('GET /api/insights/product-kpi?long=360 — nedočítaná história (D149)', () => {
  /** Prvý dočítaný deň: posledných 90 dní vrátane dneška. */
  const readFrom = addDays(TODAY, -(READ_DAYS - 1));

  it('A — telo odpovede hovorí ČÍSLOM, koľko dní okna je dočítaných', async () => {
    const { data } = await callKpi({
      ids: String(P_SOLD),
      query: `&long=${LONG_DAYS}`,
      readFrom,
      units: new Map([[P_SOLD, [4, 37]]]),
    });

    // Vypýtané okno sa v odpovedi POTVRDZUJE — nadpis obrazovky sa má o čo oprieť.
    expect(data.requested.longWindowDays).toBe(LONG_DAYS);
    expect(data.window90.windowDays).toBe(LONG_DAYS);
    expect(data.window90.from).toBe(addDays(TODAY, -(LONG_DAYS - 1)));
    expect(data.window90.to).toBe(TODAY);

    // A hlavne: koľko z toho okna appka NAOZAJ má.
    expect(data.window90.completeDays).toBe(READ_DAYS);
    expect(data.window90.unknownDays).toBe(LONG_DAYS - READ_DAYS);
    // Poistka proti tichému zliatiu: pokrytie NIE JE celé okno.
    expect(data.window90.completeDays).toBeLessThan(data.window90.windowDays);

    // To isté číslo nesie aj riadok, takže bunka tabuľky ho má po ruke.
    const row = data.rows.find((r) => r.productId === P_SOLD);
    expect(row?.units90.windowDays).toBe(LONG_DAYS);
    expect(row?.units90.completeDays).toBe(READ_DAYS);
    expect(row?.units90.unknownDays).toBe(LONG_DAYS - READ_DAYS);
  });

  it('B — súčet nad nedočítaným oknom je DOLNÁ HRANICA, a priznáva to', async () => {
    const { data } = await callKpi({
      ids: String(P_SOLD),
      query: `&long=${LONG_DAYS}`,
      readFrom,
      units: new Map([[P_SOLD, [4, 37]]]),
    });

    const row = data.rows.find((r) => r.productId === P_SOLD);
    expect(row?.units90.lowerBound).toBe(true);
    // Číslo sa nezahodí, ale nesie dôvod — obrazovka ho kreslí s „≥".
    expect(row?.units90.units).toEqual({ value: 37, gap: 'days_missing' });
  });

  it('C — nula nad nedočítaným oknom nie je fakt; bez dní je to `null`', async () => {
    const partial = await callKpi({
      ids: `${P_SOLD},${P_QUIET}`,
      query: `&long=${LONG_DAYS}`,
      readFrom,
      units: new Map([[P_SOLD, [4, 37]]]),
    });
    const quiet = partial.data.rows.find((r) => r.productId === P_QUIET);
    // Nepredalo sa nič za dočítané dni — ale o zvyšku okna nevieme, takže to
    // NIE JE zmeraná nula a `gap` to hovorí.
    expect(quiet?.units90.units).toEqual({ value: 0, gap: 'days_missing' });
    expect(quiet?.units90.lowerBound).toBe(true);

    const nothing = await callKpi({
      ids: String(P_SOLD),
      query: `&long=${LONG_DAYS}`,
      readFrom: null,
      units: new Map([[P_SOLD, [4, 37]]]),
    });
    const row = nothing.data.rows.find((r) => r.productId === P_SOLD);
    expect(nothing.data.window90.completeDays).toBe(0);
    expect(row?.units90.units).toEqual({ value: null, gap: 'days_missing' });
    // Značka „bez predaja" z nedočítaného okna vzniknúť NESMIE (D119).
    expect(row?.noSale.mark).toBe(false);
  });

  it('D — krátke okno môže byť meranie v tej istej odpovedi', async () => {
    const { data } = await callKpi({
      ids: String(P_SOLD),
      query: `&window=30&long=${LONG_DAYS}`,
      readFrom,
      units: new Map([[P_SOLD, [4, 37]]]),
    });

    const row = data.rows.find((r) => r.productId === P_SOLD);
    // 30 dní je podmnožina dočítaných 90 → meranie, bez medzery.
    expect(data.window30.windowDays).toBe(30);
    expect(data.window30.unknownDays).toBe(0);
    expect(row?.units30.lowerBound).toBe(false);
    expect(row?.units30.units).toEqual({ value: 4, gap: null });
    // …a súčasne 360 dní je dolná hranica. Dve okná, dve odpovede.
    expect(row?.units90.lowerBound).toBe(true);
  });

  it('180 dní je tiež otvorené — dve z troch okien Samuela boli prázdne', async () => {
    const { data } = await callKpi({
      ids: String(P_SOLD),
      query: '&long=180',
      readFrom,
      units: new Map([[P_SOLD, [4, 20]]]),
    });
    expect(data.requested.longWindowDays).toBe(180);
    expect(data.window90.windowDays).toBe(180);
    expect(data.window90.completeDays).toBe(READ_DAYS);
  });

  it('okno mimo zoznamu je 400, nie tichý fallback na 90', async () => {
    const { status } = await callKpi({
      ids: String(P_SOLD),
      query: '&long=45',
      readFrom,
    });
    expect(status).toBe(400);
  });

  it('bez `?long=` zostáva 90 dní — starý volajúci sa nezmenil', async () => {
    const { data } = await callKpi({
      ids: String(P_SOLD),
      readFrom,
      units: new Map([[P_SOLD, [4, 37]]]),
    });
    expect(data.requested.longWindowDays).toBe(90);
    expect(data.window90.windowDays).toBe(90);
    // Celé 90-dňové okno je dočítané, takže tu je to MERANIE.
    expect(data.window90.unknownDays).toBe(0);
    expect(data.rows[0]?.units90.units).toEqual({ value: 37, gap: null });
  });
});
