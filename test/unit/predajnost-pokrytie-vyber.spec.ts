/**
 * Aura Zľavy — POKRYTIE PREDAJNOSTI TAM, KDE SA PODĽA NEJ VYBERÁ (P2, P3).
 *
 * Nález P2: stĺpec „Predané 180 d" a pravidlo pásma „0 predaných za 180 dní"
 * znejú ako meraný fakt o pol roku, hoci okno prvého behu je zámerne krátke
 * (`SALES_WINDOW_DAYS`) a `catalog/search` dopĺňa chýbajúcu predajnosť nulou.
 * Prehľad pokrytie priznáva („N dní s údajmi"), Produkty ani sprievodca ho do
 * 26. 8. 2026 nepriznávali nikde — a práve podľa toho čísla sa vyberajú tisíce
 * produktov a podpisuje sa zápis do ostrého shopu.
 *
 * Čo sa tu meria:
 *
 *  A. **Veta o pokrytí** — všetky vetvy `soldCoverageNote()`. Vrátane dvoch,
 *     ktoré musia MLČAŤ: pred prvou odpoveďou (inak varovanie blikne na každom
 *     otvorení obrazovky) a pri plnom pokrytí (trvalá vysvetlivka sa prestane
 *     čítať).
 *  B. **Čítanie odpovede** — chýbajúce `syncEnabled` alebo `daysCovered` je
 *     „nevieme", nie prázdne pokrytie. Dopočítať si ich znamená vyrobiť
 *     tvrdenie o tom, čo appka zmerala.
 *  C. **Vysvetlivka na obrazovkách** — Produkty aj sprievodca ju naozaj
 *     vykreslia, a pri plnom pokrytí nevykreslia nič. Meria sa VYKRESLENÝ
 *     markup obrazovky, nie prítomnosť reťazca v zdrojovom kóde.
 *
 * Pokrytie prichádza do obrazoviek hookom, ktorý pri statickom renderi nemá
 * ako zbehnúť (efekty sa nespúšťajú), preto je `useSoldCoverage` nahradený —
 * všetko ostatné v module aj v obrazovkách je skutočné.
 *
 * Vlastník: V10 (obrazovka Produkty), sprievodca V11.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SoldCoverage, SoldCoverageState } from '@/components/products/sold-coverage';

/** Stav, ktorý nahradený hook vráti. Testy ho prepisujú pred renderom. */
const hook = vi.hoisted(() => ({ state: { asked: false } as { asked: boolean } }));

vi.mock('@/components/products/sold-coverage', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/products/sold-coverage')>();
  return { ...actual, useSoldCoverage: () => hook.state };
});

import NewDiscount, {
  emptySelectionText,
  type EmptySelectionReason,
  type NewDiscountInitial,
} from '@/components/campaigns/NewDiscount';
import CatalogPanel from '@/components/products/CatalogPanel';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';
import {
  parseSoldCoverage,
  soldCoverageNote,
  SOLD_COVERAGE_UNASKED,
} from '@/components/products/sold-coverage';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

/** Stav z 26. 8. 2026: okno prvého behu 3 dni, zmerané dva. */
const DVA_DNI: SoldCoverage = {
  syncEnabled: true,
  daysCovered: 2,
  daysPartial: 0,
  from: '2026-08-05',
  to: '2026-08-06',
};

const known = (coverage: SoldCoverage): SoldCoverageState => ({ asked: true, coverage });

/* ═══════════ A. Veta o pokrytí — vrátane oboch mlčaní ═════════════════════ */

describe('A — veta o pokrytí predajnosti', () => {
  it('pred prvou odpoveďou nehovorí nič — varovanie nesmie blikať', () => {
    expect(soldCoverageNote(SOLD_COVERAGE_UNASKED, 180)).toBeNull();
  });

  it('dva zmerané dni proti oknu 180 sú priznané číslom, nie mlčaním', () => {
    const note = soldCoverageNote(known(DVA_DNI), 180);
    expect(note).not.toBeNull();
    expect(note?.variant).toBe('warn');
    expect(note?.text).toContain('2 z 180');
    // Presne to, čo nález pomenúva: nula nie je dôkaz o nepredajnosti.
    expect(note?.text).toContain('nepredáva');
  });

  it('nečitateľná odpoveď je priznané „nevieme", nie plné pokrytie', () => {
    const note = soldCoverageNote({ asked: true, coverage: null }, 360);
    expect(note?.variant).toBe('warn');
    expect(note?.text).toContain('nepodarilo zistiť');
    expect(note?.text).toContain('360');
  });

  it('vypnuté sťahovanie objednávok má vlastnú vetu', () => {
    const note = soldCoverageNote(known({ ...DVA_DNI, syncEnabled: false }), 90);
    expect(note?.variant).toBe('warn');
    expect(note?.text).toContain('vypnuté');
  });

  it('ani jeden stiahnutý deň má vlastnú vetu', () => {
    const note = soldCoverageNote(known({ ...DVA_DNI, daysCovered: 0 }), 90);
    expect(note?.variant).toBe('warn');
    expect(note?.text).toContain('ani za jeden deň');
  });

  it('plné pokrytie MLČÍ — aj keď je zmeraných dní viac než okno', () => {
    expect(soldCoverageNote(known({ ...DVA_DNI, daysCovered: 180 }), 180)).toBeNull();
    expect(soldCoverageNote(known({ ...DVA_DNI, daysCovered: 400 }), 360)).toBeNull();
  });

  it('okno o jeden deň dlhšie než pokrytie sa už priznáva', () => {
    expect(soldCoverageNote(known({ ...DVA_DNI, daysCovered: 179 }), 180)).not.toBeNull();
  });

  it('ČIASTOČNÉ dni sa za pokryté nepočítajú — inak by veta zmlkla nad dolnou hranicou', () => {
    /*
     * Nález WIRING (31. 8. 2026): server po D121 sčítava kusy VÝHRADNE z dní so
     * `status = 'complete'`, kým klient bral `daysCovered`, do ktorého sa
     * počítal aj čiastočný deň s aspoň jednou objednávkou (`isMeasuredDay`
     * v `insights.ts`). Okno 30 dní s 25 celými a 5 čiastočnými dňami tak dalo
     * `30 >= 30`, veta zmlkla a bunka vypísala dolnú hranicu ako celý počet.
     */
    const note = soldCoverageNote(known({ ...DVA_DNI, daysCovered: 30, daysPartial: 5 }), 30);
    expect(note).not.toBeNull();
    expect(note?.text).toContain('25 z 30');
  });

  it('samé čiastočné dni sú „ani jeden celý", nie „nestiahlo sa nič"', () => {
    const note = soldCoverageNote(known({ ...DVA_DNI, daysCovered: 4, daysPartial: 4 }), 30);
    expect(note?.variant).toBe('warn');
    expect(note?.text).toContain('Ani jeden deň nie je stiahnutý celý');
    expect(note?.text).toContain('rozbehnutých je 4');
  });
});

/* ═══════════ B. Čítanie odpovede — „nevieme" sa nedopočítava ══════════════ */

describe('B — čítanie hlavičky o pokrytí', () => {
  it('celá hlavička sa prečíta tak, ako prišla', () => {
    expect(
      parseSoldCoverage({
        today: '2026-08-26',
        coverage: {
          syncEnabled: true,
          daysCovered: 2,
          daysPartial: 0,
          from: '2026-08-05',
          to: '2026-08-06',
        },
      }),
    ).toEqual(DVA_DNI);
  });

  it('chýbajúci príznak sťahovania je „nevieme", nie vypnuté', () => {
    expect(parseSoldCoverage({ coverage: { daysCovered: 2 } })).toBeNull();
  });

  it('chýbajúci počet zmeraných dní je „nevieme", nie nula', () => {
    expect(parseSoldCoverage({ coverage: { syncEnabled: true } })).toBeNull();
  });

  it('chýbajúci počet ČIASTOČNÝCH dní je „nevieme", nie nula', () => {
    /*
     * Dosadená nula by znamenala „všetky zmerané dni sú prečítané celé" — a to
     * je práve tvrdenie, ktoré server po D121 nerobí (kusy sčítava len z dní
     * so `status = 'complete'`). Bez tohto by klient z dolnej hranice vyrobil
     * meranie a veta o pokrytí by pri 25 celých + 5 čiastočných dňoch zmlkla.
     */
    expect(
      parseSoldCoverage({
        coverage: { syncEnabled: true, daysCovered: 30, from: null, to: null },
      }),
    ).toBeNull();
  });

  it('odpoveď bez hlavičky je „nevieme"', () => {
    expect(parseSoldCoverage({ days: [] })).toBeNull();
    expect(parseSoldCoverage(null)).toBeNull();
  });
});

/* ═══════════ C. Vysvetlivka je na oboch obrazovkách ═══════════════════════ */

const PRODUKTY_FILTER = { ...DEFAULT_CATALOG_FILTER, soldWindowDays: 180 as const };

const NOVA_ZLAVA: NewDiscountInitial = {
  productIds: null,
  filter: { ...PRODUKTY_FILTER, soldBuckets: ['none'] },
  expectedTotal: null,
  window: null,
};

function produkty(): string {
  return renderToStaticMarkup(
    createElement(CatalogPanel, { initialFilter: PRODUKTY_FILTER }),
  );
}

function sprievodca(): string {
  return renderToStaticMarkup(createElement(NewDiscount, { initial: NOVA_ZLAVA }));
}

describe('C — Produkty a sprievodca pokrytie priznávajú', () => {
  it('tabuľka Produktov stojí pod vetou o pokrytí, nie nad ňou', () => {
    hook.state = known(DVA_DNI);
    const html = produkty();
    expect(html).toContain('data-testid="sold-coverage-note"');
    expect(html).toContain('2 z 180');
    // Vysvetlivka musí stáť NAD tabuľkou — pod ňou by ju pri 50 riadkoch
    // nikto neprečítal skôr, než výber urobí.
    expect(html.indexOf('data-testid="sold-coverage-note"')).toBeLessThan(
      html.indexOf('data-testid="select-page"'),
    );
  });

  it('pásma sprievodcu stoja pod vetou o pokrytí', () => {
    hook.state = known(DVA_DNI);
    const html = sprievodca();
    expect(html).toContain('data-testid="sold-coverage-note"');
    expect(html).toContain('2 z 180');
    expect(html.indexOf('data-testid="sold-coverage-note"')).toBeLessThan(
      html.indexOf('Pravidlo'),
    );
  });

  it('pri plnom pokrytí nie je na obrazovkách ani prázdny rám', () => {
    hook.state = known({ ...DVA_DNI, daysCovered: 180 });
    expect(produkty()).not.toContain('data-testid="sold-coverage-note"');
    expect(sprievodca()).not.toContain('data-testid="sold-coverage-note"');
  });

  it('kým odpoveď nepríde, obrazovky mlčia', () => {
    hook.state = SOLD_COVERAGE_UNASKED;
    expect(produkty()).not.toContain('data-testid="sold-coverage-note"');
    expect(sprievodca()).not.toContain('data-testid="sold-coverage-note"');
  });
});

/* ═══════════ D. Prázdny výber Novej zľavy hovorí PRAVÝ dôvod ══════════════ */

/*
 * Nález z 31. 8. 2026 (I11). Predvolený filter Novej zľavy je „0 predaných za
 * 180 dní" a vedro `none` znamená po D121 MERANÚ nulu: pri nedočítanom okne
 * server prepne bránu na `1 = 0` a nevráti ani riadok. Obrazovka z toho
 * vyrobila vetu „filtru nevyhovuje ani jeden produkt", hoci produktov je
 * 40 511 a appka o ich predaji nevie nič.
 */
describe('D — prázdny výber Novej zľavy rozlišuje „nič" od „nevieme"', () => {
  const dovod = (over: Partial<EmptySelectionReason> = {}): EmptySelectionReason => ({
    catalogEmpty: false,
    wantsMeasuredZero: true,
    coverageAdmitted: true,
    soldWindowDays: 180,
    soldUnknown: 40511,
    ...over,
  });

  it('nedočítané okno pri filtri „0 predaných" NEHOVORÍ, že filtru nevyhovuje nič', () => {
    const text = emptySelectionText(dovod());
    expect(text).not.toContain('filtru nevyhovuje ani jeden produkt');
    expect(text).toContain('ZMERANÝM predajom');
    expect(text).toContain('40 511');
  });

  it('neznámy počet neznámych sa nedomýšľa číslom, ale povie sa okno', () => {
    for (const soldUnknown of [null, 0]) {
      const text = emptySelectionText(dovod({ soldUnknown }));
      expect(text, String(soldUnknown)).toContain('180 dní');
      expect(text, String(soldUnknown)).not.toContain('0 produktov');
      expect(text, String(soldUnknown)).not.toContain('filtru nevyhovuje ani jeden produkt');
    }
  });

  it('pri PLNOM pokrytí je prázdny výber naozaj prázdny výber', () => {
    expect(emptySelectionText(dovod({ coverageAdmitted: false }))).toBe(
      'Zatiaľ nie je čo zlacniť — filtru nevyhovuje ani jeden produkt.',
    );
  });

  it('filter, ktorý meranú nulu nežiada, nemá dôvod hovoriť o pokrytí', () => {
    expect(emptySelectionText(dovod({ wantsMeasuredZero: false }))).toBe(
      'Zatiaľ nie je čo zlacniť — filtru nevyhovuje ani jeden produkt.',
    );
  });

  it('prázdne zrkadlo katalógu prebíja všetko ostatné', () => {
    expect(emptySelectionText(dovod({ catalogEmpty: true }))).toContain(
      'katalóg ešte nie je načítaný',
    );
  });
});
