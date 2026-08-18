/**
 * Aura Zľavy — tab Produkty vidí do katalógu (V10; kontrakt dokončenia A5, B1,
 * C1–C4).
 *
 * Dôkaz, nie report agenta. Testuje sa presne to, čo sa na tejto obrazovke dá
 * pokaziť ticho — a čo by používateľ zistil až po tom, ako spustí zľavu na
 * neúplnom katalógu:
 *
 *  A. **Neúplný katalóg je vidieť v číslach.** Karta stavu vypíše, koľko z
 *     koľkých je načítaných, koľko chýba, kedy pôjde ďalšia dávka a dokedy to
 *     potrvá — a odhad je označený ako odhad (P7).
 *  B. **Prázdna tabuľka nad neúplným katalógom hovorí inú vetu** než prázdna
 *     tabuľka nad úplným. Práve táto zámena vyrába záver „taký produkt
 *     neexistuje", hoci ho appka len ešte nenačítala.
 *  C. **Strop výberu je vidieť dopredu a s cestou von.** Pilotná desiatka sa
 *     ukáže ako zámok s dôvodom, a keď ju výber prekročí, veta povie koľko
 *     prejde z koľkých a že sa to uvoľní v Nastaveniach (heslom).
 *  D. **Farbu volí `resolution`, nie `severity`.** Vyčerpaný rozpočet je
 *     `blokuje`, a predsa nie je chyba (K2).
 *  E. **Prečo neprejde práve tento kus.** Riadok, ktorý shop nenašiel, to má
 *     napísané pri sebe; „už je v zľave" tabuľka neopakuje, lebo to hovorí
 *     stĺpec.
 *  F. **Zrkadlo tvaru `/api/catalog/sync` sa nesmie rozísť s route** — kópia
 *     existuje len preto, aby sa `mariadb` nedostal do prehliadača.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Efekty klienta sa pri statickom renderi nespúšťajú, takže render meria
 * značky a texty, nie načítanie dát.
 *
 * Vlastník: V10 (testovú sadu ako celok vlastní V14).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CatalogStatusView as RouteCatalogStatusView } from '@/app/api/catalog/sync/route';
import BlockerNotes from '@/components/products/BlockerNotes';
import CatalogPanel from '@/components/products/CatalogPanel';
import CatalogStatusPanel from '@/components/products/CatalogStatusPanel';
import CatalogTable from '@/components/products/CatalogTable';
import ProductDetailPanel from '@/components/products/ProductDetailPanel';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';
import type { CatalogStatusView } from '@/components/products/catalog-status';
import {
  CATALOG_PANEL_BLOCKERS,
  SELECTION_BLOCKERS,
  catalogEmptyView,
  catalogStateView,
  catalogWaitingNote,
  clockPhrase,
  dropBlockers,
  filterIsNarrowed,
  finishTile,
  missingTile,
  nextBatchTile,
  noteVariantForResolution,
  pickBlockers,
  productReasons,
  rowReason,
  toRunView,
} from '@/components/products/catalog-status';
import { collectOperationBlockers, PILOT_MAX_PRODUCTS } from '@/lib/status/blockers';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

/** Skutočný stav z 12. 8. 2026: 2 900 zo 41 082, katalóg sa dopĺňa. */
const STATUS: CatalogStatusView = {
  loadedProducts: 2900,
  shopTotalProducts: 41082,
  percent: 7,
  complete: false,
  refreshing: false,
  lastFetchedAt: '2026-08-12T01:00:00.000Z',
  lastReadAt: '2026-08-12T01:00:00.000Z',
  pagesDone: 29,
  pagesTotal: 411,
  pagesLeft: 382,
  perPage: 100,
  reads: {
    day: '2026-08-12',
    limit: 240,
    used: 216,
    remaining: 24,
    exhausted: false,
    resetAt: '2026-08-13T00:00:00.000Z',
    minuteLimit: 24,
    usedThisMinute: 0,
    known: true,
  },
  waiting: null,
  nextBatchAt: '2026-08-12T10:20:00.000Z',
  estimatedDaysLeft: 2,
  estimatedFinishAt: '2026-08-14T00:00:00.000Z',
  lastError: null,
};

const COMPLETE: CatalogStatusView = {
  ...STATUS,
  loadedProducts: 41082,
  percent: 100,
  complete: true,
  pagesDone: 411,
  pagesLeft: 0,
  waiting: 'catalog_complete',
  nextBatchAt: null,
  estimatedDaysLeft: 0,
  estimatedFinishAt: null,
};

/**
 * Stav po KAŽDOM dokončenom prechode: katalóg appka má celý, ale nový
 * (obnovovací) prechod stojí na stránke 0. Karta z toho predtým poskladala
 * „0 chýba" vedľa „382 stránok ostáva, ešte 2 dni".
 */
const REFRESHING: CatalogStatusView = {
  ...STATUS,
  loadedProducts: 41082,
  percent: 100,
  complete: false,
  refreshing: true,
  pagesDone: 0,
  pagesLeft: 0,
  waiting: null,
  estimatedDaysLeft: 0,
  estimatedFinishAt: null,
};

const ROW = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok' as const,
  unitsSold: 0,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  // I11 — predvolene zo zrkadla; testy, ktoré overujú dohľadanie v eshope,
  // si `origin: 'shop'` prepíšu samy.
  origin: 'mirror' as const,
};

const NOW = new Date('2026-08-12T09:00:00.000Z');

/* ══════════════ F. Zrkadlo tvaru sa nesmie rozísť s route ═════════════════ */

describe('V10 — stav katalógu má rovnaký tvar ako odpoveď servera', () => {
  it('kópia tvaru prijme odpoveď route a naopak', () => {
    // `import type` z route je pri behu zmazaný — `mariadb` sa do prehliadača
    // nedostane. Rozídenie polí ale zhodí `tsc`, a tým aj tento súbor.
    const fromRoute: RouteCatalogStatusView = { ...STATUS, reads: { ...STATUS.reads } };
    const back: CatalogStatusView = fromRoute;
    expect(back.loadedProducts).toBe(2900);
    expect(back.reads.limit).toBe(240);
  });
});

/* ═══════════════ A. Neúplný katalóg je vidieť v číslach ═══════════════════ */

describe('V10 — karta stavu katalógu', () => {
  it('povie, koľko chýba a v koľkých stránkach sa to dočíta', () => {
    expect(missingTile(STATUS)).toEqual({
      value: '38 182',
      detail: '382 stránok, na každej 100 produktov',
    });
  });

  it('odhad dokončenia je označený ako odhad, meraný čas nie (P7)', () => {
    const finish = finishTile(STATUS);
    expect(finish.value).toBe('≈ 14. 8.');
    expect(finish.detail).toContain('2 dni');
  });

  it('bez celkového počtu zo shopu sa zvyšok NEDOPOČÍTAVA', () => {
    const unknownTotal: CatalogStatusView = {
      ...STATUS,
      shopTotalProducts: null,
      percent: null,
      estimatedFinishAt: null,
      estimatedDaysLeft: null,
    };
    expect(missingTile(unknownTotal).value).toBe('—');
    expect(finishTile(unknownTotal).value).toBe('—');
    expect(catalogStateView(unknownTotal).detail).toBeNull();
  });

  it('dokončený katalóg nehlási ďalšiu dávku ani odhad', () => {
    expect(catalogStateView(COMPLETE).tone).toBe('good');
    expect(nextBatchTile(COMPLETE, NOW).value).toBe('—');
    expect(finishTile(COMPLETE).value).toBe('hotovo');
  });

  /**
   * OBNOVA NIE JE CHÝBAJÚCI KATALÓG.
   *
   * `pagesDone` patrí aktuálnemu prechodu, `loadedProducts` je `COUNT(*)` za
   * celý katalóg. Po dokončenom prechode začína obnova od stránky 0 a karta
   * vedľa seba tvrdila „0 chýba" a „382 stránok, na každej 100 produktov",
   * plus „ešte 2 dni" — pri katalógu, ktorý appka má celý na disku.
   */
  it('obnova celého katalógu nehlási chýbajúce stránky ani dva dni čakania', () => {
    const missing = missingTile(REFRESHING);
    expect(missing.value).toBe('0');
    expect(missing.detail).not.toContain('stránok');
    expect(missing.detail).toContain('obnovuje');

    const finish = finishTile(REFRESHING);
    expect(finish.value).toBe('hotovo');
    expect(finish.detail).not.toContain('dni');

    // Stav jednou vetou musí súhlasiť s Prehľadom: katalóg JE načítaný celý.
    const state = catalogStateView(REFRESHING);
    expect(state.tone).toBe('good');
    expect(state.label).toContain('celý');
  });

  it('čas ďalšej dávky je hotová fráza s predložkou', () => {
    expect(clockPhrase('2026-08-12T10:20:00.000Z', NOW)).toBe('o 12:20');
    expect(clockPhrase('2026-08-13T00:30:00.000Z', NOW)).toBe('zajtra o 02:30');
    expect(clockPhrase('2026-08-15T10:00:00.000Z', NOW)).toBe('15. 8. o 12:00');
    expect(clockPhrase(null, NOW)).toBeNull();
    expect(clockPhrase('nezmysel', NOW)).toBeNull();
  });

  it('vlastnú vetu má LEN pauza od shopu a chyba behu — zvyšok patrí prekážkam', () => {
    expect(catalogWaitingNote(STATUS, NOW)).toBeNull();
    expect(catalogWaitingNote({ ...STATUS, waiting: 'daily_budget' }, NOW)).toBeNull();
    expect(catalogWaitingNote({ ...STATUS, waiting: 'rate_limited' }, NOW)?.variant).toBe('info');
    expect(catalogWaitingNote({ ...STATUS, waiting: 'error' }, NOW)?.variant).toBe('warn');
  });

  it('karta vypíše obe čísla, rozpočet čítaní aj cestu k ďalšej dávke', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogStatusPanel, {
        status: STATUS,
        failed: false,
        blockers: [],
        lastRun: null,
        running: false,
        onLoadBatch: () => {},
      }),
    );
    expect(html).toContain('2 900');
    expect(html).toContain('41 082');
    expect(html).toContain('38 182');
    // Rozpočet čítaní je merací prúžok, nie veta.
    expect(html).toContain('216/240');
    expect(html).toContain('Načítať ďalšiu dávku');
    // „Dáta k …" patrí nad tabuľku a je v Produktoch práve raz (architektúra §0).
    expect(html).not.toContain('Dáta k');
    // Kód chyby žije pod rozklikom, nie na povrchu (P6).
    expect(html).toContain('Technický detail');
  });

  it('nečitateľný stav sa prizná, nezamlčí', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogStatusPanel, {
        status: null,
        failed: true,
        blockers: [],
        lastRun: null,
        running: false,
        onLoadBatch: () => {},
      }),
    );
    expect(html).toContain('sa nepodarilo načítať');
  });

  it('po kliknutí je vidieť, čo dávka urobila — aj keď neurobila nič', () => {
    const nothing = toRunView({ outcome: 'too_soon', sync: null, resumeAt: null });
    expect(nothing).toEqual({ outcome: 'too_soon', pages: 0, products: 0, resumeAt: null });
    expect(toRunView(null)).toBeNull();

    const html = renderToStaticMarkup(
      createElement(CatalogStatusPanel, {
        status: STATUS,
        failed: false,
        blockers: [],
        lastRun: { outcome: 'ran', pages: 3, products: 300, resumeAt: null },
        running: false,
        onLoadBatch: () => {},
      }),
    );
    expect(html).toContain('prečítala 3 stránky');
    expect(html).toContain('300 produktov');
  });
});

/* ═════════ B. Prázdna tabuľka nad neúplným katalógom radí inak ════════════ */

describe('V10 — prázdna tabuľka hovorí, ako ju naplniť', () => {
  it('prázdny katalóg pošle po dávku, nie po filter', () => {
    const empty = catalogEmptyView({
      narrowed: false,
      status: { ...STATUS, loadedProducts: 0, percent: 0 },
    });
    expect(empty.title).toContain('prázdny');
    expect(empty.offerLoad).toBe(true);
  });

  it('neúplný katalóg prizná, že hľadaný kus môže byť medzi nenačítanými', () => {
    const empty = catalogEmptyView({ narrowed: true, status: STATUS });
    expect(empty.description).toContain('38 182');
    expect(empty.description).toContain('môže byť medzi nimi');
    expect(empty.offerLoad).toBe(true);
  });

  it('nad úplným katalógom je vinný filter a nič sa nedonačítava', () => {
    const empty = catalogEmptyView({ narrowed: true, status: COMPLETE });
    expect(empty.title).toBe('Filtru nevyhovuje ani jeden produkt');
    expect(empty.offerLoad).toBe(false);
  });

  it('filter sa počíta ako zúžený podľa ktorejkoľvek podmienky', () => {
    expect(filterIsNarrowed(DEFAULT_CATALOG_FILTER)).toBe(false);
    expect(filterIsNarrowed({ ...DEFAULT_CATALOG_FILTER, query: 'lumen' })).toBe(true);
    expect(filterIsNarrowed({ ...DEFAULT_CATALOG_FILTER, soldBuckets: ['none'] })).toBe(true);
    expect(filterIsNarrowed({ ...DEFAULT_CATALOG_FILTER, priceTo: '40' })).toBe(true);
    expect(filterIsNarrowed({ ...DEFAULT_CATALOG_FILTER, neverDiscounted: true })).toBe(true);
  });

  it('tabuľka vykreslí hotový prázdny stav, nie vlastnú vetu', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, {
        rows: [],
        soldWindowDays: 30,
        total: 0,
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
        emptyState: createElement('b', null, 'Medzi načítanými produktmi nič takéto nie je'),
      }),
    );
    expect(html).toContain('Medzi načítanými produktmi nič takéto nie je');
  });
});

/* ══════════ C+D. Strop výberu je vidieť dopredu a farbí ho resolution ═════ */

describe('V10 — strop výberu a tón vysvetliviek', () => {
  /** Snapshot, v ktorom je jediná otvorená otázka veľkosť výberu. */
  const snapshotFor = (selectedCount: number) => ({
    now: NOW,
    writes: { enabled: true },
    apiKey: { present: true, expiresAt: new Date('2026-08-14T00:00:00.000Z') },
    writeBudget: { budget: 200, spent: 0, day: '2026-08-12' as const },
    scope: { mode: 'pilot' as const, maxProducts: 10, failClosed: false },
    selection: { selectedCount },
    catalog: { loadedProducts: 2900, shopTotalProducts: 41082, missingProductIds: [] },
  });

  it('pilotný strop je vidieť, aj keď ho výber ešte neprekročil', () => {
    const notes = pickBlockers(
      collectOperationBlockers(snapshotFor(3)),
      SELECTION_BLOCKERS,
    );
    const cap = notes.find((blocker) => blocker.id === 'scope_pilot_cap');
    expect(cap).toBeDefined();
    expect(cap?.severity).toBe('informuje');
    expect(cap?.resolution).toBe('sudo');
    expect(cap?.what).toContain(String(PILOT_MAX_PRODUCTS));
  });

  it('prekročený strop povie koľko prejde z koľkých a kam ísť', () => {
    const notes = pickBlockers(collectOperationBlockers(snapshotFor(150)), SELECTION_BLOCKERS);
    const cap = notes.find((blocker) => blocker.id === 'scope_pilot_cap');
    expect(cap?.severity).toBe('blokuje');
    expect(cap?.what).toContain('150');
    expect(cap?.nextStep).toContain('heslo');
    expect(cap?.path).toBe('/nastavenia');
  });

  it('zoznam prekážok karty katalógu a zoznam výberu sa neprekrývajú', () => {
    const overlap = CATALOG_PANEL_BLOCKERS.filter((id) => SELECTION_BLOCKERS.includes(id));
    expect(overlap).toEqual([]);
  });

  it('veta o neúplnom katalógu sa neopakuje v paneli o jednom kuse', () => {
    const all = collectOperationBlockers({
      ...snapshotFor(1),
      scope: { mode: 'plny' as const, maxProducts: 1000, failClosed: false },
    });
    expect(all.some((blocker) => blocker.id === 'catalog_incomplete')).toBe(true);
    const forProduct = dropBlockers(all, CATALOG_PANEL_BLOCKERS);
    expect(forProduct.some((blocker) => blocker.id === 'catalog_incomplete')).toBe(false);
  });

  it('tón vysvetlivky určuje riešiteľ, nie závažnosť (K2)', () => {
    expect(noteVariantForResolution('cakanie')).toBe('info');
    expect(noteVariantForResolution('sam')).toBe('warn');
    expect(noteVariantForResolution('sudo')).toBe('warn');
    expect(noteVariantForResolution('mimo_appky')).toBe('err');
  });

  it('prekážka, ktorú otvorí heslo, sa kreslí ako zámok s dôvodom', () => {
    const notes = pickBlockers(collectOperationBlockers(snapshotFor(3)), SELECTION_BLOCKERS);
    const html = renderToStaticMarkup(
      createElement(BlockerNotes, { blockers: notes, here: '/produkty' }),
    );
    expect(html).toContain('locked-note');
    expect(html).toContain('Zamknuté');
    expect(html).toContain('Otvoriť Nastavenia');
  });

  it('prekročený strop už nie je tichý zámok, ale vysvetlivka', () => {
    const notes = pickBlockers(collectOperationBlockers(snapshotFor(150)), SELECTION_BLOCKERS);
    const html = renderToStaticMarkup(
      createElement(BlockerNotes, { blockers: notes, here: '/produkty' }),
    );
    expect(html).toContain('ovl-note--attention');
    expect(html).toContain('150');
  });

  it('odkaz na obrazovku, na ktorej stojím, sa nekreslí', () => {
    const notes = pickBlockers(
      collectOperationBlockers({
        ...snapshotFor(3),
        scope: { mode: 'plny' as const, maxProducts: 1000, failClosed: false },
        catalog: { loadedProducts: 2900, shopTotalProducts: 41082, missingProductIds: [777] },
      }),
      SELECTION_BLOCKERS,
    );
    const html = renderToStaticMarkup(
      createElement(BlockerNotes, { blockers: notes, here: '/produkty' }),
    );
    expect(html).toContain('777');
    expect(html).not.toContain('Otvoriť Produkty');
  });
});

/* ═══════════════ E. Prečo neprejde práve tento kus ════════════════════════ */

describe('V10 — dôvod pri konkrétnom produkte', () => {
  it('nenájdený kus to má napísané pri sebe', () => {
    const reasons = productReasons({ ...ROW, shopStatus: 'not_found' });
    expect(reasons.map((reason) => reason.id)).toEqual(['shop_not_found']);
    expect(reasons[0]?.tone).toBe('attention');
    expect(rowReason({ ...ROW, shopStatus: 'not_found' })?.short).toBe('shop ho nenašiel');
  });

  it('„už je v zľave" tabuľka neopakuje — hovorí to stĺpec', () => {
    const discounted = { ...ROW, discountedNow: true };
    expect(productReasons(discounted).map((reason) => reason.id)).toEqual(['already_discounted']);
    expect(rowReason(discounted)).toBeNull();
  });

  it('bezchybnému kusu sa nič nevyčíta', () => {
    expect(productReasons(ROW)).toEqual([]);
    expect(rowReason(ROW)).toBeNull();
  });

  it('tabuľka kreslí dôvod pri mene, nie ako nový stĺpec', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, {
        rows: [{ ...ROW, shopStatus: 'not_found' as const }],
        soldWindowDays: 30,
        total: 1,
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
        rowReason,
      }),
    );
    expect(html).toContain('shop ho nenašiel');
    // Stĺpce zostávajú štyri plus zaškrtávacie políčko (P3).
    expect(html.match(/<th[\s>]/g)?.length ?? 0).toBe(5);
    expect(html).not.toContain('>18342<');
  });

  it('bočný panel spojí prekážky operácie s dôvodmi kusu', () => {
    const blockers = collectOperationBlockers({
      now: NOW,
      writes: { enabled: false },
      apiKey: { present: true, expiresAt: new Date('2026-08-14T00:00:00.000Z') },
      writeBudget: { budget: 200, spent: 0, day: '2026-08-12' },
      scope: { mode: 'pilot', maxProducts: 10, failClosed: false },
      selection: { selectedCount: 1, productIds: [ROW.productId] },
    });
    const html = renderToStaticMarkup(
      createElement(ProductDetailPanel, {
        row: { ...ROW, shopStatus: 'not_found' as const },
        soldWindowDays: 30,
        blockers,
        onClose: () => {},
      }),
    );
    expect(html).toContain('Prekážky');
    // Dôvod kusu…
    expect(html).toContain('shop nenašiel');
    // …aj prekážka operácie, ktorá zastavuje všetko.
    expect(html).toContain('Zápisy do shopu sú vypnuté');
    // Informatívny strop rozsahu do panela o jednom kuse nepatrí.
    expect(html).not.toContain('V pilotnom režime prejde');
  });

  it('bez prekážok to panel povie rovno', () => {
    const html = renderToStaticMarkup(
      createElement(ProductDetailPanel, {
        row: ROW,
        soldWindowDays: 30,
        blockers: [],
        onClose: () => {},
      }),
    );
    expect(html).toContain('nevidí nič, čo by zápisu zľavy bránilo');
  });
});

/* ═══════════════ Celá obrazovka drží pravidlá architektúry ════════════════ */

describe('V10 — obrazovka Produkty po doplnení stavu katalógu', () => {
  const html = renderToStaticMarkup(
    createElement(CatalogPanel, { initialFilter: DEFAULT_CATALOG_FILTER }),
  );

  it('karta stavu katalógu je na obrazovke a je prvá', () => {
    expect(html).toContain('Stav katalógu');
    expect(html.indexOf('Stav katalógu')).toBeLessThan(html.indexOf('layout-filters'));
  });

  it('čerstvosť dát zostáva práve raz (architektúra §0)', () => {
    expect(html.match(/class="fresh"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('Katalóg sa zatiaľ nenačítal.');
  });

  it('druhé číslo pri počte hovorí „načítaných", nie „produktov"', () => {
    expect(html).toContain('načítaných');
  });

  it('tržby eshopu sem stále nepatria (architektúra §1)', () => {
    expect(html).not.toMatch(/tržb/i);
    expect(html).not.toMatch(/objednáv/i);
  });
});
