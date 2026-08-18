/**
 * Aura Zľavy — DETAIL PRODUKTU A FILTRE
 * (KONTRAKT-PRODUKTY-2026-08-13, časti A2 a A3).
 *
 * Zadanie znie: „potrebujem priehľadnosť lepšiu tých produktov… ktoré sú
 * zapnuté v zľave… všetky údaje vypísané + filtre." Príloha k tomu je tvrdá:
 * appka NEVIE, ktoré produkty sú naozaj v zľave — vie len to, čo sama zapísala.
 *
 * Dôkaz, nie report agenta. Testuje sa presne to, čo sa dá pokaziť ticho a čo
 * by používateľ zistil až podľa zle nastavenej zľavy na produkčnom eshope:
 *
 *  A. **Panel vypíše všetko, čo appka vie, aj s tým, odkiaľ to je.** Názov,
 *     cena, varianty, stav v eshope, pôvod riadku a ČAS načítania práve tohto
 *     riadku. Bez času sa nedá povedať, či cena ešte platí.
 *  B. **„Zľava teraz" je vlastný záznam, nikdy stav eshopu.** Výhradu nesie
 *     nadpis skupiny a značka v hlavičke panela — nie poznámka pod čiarou.
 *  C. **Zamknuté údaje sú VIDIEŤ so zámkom.** Prázdna hodnota a zámok, nie
 *     vynechaný riadok: z vynechaného riadku sa nedá zistiť, že tá informácia
 *     vôbec existuje. Vysvetlenie tu NIE JE — vedie odtiaľto odkaz na jediné
 *     miesto, kde býva.
 *  D. **Nula sa nevymýšľa.** Čo appka o predaji nevie, je pomlčka; nula je
 *     tvrdenie.
 *  E. **Filtre vedia povedať aj to, čo eshop už nevracia**, a pôvod riadku sa
 *     nefiltruje cez `filter` — inak by voľba „len dohľadané" spustila nový
 *     dotaz, dohľadané riadky by zmizli a tabuľka by ostala prázdna.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Efekty klienta sa pri statickom renderi nespúšťajú, takže test meria
 * značky a texty, nie načítanie dát.
 *
 * Vlastník: P2/P3 kontraktu produktov.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CatalogFilters from '@/components/products/CatalogFilters';
import ProductDetailPanel, {
  lastWrittenDiscount,
  runningWrite,
} from '@/components/products/ProductDetailPanel';
import type { CatalogRowView, ProductWriteView } from '@/components/products/catalog-api';
import type { CatalogFilterState, OriginFilter } from '@/components/products/catalog-filter';
import {
  catalogSearchQuery,
  DEFAULT_CATALOG_FILTER,
  filterRowsByOrigin,
  parseCatalogFilterQuery,
} from '@/components/products/catalog-filter';
import { filterIsNarrowed } from '@/components/products/catalog-status';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const ROW: CatalogRowView = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok' as const,
  unitsSold: 0,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  origin: 'mirror' as const,
};

const LOCKED = {
  stock: { locked: true as const, requested: false },
  turnover: { locked: true as const, requested: false },
  category: { locked: true as const, requested: false },
  metal: { locked: true as const, requested: false },
  jewelryType: { locked: true as const, requested: false },
  margin: { locked: true as const, requested: false },
};

const write = (over: Partial<ProductWriteView>): ProductWriteView => ({
  itemId: 1,
  campaignId: 7,
  campaignName: 'Letné zľavy',
  status: 'ok',
  percent: 15,
  dateFrom: '2026-05-12',
  dateTo: '2026-05-26',
  at: '2026-05-12T09:14:00.000Z',
  ...over,
});

function renderPanel(row: CatalogRowView, soldWindowDays = 30): string {
  return renderToStaticMarkup(
    createElement(ProductDetailPanel, { row, soldWindowDays, onClose: () => {} }),
  );
}

function renderFilters(
  filter: CatalogFilterState,
  extra: {
    origin?: OriginFilter;
    onOriginChange?: (origin: OriginFilter) => void;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(CatalogFilters, {
      filter,
      counts: null,
      lockedFilters: LOCKED,
      saved: [],
      activeSaved: null,
      open: false,
      onChange: () => {},
      onApplySaved: () => {},
      onRemoveSaved: () => {},
      ...extra,
    }),
  );
}

/* ═══════════════ A. Panel vypíše všetko a povie, odkiaľ to je ═════════════ */

describe('detail produktu — všetky údaje aj s pôvodom', () => {
  it('vypíše názov, cenu, varianty, stav v eshope a pôvod riadku', () => {
    const html = renderPanel(ROW);
    for (const label of ['Názov', 'Cena', 'Varianty', 'Stav v eshope', 'Odkiaľ je tento riadok']) {
      expect(html, `chýba údaj ${label}`).toContain(label);
    }
    expect(html).toContain('Strieborné náušnice Lumen');
    expect(html).toContain('34,90 €');
    expect(html).toContain('bez variantov');
    expect(html).toContain('eshop ho pozná');
    expect(html).toContain('z načítaného katalógu');
  });

  it('pri údajoch je ČAS načítania práve tohto riadku, konkrétny a nie relatívny', () => {
    const html = renderPanel(ROW);
    expect(html).toContain('10.08.2026');
    // Kontrakt UI, bod 10: nikdy „pred 3 minútami".
    expect(html).not.toMatch(/pred \d+ (min|h)/);
  });

  it('dohľadaný riadok sa od načítaného odlíši slovom, nie odtieňom', () => {
    const html = renderPanel({ ...ROW, origin: 'shop' as const });
    expect(html).toContain('dohľadané v eshope');
    expect(html).not.toContain('z načítaného katalógu');
  });

  it('okno predajnosti sa dá prepnúť priamo v paneli', () => {
    const html = renderPanel(ROW);
    expect(html).toContain('predaných za posledných');
    // Päť okien z kontraktu (30/60/90/180/360), nie jedno napevno.
    for (const days of [30, 60, 90, 180, 360]) {
      expect(html, `chýba okno ${days}`).toContain(`detail-window-${days}`);
    }
    expect(html).toContain('Vlastný výpočet z objednávok.');
  });
});

/* ═══════════════ B. Zľava je vlastný zápis, nikdy stav eshopu ═════════════ */

describe('detail produktu — „zľava teraz" sa nevydáva za stav eshopu', () => {
  it('nadpis skupiny hovorí, čie zápisy to sú', () => {
    const html = renderPanel(ROW);
    expect(html).toContain('Zľavy podľa vlastných zápisov');
    expect(html).toContain('Zľava teraz');
    expect(html).toContain('Appka vidí len to, čo sama zapísala');
    // Výhrada stojí PRED číslom, nie pod ním.
    expect(html.indexOf('Zľavy podľa vlastných zápisov')).toBeLessThan(
      html.indexOf('Zľava teraz'),
    );
  });

  it('produkt v zľave to má povedané aj v hlavičke, a to s výhradou', () => {
    const html = renderPanel({ ...ROW, discountedNow: true });
    expect(html).toContain('v zľave podľa vlastného zápisu');
  });

  it('produkt bez nášho zápisu je „bez zľavy", nie „nie je v zľave v eshope"', () => {
    const html = renderPanel(ROW);
    expect(html).toContain('bez zľavy');
  });

  it('zápis, ktorý práve platí, sa vyberá podľa dňa zo servera', () => {
    const running = write({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
    const older = write({ itemId: 2, dateFrom: '2026-05-12', dateTo: '2026-05-26' });
    expect(runningWrite([older, running], '2026-08-18')?.itemId).toBe(1);
    // Bez dňa zo servera sa nehádá — hodiny prehliadača tu nerozhodujú.
    expect(runningWrite([older, running], null)).toBeNull();
    expect(runningWrite([older], '2026-08-18')).toBeNull();
  });

  it('„naposledy zlacnené" počíta len úspešné zápisy', () => {
    const done = write({ itemId: 1, at: '2026-05-12T09:14:00.000Z' });
    const newerButFailed = write({ itemId: 2, status: 'failed', at: '2026-07-01T09:00:00.000Z' });
    expect(lastWrittenDiscount([done, newerButFailed])?.itemId).toBe(1);
    expect(lastWrittenDiscount([newerButFailed])).toBeNull();
    expect(lastWrittenDiscount([])).toBeNull();
  });
});

/* ═══════════ C. Zamknuté je vidieť so zámkom, vysvetlené inde ═════════════ */

describe('detail produktu — zamknuté údaje', () => {
  const html = renderPanel(ROW);

  it('všetkých šesť zamknutých údajov má riadok, nie vynechanie', () => {
    for (const label of [
      'Kód produktu',
      'Sklad',
      'Nákupná cena',
      'Marža',
      'Kategórie',
      'Skutočná zľava v eshope',
    ]) {
      expect(html, `zamknutý údaj ${label} sa nekreslí`).toContain(label);
    }
    // Šesť prázdnych hodnôt so zámkom — hodnota sa nedopĺňa ani nevymýšľa.
    expect(html.match(/class="lockcell"/g)?.length ?? 0).toBe(6);
  });

  it('vysvetlenie tu nie je, je naň odkaz na jediné miesto', () => {
    expect(html).toContain('Čaká na dáta zo shopu');
    expect(html).toContain('/nastavenia#zamknute');
    // Vysvetľujúci odstavec o chýbajúcom oprávnení sem nepatrí (P2, bod 18).
    expect(html).not.toMatch(/oprávneni/i);
    expect(html).not.toContain('product:read');
  });
});

/* ═══════════════════ D. Čo appka nevie, je pomlčka ════════════════════════ */

describe('detail produktu — nevieme sa píše pomlčkou', () => {
  it('bez načítaných zápisov sa percento nevymýšľa', () => {
    const html = renderPanel({ ...ROW, discountedNow: true });
    // Efekty pri statickom renderi nebežia, takže zápisy ešte nie sú.
    expect(html).toContain('—');
    expect(html).not.toContain('0 %');
  });

  it('produkt bez názvu dostane pomlčku, nie prázdno', () => {
    const html = renderPanel({ ...ROW, name: null, price: null });
    expect(html).toContain('—');
  });
});

/* ══════════════════════ E. Filtre nad tým, čo máme ════════════════════════ */

describe('filtre — stav v eshope', () => {
  it('ponúka tri vylučujúce sa možnosti a predvolená je „ktoré eshop pozná"', () => {
    const html = renderFilters(DEFAULT_CATALOG_FILTER);
    expect(html).toContain('Stav v eshope');
    expect(html).toContain('Ktoré eshop pozná');
    expect(html).toContain('Aj tie, ktoré už nevracia');
    expect(html).toContain('Len tie, ktoré už nevracia');
    expect(DEFAULT_CATALOG_FILTER.shopPresence).toBe('known');
  });

  it('predvolená možnosť sa do adresy nepíše, ostatné áno', () => {
    expect(catalogSearchQuery(DEFAULT_CATALOG_FILTER)).not.toContain('shopStatus');
    expect(
      catalogSearchQuery({ ...DEFAULT_CATALOG_FILTER, shopPresence: 'onlyMissing' }),
    ).toContain('shopStatus=not_found');
    const both = catalogSearchQuery({ ...DEFAULT_CATALOG_FILTER, shopPresence: 'withMissing' });
    expect(decodeURIComponent(both)).toContain('shopStatus=ok,not_found,unknown');
  });

  it('je to podmienka ako každá iná — prázdna tabuľka nesmie viniť katalóg', () => {
    // Inak by pri „len tie, ktoré už nevracia" bez výsledku obrazovka hlásila,
    // že sa katalóg načítava, hoci je načítaný celý a vinný je filter.
    expect(filterIsNarrowed(DEFAULT_CATALOG_FILTER)).toBe(false);
    expect(filterIsNarrowed({ ...DEFAULT_CATALOG_FILTER, shopPresence: 'onlyMissing' })).toBe(true);
    expect(filterIsNarrowed({ ...DEFAULT_CATALOG_FILTER, shopPresence: 'withMissing' })).toBe(true);
  });

  it('adresa → filter → adresa nestratí voľbu a znesie iné poradie stavov', () => {
    expect(parseCatalogFilterQuery('shopStatus=not_found').shopPresence).toBe('onlyMissing');
    expect(parseCatalogFilterQuery('shopStatus=unknown,not_found,ok').shopPresence).toBe(
      'withMissing',
    );
    // Starý uložený filter bez tohto parametra ostáva platný.
    expect(parseCatalogFilterQuery('soldWindowDays=180').shopPresence).toBe('known');
    // Nezmysel spadne na predvolenú hodnotu, nikdy na výnimku.
    expect(parseCatalogFilterQuery('shopStatus=zzz').shopPresence).toBe('known');
  });
});

describe('filtre — pôvod riadku', () => {
  it('sa nekreslí, kým ho obrazovka nevie použiť', () => {
    const html = renderFilters(DEFAULT_CATALOG_FILTER);
    expect(html).not.toContain('Odkiaľ je riadok');
  });

  it('sa kreslí, keď obrazovka pošle voľbu aj obsluhu', () => {
    const html = renderFilters(DEFAULT_CATALOG_FILTER, {
      origin: 'all',
      onOriginChange: () => {},
    });
    expect(html).toContain('Odkiaľ je riadok');
    expect(html).toContain('Z načítaného katalógu');
    expect(html).toContain('Dohľadané v eshope');
  });

  it('nie je súčasťou filtra — do adresy sa nedostane', () => {
    // Keby bol, jeho zmena by spustila nový dotaz a dohľadané riadky by zmizli.
    expect(catalogSearchQuery(DEFAULT_CATALOG_FILTER)).not.toContain('origin');
    expect(Object.keys(DEFAULT_CATALOG_FILTER)).not.toContain('origin');
  });

  it('vyberá riadky nad tým, čo obrazovka drží', () => {
    const rows = [
      { productId: 1, origin: 'mirror' as const },
      { productId: 2, origin: 'shop' as const },
      { productId: 3, origin: 'mirror' as const },
    ];
    expect(filterRowsByOrigin(rows, 'all')).toHaveLength(3);
    expect(filterRowsByOrigin(rows, 'mirror').map((r) => r.productId)).toEqual([1, 3]);
    expect(filterRowsByOrigin(rows, 'shop').map((r) => r.productId)).toEqual([2]);
  });
});

describe('filtre — zľava je vlastný zápis', () => {
  const html = renderFilters(DEFAULT_CATALOG_FILTER);

  it('nadpis skupiny to hovorí skôr, než človek zaškrtne políčko', () => {
    expect(html).toContain('Zľavy podľa vlastných zápisov');
    expect(html.indexOf('Zľavy podľa vlastných zápisov')).toBeLessThan(
      html.indexOf('Práve v zľave'),
    );
    expect(html).toContain('Appka vidí len to, čo sama zapísala.');
  });

  it('skutočná zľava v eshope je vidieť ako zamknutá, nie zamlčaná', () => {
    expect(html).toContain('Skutočná zľava v eshope');
    expect(html).toContain('fopt locked');
    expect(html).toContain('Čaká na dáta zo shopu');
  });

  it('zamknuté filtre zostávajú vidieť aj po doplnení nových skupín', () => {
    for (const label of ['Kategória', 'Kov', 'Typ šperku', 'Marža', 'Obrátkovosť', 'Sklad']) {
      expect(html, `zamknutý filter ${label}`).toContain(label);
    }
    // Odhad sa v paneli filtrov nevyskytuje — všetky čísla sú merané (P7).
    expect(html).not.toContain('≈');
  });
});
