/**
 * Aura Zľavy — DIZAJNOVÉ ROZHODNUTIA TABU ZĽAVY (kontrakt UI 13. 8. 2026,
 * body 4, 11, 21, 22; invariant I7; architektúra §0 P1, P5, P7).
 *
 * Testuje sa presne to, čo sa dá na tejto dvojici obrazoviek pokaziť ticho:
 *
 *  A. **Dominanta je percento** (bod 21) — a pri pásmach je to ROZSAH, nie
 *     najvyššie percento. Najvyššie percento samo by tvrdilo, že toľko dostal
 *     celý výber; pri troch pásmach je to nepravda o tisíckach produktov.
 *  B. **Zľava sa v eshope neruší** (I7, R6) — a detail hovorí to isté, čo
 *     katalóg. Do 26. 8. 2026 tu boli tvrdenia o vete potvrdenia pri RUŠENÍ
 *     zľavy (kontrakt UI, bod 23); merali text akcie, ktorú invariant
 *     zakazuje postaviť. Dôvody sú pri samotnom bloku B nižšie.
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
import DiscountDetail, {
  DetailActions,
  expiryNoteText,
} from '@/components/campaigns/DiscountDetail';
import type { DiscountRow } from '@/components/campaigns/zlavy-api';
import type { CatalogRowView } from '@/components/products/catalog-api';
import { productReasons } from '@/components/products/catalog-status';
import { formatDateSk } from '@/lib/ui/format';

/* ══════════════════════════ vymyslené dáta ════════════════════════════════ */

/**
 * Zľava, ktorá BEŽÍ. Dátumy sú zámerne mimo dosahu kalendára (do roku 2099),
 * aby sa stav nepočítal z dnešného dňa — `sentenceOf()` pri stave `done` číta
 * okno platnosti, takže test s dnešnými dátumami by o rok stíchol.
 */
const KAMPAN_BEZI: DiscountRow = {
  id: 7,
  name: 'Letné dočistenie skladu',
  status: 'done',
  statusReason: null,
  percent: 20,
  dateFrom: '2099-09-01',
  dateTo: '2099-09-12',
  mode: 'eager',
  itemsTotal: 30,
  itemsOk: 18,
  itemsFailed: 0,
  itemsUncertain: 2,
  itemsPending: 10,
  late: false,
  createdAt: '2099-08-20T10:00:00.000Z',
  tiers: [],
  estimate: null,
};

/** Tá istá zľava po konci okna — `sentenceOf()` z nej urobí `skončila`. */
const KAMPAN_SKONCILA: DiscountRow = {
  ...KAMPAN_BEZI,
  dateFrom: '2020-09-01',
  dateTo: '2020-09-12',
  itemsPending: 0,
};

/** Riadok katalógu, ktorý je práve v zľave — druhá strana tej istej vety. */
const RIADOK_V_ZLAVE: CatalogRowView = {
  productId: 4100,
  name: 'Dámsky prstienok s matným povrchom',
  price: '22.63',
  hasAttributes: false,
  shopStatus: 'ok',
  unitsSold: 3,
  everDiscounted: true,
  discountedNow: true,
  fetchedAt: '2026-08-26T10:00:00.000Z',
  origin: 'mirror',
};

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

/* ═════════ B. Zľava sa neruší, skončí sama (I7, R6) ══════════════════════ */

/**
 * Do 26. 8. 2026 tu stáli štyri tvrdenia o vete potvrdenia pri RUŠENÍ zľavy
 * (kontrakt UI, bod 23). Merali text akcie, ktorá nesmie existovať: I7
 * v `docs/10-KONTRAKT.md` zakazuje cestu, ktorá zľavu v eshope zruší,
 * `test/unit/no-clear-reduction.spec.ts` to vynucuje grepom aj guardom a
 * `test/e2e/partial-failure-retry.spec.ts` výslovne žiada, aby také tlačidlo
 * v UI nebolo. Kontrakt API v5 (R1), z ktorého bod 23 vyšiel, je NÁVRH
 * s prázdnou sekciou Výsledok — nezmenil ani invariant, ani README.
 *
 * Detail zľavy tú schopnosť ponúkal (vypnutým tlačidlom s potvrdením)
 * a katalóg ju tou istou vetou popieral. Tvrdenia nižšie merajú práve tú
 * súdržnosť: čo o rušení hovorí detail, čo katalóg, a že stĺpec akcií detailu
 * rušenie neponúka.
 */
describe('B — detail a katalóg hovoria o rušení zľavy to isté', () => {
  it('veta detailu poprie rušenie a menuje deň, ktorým zľava skončí', () => {
    const text = expiryNoteText('2026-09-12');
    expect(text).toMatch(/neruší/);
    expect(text).toContain(formatDateSk('2026-09-12'));
    // Nesmie z toho byť ponúknutý ďalší krok — zrušiť sa nedá nijako.
    expect(text).not.toMatch(/zrušiť/i);
  });

  it('katalóg pri už zlacnenom produkte hovorí to isté', () => {
    const reason = productReasons(RIADOK_V_ZLAVE).find((r) => r.id === 'already_discounted');
    expect(reason).toBeDefined();
    expect(reason?.nextStep).toMatch(/neruší/);
  });

  it('stĺpec akcií ponúka zastavenie fronty, nie rušenie zľavy', () => {
    const html = renderToStaticMarkup(
      createElement(DetailActions, {
        campaign: KAMPAN_BEZI,
        // MERANÝ počet čakajúcich (U6) — dlaždica ani stĺpec akcií už nečítajú
        // odčítané `campaign.itemsPending`. Fixtúra posiela to isté číslo.
        pendingItems: KAMPAN_BEZI.itemsPending,
        onChanged: () => {},
      }),
    );
    expect(html).toContain('Zastaviť frontu');
    expect(html).toContain(expiryNoteText(KAMPAN_BEZI.dateTo));
    // Toto tvrdenie padne, keď sa akcia vráti — aj keby bola vypnutá.
    expect(html.toLowerCase()).not.toContain('zrušiť zľavu');
  });

  it('pri skončenej zľave sa veta o konci už nekreslí', () => {
    const html = renderToStaticMarkup(
      createElement(DetailActions, {
        campaign: KAMPAN_SKONCILA,
        pendingItems: KAMPAN_SKONCILA.itemsPending,
        onChanged: () => {},
      }),
    );
    expect(html).not.toContain(expiryNoteText(KAMPAN_SKONCILA.dateTo));
  });

  it('bez jediného zapísaného produktu niet o čom písať (P2)', () => {
    const html = renderToStaticMarkup(
      createElement(DetailActions, {
        campaign: { ...KAMPAN_BEZI, itemsOk: 0, itemsUncertain: 0 },
        pendingItems: KAMPAN_BEZI.itemsPending,
        onChanged: () => {},
      }),
    );
    expect(html).toContain('Zastaviť frontu');
    expect(html).not.toContain(expiryNoteText(KAMPAN_BEZI.dateTo));
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
