/**
 * Aura Zľavy — DETAIL ZĽAVY po oprave D15–D18
 * (kontrakt UX/dizajn 19. 8. 2026; kontrakt UI, body 5, 22; P1, P7, P8).
 *
 * Čo sa tu dá ticho pokaziť späť:
 *
 *  A. **D15 — dominanta a dlaždice sú jeden útvar.** Štyri dlaždice fronty
 *     ZOSTÁVAJÚ (kontrakt UI, bod 22): „nevieme, či sa zapísalo" je vlastný
 *     stav a zliať ho so „nepodarilo sa" by bolo klamstvo. Duplicitu preto
 *     odstránila druhá strana — zmizla veta, ktorá tie isté štyri čísla
 *     hovorila ešte raz slovami, aj tretí výskyt čakajúcich. Pruh pod
 *     dominantou je rozdelený na tie isté štyri stavy, takže dlaždice sú jeho
 *     legendou, nie druhým zoznamom.
 *  B. **D16 — jeden zoznam dôvodov, nie dve červené škatule.**
 *  C. **D17 — „Výkon výberu" nie sú tri karty, ktoré všetky hlásia, že dáta
 *     nie sú.** Zamknuté uhly sú dva tiché riadky a stále povedia dôvod (K8).
 *  D. **D18 — popisok tretieho uhla je po slovensky.**
 *
 * Detail zľavy je klientský komponent, ktorý čísla ťahá až v efekte, takže
 * body A a B sa merajú nad zdrojom a nad geometriou — presne tak, ako to robia
 * `typografia.spec.ts` a `paleta.spec.ts`. Sekcia výkonu sa renderuje naozaj.
 *
 * Vlastník: O2, kontrakt UX/dizajn 19. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import DiscountPerformance from '@/components/campaigns/DiscountPerformance';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const DETAIL = read('../../src/components/campaigns/DiscountDetail.tsx');
/** Len to, čo sa naozaj vykreslí — hlavičky súborov o defektoch smú hovoriť. */
const DETAIL_JSX = DETAIL.slice(DETAIL.indexOf('data-testid="discount-detail"'));
const CSS = read('../../src/components/campaigns/zlavy.module.css');
/*
 * Rám dôvodov sa 19. 8. 2026 presťahoval z DiscountDetail.tsx do
 * BlockerList.tsx ako `StandPanel`, pretože tú istú chybu (dva poplachy
 * namiesto jedného rámu) mal aj zoznam zliav a riešiť ju dvakrát znamená
 * rozísť sa. Tvrdenia D16 preto platia o paneli, nie o detaile — detail už
 * len overuje, že ho použil práve raz.
 */
const PANEL = read('../../src/components/campaigns/BlockerList.tsx');

/** Koľkokrát sa reťazec v texte vyskytuje. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/* ═════════════ A. D15 — dominanta sa neopakuje v dlaždiciach ════════════ */

describe('A — štyri dlaždice zostávajú, duplicita zmizla inde (D15, bod 22)', () => {
  it('všetky štyri stavy fronty majú vlastnú dlaždicu', () => {
    for (const tile of ['tile-ok', 'tile-pending', 'tile-failed', 'tile-uncertain']) {
      expect(DETAIL).toContain(`testId="${tile}"`);
    }
  });

  it('„nevieme, či sa zapísalo" ostáva vlastným stavom, nezliatym so zlyhaním', () => {
    expect(DETAIL).toContain('Nevieme, či sa zapísalo');
    expect(DETAIL).toContain('Nepodarilo sa');
    expect(DETAIL).toContain('zápis odišiel, odpoveď nedorazila');
  });

  it('veta, ktorá tie isté čísla hovorila ešte raz slovami, je preč', () => {
    expect(DETAIL_JSX).not.toContain('sa nepodarilo`');
    expect(DETAIL_JSX).not.toContain('nevieme, či sa zapísalo`');
    expect(DETAIL_JSX).not.toContain('ostáva zapísať');
  });

  it('pruh priebehu je rozdelený na tie isté štyri stavy ako dlaždice', () => {
    for (const state of ['ok', 'uncertain', 'failed', 'pending']) {
      expect(DETAIL).toContain(`data-state="${state}"`);
      expect(CSS).toContain(`.queueBar i[data-state='${state}']`);
    }
  });

  it('úseky pruhu berú farbu VÝHRADNE zo stavovej škály, nikdy z akcentu', () => {
    const bar = CSS.slice(CSS.indexOf('.queueBar {'), CSS.indexOf('.queueTiles {'));
    expect(bar).toContain('var(--st-good)');
    expect(bar).toContain('var(--st-attention)');
    expect(bar).toContain('var(--st-critical)');
    expect(bar).toContain('var(--st-progress)');
    expect(bar).not.toContain('var(--accent)');
  });

  it('stav nesie farbu, glyf aj slovo — glyf je zo spoločnej škály', () => {
    expect(DETAIL).toContain("import { TONE_GLYPH } from '@/components/ui/ToneBadge'");
    expect(DETAIL).toContain('${TONE_GLYPH.good} Zapísané');
    expect(DETAIL).toContain('${TONE_GLYPH.critical} Nepodarilo sa');
  });

  it('prúžok farby dostane len dlaždica s nenulovým číslom — nula nie je poplach', () => {
    expect(DETAIL).toContain('anyOf(campaign.itemsFailed)');
    expect(CSS).toContain(".queueTile[data-any='ano'][data-state='failed']");
  });
});

/* ═════════════ B. D16 — jeden zoznam dôvodov ════════════════════════════ */

describe('B — dôvody stoja v jednom ráme (D16)', () => {
  it('detail kreslí rám dôvodov práve raz', () => {
    expect(count(DETAIL_JSX, '<StandPanel')).toBe(1);
    // Po presune do StandPanelu je z atribútu prop; panel ho na
    // `data-testid` premení sám (overené nižšie).
    expect(count(DETAIL_JSX, 'testId="detail-blockers"')).toBe(1);
    expect(PANEL).toContain('data-testid={testId}');
  });

  it('rám má jediný nadpis a nesie oba druhy dôvodov naraz', () => {
    expect(count(PANEL, 'Prečo sa teraz nezapisuje')).toBe(1);
    // Starý druhý nadpis nesmie prežiť ani v paneli, ani v detaile.
    expect(PANEL).not.toContain('Čo bráni zápisu');
    expect(DETAIL_JSX).not.toContain('Čo bráni zápisu');
  });

  it('dôvod behu appky je riadok v tej istej skupine, nie vyplnená škatuľa', () => {
    const group = PANEL.slice(PANEL.indexOf('export function StandPanel'));
    expect(group).toContain('testId="detail-stand"');
    expect(group).toContain('<StandRow');
    // `variant` je prop vyplneného `Note` — ten sa sem už nesmie vrátiť.
    expect(PANEL).not.toContain('variant=');
  });

  it('aj tento riadok má vedľa farby glyf', () => {
    expect(PANEL).toContain('{TONE_GLYPH[stand.tone]}');
  });

  it('prázdny rám sa nekreslí — bol by tvrdením, že niečo stojí', () => {
    expect(PANEL).toContain('if (stand === null && cards.length === 0) return null;');
  });
});

/* ═════════════ C + D. D17, D18 — Výkon výberu ═══════════════════════════ */

describe('C — výkon výberu nie sú tri karty s tou istou správou (D17)', () => {
  const markup = renderToStaticMarkup(createElement(DiscountPerformance, { id: 7 }));

  it('zamknuté uhly sú riadky, nie karty v mriežke', () => {
    expect(CSS).not.toContain('.perfGrid');
    expect(CSS).not.toContain('.perfPanel');
    expect(markup).toContain('data-testid="performance-locked"');
  });

  it('čísla, ktoré appka má, už nemajú vlastný nadpis nad nadpisom sekcie', () => {
    expect(markup).toContain('Výkon výberu');
    expect(markup).toContain('data-testid="performance-units"');
    expect(markup).not.toContain('Pred zľavou a teraz');
  });

  it('zamknutý uhol naďalej povie dôvod — nie je skrytý (K8)', () => {
    expect(markup).toContain('Tržby');
    expect(markup).toContain('Tržby v eurách shop cez API nevracia.');
    expect(markup).toContain('Predaje zatiaľ rok dozadu nesiahajú.');
  });

  it('appka nikde nepredstiera eurá ani záver o príčine (K8, P8)', () => {
    expect(markup).not.toContain('€');
    for (const veta of ['priniesla', 'vďaka zľave', 'spôsobil', 'nárast o']) {
      expect(markup).not.toContain(veta);
    }
  });
});

describe('D — popisok tretieho uhla je po slovensky (D18)', () => {
  const markup = renderToStaticMarkup(createElement(DiscountPerformance, { id: 7 }));

  it('príslovka už nie je nalepená na podstatné meno', () => {
    expect(markup).toContain('Rovnaké obdobie vlani');
    expect(markup).not.toContain('Vlani rovnaké obdobie');
  });
});
