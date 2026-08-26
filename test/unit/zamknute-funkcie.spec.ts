/**
 * Aura Zľavy — ZAMKNUTÉ FUNKCIE: DÔVOD ZÁMKU (nález P3 auditu 30, 26. 8. 2026).
 *
 * Čo tento súbor drží opravené. Sekcia „Zamknuté funkcie" tvrdila, že eshop
 * nevracia kategóriu, kov, typ šperku, nákupné ceny ani sklad nevariantných
 * produktov — a klipboardové tlačidlo ten text posielalo správcovi shopu. Eshop
 * ich vracia od 13. 8. (`docs/58-CO-VIEME-TAHAT-Z-API.md` §2). Chýba
 * OPRÁVNENIE `product:read`. Zámok je správny (K8), nepravdivý bol DÔVOD, a
 * príjemca tej správy je presne ten človek, ktorý údaje už dodal.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  A. **Meria sa vykreslený výstup a návratová hodnota, nie zdrojový text.**
 *     Hľadanie reťazca v `.tsx` by prešlo aj vtedy, keby sa veta nekreslila
 *     nikde — tento projekt na tom pohorel trikrát.
 *  B. **Tri stavy, nikdy dva.** `null`/`undefined` z `/api/key` znamená
 *     NEVIEME. Fail-closed: nevieme = zamknuté, a nikdy nie „kľúč to nemá"
 *     (poslať človeka pýtať si oprávnenie, ktoré kľúč má, je vlastná škoda).
 *  C. **Oprávnenie samo filtre NEODOMKNE.** Zrkadlo katalógu na tie údaje nemá
 *     stĺpce; zhasnú až vyradením z `LOCKED_FILTERS` v `catalog.repo.ts`. Stav
 *     `available` teda smie zmeniť DÔVOD, nikdy nie zámok.
 *  D. **Strop P2 platí vo všetkých troch stavoch** — 90 znakov na blok povrchu.
 *
 * Odomknutie sa NEDÁ overiť naživo (naša adresa je v shope zablokovaná od
 * 19. 8.), takže tento test je jediný dôkaz, ktorý o troch stavoch máme.
 *
 * Vykresľuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna databáza,
 * žiadna sieť.
 *
 * Vlastník: POUŽITEĽNOSŤ (audit 30).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import LockedFeatures, {
  LOCKED_FEATURES,
  lockedCause,
  lockedFeaturesText,
  productReadState,
} from '@/components/settings/LockedFeatures';
import type { ShopCapabilityState } from '@/lib/catalog/product-codes';

/** Strop P2 — `design/v3/ARCHITEKTURA.md`, riadok P2. */
const P2_LIMIT = 90;

const STATES: readonly ShopCapabilityState[] = ['unknown', 'locked', 'available'];

/** Hodnota `productRead`, ktorá do daného stavu vedie. */
const PRODUCT_READ: Readonly<Record<ShopCapabilityState, boolean | null>> = {
  unknown: null,
  locked: false,
  available: true,
};

function decode(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Texty blokových uzlov povrchu. Sekcia žiadny rozklik nemá (kontrakt bod 18). */
function surfaceBlocks(markup: string): readonly string[] {
  return markup
    .replace(/<svg\b[\s\S]*?<\/svg>/g, ' ')
    .split(/<[^>]+>/)
    .map((s) => decode(s).replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/** Sekcia tak, ako ju vidí používateľ. `undefined` = obrazovka prop neposlala. */
function surface(productRead?: boolean | null): string {
  const markup =
    productRead === undefined
      ? renderToStaticMarkup(createElement(LockedFeatures))
      : renderToStaticMarkup(createElement(LockedFeatures, { productRead }));
  return surfaceBlocks(markup).join(' ');
}

/* ══════════ 1. Tri stavy jednej hodnoty — a fail-closed ═══════════════════ */

describe('`product:read` má tri stavy, nikdy dva', () => {
  it('nevieme sa nikdy nestane „má" ani „nemá"', () => {
    expect(productReadState(null)).toBe('unknown');
    expect(productReadState(undefined)).toBe('unknown');
    expect(productReadState(false)).toBe('locked');
    expect(productReadState(true)).toBe('available');
  });

  it('každý stav má vlastnú vetu — zliať ich znamená stratiť rozdiel', () => {
    const vety = new Set(STATES.map((state) => lockedCause(state)));
    expect(vety.size).toBe(STATES.length);
  });

  it('obrazovka, ktorá kľúč nesťahuje, drží sekciu zamknutú (fail-closed)', () => {
    const bezPropu = surface();
    for (const row of LOCKED_FEATURES) expect(bezPropu).toContain(row.feature);
    // Dva fakty, nie celá veta: menuje sa oprávnenie a priznáva sa neistota.
    expect(bezPropu).toContain('product:read');
    expect(bezPropu).toMatch(/nevieme/i);
    expect(bezPropu).toBe(surface(null));
  });
});

/* ══════════ 2. Dôvod zámku nie je eshop (P3) ══════════════════════════════ */

describe('dôvodom je oprávnenie, nie rozhranie eshopu', () => {
  /** Presne to obvinenie, ktoré tu stálo do 26. 8. */
  const OBVINENIE = /(eshop|shop)\b[^.]{0,40}\bnevrac/i;

  it('ani jeden z troch stavov netvrdí, že eshop údaje nevracia', () => {
    for (const state of STATES) {
      const povrch = surface(PRODUCT_READ[state]);
      const doSchranky = lockedFeaturesText(state);
      expect(OBVINENIE.test(povrch), `povrch (${state}): ${povrch}`).toBe(false);
      expect(OBVINENIE.test(doSchranky), `schránka (${state}): ${doSchranky}`).toBe(false);
    }
  });

  it('text pre správcu shopu menuje oprávnenie aj koncový bod, z ktorého údaje idú', () => {
    for (const state of STATES) {
      const doSchranky = lockedFeaturesText(state);
      expect(doSchranky).toContain('product:read');
      /*
       * KONCOVÝ BOD, nie meno tvaru odpovede. `getFull` je interné meno tvaru a
       * `vocabulary.spec.ts` (P3/K10) camelCase na povrchu zakazuje — správne,
       * lebo tá istá funkcia skladá text, ktorý vidno v appke. Správcovi shopu
       * `products/get` povie viac než `getFull` a pravidlo neporušuje.
       */
      expect(doSchranky).toContain('products/get');
      // Zoznam funkcií v tej správe zostáva celý, v každom stave.
      for (const row of LOCKED_FEATURES) {
        expect(doSchranky).toContain(row.feature);
        expect(doSchranky).toContain(row.missing);
      }
    }
  });

  it('keď kľúč oprávnenie má, správa už oň nežiada', () => {
    expect(lockedFeaturesText('available')).not.toMatch(/prosba o oprávnenie/i);
    expect(lockedFeaturesText('locked')).toMatch(/prosba o oprávnenie/i);
  });
});

/* ══════════ 3. Sekcia kreslí to, čo appka o kľúči naozaj vie ══════════════ */

describe('dôvod na obrazovke sa mení s tým, čo appka o kľúči vie', () => {
  it('meraný fakt („kľúč to nemá") sa nekreslí ako mlčanie a naopak', () => {
    const nema = surface(false);
    const nevieme = surface(null);
    expect(nema).toContain(lockedCause('locked'));
    expect(nema).not.toContain(lockedCause('unknown'));
    expect(nevieme).toContain(lockedCause('unknown'));
    expect(nevieme).not.toContain(lockedCause('locked'));
  });

  it('s oprávnením prestane vinu klásť na oprávnenie', () => {
    const ma = surface(true);
    expect(ma).toContain(lockedCause('available'));
    expect(ma).not.toMatch(/nemá oprávnenie/i);
  });
});

/* ══════════ 4. Odomknutie je fail-closed a priznané ═══════════════════════ */

describe('oprávnenie samo filtre neodomkne', () => {
  it('všetky štyri funkcie zostávajú na povrchu aj v stave `available`', () => {
    const ma = surface(true);
    for (const row of LOCKED_FEATURES) {
      expect(ma, `funkcia „${row.feature}" zmizla z povrchu`).toContain(row.feature);
      expect(ma).toContain(`chýba ${row.missing}`);
    }
    expect(LOCKED_FEATURES).toHaveLength(4);
  });

  it('P2 — v žiadnom stave nie je na povrchu blok nad 90 znakov', () => {
    for (const state of STATES) {
      const markup = renderToStaticMarkup(
        createElement(LockedFeatures, { productRead: PRODUCT_READ[state] }),
      );
      const dlhe = surfaceBlocks(markup).filter((b) => b.length > P2_LIMIT);
      expect(dlhe, `${state}: ${dlhe.map((b) => `${b.length}: ${b}`).join('\n')}`).toEqual([]);
    }
  });
});
