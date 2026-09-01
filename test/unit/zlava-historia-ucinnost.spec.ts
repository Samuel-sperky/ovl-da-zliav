/**
 * Aura Zľavy — HISTÓRIA ZĽIAV PRODUKTU A ÚČINNOSŤ ZĽAVY
 * (D127 body 3 a 4; K7 a K8 kontraktu V5, 1. 9. 2026).
 *
 * Dve obrazovkové odpovede na dve otázky, ktoré sa dnes zodpovedať NEDAJÚ
 * rovnako dobre:
 *
 *   „Kedy sme toto už zlacnili?"  — odpoveď existuje, ide z vlastných zápisov.
 *   „A pomohlo to?"               — PODMIENENÁ odpoveď (P1 kontraktu V5):
 *                                   `orders_read` je neoverený kľúč, história
 *                                   objednávok nie je stiahnutá, takže stav
 *                                   „nedá sa spočítať" je BEŽNÝ priebeh.
 *
 * ČO SA TU MERÁ A PREČO PRÁVE TO
 * ──────────────────────────────
 *
 *  1. **Priznanie NIE JE číslo.** Keď server povie `coverage_gap` alebo
 *     `too_young`, na obrazovke nesmie byť ani jeden údaj o predaji. Je to
 *     zapísaná pasca tohto repa: commit `d00e081` vydával DVE OKNÁ, KTORÉ
 *     ZĽAVE OBE PREDCHÁDZALI, za jej výkon — dva stĺpce vyzerajú správne vždy,
 *     preto sa nedá spoliehať na to, že si niekto všimne, že sú nesprávne.
 *  2. **Okná sa MENUJÚ.** „Pred zľavou 23. 7. – 5. 8." a „Počas zľavy
 *     6. 8. – 19. 8." sú jediná vec, ktorá človeku dovolí overiť, ČO sa
 *     s ČÍM porovnáva. Bez mien by sa `d00e081` dal zopakovať potichu.
 *  3. **Účinnosť sa v komponente NIKDY nedopočítava.** Meria sa nad zdrojom:
 *     `deltaPercent` sa v ňom nesmie objaviť. Server ho posiela; sekcia ho
 *     vedome nekreslí (P8 — dve merania sú fakt, jedno odvodené percento je
 *     už záver o príčine).
 *  4. **Prázdna história je ODPOVEĎ, nie chyba.** „Tento produkt sme ešte do
 *     žiadnej zľavy nezaradili" a „Históriu zliav sa nepodarilo načítať" sú
 *     dve rôzne vety s dvoma rôznymi kotvami. Keby sa zliali, výpadok siete by
 *     tvrdil, že produkt nikdy v zľave nebol.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna sieť. Preto
 * sú `DiscountHistoryList` aj `PerformanceCard` čisté komponenty: efekty
 * v statickom renderi nebežia, takže cez načítavacie obálky by sa dala odmerať
 * jediná vetva, tá prázdna.
 *
 * Vlastník: V5 vlna 3 (Zľavy), D127 body 3 a 4.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PerformanceCard,
  parseEffectiveness,
  WINDOW_RULE,
  type EffectivenessView,
} from '@/components/campaigns/DiscountPerformance';
import ProductDetailPanel from '@/components/products/ProductDetailPanel';
import {
  DiscountHistoryList,
  HISTORY_EMPTY_TEXT,
  HISTORY_FAILED_TEXT,
  historyHint,
  historyRows,
  parseProductCampaigns,
  type ProductCampaignsWire,
} from '@/components/products/ProductDiscountHistory';
import type { CatalogRowView } from '@/components/products/catalog-api';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Zdroj bez komentárov — hlavičky o pascách smú písať čokoľvek. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

/** Len to, čo človek na obrazovke prečíta — bez značiek, tried a štýlov. */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, ' ');

const HISTORY_SRC = withoutComments(
  read('../../src/components/products/ProductDiscountHistory.tsx'),
);
const PERFORMANCE_SRC = withoutComments(
  read('../../src/components/campaigns/DiscountPerformance.tsx'),
);

/* ═══════════════════════════ vzorky ═══════════════════════════════════════ */

const HISTORY: ProductCampaignsWire = {
  productId: 18342,
  today: '2026-09-01',
  truncated: false,
  rows: [
    {
      itemId: 91,
      campaignId: 7,
      campaignName: 'Letné dočistenie skladu',
      percent: 20,
      dateFrom: '2026-08-06',
      dateTo: '2026-08-19',
      itemStatus: 'ok',
      ownWriteCoversToday: false,
      priceBefore: '12.90',
      priceAfter: '10.32',
    },
    {
      itemId: 104,
      campaignId: 9,
      campaignName: 'Septembrová vlna',
      percent: 15,
      dateFrom: '2026-09-10',
      dateTo: '2026-09-20',
      itemStatus: 'pending',
      ownWriteCoversToday: false,
      priceBefore: null,
      priceAfter: null,
    },
  ],
};

const listOf = (view: ProductCampaignsWire | null, failed = false): string =>
  renderToStaticMarkup(createElement(DiscountHistoryList, { view, failed }));

const MEASURED: EffectivenessView = {
  state: 'measured',
  reason: null,
  spanDays: 14,
  startsOn: '2026-08-06',
  duringTruncated: false,
  before: { from: '2026-07-23', to: '2026-08-05', units: 74 },
  during: { from: '2026-08-06', to: '2026-08-19', units: 128 },
  missingBefore: [],
  missingDuring: [],
  locked: { revenue: 'shop ich cez API nevracia' },
};

/** Dnešný BEŽNÝ stav: objednávky stiahnuté nie sú, takže dni chýbajú. */
const COVERAGE_GAP: EffectivenessView = {
  ...MEASURED,
  state: 'coverage_gap',
  reason: 'coverage_gap',
  before: { from: '2026-07-23', to: '2026-08-05', units: null },
  during: { from: '2026-08-06', to: '2026-08-19', units: null },
  missingBefore: ['2026-07-23', '2026-07-24'],
  missingDuring: ['2026-08-06'],
};

const TOO_YOUNG: EffectivenessView = {
  ...MEASURED,
  state: 'too_young',
  reason: 'not_started',
  startsOn: '2026-09-10',
  before: null,
  during: null,
};

const cardOf = (view: EffectivenessView | null, failed = false): string =>
  renderToStaticMarkup(createElement(PerformanceCard, { view, failed }));

/* ═════════ 1. História produktu sa vykreslí (D127 bod 3, K7) ══════════════ */

describe('história zliav produktu — v ktorých zľavách bol a ako to dopadlo', () => {
  const html = listOf(HISTORY);

  it('vypíše každú zľavu s menom, percentom, oknom a stavom NÁŠHO zápisu', () => {
    expect([...html.matchAll(/data-testid="history-row"/g)]).toHaveLength(2);

    expect(html).toContain('Letné dočistenie skladu');
    expect(html).toContain('−20 %');
    expect(html).toContain('6. 8. 2026 – 19. 8. 2026');
    // Stav zápisu ide zo slovníka `itemSentence()`, nie z vlastnej vetvy.
    expect(html).toContain('zlacnené');

    // Zľava, ktorá sa ešte nezapisovala, JE odpoveď — nie medzera.
    expect(html).toContain('Septembrová vlna');
    expect(html).toContain('ešte sa nezapisovalo');
  });

  it('cena pred a po stojí vedľa seba a nikdy sa tu nedopočítava', () => {
    expect(html).toContain('12,90 € → 10,32 €');
    // Prepočet robí server (`discountedPrice`, D4); tento modul o ňom nevie.
    expect(HISTORY_SRC).not.toContain('discountedPrice');
    expect(HISTORY_SRC).not.toMatch(/percent\s*\/\s*100/);
  });

  it('neznáma cena pred zľavou je pomlčka, nikdy dopočítaná z dnešného cenníka', () => {
    const rows = historyRows(HISTORY);
    expect(rows[1]?.priceText).toBe('—');
    // Druhý riadok teda nesmie niesť žiadne euro — ani „0,00 €".
    expect(html).not.toContain('0,00 €');
  });

  it('náš zápis, ktorý pokrýva dnešok, sa označí — a je to NÁŠ zápis, nie eshop', () => {
    const beziDnes = listOf({
      ...HISTORY,
      rows: [{ ...HISTORY.rows[0]!, ownWriteCoversToday: true }],
    });
    expect(beziDnes).toContain('data-testid="history-running"');
    expect(beziDnes).toContain('platí dnes podľa nášho zápisu');
    expect(textOf(beziDnes)).toContain('náš zápis — nie stav eshopu');
  });

  it('výhradu o vlastných zápisoch panel nepovie dvakrát tými istými slovami', () => {
    /*
     * Skupina „Zľavy podľa vlastných zápisov" o 30 px vyššie hovorí „Appka
     * vidí len to, čo sama zapísala — nie stav eshopu." Doslovné zopakovanie
     * by bol ten istý fakt v paneli dvakrát (bod 7 hlavičky panela).
     */
    expect(textOf(html)).not.toContain('Appka vidí len to, čo sama zapísala');
  });

  it('orezaný chvost histórie sa prizná, nikdy sa ticho neoreže', () => {
    expect(html).not.toContain('data-testid="history-truncated"');
    const orezane = listOf({ ...HISTORY, truncated: true });
    expect(orezane).toContain('data-testid="history-truncated"');
    expect(textOf(orezane)).toContain('Starších zliav môže byť viac');
  });

  it('zoznam je iný než log „Všetky naše zápisy" — a hovorí to na obrazovke', () => {
    expect(textOf(html)).toContain('Aj zľavy, ktoré sa ešte nezapisovali');
  });
});

/* ═════════ 2. Prázdna história je odpoveď, nie chyba (D127 bod 3) ═════════ */

describe('prázdna história nevyzerá ako chyba', () => {
  const prazdna = listOf({ ...HISTORY, rows: [] });
  const zlyhala = listOf(null, true);

  it('prázdny zoznam povie vetu odpovede a NEPOVIE vetu chyby', () => {
    expect(prazdna).toContain('data-testid="history-empty"');
    expect(textOf(prazdna)).toContain(HISTORY_EMPTY_TEXT);
    expect(prazdna).not.toContain(HISTORY_FAILED_TEXT);
    expect(prazdna).not.toContain('data-testid="history-failed"');
  });

  it('prázdna história nemá výstražný tón ani pomlčku namiesto zoznamu', () => {
    // `.flag` bez `neutral` je v tomto repe upozornenie; odpoveď ním nie je.
    expect(prazdna).not.toContain('data-testid="history-row"');
    expect(prazdna).not.toMatch(/class="flag"/);
    // Odpoveď je VETA: žiadna pomlčka namiesto hodnoty, žiadna nula.
    expect(HISTORY_EMPTY_TEXT).not.toContain('—');
    expect(HISTORY_EMPTY_TEXT).not.toMatch(/\d/);
    // Výhrada o cenách patrí k zoznamu; nad prázdnom by sľubovala riadky.
    expect(prazdna).not.toContain('data-testid="history-price-note"');
    const text = textOf(prazdna);
    for (const slovo of ['chyba', 'nepodarilo', 'zlyhalo', 'Skúste']) {
      expect(text, slovo).not.toContain(slovo);
    }
  });

  it('zlyhané načítanie je TRETIA veta — nikdy prázdny zoznam', () => {
    expect(zlyhala).toContain('data-testid="history-failed"');
    expect(textOf(zlyhala)).toContain(HISTORY_FAILED_TEXT);
    expect(zlyhala).not.toContain(HISTORY_EMPTY_TEXT);
    expect(zlyhala).not.toContain('data-testid="history-empty"');
  });

  it('nenačítané, prázdne, plné a zlyhané majú v nadpise štyri rôzne vety', () => {
    const hints = [
      historyHint(null, false),
      historyHint({ ...HISTORY, rows: [] }, false),
      historyHint(HISTORY, false),
      historyHint(null, true),
    ];
    expect(new Set(hints).size).toBe(4);
    expect(hints[1]).not.toMatch(/\d/); // prázdno sa nepíše nulou
    expect(hints[2]).toContain('2 zľavy');
  });

  it('nečitateľné telo NIE JE prázdna história', () => {
    // Chýbajúce `rows` = odpoveď sa nedá prečítať. `[]` by z výpadku spravilo
    // tvrdenie „tento produkt nikdy v zľave nebol" (I11, P7).
    expect(parseProductCampaigns({ productId: 1, today: '2026-09-01' })).toBeNull();
    expect(parseProductCampaigns(null)).toBeNull();
    expect(parseProductCampaigns({ productId: 1, rows: [] })?.rows).toEqual([]);
  });
});

/* ═════════ 3. Účinnosť: priznanie je priznanie, nie číslo (K8) ════════════ */

describe('účinnosť zľavy — tri stavy a ani jeden z nich nie je nula', () => {
  it('measured: dve merania vedľa seba, obe pomenované oknom', () => {
    const html = cardOf(MEASURED);
    expect(html).toContain('74 ks');
    expect(html).toContain('128 ks');
    expect(html).not.toContain('data-testid="performance-unavailable"');
  });

  it('coverage_gap: ŽIADNE číslo, ale povie sa, ktoré dni chýbajú', () => {
    const html = cardOf(COVERAGE_GAP);
    const text = textOf(html);

    expect(html).toContain('data-testid="performance-unavailable"');
    expect(html).toContain('data-state="coverage_gap"');
    expect(text).toContain('nedá sa spočítať');
    expect(text).toContain('nie sú stiahnuté');

    // Ani jeden údaj o predaji — ani pomlčka namiesto neho, ani pruh.
    expect(text).not.toMatch(/\d+\s*ks/);
    expect([...html.matchAll(/width:\s*\d+%/g)]).toHaveLength(0);

    // Chýbajúce dni sa MENUJÚ, nie zhrnú do rozsahu (medzery nie sú súvislé).
    expect(html).toContain('data-testid="performance-missing-before"');
    expect(text).toContain('23. 7. 2026, 24. 7. 2026');
    expect(html).toContain('data-testid="performance-missing-during"');
    expect(text).toContain('6. 8. 2026');
  });

  it('too_young: povie KEDY zľava začne a nekreslí ani jeden stĺpec', () => {
    const html = cardOf(TOO_YOUNG);
    const text = textOf(html);

    expect(html).toContain('data-state="too_young"');
    expect(html).toContain('data-testid="performance-not-started"');
    expect(text).toContain('ešte nezačala');
    expect(text).toContain('10. 9. 2026');
    expect(text).not.toMatch(/\d+\s*ks/);
    expect([...html.matchAll(/width:\s*\d+%/g)]).toHaveLength(0);
  });

  it('krátke okno má vlastnú vetu — nie tú istú, čo nezačatá zľava', () => {
    const html = cardOf({ ...TOO_YOUNG, reason: 'window_too_short' });
    expect(textOf(html)).toContain('kratšie než tri dni');
    expect(html).not.toContain('data-testid="performance-not-started"');
  });

  it('zlyhané načítanie sa povie vetou a nepredstiera sa stavom', () => {
    const html = cardOf(null, true);
    expect(html).toContain('Čísla sa nepodarilo načítať.');
    expect(html).not.toContain('data-testid="performance-unavailable"');
    expect(html).not.toContain('data-testid="performance-measured"');
  });

  it('neznámy stav zo servera je nečitateľná odpoveď, nikdy „measured"', () => {
    expect(parseEffectiveness({ state: 'brand_new_state' })).toBeNull();
    expect(parseEffectiveness({})).toBeNull();
    // `units` bez čísla je „nevieme", nikdy nula.
    const view = parseEffectiveness({
      state: 'coverage_gap',
      before: { from: '2026-07-23', to: '2026-08-05' },
      locked: { revenue: 'x' },
    });
    expect(view?.before?.units).toBeNull();
  });
});

/* ═════════ 4. Okná sa MENUJÚ — celá oprava d00e081 ════════════════════════ */

describe('obrazovka pomenuje porovnávané okná, aby sa dali overiť', () => {
  it('pri čísle stojí meno okna aj jeho dátumy', () => {
    const text = textOf(cardOf(MEASURED));
    expect(text).toContain('Pred zľavou · 23. 7. 2026 – 5. 8. 2026');
    expect(text).toContain('Počas zľavy · 6. 8. 2026 – 19. 8. 2026');
  });

  it('pravidlo okien je na obrazovke aj vtedy, keď sa účinnosť spočítať nedá', () => {
    for (const view of [MEASURED, COVERAGE_GAP, TOO_YOUNG]) {
      expect(textOf(cardOf(view)), view.state).toContain(WINDOW_RULE);
    }
  });

  it('pravidlo hovorí, že základňa končí PRED začiatkom zľavy — nie dneškom', () => {
    expect(WINDOW_RULE).toContain('končí deň pred jej začiatkom');
    expect(WINDOW_RULE).toContain('od jej začiatku');
  });

  it('aj priznanie pomenuje okná, keď ich server pozná', () => {
    const text = textOf(cardOf(COVERAGE_GAP));
    expect(text).toContain('pred zľavou · 23. 7. 2026 – 5. 8. 2026');
    expect(text).toContain('počas zľavy · 6. 8. 2026 – 19. 8. 2026');
  });

  it('účinnosť sa v komponente NIKDY nedopočítava', () => {
    // Server rozdiel posiela; sekcia ho vedome nekreslí (P8). Keby sa tu
    // objavil, bolo by to jedno odvodené číslo vydávané za vplyv zľavy.
    expect(PERFORMANCE_SRC).not.toContain('deltaPercent');
    expect(PERFORMANCE_SRC).not.toContain('deltaReason');
    const text = textOf(cardOf(MEASURED));
    expect(text).not.toContain('%');
    expect(text).not.toContain('54'); // 128 − 74 sa nikde neobjaví
  });
});

/* ═════════ 5. Panel kusu skutočne tú sekciu má (wiring) ═══════════════════ */

const ROW: CatalogRowView = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok',
  unitsSold: 0,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  origin: 'mirror',
};

describe('panel kusu — história je v ňom, a je pod rozklikom', () => {
  const html = renderToStaticMarkup(
    createElement(ProductDetailPanel, { row: ROW, soldWindowDays: 30, onClose: () => {} }),
  );

  it('sekcia histórie v paneli je a nesie svoj nadpis na povrchu', () => {
    const at = html.indexOf('data-testid="detail-history-fold"');
    expect(at, 'rozklik histórie v paneli nie je').toBeGreaterThan(-1);
    const summary = html.slice(at, html.indexOf('</summary>', at));
    expect(summary).toContain('Kedy sme tento kus už zlacnili');
    // Statický render efekty nespúšťa, takže história je „nenačítaná" — a to
    // sa NESMIE prečítať ako „nikdy nebol v zľave".
    expect(summary).toContain('zatiaľ nenačítané');
  });

  it('história nepridáva na povrch ani jeden riadok dvojstĺpcovej tabuľky', () => {
    /*
     * Rozpočet výšky povrchu panela sa meria počtom `<dt>`
     * (`produkty-detail-rozklik.spec.ts`). Zoznam zliav nie je tabuľka údajov
     * a menovky by sa navyše bili s `panel-fakty-dvakrat.spec.ts`.
     */
    expect(HISTORY_SRC).not.toContain('<dt>');
    const at = html.indexOf('data-testid="detail-history-fold"');
    const fold = html.slice(at, html.indexOf('</details>', at));
    expect(fold).not.toContain('<dt>');
    expect(fold).toContain('data-testid="product-discount-history"');
  });
});
