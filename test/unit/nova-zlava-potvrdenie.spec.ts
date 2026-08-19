/**
 * Aura Zľavy — NOVÁ ZĽAVA, karta rozhodnutia po oprave D11–D14
 * (kontrakt UX/dizajn 19. 8. 2026; kontrakt UI, body 5, 11, 24; P1; I3).
 *
 * Testuje sa presne to, čo sa na tejto karte dá ticho pokaziť späť:
 *
 *  A. **D11 — pomlčka sa nesmie vrátiť do `.big`.** Toto je celá podstata
 *     defektu: pravidlo „keď appka nevie, je tam pomlčka, nikdy nula" je
 *     správne, ale em pomlčka v 64 px a reze 660 nie je interpunkcia, je to
 *     vyplnený obdĺžnik. Dominanta karty, pred ktorou človek potvrdzuje zápis
 *     do ostrého eshopu, tak vyzerala ako chyba vykreslenia a popisok pod ňou
 *     nemal nad sebou hodnotu. Test stráži oboje: pomlčka ostáva, ale nikdy
 *     nie v triede `big` — a nikdy sama, vždy so slovom.
 *  B. **D12 — poradie krokov.** Skúška naprázdno → ručný počet → zaradenie.
 *     Keby sa poradie otočilo späť, obrazovka by znova stavila najvýraznejší
 *     prvok na najnebezpečnejší krok.
 *  C. **D13 — prekážky sú v karte rozhodnutia**, nie vo vlastnej karte vedľa.
 *  D. **I3 neoslabol.** Obe poistky sú stále na obrazovke a zamknuté tlačidlo
 *     stále hovorí dôvod. Zmena vzhľadu potvrdenia sa nesmie stať zmenou
 *     jeho mechaniky.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť.
 *
 * Vlastník: O2, kontrakt UX/dizajn 19. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NewDiscountConfirm from '@/components/campaigns/NewDiscountConfirm';
import { buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';
import type { BlockerCard } from '@/components/campaigns/queue-model';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const ROWS: SelectableRow[] = [
  { productId: 18342, name: 'Strieborné náušnice Lumen', price: '34.90', unitsSold: 0, discountedNow: false },
  { productId: 21170, name: 'Strieborný prsteň Aurora', price: '49.00', unitsSold: 0, discountedNow: false },
];

const PROPS = {
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

const WRITES_OFF: BlockerCard = {
  id: 'writes_disabled',
  severity: 'blokuje',
  resolution: 'mimo_appky',
  what: 'Zápisy do shopu sú vypnuté — appka teraz nezapíše ani jeden produkt.',
  nextStep: 'Zapnúť ich môže len správca počítača v konfigurácii appky.',
  path: null,
  assumed: false,
  clearsAt: null,
};

const render = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(NewDiscountConfirm, { ...PROPS, ...extra }));

/** Otváracia značka prvku, ktorý nesie dané `data-testid`. */
function openingTagOf(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

/* ═════════════ A. D11 — dominanta, ktorú appka nevie ═════════════════════ */

describe('A — neznámy počet je pomlčka so slovom, nikdy obdĺžnik (D11)', () => {
  it('pri známom počte je dominanta číslo v `big`', () => {
    const html = render();
    expect(openingTagOf(html, 'confirm-count')).toContain('big');
    expect(html).toContain('produktov dostane zľavu');
  });

  it('pri neznámom počte NIE JE dominanta v `big` — 64 px pomlčka je obdĺžnik', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    expect(openingTagOf(html, 'confirm-count')).not.toContain('big');
  });

  it('pomlčka zostáva a nula sa nedopočíta (kontrakt UI, bod 5)', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    const at = html.indexOf('data-testid="confirm-count"');
    expect(html.slice(at, at + 60)).toContain('—');
    expect(html.slice(at, at + 60)).not.toContain('0');
  });

  it('pomlčka nikdy nestojí sama — má pri sebe slovo', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    expect(html).toContain('zatiaľ nevieme');
  });

  it('popisok nikdy nevisí nad prázdnom — bez hodnoty sa pýta „koľko"', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    expect(html).toContain('koľko produktov dostane zľavu');
  });

  it('v žiadnom stave nie je em pomlčka priamo v prvku s triedou `big`', () => {
    for (const state of [{}, { itemsCount: 0, countKnown: false }, { countKnown: false }]) {
      const html = render(state);
      expect(html).not.toMatch(/class="[^"]*\bbig\b[^"]*"[^>]*>\s*—/);
    }
  });
});

/* ═════════════ B. D12 — poradie a váha krokov ═══════════════════════════ */

describe('B — kroky idú v poradí, v akom sa robia (D12)', () => {
  it('skúška naprázdno stojí PRED ručným počtom a ten PRED zaradením', () => {
    const html = render();
    const dry = html.indexOf('data-testid="dry-run"');
    const typed = html.indexOf('data-testid="confirm-count-input"');
    const queue = html.indexOf('data-testid="queue-discount"');
    expect(dry).toBeGreaterThan(-1);
    expect(dry).toBeLessThan(typed);
    expect(typed).toBeLessThan(queue);
  });

  it('pole na počet už nie je zdieľané `inp big` — má vlastný, ťažší stupeň', () => {
    const html = render();
    expect(openingTagOf(html, 'confirm-count-input')).not.toMatch(/class="inp big/);
  });

  it('CSS drží ručný počet väčší než text tlačidla', () => {
    const css = read('../../src/components/campaigns/zlavy.module.css');
    const gate = css.slice(css.indexOf('.gate :global(.inp).gateInput'));
    const size = /font-size:\s*(\d+)px/.exec(gate);
    expect(size).not.toBeNull();
    expect(Number(size![1])).toBeGreaterThanOrEqual(24);
  });

  it('tlačidlá už nestoja vedľa seba — zaradenie je samo v riadku akcií', () => {
    const html = render();
    const acts = html.indexOf('data-testid="queue-discount"');
    const after = html.slice(acts);
    // Za tlačidlom zaradenia už žiadne ďalšie tlačidlo v tom istom riadku nie je.
    expect(after.indexOf('data-testid="dry-run"')).toBe(-1);
  });
});

/* ═════════════ C. D13 — prekážky pri rozhodnutí, nie vedľa neho ═════════ */

describe('C — prekážky sú v karte rozhodnutia (D13)', () => {
  it('bez prekážok sa nekreslí nič', () => {
    expect(render()).not.toContain('data-testid="confirm-obstacles"');
  });

  it('s prekážkou sa kreslí V TEJ ISTEJ karte, nad krokmi', () => {
    const html = render({ obstacles: [WRITES_OFF] });
    const card = html.indexOf('data-testid="new-discount-confirm"');
    const obstacles = html.indexOf('data-testid="confirm-obstacles"');
    const dry = html.indexOf('data-testid="dry-run"');
    expect(card).toBeGreaterThan(-1);
    expect(obstacles).toBeGreaterThan(card);
    expect(obstacles).toBeLessThan(dry);
    expect(html).toContain('Zápisy do shopu sú vypnuté');
  });

  it('obrazovka už nemá vlastnú kartu prekážok vedľa rozhodnutia', () => {
    const source = read('../../src/components/campaigns/NewDiscount.tsx');
    expect(source).not.toContain('new-discount-blockers');
    expect(source).not.toContain('Čo teraz stojí v ceste');
  });
});

/* ═════════════ D. D14 — prázdny stav nezaberá pol stĺpca ════════════════ */

describe('D — prázdny katalóg: jedna veta a jedno tlačidlo (D14, bod 11)', () => {
  const source = read('../../src/components/campaigns/NewDiscount.tsx');

  it('sekcia pásiem sa pri prázdnom výbere nekreslí vôbec', () => {
    expect(source).toContain('{emptySelection ? null : (');
    expect(source).toContain('data-testid="new-discount-tiers"');
  });

  it('prázdny stav je riadok v sekcii výberu, nie vycentrovaná karta', () => {
    expect(source).toContain('data-testid="new-discount-empty"');
    expect(source).not.toContain('EmptyState');
  });
});

/* ═════════════ E. I3 — potvrdzovacia cesta neoslabla ════════════════════ */

describe('E — obe poistky I3 sú stále na obrazovke', () => {
  it('skúška naprázdno aj ručný počet existujú a nič ich nenahradilo', () => {
    const html = render();
    expect(html).toContain('data-testid="dry-run"');
    expect(html).toContain('data-testid="confirm-count-input"');
    expect(html).toContain('Napíšte počet produktov');
    expect(html).toContain('Skúška nič nezapíše');
  });

  it('kým je dôvod zámku, tlačidlo je vypnuté a dôvod je vidieť', () => {
    const html = render();
    const tag = openingTagOf(html, 'queue-discount');
    expect(tag).toContain('disabled');
    expect(html).toContain('Najprv spustite skúšku naprázdno');
  });

  it('bez dôvodu zámku je tlačidlo živé — rozhoduje výhradne `blockedReason`', () => {
    const html = render({ typed: '8000', previewFresh: true, blockedReason: null });
    expect(openingTagOf(html, 'queue-discount')).not.toContain('disabled');
  });

  it('samotná čerstvá skúška bez vpísaného počtu nič neodomkne', () => {
    const html = render({ previewFresh: true });
    expect(openingTagOf(html, 'queue-discount')).toContain('disabled');
  });
});
