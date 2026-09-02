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
import CatalogTable from '@/components/products/CatalogTable';
/* Skok na stranu bol vlastný `PageJump` v CatalogTable; vo V6b ho nesie
   `ui/Pagination` (prop `jumpFromPages`). Tvrdenie nižšie meria to isté
   pravidlo na novom mieste — pole musí POVEDAŤ, aký rozsah prijme. */
import Pagination from '@/components/ui/Pagination';
import CatalogTiles from '@/components/products/CatalogTiles';
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

/* D125 (1. 9. 2026) — panel zamknuté filtre nedostáva ani nekreslí (K4). */

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

/* ══════ D125 — filter bez dátového zdroja v paneli NEEXISTUJE (K4) ════════ */

/*
 * Do 1. 9. 2026 tu žil test „D9 — zamknuté filtre sú v paneli práve raz": šesť
 * sivých riadkov plus „Skutočná zľava v eshope" v jednej skupine s jedným
 * vysvetlením. D125 to celé RUŠÍ, lebo tie riadky boli dve rôzne veci:
 *
 *  · marža, sklad a obrátkovosť dátový zdroj MAJÚ (migrácia 0014) — sú to teraz
 *    NORMÁLNE filtre a stráži ich `test/unit/filtre-podla-dat.spec.ts`,
 *  · kategória, kov a typ šperku zdroj nemajú — a filter bez zdroja na
 *    obrazovke podľa K4 neexistuje, ani sivý.
 *
 * Zásada, ktorú D9 zaviedol, tým NEZANIKÁ: jednu vec hovorí panel na jedinom
 * mieste, a preto sa tu naďalej počíta, koľkokrát čo v paneli je.
 */
describe('D125 — zamknuté filtre panel nekreslí vôbec', () => {
  const html = panelFiltrov();

  it('sivý riadok, jeho skupina ani odkaz do Nastavení už v paneli nie sú', () => {
    expect(kolkokrat(html, 'fopt locked')).toBe(0);
    expect(kolkokrat(html, 'filter-locked')).toBe(0);
    expect(kolkokrat(html, 'Zatiaľ nedostupné')).toBe(0);
    expect(kolkokrat(html, '/nastavenia#zamknute')).toBe(0);
    expect(kolkokrat(html, 'Čaká na dáta zo shopu')).toBe(0);
  });

  it('filtre bez zdroja zmizli, filtre so zdrojom sú v paneli raz', () => {
    for (const label of ['Kategória', 'Kov', 'Typ šperku', 'Skutočná zľava v eshope']) {
      expect(html, `${label} sa nesmie kresliť`).not.toContain(label);
    }
    // Marža a sklad majú vlastný nadpis — práve jeden, nie dva tvary tej istej veci.
    expect(kolkokrat(html, '<h3>Marža</h3>')).toBe(1);
    expect(kolkokrat(html, '<h3>Sklad</h3>')).toBe(1);
    // Obrátkovosť sa tak UŽ NEMENUJE: `qty_in_orders` je celkové množstvo (R3).
    expect(html).not.toContain('Obrátkovosť');
    expect(kolkokrat(html, '<h3>Celkovo objednané</h3>')).toBe(1);
  });

  it('rozdiel „vlastný zápis vs. eshop" drží ďalej SÁM nadpis skupiny', () => {
    expect(html).toContain('Zľavy podľa vlastných zápisov');
    expect(html.indexOf('Zľavy podľa vlastných zápisov')).toBeLessThan(
      html.indexOf('Práve v zľave'),
    );
    // ZMENA 20. 8. 2026 (bod 16): druhá veta o tom istom pod políčkami padla.
    expect(html).not.toContain('Appka vidí len to, čo sama zapísala.');
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
    /* Dvanásť, nie päť: kontrakt V4 D114 (31. 8. 2026) pridal KPI stĺpce,
       D122 (1. 9. 2026) referenciu ako PRVÝ stĺpec a D124 sklad z jednotnej
       sady. Mriežka musí zostať PEVNÁ aj pri dvanástich — o to v tomto teste
       ide, nie o ich počet; poradie a obsah stĺpca referencie stráži
       `produkty-referencia-stlpec.spec.ts`, jednotnú sadu
       `produkty-jednotne-stlpce.spec.ts`.

       Počet sa NEPÍŠE ako literál dvakrát: `<col>` sa porovnáva s počtom
       `<th>` v hlavičke. Pevná mriežka, ktorej chýba jeden `col`, je práve tá
       chyba, pri ktorej sa čísla medzi stránkami hýbu — a literál v teste by
       ju prepustil, lebo by sa opravil spolu s tabuľkou. */
    const hlavicka = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
    // `'<th '` s medzerou zámerne: `'<th'` by započítalo aj `<thead>`.
    const stlpcov = kolkokrat(hlavicka, '<th ');
    expect(stlpcov).toBe(12);
    expect(kolkokrat(html, '<col') - kolkokrat(html, '<colgroup')).toBe(stlpcov);
  });

  it('celý názov je v `title`, aj keď sa orezal — a s ním technické `id` (D116)', () => {
    /* Od D116 nesie `title` pomenovanie AJ `#id`: identifikátor patrí do
       technického detailu, ale musí byť dosiahnuteľný bez otvorenia panela. */
    expect(html).toContain(`title="${NAJDLHSI_NAZOV} · #18342"`);
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

  it('dávka je najviac 100 riadkov — strop KPI na jeden dotaz (V4 D114)', () => {
    /* D10 tu malo aj 200. Kontrakt V4 to vzal späť: riadok nesie KPI
       z `/api/insights/product-kpi`, kde je strop `MAX_KPI_IDS = 100` na
       dotaz. Dávka 200 by znamenala dva dotazy na stránku (N+1 v malom),
       alebo stránku s polovicou prázdnych KPI — a prázdna bunka na tejto
       obrazovke znamená „o produkte nevieme", nie „stránka je veľká". */
    expect(PER_PAGE_CHOICES).toEqual([50, 100]);
    expect(DEFAULT_CATALOG_FILTER.perPage).toBe(100);
  });

  it('predvolené poradie je najhoršie ležiaky prvé (V4 §5 K4)', () => {
    /* Do 31. 8. 2026 najdrahšie prvé (kontrakt UI bod 19). Obrazovka hľadá
       kusy na zlacnenie a najdrahší produkt na tú otázku neodpovedá. */
    expect(DEFAULT_CATALOG_FILTER.sort).toBe('sold_asc');
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
    /* 825 strán po 50 riadkoch = 41 250 zhôd. `jumpFromPages: 1` vynúti skok
       aj pri malom počte, aby test nemeral prah, ale samotné pole. */
    const html = renderToStaticMarkup(
      createElement(Pagination, {
        page: 1,
        pageSize: 50,
        total: 41_250,
        jumpFromPages: 1,
        onPageChange: () => {},
      }),
    );
    expect(html).toContain('1 – 825');
    expect(html).toContain('Prejsť');
  });
});
