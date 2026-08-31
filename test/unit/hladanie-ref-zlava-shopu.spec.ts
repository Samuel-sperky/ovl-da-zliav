/**
 * Aura Zľavy — HĽADANIE PODĽA REFERENCIE a FILTER „ZĽAVA V SHOPE"
 * (KONTRAKT V4 §5 K4; D116, migrácia 0014; invariant I11).
 *
 * Obohatenie katalógu (`getFull`) doplnilo do zrkadla `reference`, `ean13` a
 * `reduction_percent/from/to`. Obrazovka Produkty ich UKAZOVALA, ale nedali sa
 * použiť ako otázka — a v tejto appke je to najdrahšia trieda chyby:
 *
 *  A. **„Nájdi NAU-1042" vracalo nulu.** `WHERE` pozeralo výhradne `c.name`,
 *     takže kód produktu nenašiel nikto. Prázdny výsledok sa na obrazovke číta
 *     ako „taký produkt neexistuje", nie ako „týmto sa nehľadá".
 *  B. **Zľava v shope sa nedala filtrovať.** Existujúci `currentlyDiscounted`
 *     stojí na VLASTNÝCH zápisoch (`campaign_items`), teda hovorí inú vetu.
 *     Klientský filter nad načítanou stránkou by tvrdil niečo o celom katalógu.
 *
 * Oboje sa dá LEN pri obohatených riadkoch — pri ostatných sú tie stĺpce `NULL`.
 * Preto tu okrem tvaru `WHERE` stráži tento súbor aj to, že sa to PRIZNÁVA
 * (`enrichedOnly`, `counts.enrichedRows`): filter, ktorý ticho vynechá 40 tisíc
 * riadkov, je tvrdenie, nie filter (I11, K8).
 *
 * Testuje sa cez `defaultConn`, ktoré si SQL a parametre len zapíše — žiadna DB
 * a žiadny `fetch` (I6).
 *
 * Vlastník: V15 (hľadanie). Čítanie zrkadla: V8.
 */
import { describe, expect, it } from 'vitest';

import type { Queryable } from '@/contracts';
import {
  createCatalogRepo,
  ENRICHED_ONLY_FEATURES,
  type CatalogSearchFilter,
  type CatalogSearchResult,
} from '@/lib/repo/catalog.repo';
import {
  createCatalogSearchRoute,
  type CatalogSearchRouteDeps,
} from '@/app/api/catalog/search/route';
import type { RouteDeps } from '@/lib/http/define-route';

/* ═══════════════════════════ 1. Prostredie ════════════════════════════════ */

const TODAY = '2026-08-31';

interface Call {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** Spojenie, ktoré si dotaz zapíše a odpovie tým, čo mu podstrčíme. */
function recordingConn(rows: unknown[] = []): { conn: Queryable; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    conn: {
      query: (async (sql: string, values?: unknown) => {
        calls.push({ sql, values: Array.isArray(values) ? values : [] });
        return rows;
      }) as Queryable['query'],
    },
  };
}

const countCall = (calls: readonly Call[]): Call => {
  const call = calls.find((item) => item.sql.startsWith('SELECT COUNT(*)'));
  if (call === undefined) throw new Error('Repozitár neposlal `COUNT(*)` dotaz.');
  return call;
};

const whereOf = (sql: string): string => sql.slice(sql.indexOf(' WHERE '));

async function searchCalls(filter: CatalogSearchFilter): Promise<Call[]> {
  const { conn, calls } = recordingConn();
  await createCatalogRepo({ defaultConn: conn }).search({ today: TODAY, ...filter });
  return calls;
}

/* ══════════════ 2. Hľadanie pozerá aj kód produktu a EAN ══════════════════ */

describe('hľadanie hľadá v názve, referencii a EAN-e', () => {
  it('`NAU-1042` sa hľadá vo všetkých troch stĺpcoch, každý ako `?`', async () => {
    const call = countCall(await searchCalls({ query: 'NAU-1042' }));
    const where = whereOf(call.sql);

    expect(where).toContain('c.name LIKE');
    expect(where).toContain('c.reference LIKE');
    expect(where).toContain('c.ean13 LIKE');
    // Do SQL sa nedostane ani znak hľadaného textu.
    expect(call.sql).not.toContain('NAU-1042');
    expect(call.values.filter((value) => value === 'NAU-1042')).toHaveLength(3);
  });

  it('stĺpce sú spojené cez `OR` — kód nesmie byť podmienkou navyše', async () => {
    const where = whereOf(countCall(await searchCalls({ query: 'NAU-1042' })).sql);

    // `AND` by znamenalo, že produkt musí mať hľadaný text V NÁZVE AJ V KÓDE,
    // teda by hľadanie prestalo nachádzať čokoľvek podľa názvu.
    expect(where).toContain('c.name LIKE CONCAT(\'%\', ?, \'%\') ESCAPE \'\\\\\' OR c.reference LIKE');
    expect(where).not.toContain('ESCAPE \'\\\\\' AND c.reference LIKE');
  });

  it('celé číslo je ID ALEBO text vo všetkých troch stĺpcoch (EAN je číslo)', async () => {
    const call = countCall(await searchCalls({ query: '5901234123457' }));
    const where = whereOf(call.sql);

    // Trinásťciferný EAN už nie je ID (strop 9 cifier), ale hľadať sa v `ean13`
    // musí — inak sa dá nájsť len omylom, ako „slovo" v názve.
    expect(where).toContain('c.ean13 LIKE');
    expect(call.values.filter((value) => value === '5901234123457')).toHaveLength(3);
  });

  it('`%` a `_` sa escapujú aj pre kód a EAN, nie len pre názov', async () => {
    const call = countCall(await searchCalls({ query: 'NAU_1%' }));

    expect(call.values.filter((value) => value === 'NAU\\_1\\%')).toHaveLength(3);
  });

  it('`search()` priznáva, že kód a EAN pozná len pri obohatených riadkoch', async () => {
    const { conn } = recordingConn();
    const result: CatalogSearchResult = await createCatalogRepo({ defaultConn: conn }).search({
      query: 'NAU-1042',
      today: TODAY,
    });

    expect([...result.enrichedOnly].sort()).toEqual([...ENRICHED_ONLY_FEATURES].sort());
    // A NIE je to zamknutý filter: zamknutý sa neaplikuje vôbec (K8).
    expect(result.lockedFilters).not.toContain('referenceSearch');
  });
});

/* ══════════════ 3. Filter „má aktívnu zľavu podľa shopu" ══════════════════ */

describe('filter „zľava v shope" stojí na obohatení, nie na vlastných zápisoch', () => {
  it('bez filtra sa `reduction_*` v `WHERE` nespomína vôbec', async () => {
    const where = whereOf(countCall(await searchCalls({ query: 'naramok' })).sql);

    expect(where).not.toContain('c.reduction_percent');
  });

  it('`shopDiscounted` pridá okno zľavy zo shopu s hranicami CELÉHO dňa', async () => {
    const call = countCall(await searchCalls({ shopDiscounted: true }));
    const where = whereOf(call.sql);

    expect(where).toContain('c.reduction_percent IS NOT NULL');
    // Nula percent nie je zľava.
    expect(where).toContain('c.reduction_percent > 0');
    // `DATETIME` stĺpce voči DŇU: zľava končiaca dnes o 12:00 dnes ešte bežala.
    expect(where).toContain('c.reduction_from IS NULL OR c.reduction_from <= ?');
    expect(where).toContain('c.reduction_to IS NULL OR c.reduction_to >= ?');
    expect(call.values).toContain(`${TODAY} 23:59:59`);
    expect(call.values).toContain(`${TODAY} 00:00:00`);
  });

  it('je to DRUHÝ filter, nie prepis „práve v zľave" — dajú sa kombinovať', async () => {
    const where = whereOf(
      countCall(await searchCalls({ shopDiscounted: true, currentlyDiscounted: true })).sql,
    );

    // Vlastné zápisy (`d.now_on` z `campaign_items`) AJ stav shopu naraz.
    expect(where).toContain('COALESCE(d.now_on, 0) = 1');
    expect(where).toContain('c.reduction_percent IS NOT NULL');
  });

  it('`counts()` filter NEAPLIKUJE, ale vracia jeho číslo aj pokrytie', async () => {
    const { conn, calls } = recordingConn([
      {
        total: 41_348,
        sold_none: 41_348,
        sold_low: 0,
        sold_mid: 0,
        sold_high: 0,
        never_discounted: 41_000,
        discounted_now: 12,
        shop_discounted_now: 9,
        enriched_rows: 41,
      },
    ]);
    const counts = await createCatalogRepo({ defaultConn: conn }).counts({
      shopDiscounted: true,
      today: TODAY,
    });
    const sql = calls[0]?.sql ?? '';

    // Facetový filter vo vlastnom počte nesmie byť — inak by zaškrtnuté políčko
    // vynulovalo číslo pri sebe samom.
    expect(whereOf(sql)).not.toContain('c.reduction_percent');
    expect(sql).toContain('AS shop_discounted_now');
    expect(sql).toContain('AS enriched_rows');
    expect(counts.shopDiscountedNow).toBe(9);
    // Bez pokrytia je 9 dolná hranica vydávaná za počet (I11).
    expect(counts.enrichedRows).toBe(41);
    expect([...counts.enrichedOnly].sort()).toEqual([...ENRICHED_ONLY_FEATURES].sort());
  });
});

/* ═══════════ 4. Route — meno parametra je to isté ako v adrese ════════════ */

function routeDeps(seen: CatalogSearchFilter[]): CatalogSearchRouteDeps {
  const routeDepsValue: RouteDeps = {
    now: () => new Date(`${TODAY}T09:00:00.000Z`),
    newRequestId: () => '01J0000000000000000REF001',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
  return {
    routeDeps: routeDepsValue,
    now: () => new Date(`${TODAY}T09:00:00.000Z`),
    catalog: {
      search: async (filter) => {
        seen.push(filter);
        return {
          data: [],
          page: filter.page ?? 1,
          perPage: filter.perPage ?? 50,
          total: 0,
          soldWindowDays: 30,
          soldFrom: '2026-08-02',
          soldTo: TODAY,
          lockedFilters: [],
          enrichedOnly: [...ENRICHED_ONLY_FEATURES],
        };
      },
      counts: async (filter) => {
        seen.push(filter);
        return {
          total: 0,
          sold: { none: 0, low: 0, mid: 0, high: 0 },
          neverDiscounted: 0,
          discountedNow: 0,
          shopDiscountedNow: 9,
          enrichedRows: 41,
          soldWindowDays: 30,
          soldFrom: '2026-08-02',
          soldTo: TODAY,
          lockedFilters: [],
          enrichedOnly: [...ENRICHED_ONLY_FEATURES],
        };
      },
      totalRows: async () => 41_348,
      lastFetchedAt: async () => new Date(`${TODAY}T00:13:00.000Z`),
    },
    apiKey: {
      loadForUse: async () => null,
      recallScopes: () => ({ scopes: null, checkedAt: null }),
    },
  };
}

interface Body {
  ok: boolean;
  data: {
    discountSource: string;
    shopDiscountSource: string;
    enrichedOnly: string[];
    counts: { shopDiscountedNow: number; enrichedRows: number } | null;
  };
}

async function callSearch(query: string): Promise<{ body: Body; seen: CatalogSearchFilter[] }> {
  const seen: CatalogSearchFilter[] = [];
  const response = await createCatalogSearchRoute(routeDeps(seen))(
    new Request(`https://zlavy.local/api/catalog/search${query}`, {
      headers: { cookie: 'ovl_zliav_session=x' },
    }),
  );
  expect(response.status).toBe(200);
  return { body: (await response.json()) as Body, seen };
}

describe('GET /api/catalog/search — `shopDiscounted` a priznanie pokrytia', () => {
  it('`?shopDiscounted=1` sa dostane do filtra repozitára pod tým istým menom', async () => {
    const { seen } = await callSearch('?shopDiscounted=1');

    expect(seen).not.toHaveLength(0);
    for (const filter of seen) expect(filter.shopDiscounted).toBe(true);
  });

  it('bez parametra je filter vypnutý — nič sa nedomýšľa', async () => {
    const { seen } = await callSearch('?q=naramok');

    for (const filter of seen) expect(filter.shopDiscounted).toBe(false);
  });

  it('zdroje sa v odpovedi menujú OBA a nezlievajú sa', async () => {
    const { body } = await callSearch('?shopDiscounted=1&currentlyDiscounted=1');

    expect(body.data.discountSource).toBe('own_writes');
    expect(body.data.shopDiscountSource).toBe('shop_enrichment');
  });

  it('odpoveď nesie, čo platí len pre obohatené riadky, aj koľko ich je', async () => {
    const { body } = await callSearch('?q=NAU-1042');

    expect([...body.data.enrichedOnly].sort()).toEqual([...ENRICHED_ONLY_FEATURES].sort());
    expect(body.data.counts?.shopDiscountedNow).toBe(9);
    expect(body.data.counts?.enrichedRows).toBe(41);
  });
});
