/**
 * Aura Zľavy — KPI TABUĽKY: SKUTOČNÉ ZAPOJENIE (kontrakt V4 D114, K8).
 *
 * @vitest-environment jsdom
 *
 * PREČO MÁ TENTO SÚBOR VLASTNÉ PROSTREDIE
 * ───────────────────────────────────────
 * Zvyšok obrazovky Produktov sa meria `renderToStaticMarkup` — bez DOM-u a bez
 * efektov. Na značky to stačí, na DOTAZ nie: KPI sa načítavajú v `useEffect`,
 * a práve to je tvrdenie, ktoré treba dokázať:
 *
 *  · stránka o 100 riadkoch spustí PRÁVE JEDEN dotaz na `product-kpi`
 *    (nie sto — to by bolo N+1, ktoré kontrakt V4 výslovne zakazuje),
 *  · v dotaze sú VŠETKY ID stránky,
 *  · čísla z odpovede sa naozaj objavia v riadkoch,
 *  · keď odpoveď zlyhá, bunky zostanú pomlčkami — nie nulami (I11).
 *
 * Statický render by prvé tri z toho „dokázal" tým, že sa nespustí nič.
 *
 * ŽIADNY SHOP (K8): jediné adresy, ktoré tu smú padnúť, sú lokálne `/api/*`.
 * Test to overuje zoznamom volaní, nie dobrou vôľou.
 *
 * Vlastník: vlna V4-PRODUKTY.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CatalogPanel from '@/components/products/CatalogPanel';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const PAGE_SIZE = 100;
const IDS = Array.from({ length: PAGE_SIZE }, (_, i) => 10_000 + i);

const searchPayload = () => ({
  ok: true,
  data: {
    data: IDS.map((productId, index) => ({
      productId,
      name: `Strieborný prsteň ${index + 1}`,
      price: '29.90',
      hasAttributes: false,
      shopStatus: 'ok',
      unitsSold: 0,
      everDiscounted: false,
      discountedNow: false,
      fetchedAt: '2026-08-30T01:00:00.000Z',
      origin: 'mirror',
    })),
    page: 1,
    perPage: PAGE_SIZE,
    total: 41_348,
    soldWindowDays: 30,
    soldFrom: '2026-08-02',
    soldTo: '2026-08-31',
    counts: null,
    catalogTotal: 41_348,
    dataAsOf: '2026-08-30T01:00:00.000Z',
    lockedFilters: {},
    lookup: { requested: false, outcome: '' },
    capabilities: [],
  },
});

/** Obohatený je LEN prvý riadok — presne to, čo D118 spraví v praxi. */
const kpiPayload = () => ({
  ok: true,
  data: {
    today: '2026-08-31',
    window30: { windowDays: 30, from: '2026-08-02', to: '2026-08-31', completeDays: 30, unknownDays: 0 },
    window90: { windowDays: 90, from: '2026-06-03', to: '2026-08-31', completeDays: 90, unknownDays: 0 },
    rows: [
      {
        productId: IDS[0],
        missing: false,
        reference: { value: 'PRS-9001', gap: null },
        supplier: { value: 'Aura', gap: null },
        priceWithVat: { value: 35.88, gap: null },
        margin: { value: 9.5, gap: null },
        marginPercent: { value: 31, gap: null },
        discount: {
          state: 'none',
          activePercent: { value: null, gap: 'shop_has_none' },
          reportedPercent: { value: null, gap: 'shop_has_none' },
          from: null,
          to: null,
          measuredAt: '2026-08-30T02:00:00.000Z',
        },
        stock: { value: 4, gap: null },
        soldTotal: { value: 12, gap: null },
        lastSaleAt: { value: '2026-08-20T00:00:00.000Z', gap: null },
        daysSinceLastSale: { value: 11, gap: null },
        soldPerStock: { value: 3, gap: null },
        units30: {
          windowDays: 30,
          from: '2026-08-02',
          to: '2026-08-31',
          completeDays: 30,
          unknownDays: 0,
          units: { value: 0, gap: null },
          lowerBound: false,
        },
        units90: {
          windowDays: 90,
          from: '2026-06-03',
          to: '2026-08-31',
          completeDays: 90,
          unknownDays: 0,
          units: { value: 5, gap: null },
          lowerBound: false,
        },
        noSale: { mark: false, proof: null },
        enrichedAt: '2026-08-30T02:00:00.000Z',
      },
    ],
    requested: { shortWindowDays: 30, longWindowDays: 90 },
    skippedIds: [],
  },
});

let container: HTMLElement;
let root: Root;
let calls: string[];
const povodnyFetch = globalThis.fetch;

/** `true` = `product-kpi` odpovie chybou (dôkaz o pomlčkách namiesto núl). */
let kpiFails = false;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  calls = [];
  kpiFails = false;

  const json = (body: unknown): Response =>
    ({ json: () => Promise.resolve(body) }) as unknown as Response;

  globalThis.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('/api/catalog/search')) return Promise.resolve(json(searchPayload()));
    if (url.startsWith('/api/insights/product-kpi')) {
      return kpiFails
        ? Promise.resolve(json({ ok: false, error: { code: 'db_down', message: 'Nedostupné.' } }))
        : Promise.resolve(json(kpiPayload()));
    }
    // Ostatné dotazy obrazovky (stav, pokrytie, kódy) tento test nemeria —
    // prísľub, ktorý nedobehne, ich nechá v stave „zatiaľ nenačítané", teda
    // v tom, ktorý sa aj tak kreslí prvý.
    return new Promise<Response>(() => {});
  }) as unknown as typeof globalThis.fetch;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = povodnyFetch;
  vi.restoreAllMocks();
});

/** Vykreslí obrazovku a nechá dobehnúť efekty aj prísľuby. */
async function otvor(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(CatalogPanel, {
        initialFilter: { ...DEFAULT_CATALOG_FILTER, perPage: PAGE_SIZE },
      }),
    );
  });
  // Druhý priechod: prvý dobehol `catalog/search`, KPI sa pýtajú až z riadkov.
  await act(async () => {
    await Promise.resolve();
  });
}

const kpiCalls = (): string[] =>
  calls.filter((url) => url.startsWith('/api/insights/product-kpi'));

/* ═══════════════════════════ 1. Jeden dotaz ═══════════════════════════════ */

describe('V4 — KPI stránky idú jedným dotazom (D114)', () => {
  it('sto riadkov = JEDEN dotaz so všetkými ID', async () => {
    await otvor();
    expect(kpiCalls().length).toBe(1);
    const url = kpiCalls()[0] ?? '';
    const ids = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('ids');
    expect(ids?.split(',').length).toBe(PAGE_SIZE);
    expect(ids?.startsWith(String(IDS[0]))).toBe(true);
    expect(ids).toContain(String(IDS[PAGE_SIZE - 1]));
  });

  it('na render ceste sa nevolá shop, len lokálne `/api/*` (K8)', async () => {
    await otvor();
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) expect(url.startsWith('/api/')).toBe(true);
  });

  it('čísla z odpovede sú v riadku a nula z DOČÍTANÉHO okna zostane nulou', async () => {
    await otvor();
    const html = container.innerHTML;
    // Referencia je na povrchu pri názve (D116).
    expect(html).toContain('PRS-9001');
    // Celé okno 30 dní je dočítané a v ňom nula kusov — MERANÝ fakt.
    const cell = container.querySelector(`[data-testid="kpi-units30-${IDS[0]}"]`);
    expect(cell?.textContent).toBe('0');
    expect(cell?.getAttribute('data-unknown')).toBeNull();
    // Dlhé okno má päť kusov.
    expect(
      container.querySelector(`[data-testid="kpi-units90-${IDS[0]}"]`)?.textContent,
    ).toBe('5');
    // Shop k času merania povedal, že zľava nebeží — to je veta, nie pomlčka.
    expect(
      container.querySelector(`[data-testid="kpi-shop-discount-${IDS[0]}"]`)?.textContent,
    ).toBe('bez zľavy');
  });

  it('riadok, o ktorom odpoveď KPI nič nepovedala, je celý „nevieme"', async () => {
    await otvor();
    const iny = IDS[1];
    for (const testId of [
      `kpi-units30-${iny}`,
      `kpi-units90-${iny}`,
      `kpi-sold-per-stock-${iny}`,
      `kpi-last-sale-${iny}`,
      `kpi-shop-discount-${iny}`,
    ]) {
      const node = container.querySelector(`[data-testid="${testId}"]`);
      expect(node?.getAttribute('data-unknown'), testId).toBe('true');
      expect(node?.textContent, testId).toBe('—');
    }
    // A rozhodne nie „bez predaja": neobohatený produkt nie je mŕtvy produkt.
    expect(container.querySelector(`[data-testid="row-no-sale-${iny}"]`)).toBeNull();
  });

  it('zlyhaná odpoveď KPI nechá pomlčky, nie nuly', async () => {
    kpiFails = true;
    await otvor();
    expect(kpiCalls().length).toBe(1);
    const cell = container.querySelector(`[data-testid="kpi-units30-${IDS[0]}"]`);
    expect(cell?.textContent).toBe('—');
    expect(cell?.getAttribute('data-unknown')).toBe('true');
    // Ani jedna bunka KPI sa nesmie vykresliť ako nula.
    const nuly = [...container.querySelectorAll('[data-testid^="kpi-"]')].filter(
      (node) => node.textContent === '0',
    );
    expect(nuly.length).toBe(0);
  });
});
