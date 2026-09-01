/**
 * Aura Zľavy — OBOHATENIE STRANY MÁ NA OBRAZOVKE VOLAJÚCEHO (D123, K2, R2).
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * ─────────────────────────
 * Engine `enrichPageOnDemand()` aj vetva `mode: 'page'` v routе boli
 * 1. 9. 2026 hotové a mali 34 zelených tvrdení — a NIKTO ich z prehliadača
 * nevolal. Jediný klientsky `POST /api/catalog/enrich` posielal
 * `{ productId }`, teda jeden produkt z bočného panela. Preklik na `/produkty`
 * by teda neobohatil ani jeden riadok a tabuľka by zostala plná pomlčiek —
 * presne ten stav, kvôli ktorému V5 vznikol. Je to zapísaná pasca tohto repa:
 * „integračné testy nad routou sú zelené, produkčný wiring neexistuje."
 *
 * ČO SA TU MERIA
 * ──────────────
 *  A. **Klient naozaj pošle STRANU.** Meria sa telo požiadavky cez podvrhnutý
 *     `fetch`, nie prítomnosť reťazca v zdroji.
 *  B. **Odpoveď sa číta trojstavovo** (I11) — `day.*` s `null` sa NESMIE stať
 *     nulou, lebo nula by tvrdila, že dnes sa neobohatilo nič.
 *  C. **Obrazovka to povie ČÍSLOM** (R2) — pri naplnenom dennom cieli, pri
 *     chýbajúcom kľúči aj pri vyčerpanom rozpočte.
 *  D. **Volajúci je zapojený do obrazovky.** Efekty Reactu sa v prostredí
 *     `node` (vitest, `renderToStaticMarkup`) nespúšťajú, takže poslednú
 *     spojku — „`CatalogPanel` ten klient naozaj volá a vetu kreslí" — meria
 *     zdrojová kontrola. Je to jediné tvrdenie tohto súboru, ktoré sa nedá
 *     zmerať správaním, a preto je pomenované nahlas.
 *
 * Vlastník: V5 (zelená brána).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { enrichPage } from '@/components/products/extras-api';
import { enrichPageNote, type EnrichPageView } from '@/components/products/enrich-note';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Zdroj bez komentárov — komentár o volaní nie je volanie. */
const bezKomentarov = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const DAY_PLNY = {
  enrichedTodayByBatch: 600,
  dailyTarget: 600,
  targetLeft: 0,
  readsUsedToday: 780,
  readsLeftToday: 20,
  readsLimitToday: 800,
};

function view(patch: Partial<EnrichPageView> = {}): EnrichPageView {
  return {
    outcome: 'done',
    requested: 100,
    fresh: 0,
    stale: 100,
    attempted: 100,
    enriched: 100,
    skipped: 0,
    day: {
      enrichedTodayByBatch: 120,
      dailyTarget: 600,
      targetLeft: 480,
      readsUsedToday: 220,
      readsLeftToday: 580,
      readsLimitToday: 800,
      ...(patch.day ?? {}),
    },
    resumeAt: null,
    error: null,
    ...patch,
  };
}

/** Odpoveď routy v obálke `{ ok, data }`, tak ako ju posiela `defineRoute`. */
function odpoved(data: Record<string, unknown>): Response {
  return {
    json: async () => ({ ok: true, data }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ═════════ A. Klient pošle celú stranu, nie jeden produkt ═════════════════ */

describe('A. `enrichPage()` pošle STRANU na `POST /api/catalog/enrich`', () => {
  it('telo požiadavky nesie `productIds`, nie `productId`', async () => {
    const volania: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      volania.push({ url, init });
      return Promise.resolve(odpoved({ mode: 'page', outcome: 'done', enriched: 2 }));
    });

    const res = await enrichPage([18342, 21170]);

    expect(volania).toHaveLength(1);
    expect(volania[0]!.url).toBe('/api/catalog/enrich');
    expect(volania[0]!.init.method).toBe('POST');
    const telo: unknown = JSON.parse(String(volania[0]!.init.body));
    expect(telo).toEqual({ productIds: [18342, 21170] });
    expect(res.ok).toBe(true);
  });

  it('neznámy `outcome` je `failed`, nikdy `done`', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(odpoved({ mode: 'page', outcome: 'vsetko-super' })),
    );
    const res = await enrichPage([1]);
    expect(res.ok && res.data.outcome).toBe('failed');
  });
});

/* ═════════ B. Trojstavovosť odpovede (I11) ════════════════════════════════ */

describe('B. dnešné počty sa čítajú trojstavovo, `null` nie je nula', () => {
  it('chýbajúce `day` čísla zostanú `null` — nie nula', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        odpoved({
          mode: 'page',
          outcome: 'target_reached',
          day: {
            enrichedTodayByBatch: null,
            dailyTarget: 600,
            targetLeft: null,
            readsUsedToday: null,
            readsLeftToday: null,
            readsLimitToday: null,
          },
        }),
      ),
    );
    const res = await enrichPage([1]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.day.enrichedTodayByBatch).toBeNull();
    expect(res.data.day.targetLeft).toBeNull();
    expect(res.data.day.dailyTarget).toBe(600);
  });

  it('počty pokusov sú POČTY — chýbajúce pole je nula pokusov, nie „nevieme"', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(odpoved({ mode: 'page', outcome: 'fresh_only' })));
    const res = await enrichPage([1]);
    expect(res.ok && res.data.enriched).toBe(0);
    expect(res.ok && res.data.attempted).toBe(0);
  });
});

/* ═════════ C. Obrazovka to povie ČÍSLOM (R2) ══════════════════════════════ */

describe('C. veta pod tabuľkou hovorí čísla, nie „niečo sa nepodarilo"', () => {
  it('naplnený denný cieľ POVIE, koľko z koľkých a koľko riadkov zostáva', () => {
    const note = enrichPageNote(view({ outcome: 'target_reached', day: DAY_PLNY, skipped: 87 }));
    expect(note).not.toBeNull();
    expect(note!.tone).toBe('attention');
    expect(note!.text).toContain('600');
    expect(note!.text).toContain('87');
    // Nie je to chyba, je to strop kvóty — a veta to musí povedať.
    expect(note!.text).toContain('kvóty');
  });

  it('chýbajúci kľúč je čitateľný dôvod, nie ticho', () => {
    const note = enrichPageNote(view({ outcome: 'no_key', enriched: 0, skipped: 100 }));
    expect(note!.tone).toBe('attention');
    expect(note!.text).toContain('kľúč');
    expect(note!.text).toContain('100');
  });

  it('vyčerpaný denný rozpočet nesie OBE čísla', () => {
    const note = enrichPageNote(
      view({ outcome: 'budget_day', enriched: 0, skipped: 100, day: DAY_PLNY }),
    );
    expect(note!.text).toContain('780');
    expect(note!.text).toContain('800');
  });

  it('neznáme dnešné čísla sú POMLČKA, nikdy nula', () => {
    const prazdny = {
      enrichedTodayByBatch: null,
      dailyTarget: null,
      targetLeft: null,
      readsUsedToday: null,
      readsLeftToday: null,
      readsLimitToday: null,
    };
    const note = enrichPageNote(view({ outcome: 'target_reached', day: prazdny, skipped: 100 }));
    expect(note!.text).toContain('—');
    expect(note!.text).not.toMatch(/:\s*0\s*z\s*0/);
  });

  it('svieža strana MLČÍ — trvalá vysvetlivka sa prestane čítať', () => {
    expect(enrichPageNote(view({ outcome: 'fresh_only' }))).toBeNull();
    expect(enrichPageNote(view({ outcome: 'no_ids' }))).toBeNull();
    expect(enrichPageNote(view({ outcome: 'done', enriched: 0 }))).toBeNull();
    expect(enrichPageNote(null)).toBeNull();
  });

  it('úspech povie, koľko riadkov pribudlo a koľko z cieľa zostáva', () => {
    const note = enrichPageNote(view({ outcome: 'done', enriched: 42 }));
    expect(note!.tone).toBe('quiet');
    expect(note!.text).toContain('42');
    expect(note!.text).toContain('480');
  });

  it('kód chyby ide do `title`, nie do vety (I1)', () => {
    const note = enrichPageNote(
      view({ outcome: 'paused', error: 'ip_banned', resumeAt: '2026-09-02T00:00:00.000Z' }),
    );
    expect(note!.text).not.toContain('ip_banned');
    expect(note!.title).toContain('ip_banned');
  });

  it('KAŽDÝ výsledok okrem mlčania nesie aspoň jedno číslo alebo pomlčku', () => {
    /* Bez tohto by nový `outcome` mohol pribudnúť s vetou bez čísla — a R2
       žiada presne opak: obrazovka to má POVEDAŤ číslom. */
    const hlucne = [
      'done',
      'target_reached',
      'paused',
      'deadline',
      'locked',
      'unknown_scope',
      'no_key',
      'budget_day',
      'budget_minute',
      'budget_unknown',
      'ip_banned',
      'rate_limited',
      'failed',
    ] as const;
    for (const outcome of hlucne) {
      const note = enrichPageNote(view({ outcome, enriched: 3, skipped: 7 }));
      expect(note, outcome).not.toBeNull();
      expect(note!.text, outcome).toMatch(/[0-9—]/);
    }
  });
});

/* ═════════ D. Spojka do obrazovky (zdrojová kontrola, pomenovaná) ═════════ */

describe('D. `CatalogPanel` ten klient naozaj volá a vetu kreslí', () => {
  const PANEL = bezKomentarov('../../src/components/products/CatalogPanel.tsx');

  it('obrazovka volá `enrichPage()` nad ID práve zobrazenej strany', () => {
    expect(PANEL).toContain('enrichPage');
    expect(PANEL).toMatch(/enrichPage\(\s*\n?\s*rows\.map\(\(row\) => row\.productId\)/);
  });

  it('vetu kreslí z `enrichPageNote`, nie z vlastného textu', () => {
    expect(PANEL).toContain('enrichPageNote(');
    expect(PANEL).toContain('data-testid="catalog-enrich-note"');
  });

  it('po obohatení sa KPI vypýtajú ZNOVA — inak by riadky ostali pomlčkami', () => {
    /* KPI sa čítajú z lokálnej DB; kým obohatenie riadky nezapíše, odpoveď je
       tá istá. Bez druhého čítania by človek videl pomlčky na riadkoch, ktoré
       appka práve doplnila. */
    expect(PANEL).toContain('setKpiTick');
    expect(PANEL).toMatch(/\[pageIds, kpiTick\]/);
  });
});
