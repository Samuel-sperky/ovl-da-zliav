/**
 * Aura Zľavy — RIADOK Z `getFull` SA NESMIE ČÍTAŤ AKO RIADOK Z `get`.
 *
 * ČO TENTO SÚBOR EXISTUJE ZATVORIŤ
 * --------------------------------
 * `catalog.repo.ts` o sebe od 24. 8. 2026 tvrdilo „Stráži to
 * `detaily-katalog.spec.ts`" a ten súbor NEEXISTOVAL. Bol to štvrtý taký prípad
 * v tomto repe (nález B5) a je horší než chýbajúci test: kto grepne po riziku,
 * nájde vetu a prestane hľadať.
 *
 * ČO SA STRÁŽI. `catalogDetailRoute()` rozhoduje, ktorou cestou riadok zrkadla
 * prišel, a robí to podľa prítomnosti poľa `reduction` — to `getFull` posiela
 * vždy (aj keď `null`) a `get` nikdy. Keby to niekto z ukladaného objektu
 * odstránil, riadky z `getFull` by sa začali čítať ako `get` a kód produktu by
 * na obrazovke zmizol za „chýba oprávnenie". To je tvrdenie o CHÝBAJÚCICH
 * dátach nad dátami, ktoré appka má — presne to, čo prvé pravidlo projektu
 * zakazuje, len obrátené.
 *
 * Meria sa NÁVRATOVÁ HODNOTA funkcie nad tvarmi, aké naozaj chodia z API, nie
 * text v zdrojáku.
 */
import { describe, expect, it } from 'vitest';

import { catalogDetailRoute } from '@/lib/repo/catalog.repo';

/** Tvar, aký vracia `GET /api/products/get` — bez `reduction`. */
const Z_GET = { id: 7, name: 'Náušnice', price: '19.90', has_attributes: false };

/**
 * Tvar z `getFull` (API v5, scope `product:read`). `reduction` je prítomné VŽDY;
 * `null` znamená „na produkte nie je zľava", nie „pole neprišlo".
 */
const Z_GETFULL = { ...Z_GET, reduction: null, purchase_price: '8.00', qty: 3 };

describe('catalogDetailRoute — rozlíšenie `get` a `getFull`', () => {
  it('riadok z `getFull` sa pozná podľa `reduction`, aj keď je `null`', () => {
    expect(catalogDetailRoute('get', Z_GETFULL)).toBe('getFull');
    expect(catalogDetailRoute('batch', Z_GETFULL)).toBe('getFull');
    // A so skutočnou zľavou rovnako — nerozhoduje hodnota, len prítomnosť.
    expect(catalogDetailRoute('get', { ...Z_GETFULL, reduction: 20 })).toBe('getFull');
  });

  it('riadok z `get` sa NEVYDÁVA za `getFull`', () => {
    expect(catalogDetailRoute('get', Z_GET)).toBe('get');
    expect(catalogDetailRoute('batch', Z_GET)).toBe('get');
  });

  /**
   * Toto je tá diera, o ktorej komentár v repozitári hovorí: odstránenie
   * `reduction` z ukladaného objektu. Test ho odstráni a čaká, že sa cesta
   * zmení — čím je zmena viditeľná v teste namiesto na obrazovke.
   */
  it('bez `reduction` sa `getFull` riadok stane nerozoznateľným — a to je tá chyba', () => {
    const { reduction: _vynechane, ...bezReduction } = Z_GETFULL;
    expect(catalogDetailRoute('get', bezReduction)).toBe('get');
    // Kontrola, že rozdiel spôsobilo výhradne to jedno pole.
    expect(catalogDetailRoute('get', Z_GETFULL)).toBe('getFull');
  });

  it('riadok zo zoznamu je `list`, nech obsahuje čokoľvek', () => {
    expect(catalogDetailRoute('list', Z_GETFULL)).toBe('list');
    expect(catalogDetailRoute(null, Z_GETFULL)).toBe('list');
  });

  it('nečitateľné `raw` je `list`, nie hádanie', () => {
    // Nie objekt = o ceste sa nedá rozhodnúť, takže fail-closed na `list`.
    for (const raw of [null, undefined, 'nieco', 42]) {
      expect(catalogDetailRoute('get', raw)).toBe('list');
    }
    // Prázdne pole objekt JE, len `reduction` v ňom nie je — teda `get`.
    // Nie je to nečitateľný vstup a zliať to s ním by zakrylo rozdiel.
    expect(catalogDetailRoute('get', [])).toBe('get');
  });
});
