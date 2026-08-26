/**
 * Aura Zľavy — PANEL DETAILU: ESCAPE A FOKUS (nález P5, 26. 8. 2026).
 *
 * @vitest-environment jsdom
 *
 * PREČO TENTO SÚBOR EXISTUJE A PREČO MÁ VLASTNÉ PROSTREDIE
 * ────────────────────────────────────────────────────────
 * Zvyšok projektu meria obrazovky `renderToStaticMarkup` — bez prehliadača,
 * bez DOM-u. Na markup to stačí, na KLÁVESU nie: statický render nemá
 * `document.activeElement`, nedoručí `keydown` a nespustí ani jeden efekt.
 * A práve tie tri veci sú celý defekt, ktorý sa tu opravoval:
 *
 *  · panel je v DOM ZA celou tabuľkou (`.catalog-split` má tabuľku a panel ako
 *    súrodencov v tomto poradí), takže kto ho otvorí z prvého riadku, má pri
 *    päťdesiatich riadkoch na stránku k jeho obsahu vyše sto tabulátorov;
 *  · Escape nezatváral nič — z panela sa klávesnicou nedalo vyjsť inak než
 *    pretabulovaním zvyšku stránky;
 *  · po zavretí fokus spadol na `document.body`, teda človek začínal od
 *    hlavičky stránky a svoj riadok medzi päťdesiatimi hľadal odznova.
 *
 * Je to jediný súbor v projekte s prostredím `jsdom` a je to zámerne jeden
 * súbor: `vitest.config.ts` zostáva `environment: 'node'` pre všetkých
 * ostatných 117 testov, ktoré DOM nechcú ani nepotrebujú.
 *
 * ČO ANI TENTO SÚBOR NEZMERÁ
 * ──────────────────────────
 * jsdom nepočíta rozloženie, takže poradie tabulátora sa tu skutočne
 * PREJSŤ nedá (`offsetParent` je vždy `null`, `Tab` nemá vlastnú obsluhu).
 * Meria sa teda to, čo je merateľné a čo bolo pokazené: kam ide fokus pri
 * otvorení, čo urobí Escape a kam sa fokus vráti po zavretí.
 *
 * Vlastník: P5.
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProductDetailPanel, {
  detailPanelKeyAction,
} from '@/components/products/ProductDetailPanel';

const ROW = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok' as const,
  unitsSold: 4,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  origin: 'mirror' as const,
};

const INY_ROW = { ...ROW, productId: 19001, name: 'Oceľový prívesok s perleťovým vzorom' };

let container: HTMLElement;
let root: Root;
/** `fetch`, ktorý nikdy nedobehne — efekty panela tak nemajú čo prekresliť. */
let fetchStub: ReturnType<typeof vi.fn>;
const povodnyFetch = globalThis.fetch;

beforeEach(() => {
  // React 19 chce vedieť, že sme v `act` prostredí, inak varuje pri každom
  // prekreslení. Príznak žije na `globalThis`, nie v type — odtiaľ `as`.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  // Panel si pri otvorení doťahuje varianty, zápisy a predané kusy. Sieť
  // v teste neexistuje: prísľub, ktorý nikdy nedobehne, nechá panel presne
  // v stave „zatiaľ nenačítané", teda v tom, ktorý sa aj tak kreslí prvý.
  fetchStub = vi.fn(() => new Promise<Response>(() => {}));
  globalThis.fetch = fetchStub as unknown as typeof globalThis.fetch;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = povodnyFetch;
  vi.restoreAllMocks();
});

/**
 * Obrazovka v malom: tlačidlo, z ktorého sa panel otvára (v tabuľke je to
 * tlačidlo názvu riadku), a panel. Poradie je to isté ako v `CatalogPanel` —
 * panel stojí ZA otváračom.
 */
function Harness({
  open,
  row = ROW,
  onClose,
}: {
  open: boolean;
  row?: typeof ROW;
  onClose: () => void;
}): ReactNode {
  return createElement(
    'div',
    null,
    createElement('button', { type: 'button', id: 'otvarac' }, row.name),
    open
      ? createElement(ProductDetailPanel, { row, soldWindowDays: 30, onClose })
      : null,
  );
}

const otvarac = () => container.querySelector<HTMLButtonElement>('#otvarac');
const panel = () => container.querySelector<HTMLElement>('[data-testid="product-detail"]');

/** Skutočný `keydown`, nie zavolaný prop — React ho zachytí na koreni. */
function stlac(ciel: HTMLElement, key: string, options: KeyboardEventInit = {}): void {
  act(() => {
    ciel.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  });
}

/* ═══════════ A. Rozhodnutie o klávese ako čistá funkcia ═══════════════════ */

describe('A — čo panel s klávesou urobí', () => {
  it('Escape zatvára', () => {
    expect(detailPanelKeyAction('Escape', false)).toBe('close');
  });

  it('Escape, ktorý si už spracoval vnorený dialóg, panel nechytá', () => {
    // Sudo prompt nad panelom si Escape zoberie sám; keby ho panel bral ako
    // druhý, zatvoril by sa pod otvoreným dialógom.
    expect(detailPanelKeyAction('Escape', true)).toBe('ignore');
  });

  it('iné klávesy panel nezatvárajú', () => {
    for (const key of ['Enter', ' ', 'Tab', 'Backspace', 'ArrowLeft', 'e']) {
      expect(detailPanelKeyAction(key, false), key).toBe('ignore');
    }
  });
});

/* ═══════════ B. Fokus pri otvorení ═══════════════════════════════════════ */

describe('B — otvorenie presunie fokus do panela', () => {
  it('po otvorení je fokus v paneli, nie na otváracom tlačidle', () => {
    act(() => root.render(createElement(Harness, { open: false, onClose: () => {} })));
    otvarac()?.focus();
    expect(document.activeElement).toBe(otvarac());

    act(() => root.render(createElement(Harness, { open: true, onClose: () => {} })));
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(panel());
  });

  it('panel sám v poradí tabulátora nie je — fokus doň ide programovo', () => {
    act(() => root.render(createElement(Harness, { open: true, onClose: () => {} })));
    expect(panel()?.getAttribute('tabindex')).toBe('-1');
  });

  it('prepnutie na iný riadok presunie fokus znova — obsah je o inom kuse', () => {
    act(() => root.render(createElement(Harness, { open: true, onClose: () => {} })));
    // Fokus schválne odvedieme inam, aby sa dalo rozlíšiť „nikdy sa nepohol"
    // od „pohol sa aj pri prepnutí".
    otvarac()?.focus();
    expect(document.activeElement).toBe(otvarac());

    act(() =>
      root.render(createElement(Harness, { open: true, row: INY_ROW, onClose: () => {} })),
    );
    expect(document.activeElement).toBe(panel());
  });
});

/* ═══════════ C. Escape v skutočnom DOM-e ═════════════════════════════════ */

describe('C — z panela sa dá vyjsť klávesnicou', () => {
  it('Escape v paneli zavolá zavretie', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Harness, { open: true, onClose })));
    const p = panel();
    expect(p).not.toBeNull();

    stlac(p!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape z vnútra panela funguje aj z hlbšie vnoreného prvku', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Harness, { open: true, onClose })));
    const zavriet = container.querySelector<HTMLElement>('button.close');
    expect(zavriet, 'tlačidlo zavretia panela').not.toBeNull();

    stlac(zavriet!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape MIMO panela panel nezatvára — panel nie je modálny', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Harness, { open: true, onClose })));

    stlac(otvarac()!, 'Escape');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Enter ani Tab panel nezatvárajú', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Harness, { open: true, onClose })));
    const p = panel();

    stlac(p!, 'Enter');
    stlac(p!, 'Tab');
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* ═══════════ D. Fokus po zavretí ═════════════════════════════════════════ */

describe('D — zavretie vráti fokus tam, odkiaľ sa panel otvoril', () => {
  it('po zavretí je fokus späť na otváracom tlačidle, nie na `body`', () => {
    act(() => root.render(createElement(Harness, { open: false, onClose: () => {} })));
    otvarac()?.focus();
    act(() => root.render(createElement(Harness, { open: true, onClose: () => {} })));
    expect(document.activeElement).toBe(panel());

    act(() => root.render(createElement(Harness, { open: false, onClose: () => {} })));
    expect(document.activeElement).toBe(otvarac());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('otvárač, ktorý medzitým z obrazovky zmizol, sa preskočí bez výnimky', () => {
    act(() => root.render(createElement(Harness, { open: false, onClose: () => {} })));
    otvarac()?.focus();
    act(() => root.render(createElement(Harness, { open: true, onClose: () => {} })));

    // Prelistovanie stránky alebo iný filter otvárací riadok odmontuje.
    // Panel sa vtedy nesmie pokúšať fokusovať niečo, čo v dokumente nie je.
    expect(() => act(() => root.render(createElement('div', null)))).not.toThrow();
  });
});
