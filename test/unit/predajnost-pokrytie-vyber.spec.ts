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

import NewDiscount, { type NewDiscountInitial } from '@/components/campaigns/NewDiscount';
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
});

/* ═══════════ B. Čítanie odpovede — „nevieme" sa nedopočítava ══════════════ */

describe('B — čítanie hlavičky o pokrytí', () => {
  it('celá hlavička sa prečíta tak, ako prišla', () => {
    expect(
      parseSoldCoverage({
        today: '2026-08-26',
        coverage: { syncEnabled: true, daysCovered: 2, from: '2026-08-05', to: '2026-08-06' },
      }),
    ).toEqual(DVA_DNI);
  });

  it('chýbajúci príznak sťahovania je „nevieme", nie vypnuté', () => {
    expect(parseSoldCoverage({ coverage: { daysCovered: 2 } })).toBeNull();
  });

  it('chýbajúci počet zmeraných dní je „nevieme", nie nula', () => {
    expect(parseSoldCoverage({ coverage: { syncEnabled: true } })).toBeNull();
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
