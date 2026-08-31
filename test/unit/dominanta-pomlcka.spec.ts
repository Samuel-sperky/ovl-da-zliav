/**
 * Aura Zľavy — POMLČKA V DISPLEJOVOM SLOTE a jedna dominanta na obrazovku
 * (P1; kontrakt UI, bod 5; D11 z 19. 8. 2026).
 *
 * PREČO EXISTUJE TENTO SÚBOR
 * --------------------------
 * D11 nebol defekt jednej karty, ale TRIEDA defektov. Pravidlo appky znie
 * „čo appka nevie, je pomlčka, nikdy nula" a je správne — lenže em pomlčka je
 * celoštvorcová vodorovná čiara. V bežnom texte je to interpunkcia; v tučnom
 * displejovom reze prestáva byť znakom a vykreslí sa ako vyplnený obdĺžnik.
 * Karta potvrdenia novej zľavy to mala v 64 px (`.big`), bočný panel detailu
 * produktu v 44 px (`.big.sm`) — ten istý defekt, len menší. Test D11 strážil
 * iba prvé miesto, a to menom triedy, takže druhé prežilo.
 *
 * Tento súbor preto meria PRAVIDLO, nie jedno miesto:
 *
 *  A. Žiadny displejový slot (`.big`, `.big.sm`) neobsahuje samotnú pomlčku —
 *     a to sa kontroluje nad každou obrazovkou, ktorá dominantu má.
 *  B. Keď je hodnota neznáma, na jej mieste stojí ten ISTÝ tvar: pomlčka so
 *     slovom v čitateľnom stupni (`.unknown`). Dva tvary tej istej veci by sa
 *     po prvej úprave rozišli.
 *  C. Na obrazovke je presne jedna dominanta a nesie ju škála
 *     `.lvl-1/.lvl-2/.lvl-3`, nie vlastná veľkosť.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna sieť.
 * Efekty sa pritom nespúšťajú, takže komponenty vidno v ich VÝCHODZOM stave;
 * pri paneli produktu je to presne ten stav, o ktorý ide (`unitsSold` z riadku).
 *
 * Vlastník: R-B, opravná vlna 19. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NewDiscountConfirm from '@/components/campaigns/NewDiscountConfirm';
import ProductDetailPanel, { SoldDominant } from '@/components/products/ProductDetailPanel';
import { buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';
import type { CatalogRowView } from '@/components/products/catalog-api';
import { soldUnitsViaCoverage } from '@/components/products/sold-coverage';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const MODULE_CSS = read('../../src/components/campaigns/zlavy.module.css');
const GLOBAL_CSS = read('../../src/app/globals.css');

/** Em pomlčka — to, čím appka hovorí „toto nevieme". */
const DASH = '—';

/* ═══════════════════════════ vzorky ═══════════════════════════════════════ */

const ROW: CatalogRowView = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok',
  unitsSold: 12,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-19T07:00:00.000Z',
  origin: 'mirror',
};

/** Celý panel — v ňom sa dá odmerať počet dominánt a zvyšok obrazovky. */
const panel = (row: CatalogRowView = ROW): string =>
  renderToStaticMarkup(
    createElement(ProductDetailPanel, { row, soldWindowDays: 30, onClose: () => {} }),
  );

/**
 * Samotná dominanta panela. Cez celý panel sa neznáma vetva odmerať nedá:
 * `sold === null` nastane až po prepnutí okna predajnosti, teda v efekte, a
 * `renderToStaticMarkup` efekty nespúšťa. Práve preto tam defekt prežil.
 */
const dominant = (sold: number | null): string =>
  renderToStaticMarkup(
    createElement(SoldDominant, {
      /*
       * Bunku vyrába `soldUnitsViaCoverage()` — pri PLNOM pokrytí okna, aby sa
       * v tomto súbore meral rez a znak, nie priznanie medzery (to má vlastný
       * test v `produkty-kpi-bunky.spec.ts`). Bez pokrytia by nula bola
       * pomlčka a testy nižšie by merali inú vetu, než na akú boli napísané.
       */
      cell: soldUnitsViaCoverage(sold, 30, {
        asked: true,
        coverage: { syncEnabled: true, daysCovered: 30, from: '2026-07-21', to: '2026-08-19' },
      }),
      windowDays: 30,
    }),
  );

const SELECTION: SelectableRow[] = [
  { productId: 18342, name: 'Strieborné náušnice Lumen', price: '34.90', unitsSold: 0, discountedNow: false },
];

const CONFIRM_PROPS = {
  itemsCount: 8000,
  tiers: buildTiers(SELECTION, 180).tiers,
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

const confirm = (extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(createElement(NewDiscountConfirm, { ...CONFIRM_PROPS, ...extra }));

/* ═══════════════════════════ pomôcky ══════════════════════════════════════ */

/**
 * Obsah každého prvku, ktorý má v triede `big` — teda každého displejového
 * slotu na vykreslenej obrazovke. Práve tam sa pomlčka kresliť nesmie.
 */
function displaySlots(html: string): string[] {
  const found: string[] = [];
  const pattern = /<(\w+)[^>]*class="[^"]*\bbig\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;
  for (const hit of html.matchAll(pattern)) found.push(hit[2]);
  return found;
}

/** Veľkosť písma prvého pravidla daného selektora, v px. */
function fontSizeOf(css: string, selector: string): number {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  const block = css.slice(at, css.indexOf('}', at));
  const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(block);
  expect(size, selector).not.toBeNull();
  return Number(size![1]);
}

/** Koľkokrát sa reťazec v texte vyskytuje. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/* ═══════ A. Pomlčka sa nekreslí do displejového slotu — nikde ═════════════ */

describe('A — v displejovom slote nikdy nestojí samotná pomlčka (D11)', () => {
  const screens: ReadonlyArray<readonly [string, string]> = [
    ['detail produktu, predajnosť neznáma', dominant(null)],
    ['detail produktu, predajnosť známa', dominant(12)],
    ['detail produktu, nula predaných', dominant(0)],
    ['detail produktu, celý panel', panel()],
    ['nová zľava, počet neznámy', confirm({ itemsCount: 0, countKnown: false })],
    ['nová zľava, počet známy', confirm()],
    [
      'nová zľava, zaradené do fronty',
      confirm({ created: { campaignId: 4, itemsTotal: 8000, estimate: null } }),
    ],
  ];

  for (const [name, html] of screens) {
    it(`${name}: žiadny prvok s triedou \`big\` neobsahuje em pomlčku`, () => {
      for (const slot of displaySlots(html)) {
        expect(slot, name).not.toContain(DASH);
      }
    });
  }

  it('slotov je čo merať — inak by test prešiel na prázdnej množine', () => {
    expect(displaySlots(dominant(12)).length).toBeGreaterThan(0);
    expect(displaySlots(panel()).length).toBeGreaterThan(0);
    expect(displaySlots(confirm()).length).toBeGreaterThan(0);
  });
});

/* ═══════ B. Neznáma dominanta má jeden spoločný tvar ══════════════════════ */

describe('B — neznáma dominanta je pomlčka SO SLOVOM, v jednom tvare pre celú appku', () => {
  it('panel detailu produktu: pomlčka opustila 44 px rez a dostala slovo', () => {
    const html = dominant(null);
    const at = html.indexOf('data-testid="detail-units-sold"');
    expect(at).toBeGreaterThan(-1);
    const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
    expect(tag).not.toContain('big');
    expect(tag).toContain('unknown');
    expect(html).toContain(`${DASH} zatiaľ nevieme`);
  });

  it('panel detailu produktu: pomlčka nie je nula a popisok nevisí nad prázdnom', () => {
    const html = dominant(null);
    expect(html).toContain('koľko sa predalo za posledných 30 dní');
    expect(html).not.toContain('>0<');
  });

  it('nula predaných je stále nula — pomlčka nesmie prekryť nameraný fakt', () => {
    const html = dominant(0);
    expect(html).toContain('>0<');
    expect(html).not.toContain(DASH);
    expect(html).toContain('predaných za posledných 30 dní');
  });

  it('pri známom čísle je dominanta panela zase číslo v 44 px reze', () => {
    const html = dominant(12);
    const at = html.indexOf('data-testid="detail-units-sold"');
    const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
    expect(tag).toContain('big');
    expect(tag).toContain('sm');
    expect(html).toContain('predaných za posledných 30 dní');
  });

  it('obe obrazovky používajú TÚ ISTÚ triedu, nie dve podobné', () => {
    const fromPanel = /class="([^"]*unknown[^"]*)"/.exec(dominant(null));
    const fromConfirm = /class="([^"]*unknown[^"]*)"/.exec(
      confirm({ itemsCount: 0, countKnown: false }),
    );
    expect(fromPanel).not.toBeNull();
    expect(fromConfirm).not.toBeNull();
    expect(fromPanel![1]).toBe(fromConfirm![1]);
  });

  it('trieda je v CSS práve raz a je čitateľne malá, nie displejová', () => {
    expect(count(MODULE_CSS, '\n.unknown {')).toBe(1);
    const unknown = fontSizeOf(MODULE_CSS, '.unknown');
    expect(unknown).toBeLessThan(fontSizeOf(GLOBAL_CSS, '.lvl-1 .big.sm'));
    expect(unknown).toBeLessThan(fontSizeOf(GLOBAL_CSS, '.lvl-1 .big'));
  });

  it('pomlčka v bežnom texte zostáva — pravidlo „nikdy nula" sa neruší', () => {
    // Zamknuté riadky panela hovoria pomlčkou ďalej; problém bol rez, nie znak.
    expect(panel()).toContain('lockcell');
    expect(panel()).toContain(DASH);
  });
});

/* ═══════ C. Jedna dominanta na obrazovku ══════════════════════════════════ */

describe('C — každá z týchto obrazoviek má práve jednu dominantu (P1)', () => {
  it('panel detailu produktu má jednu `.lvl-1` a nesie ju dominanta', () => {
    expect(count(panel(), 'class="lvl-1"')).toBe(1);
    expect(count(dominant(null), 'class="lvl-1"')).toBe(1);
    expect(count(dominant(12), 'class="lvl-1"')).toBe(1);
  });

  it('karta rozhodnutia má jednu `.lvl-1` a nesie ju dominanta, nie poistka', () => {
    const html = confirm();
    expect(count(html, 'lvl-1')).toBe(1);
    const dominant = html.indexOf('data-testid="confirm-count"');
    const gate = html.indexOf('data-testid="confirm-count-input"');
    expect(dominant).toBeGreaterThan(-1);
    expect(dominant).toBeLessThan(gate);
  });
});
