/**
 * Aura Zľavy — TRI KPI KARTY PREHĽADU: TROJSTAVOVOSŤ (V7, K4; D148, D152, D154).
 *
 * K4 kontraktu V7 žiada mutačne overený test na to, že každá z troch kariet
 * ukáže PRESNE jedno z troch: hodnotu, pomlčku „nevieme", alebo dolnú hranicu
 * `≥ N`. Tento súbor meria model (`kpi-row-model.ts`) — čisté funkcie bez
 * prehliadača; že sú karty naozaj VYKRESLENÉ a že do nich čísla dotečú, meria
 * `prehlad-kpi-zapojenie.spec.ts` nad DOM-om.
 *
 * ČO SA TU DÁ POKAZIŤ TAK, ŽE BY TEST ZOSTAL ZELENÝ — A PREČO NEZOSTANE
 * ────────────────────────────────────────────────────────────────────
 *
 *  A. **Zámena „nežiadali sme" a „neprečítalo sa".** `undefined` a `null` sú
 *     dva RÔZNE stavy: prvý znamená, že sa dáta práve ťahajú (a vtedy sa
 *     medzera NEPRIZNÁVA — bolo by to tvrdenie o eshope namiesto tvrdenia
 *     o načítaní), druhý znamená, že odpoveď sa nedala prečítať, a to karta
 *     povedať MUSÍ. Test drží OBA a porovnáva ich DETAILY, nie len hodnotu:
 *     hodnota je v oboch prípadoch pomlčka, takže test len na ňu by zámenu
 *     nezachytil.
 *
 *  B. **Nula namiesto pomlčky.** Najčastejšia chyba tohto repa. Meria sa, že
 *     ani jedna karta bez dát nemá text `'0'`, a že MERANÁ nula (server ju
 *     naozaj poslal) sa naopak ako `'0'` vykreslí — obe strany, inak by prešlo
 *     „všetko je pomlčka".
 *
 *  C. **`≥ 0` ako priznanie.** „Predalo sa aspoň nič zo skladu" je prázdna
 *     veta, nie dolná hranica. Kto `ratioValue()` napíše bez tej závory,
 *     dostane pri dnešnom pokrytí okna `≥ 0×` takmer stále.
 *
 *  D. **Pilulka s nulou.** `DeltaPill` pri neznámej zmene NESMIE ukázať 0 % —
 *     nula je tvrdenie „nič sa nezmenilo" a appka ho o nezmeranom období
 *     urobiť nesmie. Test meria, že zmena je `null` vždy, keď čo i len jedna
 *     z troch podmienok nedrží, a že prvé dve karty pilulku vôbec NEMAJÚ
 *     (momentka porovnanie nemá — to nie je to isté ako „nepoznáme ho").
 *
 *  E. **Podiel z iného menovateľa.** Keď odpoveď sama hlási, že diely nedávajú
 *     celok (`sumMatchesTotal: false`), percento by vyšlo z niečoho iného, než
 *     čo je v odpovedi. Karta ho vtedy nesmie napísať a musí povedať prečo.
 *
 *  F. **Tvar pomeru.** `formatSoldPerStock()` je DRUHÁ kópia tvaru, ktorý píše
 *     stĺpec „predané/sklad" v tabuľkách (`soldPerStockCell()`
 *     v `lib/ui/product-columns.ts`). Kópia je vedomá (formátovač sa
 *     neexportuje), a preto sú hodnoty pribité na VLASTNÚ tabuľku očakávaní —
 *     nie porovnané klon s klonom. To je poučenie V6b z troch znakovo
 *     zhodných kópií pravidla osi: rovnaký preklep v oboch by prešiel.
 *
 * Vlastník: V7, krok 1/4 (KPI riadok a prepínače okna).
 */
import { describe, expect, it } from 'vitest';

import type { OwnDiscountShareView, SoldPerStockView } from '@/components/dashboard/kpi-api';
import {
  KPI_CARD_IDS,
  catalogCard,
  coveragePhrase,
  discountedCard,
  formatSharePercentSk,
  formatSoldPerStock,
  kpiCards,
  missingDaysPhrase,
  previousWindowAnchor,
  ratioChangePercent,
  ratioValue,
  soldPerStockCard,
  windowsAdjoin,
  type KpiRowInput,
} from '@/components/dashboard/kpi-row-model';
import { DEFAULT_SOLD_WINDOW } from '@/components/dashboard/sold-window';

const NEVIEME = '—';
const HRANICA = '≥';

/* ═════════════════════════════ 1. Vzorky ══════════════════════════════════ */

const CATALOG: OwnDiscountShareView = {
  catalogRows: 41_348,
  discountedNow: 620,
  share: 0.015,
  sumMatchesTotal: true,
};

const RATIO: SoldPerStockView = {
  from: '2026-08-05',
  to: '2026-09-03',
  ratio: 1.5,
  ratioState: 'measured',
  windowUnits: 900,
  stock: 600,
  unknownDays: 0,
  productsWithStock: 612,
  catalogRows: 41_348,
};

/** Predchádzajúce okno rovnakej dĺžky, ktoré na to aktuálne NAVÄZUJE. */
const RATIO_BEFORE: SoldPerStockView = {
  ...RATIO,
  from: '2026-07-06',
  to: '2026-08-04',
  ratio: 1.2,
};

const base = (over: Partial<KpiRowInput> = {}): KpiRowInput => ({
  windowDays: DEFAULT_SOLD_WINDOW,
  ...over,
});

/* ═════════════════════ 2. Rad ako celok (D152, bod 5) ════════════════════ */

describe('D152 — rad má TRI karty v záväznom poradí', () => {
  it('poradie kariet sedí so zoznamom modelu', () => {
    const cards = kpiCards(base({ catalog: CATALOG, soldPerStock: RATIO }));
    expect(cards.map((card) => card.id)).toEqual([...KPI_CARD_IDS]);
    expect(cards).toHaveLength(3);
  });

  it('zlatý vlas má PRESNE JEDNA karta a je to „Predané na sklad"', () => {
    const cards = kpiCards(base({ catalog: CATALOG, soldPerStock: RATIO }));
    const gold = cards.filter((card) => card.accent === 'gold');
    expect(gold.map((card) => card.id)).toEqual(['predane-na-sklad']);
  });

  it('slovo zakázanej účtovnej metriky nie je v ani jednom popisku (K3)', () => {
    const cards = kpiCards(base({ catalog: CATALOG, soldPerStock: RATIO }));
    for (const card of cards) {
      const text = `${card.label} ${card.detail}`.toLowerCase();
      expect(text, card.id).not.toContain('obrátkov');
      expect(text, card.id).not.toContain('turnover');
    }
    // A tretia karta sa volá presne tak, ako rozhodol D148.
    expect(cards[2]?.label).toBe('Predané na sklad');
  });
});

/* ═══════════════ 3. Trojstavovosť: hodnota · pomlčka · hranica ════════════ */

describe('K4 — každá karta má tri stavy a ani jeden nie je nula', () => {
  it('bez dát je celý rad pomlčka a ani jedna nula (R4)', () => {
    for (const input of [base(), base({ catalog: null, soldPerStock: null })]) {
      for (const card of kpiCards(input)) {
        expect(card.value.text, card.id).toBe(NEVIEME);
        expect(card.value.unknown, card.id).toBe(true);
        expect(card.value.lowerBound, card.id).toBe(false);
      }
    }
  });

  it('„nežiadali sme" a „neprečítalo sa" majú RÔZNY detail (bod A)', () => {
    // Hodnota je v oboch pomlčka, takže rozdiel musí niesť veta pod ňou.
    expect(catalogCard(base()).detail).not.toBe(catalogCard(base({ catalog: null })).detail);
    expect(catalogCard(base({ catalog: null })).detail).toContain('nepodarilo prečítať');
    // Kým sa dáta ťahajú, o medzere sa NETVRDÍ nič.
    expect(catalogCard(base()).detail).not.toContain('nepodarilo');

    expect(soldPerStockCard(base()).detail).not.toBe(
      soldPerStockCard(base({ soldPerStock: null })).detail,
    );
    expect(soldPerStockCard(base({ soldPerStock: null })).detail).toContain(
      'nepodarilo prečítať',
    );
  });

  it('MERANÁ nula sa vykreslí ako nula, nie ako pomlčka (bod B)', () => {
    const zero: OwnDiscountShareView = {
      catalogRows: 41_348,
      discountedNow: 0,
      share: 0,
      sumMatchesTotal: true,
    };
    const card = discountedCard(base({ catalog: zero }));
    expect(card.value.text).toBe('0');
    expect(card.value.unknown).toBe(false);
  });

  it('nedočítané okno nesie `≥` a POVIE, koľko dní chýba (D149, R3)', () => {
    const card = soldPerStockCard(
      base({
        windowDays: 360,
        soldPerStock: { ...RATIO, ratioState: 'lower_bound', unknownDays: 274 },
      }),
    );
    expect(card.value.text.startsWith(HRANICA)).toBe(true);
    expect(card.value.lowerBound).toBe(true);
    expect(card.value.unknown).toBe(false);
    expect(card.detail).toContain('274 dní okna nemáme');
    // Nadpis rozsahu musí byť to okno, na ktoré človek klikol.
    expect(card.detail).toContain('360 dní');
  });

  it('nedočítané okno bez počtu chýbajúcich dní priznanie NEZAMLČÍ', () => {
    const card = soldPerStockCard(
      base({ soldPerStock: { ...RATIO, ratioState: 'lower_bound', unknownDays: null } }),
    );
    expect(card.value.text.startsWith(HRANICA)).toBe(true);
    expect(card.detail).toContain('koľko dní okna chýba, nevieme');
  });

  it('okno bez jediného dočítaného dňa je pomlčka, nie nula', () => {
    const card = soldPerStockCard(
      base({ soldPerStock: { ...RATIO, ratio: null, ratioState: 'unknown' } }),
    );
    expect(card.value.text).toBe(NEVIEME);
    expect(card.detail).toContain('ani jeden deň okna zatiaľ nemáme');
  });

  it('`≥ 0` sa nevykreslí NIKDY (bod C)', () => {
    expect(ratioValue(0, true).text).toBe(NEVIEME);
    expect(ratioValue(0, true).unknown).toBe(true);
    // Meraná nula BEZ dolnej hranice je naopak platná hodnota.
    expect(ratioValue(0, false).text).toBe('0.0×');
    expect(ratioValue(0, false).unknown).toBe(false);
  });

  it('nekonečno ani NaN nie sú hodnota', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ratioValue(bad, false).unknown, String(bad)).toBe(true);
    }
  });
});

/* ═════════════════════ 4. Pilulka smeru (bod D) ═══════════════════════════ */

describe('K4 — pilulka smeru nikdy neukáže 0 % za nezmerané obdobie', () => {
  it('prvé dve karty pilulku VÔBEC nemajú (momentka nemá porovnanie)', () => {
    const cards = kpiCards(base({ catalog: CATALOG, soldPerStock: RATIO }));
    expect(cards[0]?.delta).toBeNull();
    expect(cards[1]?.delta).toBeNull();
    expect(cards[2]?.delta).not.toBeNull();
  });

  it('zmena je `null`, kým nie sú OBE okná zmerané', () => {
    expect(ratioChangePercent(undefined, RATIO)).toBeNull();
    expect(ratioChangePercent(null, RATIO)).toBeNull();
    expect(ratioChangePercent(RATIO_BEFORE, null)).toBeNull();
    expect(
      ratioChangePercent({ ...RATIO_BEFORE, ratioState: 'lower_bound' }, RATIO),
    ).toBeNull();
    expect(
      ratioChangePercent(RATIO_BEFORE, { ...RATIO, ratioState: 'lower_bound' }),
    ).toBeNull();
  });

  it('zmena je `null`, keď okná na seba kalendárne NENAVÄZUJÚ', () => {
    // Deň medzi oknami (hrana polnoci na klientovi) — okná by sa prekryli.
    const posunute: SoldPerStockView = { ...RATIO_BEFORE, to: '2026-08-03' };
    expect(windowsAdjoin(posunute, RATIO)).toBe(false);
    expect(ratioChangePercent(posunute, RATIO)).toBeNull();
    expect(windowsAdjoin(RATIO_BEFORE, RATIO)).toBe(true);
  });

  it('zmena je `null`, keď staršie okno je nulové (žiadne „+∞ %")', () => {
    expect(ratioChangePercent({ ...RATIO_BEFORE, ratio: 0 }, RATIO)).toBeNull();
  });

  it('keď porovnanie EXISTUJE, je to percento a má vetu o období', () => {
    expect(ratioChangePercent(RATIO_BEFORE, RATIO)).toBe(25);
    const card = soldPerStockCard(
      base({ soldPerStock: RATIO, soldPerStockBefore: RATIO_BEFORE }),
    );
    expect(card.delta?.value).toBe(25);
    expect(card.delta?.title).toContain('30 dní');
    expect(card.delta?.suffix).toBe('%');
    // Bez porovnania NIE JE `title` vymyslený — pilulka má vlastné priznanie.
    expect(soldPerStockCard(base({ soldPerStock: RATIO })).delta?.value).toBeNull();
    expect(soldPerStockCard(base({ soldPerStock: RATIO })).delta?.title).toBeNull();
  });
});

/* ═══════════════ 5. Podiel katalógu a vlastné zápisy (bod E) ══════════════ */

describe('D156 / I11 — „V zľave" je podľa VLASTNÝCH zápisov', () => {
  it('detail povie počet katalógu, podiel aj to, čí je to zápis', () => {
    const card = discountedCard(base({ catalog: CATALOG }));
    expect(card.value.text).toBe('620');
    expect(card.detail).toContain('41 348');
    expect(card.detail).toContain('1,5 %');
    expect(card.detail).toContain('podľa vlastných zápisov');
  });

  it('keď diely nedávajú celok, podiel sa NENAPÍŠE a karta povie prečo', () => {
    const card = discountedCard(base({ catalog: { ...CATALOG, sumMatchesTotal: false } }));
    expect(card.detail).not.toContain('%');
    expect(card.detail).toContain('diely nedávajú celok');
  });

  it('nulový celok nedá „0 %", ale priznanie', () => {
    const card = discountedCard(
      base({ catalog: { catalogRows: 0, discountedNow: 0, share: null, sumMatchesTotal: true } }),
    );
    expect(card.detail).not.toContain('%');
  });

  it('podiel, ktorý zaokrúhlením padne na nulu, sa napíše ako „menej než"', () => {
    expect(formatSharePercentSk(0.0002)).toBe('menej než 0,1 %');
    expect(formatSharePercentSk(0)).toBe('0 %');
    expect(formatSharePercentSk(null)).toBeNull();
    expect(formatSharePercentSk(0.015)).toBe('1,5 %');
    expect(formatSharePercentSk(0.12)).toBe('12 %');
  });

  it('karta katalógu hovorí o ZRKADLE, nie o eshope', () => {
    const card = catalogCard(base({ catalog: CATALOG }));
    expect(card.value.text).toBe('41 348');
    expect(card.detail).toContain('zrkadle');
    expect(card.detail).toContain('nie v eshope');
  });
});

/* ═════════════════ 6. Tvar pomeru a vety pokrytia (bod F) ═════════════════ */

describe('D148 — pomer sa píše ako `N×`, tak ako v tabuľke', () => {
  it('tabuľka očakávaní, nie porovnanie klonu s klonom', () => {
    const expected: readonly [number, string][] = [
      [0, '0.0×'],
      [0.04, '0.0×'],
      [1, '1.0×'],
      [1.25, '1.3×'],
      [1.5, '1.5×'],
      [12.34, '12.3×'],
    ];
    for (const [input, text] of expected) {
      expect(formatSoldPerStock(input), String(input)).toBe(text);
    }
  });

  it('dolná hranica má znak `≥`, medzeru a potom číslo', () => {
    expect(ratioValue(1.5, true).text).toBe('≥ 1.5×');
  });

  it('veta o pokrytí nedopĺňa nulu, keď počet produktov nepoznáme', () => {
    expect(coveragePhrase(null)).toContain('appka nevie');
    expect(coveragePhrase(null)).not.toContain('0');
    expect(coveragePhrase(612)).toContain('612');
    expect(coveragePhrase(1)).toContain('1 produktu');
  });

  it('priznanie chýbajúcich dní má tri stavy, nie dva', () => {
    expect(missingDaysPhrase(null)).toContain('nevieme');
    expect(missingDaysPhrase(0)).toBe('aspoň toľko, časť dní nemáme celú');
    expect(missingDaysPhrase(12)).toContain('12 dní okna nemáme');
  });
});

/* ═══════════════════ 7. Kotva predchádzajúceho okna ══════════════════════ */

describe('kotva predchádzajúceho okna je „dnešok − N"', () => {
  it('okno 30 dní kotví o 30 dní dozadu a okná potom naväzujú', () => {
    const anchor = previousWindowAnchor('2026-09-03', 30);
    expect(anchor).toBe('2026-08-04');
    expect(windowsAdjoin({ to: anchor! }, { from: '2026-08-05' })).toBe(true);
  });

  it('nečitateľný deň sa NEHÁDA', () => {
    expect(previousWindowAnchor('nie-datum', 30)).toBeNull();
  });
});
