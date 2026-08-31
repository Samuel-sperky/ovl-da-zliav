/**
 * Aura Zľavy — TAB ZĽAVY: MAJSTER/DETAIL A ODKAZ NA ZAMKNUTÉ (K1, kontrakt
 * bod 18; šprint 20 vlna 3, pracovník C3).
 *
 * Dve zmeny z vlny 3, obe s tichým spôsobom, ako sa dajú pokaziť:
 *
 *  A. **Zoznam a detail sú JEDEN pohľad, ale adresa zostáva zdrojom pravdy.**
 *     Keby výber prešiel do stavu komponentu, priamy odkaz na `/zlavy/[id]`,
 *     obnovenie stránky aj tlačidlo Späť by prestali fungovať — a nič by
 *     nespadlo, len by sa otvárala prázdna obrazovka. Preto sa tu testuje
 *     preklad ADRESY na výber a to, že pravý stĺpec nikdy nekreslí dve
 *     dominanty naraz.
 *
 *  B. **„Dopad na maržu — zamknuté" na dvoch miestach ODKAZUJE, nevysvetľuje.**
 *     Vysvetlenie žije výhradne v `settings/LockedFeatures.tsx`. Druhý výklad
 *     tých istých chýbajúcich dát by sa raz rozišiel s prvým, a používateľ by
 *     nevedel, ktorý platí.
 *
 * Vlastník: vlna 3, šprint 20.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `workspace.tsx` je klientský komponent a importuje `next/navigation`.
// Testuje sa z neho čistá funkcia, takže hook stačí nahradiť atrapou.
vi.mock('next/navigation', () => ({ usePathname: () => '/zlavy' }));

const { selectedIdFromPath } = await import('@/app/zlavy/(prehlad)/workspace');
const { default: DiscountsList } = await import('@/components/campaigns/DiscountsList');
const { default: NewDiscountConfirm } = await import(
  '@/components/campaigns/NewDiscountConfirm'
);
const { buildTiers } = await import('@/components/campaigns/discounts-model');
const { hrefForAnchor } = await import('@/components/settings/sub-pages');

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* ═════════ A. Adresa je jediný zdroj pravdy o tom, čo je otvorené ════════ */

describe('A — výber sa číta z adresy, nie zo stavu', () => {
  it('`/zlavy/[id]` sa preloží na číslo, `/zlavy` na nič', () => {
    expect(selectedIdFromPath('/zlavy/12')).toBe(12);
    expect(selectedIdFromPath('/zlavy')).toBeNull();
  });

  it('sprievodca novou zľavou nie je zľava — `/zlavy/nova` nevyberá riadok', () => {
    // Keby sa `nova` prečítala ako id, rebrík by podčiarkol náhodný riadok
    // a shell by sa pokúsil otvoriť detail neexistujúcej zľavy.
    expect(selectedIdFromPath('/zlavy/nova')).toBeNull();
  });

  it('nezmyselné id neotvorí nič — hádať sa nesmie (P7)', () => {
    for (const path of ['/zlavy/0', '/zlavy/-3', '/zlavy/1.5', '/zlavy/12/polozky', '/produkty']) {
      expect(selectedIdFromPath(path), path).toBeNull();
    }
  });
});

/* ═════════ B. Jedna dominanta, aj keď sú na obrazovke dva stĺpce (P1) ════ */

describe('B — pravý stĺpec nesie práve jednu vec', () => {
  it('pri otvorenej zľave kreslí detail z trasy a NIE kartu na čele', () => {
    const html = renderToStaticMarkup(
      createElement(DiscountsList, {
        selectedId: 7,
        detail: createElement('div', { 'data-testid': 'detail-slot' }),
      }),
    );
    expect(html).toContain('data-testid="detail-slot"');
    // Karta na čele má vlastnú `.lvl-1` — vedľa dominanty detailu by to boli
    // dve dominanty na jednej obrazovke.
    expect(html).not.toContain('data-testid="discounts-leading"');
  });

  it('bez otvorenej zľavy sa slot detailu nekreslí vôbec', () => {
    const html = renderToStaticMarkup(
      createElement(DiscountsList, {
        selectedId: null,
        detail: createElement('div', { 'data-testid': 'detail-slot' }),
      }),
    );
    expect(html).not.toContain('data-testid="detail-slot"');
  });

  it('rebrík aj bez dát prizná, že ešte načítava (P7)', () => {
    const html = renderToStaticMarkup(createElement(DiscountsList, { selectedId: 7 }));
    expect(html).toContain('Načítavam zľavy');
    expect(html).not.toContain('Zatiaľ tu nie je ani jedna zľava');
  });

  it('rám dôvodov nestojí vedľa detailu dvakrát (D16)', () => {
    // Panel stojacej fronty patrí pri otvorenej zľave detailu; shell ho vtedy
    // nekreslí. Bez dát sa nekreslí ani tak — stráži sa tvar podmienky.
    const shell = read('../../src/components/campaigns/DiscountsList.tsx');
    expect(shell).toContain('selectedId === null &&');
  });
});

/* ═════════ C. Zamknuté sa vysvetľuje na jedinom mieste (kontrakt 18) ═════ */

const LOCKED_HREF = hrefForAnchor('#zamknute');

const ROWS = [
  { productId: 1, name: 'Strieborná retiazka', price: '39.00', unitsSold: 0, discountedNow: false },
  { productId: 2, name: 'Zlatý prsteň', price: '129.00', unitsSold: 2, discountedNow: false },
];

const CONFIRM_PROPS = {
  itemsCount: 2,
  tiers: buildTiers(ROWS, 20).tiers,
  averagePrice: 84,
  typed: '',
  onTyped: () => {},
  previewFresh: false,
  preview: null,
  previewAt: null,
  busy: 'idle' as const,
  blockedReason: null,
  error: null,
  created: null,
  onPreview: () => {},
  onQueue: () => {},
};

describe('C — „Dopad na maržu — zamknuté" odkazuje, nevysvetľuje', () => {
  it('kotva vedie na sekciu, ktorá to naozaj vysvetľuje', () => {
    expect(LOCKED_HREF).toBe('/nastavenia/historia#zamknute');
  });

  it('potvrdenie novej zľavy nesie odkaz, nie výklad', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountConfirm, CONFIRM_PROPS));
    expect(html).toContain('Dopad na maržu');
    expect(html).toContain(`href="${LOCKED_HREF}"`);
    // Výklad o nákupných cenách má jediné miesto a toto ním nie je.
    expect(html).not.toContain('nákupné ceny');
    expect(html).not.toContain('nákupných cien');
  });

  it('detail zľavy odkazuje na to isté miesto tým istým slovom', () => {
    // Blok je za načítaním dát, takže sa meria nad zdrojom — inak by test
    // tvrdil niečo o obrazovke, ktorú nikdy nevidel.
    const detail = read('../../src/components/campaigns/DiscountDetail.tsx');
    expect(detail).toContain("hrefForAnchor('#zamknute')");
    expect(detail).toMatch(/className="lockwhy"[\s\S]{0,80}prečo\s*<\/Link>/);
    expect(detail).not.toContain('nákupné ceny');
  });

  it('odkaz je jedno slovo — dva výklady toho istého sa raz rozídu', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountConfirm, CONFIRM_PROPS));
    const inner = /class="lockwhy"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(inner.trim()).toBe('prečo');
  });
});
