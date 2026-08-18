/**
 * Aura Zľavy — NOVÁ ZĽAVA po zhustení (kontrakt UI 13. 8. 2026, bod 24;
 * pravidlá P1, P6, P7; invariant I3).
 *
 * Obrazovka sa 18. 8. 2026 zhustila zo štyroch sekcií na tri: ŠTART a
 * POTVRDENIE sú jedna karta rozhodnutia a medzikroky výpočtu sa presunuli pod
 * rozklik. Testuje sa to, čo by sa tým dalo ticho pokaziť:
 *
 *  A. **I3 neoslabol.** Odtlačok výberu sa mení pri každej skutočnej zmene
 *     (iný produkt, iná predajnosť, iná cena, iné poradie) a NEMENÍ sa, keď
 *     obnova vráti tú istú sadu — inak by tlačidlo Obnoviť buď zahadzovalo
 *     hotovú skúšku, alebo, horšie, nechalo platiť skúšku pre iný výber.
 *  B. **Dva dni sú na povrchu, výpočet pod rozklikom** (P6) — a deň
 *     dobehnutia je označený ako odhad (P7), deň nábehu zľavy nie.
 *  C. **Dominantou karty je počet produktov** (P1) a plán času sa kreslí
 *     medzi dominantu a poistky, nie ako vlastná sekcia.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť.
 *
 * Vlastník: V11.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { selectionPrintOf } from '@/components/campaigns/NewDiscount';
import NewDiscountConfirm from '@/components/campaigns/NewDiscountConfirm';
import NewDiscountStart from '@/components/campaigns/NewDiscountStart';
import { buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';

const ROWS: SelectableRow[] = [
  { productId: 18342, name: 'Strieborné náušnice Lumen', price: '34.90', unitsSold: 0, discountedNow: false },
  { productId: 21170, name: 'Strieborný prsteň Aurora', price: '49.00', unitsSold: 0, discountedNow: false },
  { productId: 9084, name: 'Strieborná retiazka Ancora', price: '27.50', unitsSold: 2, discountedNow: false },
];

/* ═════════════ A. I3 — odtlačok výberu ═══════════════════════════════════ */

describe('A — odtlačok výberu drží I3', () => {
  it('tá istá sada po obnove dá ten istý odtlačok — skúška naprázdno platí ďalej', () => {
    expect(selectionPrintOf(ROWS)).toBe(selectionPrintOf([...ROWS]));
  });

  it('iný produkt vo výbere odtlačok zmení', () => {
    const other = [...ROWS.slice(0, 2), { ...ROWS[2]!, productId: 11265 }];
    expect(selectionPrintOf(other)).not.toBe(selectionPrintOf(ROWS));
  });

  it('zmena predajnosti odtlačok zmení — produkt by padol do iného pásma', () => {
    const moved = [...ROWS.slice(0, 2), { ...ROWS[2]!, unitsSold: 7 }];
    expect(selectionPrintOf(moved)).not.toBe(selectionPrintOf(ROWS));
  });

  it('zmena ceny odtlačok zmení — človek potvrdzoval inú novú cenu', () => {
    const repriced = [{ ...ROWS[0]!, price: '39.90' }, ...ROWS.slice(1)];
    expect(selectionPrintOf(repriced)).not.toBe(selectionPrintOf(ROWS));
  });

  it('iné poradie riadkov odtlačok zmení — vzorka ukazuje iné produkty', () => {
    expect(selectionPrintOf([...ROWS].reverse())).not.toBe(selectionPrintOf(ROWS));
  });

  it('ubratý produkt odtlačok zmení, aj keď zvyšok sedí', () => {
    expect(selectionPrintOf(ROWS.slice(0, 2))).not.toBe(selectionPrintOf(ROWS));
  });
});

/* ═════════════ B. Dva dni na povrchu, výpočet pod rozklikom ══════════════ */

const START_PROPS = {
  itemsCount: 8000,
  perDay: 200,
  aheadPending: 3240,
  aheadNames: [{ name: 'Ležiaky striebro', pending: 3240 }],
  finishDay: '2026-09-02',
  queueDays: 17,
  proposedStart: '2026-09-04',
  from: '2026-09-04',
  onUseProposal: () => {},
  keyExpiresAt: '2026-12-01T10:00:00.000Z',
  keyPresent: true,
  budget: { spent: 100, limit: 200, resetsAt: 'o 02:00' },
};

describe('B — kedy sa zapíše a kedy nabehne (P6, P7)', () => {
  it('na povrchu sú oba dni', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountStart, START_PROPS));
    expect(html).toContain('Zapísané budú');
    expect(html).toContain('02.09.2026');
    expect(html).toContain('Zľava nabehne');
    expect(html).toContain('04.09.2026');
  });

  it('P7 — deň dobehnutia je označený ako odhad, deň nábehu zľavy nie', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountStart, START_PROPS));
    const finish = html.indexOf('data-testid="start-finish"');
    const live = html.indexOf('data-testid="start-live-from"');
    // Trieda `est` dopĺňa `≈` a tlmenejší odtieň (globals.css).
    expect(html.slice(finish - 60, finish)).toContain('est');
    expect(html.slice(live - 60, live)).not.toContain('est');
  });

  it('P6 — rozpočet a fronta pred nami sú AŽ v rozkliku, nie na povrchu', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountStart, START_PROPS));
    const fold = html.indexOf('Ako to počítam');
    expect(fold).toBeGreaterThan(-1);
    expect(html.indexOf('Denný rozpočet')).toBeGreaterThan(fold);
    expect(html.indexOf('Pred touto zľavou')).toBeGreaterThan(fold);
    expect(html.indexOf('Fronta pobeží')).toBeGreaterThan(fold);
    expect(html.indexOf('100/200')).toBeGreaterThan(fold);
  });

  it('bez odhadu je na povrchu pomlčka a dôvod ostáva v rozkliku (nikdy nula)', () => {
    const html = renderToStaticMarkup(
      createElement(NewDiscountStart, {
        ...START_PROPS,
        perDay: null,
        finishDay: null,
        queueDays: null,
        proposedStart: null,
        budget: null,
      }),
    );
    const finish = html.indexOf('data-testid="start-finish"');
    expect(html.slice(finish, finish + 60)).toContain('—');
    expect(html.slice(finish, finish + 60)).not.toContain('0');
    expect(html).toContain('nevieme');
  });

  it('ponuka posunu nesie deň, na ktorý posúva — a nekreslí sa, keď je štart už na ňom', () => {
    const offered = renderToStaticMarkup(
      createElement(NewDiscountStart, { ...START_PROPS, from: '2026-09-01' }),
    );
    expect(offered).toContain('Posunúť na');
    expect(offered).toContain('data-testid="start-proposal"');

    const same = renderToStaticMarkup(createElement(NewDiscountStart, START_PROPS));
    expect(same).not.toContain('Posunúť na');
  });
});

/* ═════════════ C. Jedna karta rozhodnutia ════════════════════════════════ */

const CONFIRM_PROPS = {
  itemsCount: 8000,
  tiers: buildTiers(ROWS, 180),
  averagePrice: 46.2,
  typed: '',
  onTyped: () => {},
  previewFresh: false,
  preview: null,
  previewAt: null,
  busy: 'idle' as const,
  blockedReason: 'Najprv spustite skúšku naprázdno pre tento výber.',
  error: null,
  created: null,
  onPreview: () => {},
  onQueue: () => {},
};

describe('C — karta rozhodnutia: dominanta hore, plán času pod ňou', () => {
  it('plán času sa kreslí medzi dominantu a poistku s maržou', () => {
    const html = renderToStaticMarkup(
      createElement(NewDiscountConfirm, {
        ...CONFIRM_PROPS,
        plan: createElement(NewDiscountStart, START_PROPS),
      }),
    );
    const count = html.indexOf('data-testid="confirm-count"');
    const plan = html.indexOf('data-testid="new-discount-start"');
    const margin = html.indexOf('Dopad na maržu');
    const queue = html.indexOf('data-testid="queue-discount"');
    expect(count).toBeLessThan(plan);
    expect(plan).toBeLessThan(margin);
    expect(margin).toBeLessThan(queue);
  });

  it('štart nekreslí vlastnú sekciu — karta rozhodnutia je jedna', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountStart, START_PROPS));
    expect(html).not.toContain('<section');
    expect(html).not.toContain('sec-h');
  });

  it('prázdny katalóg dá pomlčku, nie nulu — nula je tvrdenie (kontrakt UI, bod 5)', () => {
    const html = renderToStaticMarkup(
      createElement(NewDiscountConfirm, { ...CONFIRM_PROPS, itemsCount: 0, countKnown: false }),
    );
    const count = html.indexOf('data-testid="confirm-count"');
    expect(html.slice(count, count + 60)).toContain('—');
    expect(html.slice(count, count + 60)).not.toContain('0');
  });

  it('bez plánu času sa karta vykreslí tiež — slot je voliteľný', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountConfirm, CONFIRM_PROPS));
    expect(html).toContain('produktov dostane zľavu');
    expect(html).not.toContain('data-testid="new-discount-start"');
  });
});
