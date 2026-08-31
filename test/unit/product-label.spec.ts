/**
 * Aura Zľavy — pomenovanie produktu na obrazovke (D116, 28. 8. 2026).
 *
 * Tento test stráži JEDNU vec, na ktorej sa štyri obrazovky môžu rozísť:
 * čo sa stane, keď referenciu NEPOZNÁME. Referencia je pole z `getFull`
 * a appka ho má len pre obohatené produkty (D118), takže „chýba" je bežný
 * stav, nie výnimka — a nesmie sa vydávať za to, že produkt referenciu
 * v shope nemá (I11).
 */
import { describe, expect, it } from 'vitest';

import { NEVIEME, productLabel } from '@/lib/ui/product-label';

describe('productLabel — referencia · názov (D116)', () => {
  it('obohatený produkt má na povrchu referenciu PRVÚ, id v technickom detaile', () => {
    const label = productLabel({ productId: 30582, reference: 'C16.19', name: 'Náramok' });

    expect(label.text).toBe('C16.19 · Náramok');
    // Poradie je zámerné: podľa referencie sa produkt hľadá v sklade, názvy
    // sa opakujú. Keby sa prehodilo, test to zachytí.
    expect(label.text.indexOf('C16.19')).toBeLessThan(label.text.indexOf('Náramok'));
    expect(label.technical).toBe('#30582');
    expect(label.referenceUnknown).toBe(false);
  });

  it('NEOBOHATENÝ produkt: pomlčka a priznané „nevieme", nikdy prázdny reťazec', () => {
    const label = productLabel({ productId: 30582, reference: null, name: 'Náramok' });

    expect(label.reference).toBe(NEVIEME);
    expect(label.reference).not.toBe('');
    // Toto je jadro I11: appka NEVIE referenciu, a musí to vedieť povedať.
    expect(label.referenceUnknown).toBe(true);
    // Názov ale poznáme, takže produkt nie je bezmenný.
    expect(label.text).toBe('Náramok');
  });

  it('prázdny reťazec a samé medzery znamenajú to isté ako `null`', () => {
    for (const reference of ['', '   ', null]) {
      const label = productLabel({ productId: 7, reference, name: 'X' });
      expect(label.referenceUnknown, `referencia ${JSON.stringify(reference)}`).toBe(true);
      expect(label.reference).toBe(NEVIEME);
    }
  });

  it('bez referencie aj bez názvu zostane aspoň id — produkt sa dá identifikovať', () => {
    const label = productLabel({ productId: 41348, reference: null, name: null });

    expect(label.text).toBe('#41348');
    expect(label.name).toBe(NEVIEME);
    expect(label.reference).toBe(NEVIEME);
  });

  it('produkt s referenciou a bez názvu neukáže osirotenú pomlčku', () => {
    const label = productLabel({ productId: 9, reference: 'A1', name: null });

    expect(label.text).toBe('A1');
    // „A1 · —" by vyzeralo ako názov, ktorý je pomlčka. To nie je pravda:
    // názov nepoznáme a povrch o ňom má mlčať.
    expect(label.text).not.toContain(NEVIEME);
  });
});
