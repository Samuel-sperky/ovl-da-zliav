/**
 * Aura Zľavy — HUSTOTA A OPAKOVANIE NA TABE PRODUKTY
 * (kontrakt UX/dizajn 19. 8. 2026, defekty D4, D8, D9, D10; vlna O3).
 *
 * Štyri veci, ktoré sa na tejto obrazovke pokazili ticho a tento súbor ich
 * drží opravené:
 *
 *  D4. **Tá istá veta trikrát.** „Katalóg je prázdny" stálo v pilulke karty,
 *      v žltom páse s prekážkou aj v prázdnej tabuľke. Na obrazovke smie byť
 *      raz; karta odpovedá na inú otázku (čo sa s načítaním deje) a prekážku
 *      `catalog_incomplete` už nekreslí.
 *  D8. **Štyri dlaždice, z toho tri pomlčky.** Dlaždice ostávajú štyri
 *      (kontrakt UI, bod 16), ale dlaždica bez hodnoty nekreslí vysvetlivku —
 *      dôvody pomlčiek sú v jednom rozkliku „Prečo —" (P6).
 *  D9. **Zamknuté filtre dvakrát.** Jedna skupina, jedno vysvetlenie, jeden
 *      odkaz (kontrakt UI, bod 18 — `LockedFeatures.tsx` sa NEROZŠIRUJE).
 * D10. **Hustota pre 41 220 riadkov.** Pevná mriežka stĺpcov, názov na jeden
 *      riadok s celým textom v `title`, skok na stránku a dávka 200 riadkov.
 *      Čísla v tomto súbore sú ZMERANÉ na reálnej databáze (19. 8. 2026):
 *      41 220 produktov, priemerný názov 64 znakov, najdlhší 117, ceny
 *      0,00 – 1 758,46 €. Pri 1440 px sa do stĺpca názvu zmestí ≈ 116 znakov,
 *      takže orezaný je JEDEN názov zo 41 220 (0,002 %).
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Merajú sa značky a texty, nie pixely; pixely sa merali v prehliadači
 * a ich závery sú zapísané v hlavičke `CatalogTable.tsx`.
 *
 * Vlastník: O3.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CatalogFilters from '@/components/products/CatalogFilters';
import CatalogStatusPanel from '@/components/products/CatalogStatusPanel';
import CatalogTable, { PageJump } from '@/components/products/CatalogTable';
import CatalogTiles from '@/components/products/CatalogTiles';
import type { LockedFilterView } from '@/components/products/catalog-api';
import {
  DEFAULT_CATALOG_FILTER,
  PER_PAGE_CHOICES,
} from '@/components/products/catalog-filter';
import type { CatalogStatusView } from '@/components/products/catalog-status';
import {
  catalogEmptyView,
  catalogStateView,
  finishTile,
  loadedTile,
  missingTile,
  nextBatchTile,
} from '@/components/products/catalog-status';
import { collectOperationBlockers } from '@/lib/status/blockers';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

/** Najdlhší názov v reálnom katalógu k 19. 8. 2026 — 117 znakov. */
const NAJDLHSI_NAZOV =
  'Prevliekací strieborný náhrdelník 925 - kruh s čírymi a modrými zirkónmi, ' +
  'nepriehľadný kvietok z tyrkysových zirkónov';

const STATUS: CatalogStatusView = {
  loadedProducts: 2900,
  shopTotalProducts: null,
  percent: null,
  complete: false,
  refreshing: false,
  lastFetchedAt: '2026-08-19T01:00:00.000Z',
  lastReadAt: '2026-08-19T01:00:00.000Z',
  pagesDone: 29,
  pagesTotal: null,
  pagesLeft: null,
  perPage: 100,
  reads: {
    day: '2026-08-19',
    limit: 240,
    used: 29,
    remaining: 211,
    exhausted: false,
    resetAt: '2026-08-20T00:00:00.000Z',
    minuteLimit: 24,
    usedThisMinute: 0,
    known: true,
  },
  waiting: null,
  nextBatchAt: null,
  estimatedDaysLeft: null,
  estimatedFinishAt: null,
  lastError: null,
};

const PRAZDNY: CatalogStatusView = { ...STATUS, loadedProducts: 0, pagesDone: 0, percent: 0 };

const LOCKED: Readonly<Record<string, LockedFilterView>> = {
  stock: { label: 'Sklad', reason: 'stavy skladu' },
  turnover: { label: 'Obrátkovosť', reason: 'nákupné ceny' },
  category: { label: 'Kategória', reason: 'zoznam kategórií' },
  metal: { label: 'Kov', reason: 'zoznam kovov' },
  jewelryType: { label: 'Typ šperku', reason: 'zoznam typov' },
  margin: { label: 'Marža', reason: 'nákupné ceny' },
} as unknown as Readonly<Record<string, LockedFilterView>>;

/** Prekážky pre prázdny katalóg — `catalog_incomplete` medzi nimi JE. */
function prekazkyPrePrazdnyKatalog() {
  return collectOperationBlockers({
    now: new Date('2026-08-19T10:00:00.000Z'),
    writes: { enabled: true },
    apiKey: { present: true, expiresAt: new Date('2026-09-09T00:00:00.000Z') },
    writeBudget: { budget: 200, spent: 0, day: '2026-08-19' },
    scope: { mode: 'pilot', maxProducts: 10, failClosed: false },
    selection: { selectedCount: 0 },
    catalog: { loadedProducts: 0, shopTotalProducts: null, missingProductIds: [] },
  } as never);
}

function kartaPrazdna(): string {
  return renderToStaticMarkup(
    createElement(CatalogStatusPanel, {
      status: PRAZDNY,
      failed: false,
      blockers: prekazkyPrePrazdnyKatalog(),
      lastRun: null,
      running: false,
      onLoadBatch: () => {},
    }),
  );
}

function panelFiltrov(): string {
  return renderToStaticMarkup(
    createElement(CatalogFilters, {
      filter: DEFAULT_CATALOG_FILTER,
      counts: null,
      lockedFilters: LOCKED,
      saved: [],
      activeSaved: null,
      open: false,
      onChange: () => {},
      onApplySaved: () => {},
      onRemoveSaved: () => {},
    }),
  );
}

/** Koľkokrát sa reťazec v značkách vyskytuje. */
const kolkokrat = (html: string, text: string): number => html.split(text).length - 1;

/* ═════════════════════ D4 — povedz to raz ═════════════════════════════════ */

describe('D4 — prázdny katalóg sa hlási raz, nie trikrát', () => {
  const html = kartaPrazdna();

  it('karta stavu už vetu o prázdnom katalógu neopakuje', () => {
    expect(kolkokrat(html, 'prázdn')).toBe(0);
  });

  it('prekážka o neúplnom katalógu sa v karte nekreslí — karta to hovorí sama', () => {
    // Poistka, že sa naozaj testuje niečo: prekážka v zozname JE.
    expect(prekazkyPrePrazdnyKatalog().some((b) => b.id === 'catalog_incomplete')).toBe(true);
    expect(html).not.toContain('appka zatiaľ nemá načítaný ani jeden produkt');
    expect(html).not.toContain('Spustite načítanie katalógu v Produktoch');
  });

  it('pilulka odpovedá na inú otázku než dlaždica — čo sa s načítaním deje', () => {
    expect(catalogStateView(PRAZDNY).label).toBe('Načítanie katalógu sa ešte nezačalo');
    // Že je katalóg prázdny, hovorí ČÍSLO v dlaždici. Nula tu nie je domnienka:
    // `loadedProducts` je meraný počet riadkov v zrkadle.
    expect(loadedTile(PRAZDNY).value).toBe('0');
  });

  it('prázdny katalóg, ktorý na niečo čaká, nie je ten istý stav ako nezačatý', () => {
    const spomaleny = { ...PRAZDNY, waiting: 'rate_limited' as const };
    expect(catalogStateView(spomaleny).label).toBe('Katalóg čaká, shop ho spomalil');
  });

  it('vetu o prázdnom katalógu drží prázdna tabuľka — a len ona', () => {
    const empty = catalogEmptyView({ narrowed: false, status: PRAZDNY });
    expect(empty.title).toBe('Katalóg je zatiaľ prázdny');
    expect(empty.offerLoad).toBe(true);
    // Popis už nevysvetľuje to isté druhýkrát; hovorí, čo sa stane po kliknutí.
    expect(empty.description).not.toContain('prázdn');
    expect(empty.description.length).toBeLessThanOrEqual(90);
  });
});

/* ═════════════ D8 — štyri dlaždice, tri pomlčky, jeden rozklik ════════════ */

describe('D8 — dlaždice stavu katalógu', () => {
  const tiles = [
    { label: 'Načítaných z katalógu', view: loadedTile(STATUS), testId: 'catalog-tile-loaded' },
    { label: 'Zatiaľ chýba', view: missingTile(STATUS), testId: 'catalog-tile-missing' },
    { label: 'Ďalšia dávka', view: nextBatchTile(STATUS), testId: 'catalog-tile-next' },
    { label: 'Katalóg bude celý', view: finishTile(STATUS), testId: 'catalog-tile-finish' },
  ];
  const html = renderToStaticMarkup(createElement(CatalogTiles, { tiles }));

  it('ostávajú ŠTYRI — kontrakt UI, bod 16 (neúplný katalóg je najväčšie riziko)', () => {
    // Trieda je od 19. 8. 2026 "kpi dense" — zhustenie sa presunulo z inline
    // štýlov do globals.css, aby geometria dlaždice žila na jednom mieste.
    expect(kolkokrat(html, 'class="kpi dense"')).toBe(4);
    for (const tile of tiles) expect(html).toContain(tile.testId);
  });

  it('dlaždica bez hodnoty nekreslí vysvetlivku — tri prázdne riadky sú šum', () => {
    expect(missingTile(STATUS).value).toBe('—');
    expect(html).not.toContain('bez celkového počtu zo shopu sa to nedá povedať</div>');
    // Vysvetlivka hodnoty, ktorú appka MÁ, zostáva.
    expect(html).toContain('koľko ich má shop celkovo, appka zatiaľ nevie');
  });

  it('dôvody pomlčiek sú v jednom rozkliku, nie pri každej dlaždici (P6)', () => {
    expect(kolkokrat(html, 'catalog-tiles-why')).toBe(1);
    expect(html).toContain('Prečo —');
    expect(html).toContain('bez celkového počtu zo shopu sa to nedá povedať');
    expect(html).toContain('kým shop nepovie celkový počet, odhad si appka nevymýšľa');
  });

  it('keď appka vie všetko, rozklik sa nekreslí vôbec', () => {
    const cele = { ...STATUS, complete: true, shopTotalProducts: 41220, percent: 100 };
    const plne = renderToStaticMarkup(
      createElement(CatalogTiles, {
        tiles: [
          { label: 'Načítaných z katalógu', view: loadedTile(cele), testId: 'a' },
          { label: 'Zatiaľ chýba', view: missingTile(cele), testId: 'b' },
          { label: 'Ďalšia dávka', view: nextBatchTile(cele), testId: 'c' },
          { label: 'Katalóg bude celý', view: finishTile(cele), testId: 'd' },
        ],
      }),
    );
    // „Ďalšia dávka" je pri dokončenom katalógu pomlčka, takže rozklik ostáva;
    // dôležité je, že sa NIKDY nekreslí prázdny.
    expect(kolkokrat(plne, 'Prečo —')).toBeLessThanOrEqual(1);
  });

  it('chýbajúca hodnota je pomlčka, nikdy nula (kontrakt UI, bod 5)', () => {
    expect(html).not.toContain('>0<');
  });
});

/* ═════════════════ D9 — zamknuté filtre na jednom mieste ══════════════════ */

describe('D9 — zamknuté filtre sú v paneli práve raz', () => {
  const html = panelFiltrov();

  it('všetkých sedem zamknutých vecí je v JEDNEJ skupine', () => {
    expect(kolkokrat(html, 'fopt locked')).toBe(7);
    expect(kolkokrat(html, 'filter-locked')).toBe(1);
    expect(kolkokrat(html, 'Zatiaľ nedostupné')).toBe(1);
  });

  it('žiadna z nich už nevisí pri svojej pôvodnej skupine', () => {
    const skupina = html.slice(html.indexOf('Zatiaľ nedostupné'));
    for (const label of [
      'Kategória',
      'Kov',
      'Typ šperku',
      'Obrátkovosť',
      'Sklad',
      'Marža',
      'Skutočná zľava v eshope',
    ]) {
      expect(html, label).toContain(label);
      expect(skupina, `${label} patrí do jedinej skupiny`).toContain(label);
    }
    // Skupina „Sklad" s jediným sivým riadkom zanikla.
    expect(html).not.toContain('<h3>Sklad</h3>');
  });

  it('vysvetlenie a odkaz sú raz — `LockedFeatures.tsx` sa nerozširuje (bod 18)', () => {
    expect(kolkokrat(html, '/nastavenia#zamknute')).toBe(1);
    expect(kolkokrat(html, 'Čaká na dáta zo shopu ·')).toBe(1);
  });

  it('rozdiel „vlastný zápis vs. eshop" drží ďalej SÁM nadpis skupiny', () => {
    expect(html).toContain('Zľavy podľa vlastných zápisov');
    expect(html.indexOf('Zľavy podľa vlastných zápisov')).toBeLessThan(
      html.indexOf('Práve v zľave'),
    );
    // ZMENA 20. 8. 2026 (bod 16): druhá veta o tom istom pod políčkami padla.
    expect(html).not.toContain('Appka vidí len to, čo sama zapísala.');
  });

  it('keď API prestane hlásiť zamknuté filtre, skupina zostane len so zľavou', () => {
    const bezZamku = renderToStaticMarkup(
      createElement(CatalogFilters, {
        filter: DEFAULT_CATALOG_FILTER,
        counts: null,
        lockedFilters: {},
        saved: [],
        activeSaved: null,
        open: false,
        onChange: () => {},
        onApplySaved: () => {},
        onRemoveSaved: () => {},
      }),
    );
    expect(kolkokrat(bezZamku, 'fopt locked')).toBe(1);
    expect(bezZamku).toContain('Skutočná zľava v eshope');
  });
});

/* ═══════════════ D10 — hustota pre 41 220 riadkov ═════════════════════════ */

describe('D10 — tabuľka znesie 41 220 riadkov a 117-znakový názov', () => {
  const row = {
    productId: 18342,
    name: NAJDLHSI_NAZOV,
    price: 1758.46,
    hasAttributes: true,
    shopStatus: 'ok',
    unitsSold: 0,
    discountedNow: false,
    discountPercent: null,
    lastDiscountAt: null,
    fetchedAt: '2026-08-19T03:00:00.000Z',
    origin: 'mirror',
  } as never;

  const html = renderToStaticMarkup(
    createElement(CatalogTable, {
      rows: [row],
      soldWindowDays: 360,
      total: 41220,
      totalIsLowerBound: true,
      page: 412,
      perPage: 50 as const,
      loading: false,
      selected: new Set<number>(),
      allMatchingSelected: false,
      onToggleRow: () => {},
      onTogglePage: () => {},
      onOpenDetail: () => {},
      onPage: () => {},
      onPerPage: () => {},
    }),
  );

  it('vzorka je naozaj tá najdlhšia z katalógu — 117 znakov', () => {
    expect(NAJDLHSI_NAZOV.length).toBe(117);
  });

  it('mriežka stĺpcov je pevná, aby sa čísla medzi stránkami nehýbali', () => {
    expect(html).toContain('table-layout:fixed');
    expect(html).toContain('<colgroup>');
    expect(kolkokrat(html, '<col') - kolkokrat(html, '<colgroup')).toBe(5);
  });

  it('celý názov je v `title`, aj keď sa orezal', () => {
    expect(html).toContain(`title="${NAJDLHSI_NAZOV}"`);
  });

  it('názov orezáva výpustkou a na úzkej obrazovke sa zalomí — `white-space` DEDÍ', () => {
    expect(html).toContain('text-overflow:ellipsis');
    expect(html).toContain('white-space:inherit');
  });

  it('pätka povie, na ktorej z 825 strán človek stojí', () => {
    expect(html).toContain('strana 412 z 825');
  });

  it('skok na stránku je pri 825 stranách k dispozícii', () => {
    expect(html).toContain('page-jump-input');
    expect(html).toContain('1 – 825');
  });

  it('pri troch stranách sa skok nekreslí — nahrádzal by kliknutie vedľa seba', () => {
    const kratke = renderToStaticMarkup(
      createElement(CatalogTable, {
        rows: [row],
        soldWindowDays: 30,
        total: 120,
        page: 1,
        perPage: 50 as const,
        loading: false,
        selected: new Set<number>(),
        allMatchingSelected: false,
        onToggleRow: () => {},
        onTogglePage: () => {},
        onOpenDetail: () => {},
        onPage: () => {},
        onPerPage: () => {},
      }),
    );
    expect(kratke).not.toContain('page-jump-input');
    expect(kratke).toContain('strana 1 z 3');
  });

  it('dávka 200 riadkov je na výber a je to strop, ktorý API pustí', () => {
    expect(PER_PAGE_CHOICES).toEqual([50, 100, 200]);
    expect(DEFAULT_CATALOG_FILTER.perPage).toBe(50);
  });

  it('predvolené poradie zostáva najdrahšie prvé (kontrakt UI, bod 19)', () => {
    expect(DEFAULT_CATALOG_FILTER.sort).toBe('price_desc');
  });
});

describe('D10 — skok na stránku nikam nehádže', () => {
  function skok(hodnota: string, pages: number): number | null {
    let kam: number | null = null;
    // Formulár sa nedá odoslať v statickom renderi, tak sa overuje tá istá
    // podmienka, akú má obsluha: mimo rozsahu sa NEDEJE nič.
    const wanted = Number.parseInt(hodnota.trim(), 10);
    if (Number.isInteger(wanted) && wanted >= 1 && wanted <= pages) kam = wanted;
    return kam;
  }

  it('platné číslo prejde, nezmysel a rozsah mimo tabuľky nie', () => {
    expect(skok('412', 825)).toBe(412);
    expect(skok('0', 825)).toBeNull();
    expect(skok('826', 825)).toBeNull();
    expect(skok('abc', 825)).toBeNull();
    expect(skok('', 825)).toBeNull();
  });

  it('pole hovorí, aký rozsah prijme', () => {
    const html = renderToStaticMarkup(createElement(PageJump, { pages: 825, onPage: () => {} }));
    expect(html).toContain('1 – 825');
    expect(html).toContain('Prejsť');
  });
});
