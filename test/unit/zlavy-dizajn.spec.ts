/**
 * Aura Zľavy — DIZAJNOVÉ ROZHODNUTIA TABU ZĽAVY (kontrakt UI 13. 8. 2026,
 * body 4, 11, 21, 22, 23; architektúra §0 P1, P5, P7).
 *
 * Testuje sa presne to, čo sa dá na tejto dvojici obrazoviek pokaziť ticho:
 *
 *  A. **Dominanta je percento** (bod 21) — a pri pásmach je to ROZSAH, nie
 *     najvyššie percento. Najvyššie percento samo by tvrdilo, že toľko dostal
 *     celý výber; pri troch pásmach je to nepravda o tisíckach produktov.
 *  B. **Potvrdenie pri rušení zľavy** (bod 23) musí niesť POČET PRODUKTOV a
 *     to, že sa každé zrušenie počíta do denného rozpočtu. Bez počtu je to
 *     potvrdenie naslepo; bez rozpočtu človek nevie, že si brzdí frontu.
 *     Keď sa rozpočet nedá prečítať, veta to prizná — nedopočíta sa nula (P7).
 *  C. **Prázdny zoznam je tvrdenie** — kým sa dáta nenačítajú, nekreslí sa.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Efekty klienta sa pri statickom renderi nespúšťajú, takže test meria
 * značky a texty, nie načítanie dát.
 *
 * Vlastník: V11.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import DiscountsList, { percentHeadline } from '@/components/campaigns/DiscountsList';
import DiscountDetail, { endInShopConfirmText } from '@/components/campaigns/DiscountDetail';

/* ═════════ A. Dominanta zoznamu je percento (kontrakt UI, bod 21) ═════════ */

describe('A — percento zľavy ako dominanta', () => {
  it('jedno percento sa píše ako jedno číslo, bez doplnku', () => {
    const head = percentHeadline(25, []);
    expect(head.big).toBe('25 %');
    expect(head.sub).toBeNull();
  });

  it('jedno pásmo je stále jedno percento', () => {
    const head = percentHeadline(20, [{ percent: 20 }]);
    expect(head.big).toBe('20 %');
    expect(head.sub).toBeNull();
  });

  it('pásma sa píšu ako ROZSAH, nie ako najvyššie percento', () => {
    const head = percentHeadline(30, [{ percent: 30 }, { percent: 20 }, { percent: 15 }]);
    expect(head.big).toBe('15–30 %');
    expect(head.sub).toBe('3 pásma');
    // Najvyššie percento samo by klamalo o zvyšných dvoch pásmach.
    expect(head.big).not.toBe('30 %');
  });

  it('pásma s rovnakým percentom nevyrobia falošný rozsah', () => {
    const head = percentHeadline(20, [{ percent: 20 }, { percent: 20 }]);
    expect(head.big).toBe('20 %');
    expect(head.sub).toBe('2 pásma');
  });
});

/* ═════════ B. Potvrdenie pri rušení zľavy (kontrakt UI, bod 23) ═══════════ */

describe('B — potvrdenie zrušenia zľavy povie počet aj cenu v rozpočte', () => {
  it('nesie počet zapísaných produktov a odrátanie z denného rozpočtu', () => {
    const text = endInShopConfirmText({
      written: 3408,
      uncertain: 0,
      pending: 0,
      budgetRemaining: 179,
      budgetTotal: 200,
    });
    expect(text).toContain('3 408');
    expect(text).toContain('denného rozpočtu');
    expect(text).toContain('179');
    expect(text).toContain('200');
  });

  it('neisté položky sa nezlievajú so zapísanými (D45)', () => {
    const text = endInShopConfirmText({
      written: 3408,
      uncertain: 12,
      pending: 0,
      budgetRemaining: 179,
      budgetTotal: 200,
    });
    expect(text).toContain('3 408');
    expect(text).toContain('12');
    expect(text).toContain('nevie, či sa zapísali');
    // 3 420 by bol súčet oboch čísel — presne to, čo sa nesmie stať.
    expect(text).not.toContain('3 420');
  });

  it('bežiaca fronta sa v potvrdení pomenuje ako ďalší krok', () => {
    const text = endInShopConfirmText({
      written: 100,
      uncertain: 0,
      pending: 4480,
      budgetRemaining: 179,
      budgetTotal: 200,
    });
    expect(text).toContain('4 480');
    expect(text).toContain('zastaviť frontu');
  });

  it('neznámy rozpočet sa prizná, nedopočíta sa nula (P7)', () => {
    const text = endInShopConfirmText({
      written: 5,
      uncertain: 0,
      pending: 0,
      budgetRemaining: null,
      budgetTotal: null,
    });
    expect(text).toContain('appka teraz nevie');
    expect(text).not.toMatch(/ostáva \d/);
    expect(text).not.toContain(' 0 ');
  });
});

/* ═════════ C. Prvý render nič netvrdí (P7, kontrakt UI bod 11) ═══════════ */

describe('C — obrazovky sa vykreslia aj bez dát a nič si nevymyslia', () => {
  it('zoznam zliav ešte netvrdí, že žiadna zľava neexistuje', () => {
    const html = renderToStaticMarkup(createElement(DiscountsList));
    expect(html).toContain('Načítavam zľavy');
    expect(html).not.toContain('Zatiaľ tu nie je ani jedna zľava');
  });

  it('detail zľavy nekreslí čísla, kým ich nemá', () => {
    const html = renderToStaticMarkup(createElement(DiscountDetail, { id: 7 }));
    expect(html).toContain('Načítavam zľavu');
    // Štyri dlaždice fronty patria k dátam, nie k načítavaniu.
    expect(html).not.toContain('Nevieme, či sa zapísalo');
  });
});
