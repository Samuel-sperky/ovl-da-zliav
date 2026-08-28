/**
 * Aura Zľavy — HLÁŠKA NEÚSPEŠNEJ MUTÁCIE NESMIE TVRDIŤ VIAC, NEŽ VIE.
 *
 * ČO TENTO SÚBOR EXISTUJE ZATVORIŤ
 * --------------------------------
 * Modul vznikol preto, že používateľ vložil API kľúč do produkčného shopu,
 * dostal červený obdĺžnik, pole sa vyprázdnilo — a myslel si, že kľúč je
 * uložený. Do 27. 8. 2026 mal na to vetu „nie si prihlásený a NIČ sa neuložilo",
 * ktorú smel povedať výhradne pri 401 `unauthorized`: tam bol request odmietnutý
 * pred akoukoľvek prácou, takže to bolo preukázateľné.
 *
 * Prihlásenie zmizlo (D99) a s ním tá vetva. Pri prepise sa do fallbacku
 * DOSTALA tá istá veta („v shope ani v databáze sa nič nezmenilo") — už bez
 * dôkazu. Pri neznámej chybe appka NEVIE, či mutácia nespadla uprostred, takže
 * by tvrdila „nezapísali sme nič" bez merania. To je I11 naopak a je to horšie
 * než mlčať: používateľ by na to tvrdenie stavil rozhodnutie.
 *
 * Testy nižšie merajú NÁVRATOVÚ HODNOTU funkcie, nie text v zdrojáku.
 */
import { describe, expect, it } from 'vitest';

import { describeActionFailure } from '@/lib/ui/action-failure';

describe('describeActionFailure — hláška servera má prednosť', () => {
  it('prejde s hláškou servera a tónom `critical`', () => {
    const f = describeActionFailure(
      { code: 'shop_unreachable', message: 'Shop neodpovedal.' },
      { action: 'Uloženie API kľúča' },
    );
    expect(f.message).toBe('Shop neodpovedal.');
    expect(f.tone).toBe('critical');
  });

  it('technický kód zostáva dostupný v detaile', () => {
    const f = describeActionFailure(
      { code: 'shop_unreachable', message: 'Shop neodpovedal.' },
      { action: 'Uloženie API kľúča' },
    );
    expect(f.rawCode).toBe('shop_unreachable');
  });

  it('prázdna alebo whitespace hláška servera sa NEBERIE ako hláška', () => {
    for (const message of ['', '   ', '\n\t']) {
      const f = describeActionFailure({ code: 'x', message }, { action: 'Uloženie kľúča' });
      expect(f.message).not.toBe(message);
      expect(f.message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('describeActionFailure — fallback bez hlášky servera', () => {
  it('pomenuje akciu, ktorá zlyhala, a nikdy nie je prázdny', () => {
    const f = describeActionFailure(null, { action: 'Uloženie API kľúča' });
    expect(f.message).toContain('Uloženie API kľúča');
    expect(f.message.trim().length).toBeGreaterThan(0);
  });

  it('rawCode je `null`, keď chyba nemá kód — nie prázdny string', () => {
    expect(describeActionFailure(null, { action: 'Uloženie kľúča' }).rawCode).toBeNull();
    expect(describeActionFailure({}, { action: 'Uloženie kľúča' }).rawCode).toBeNull();
  });

  /*
   * TOTO JE TEN STRÁŽENÝ RIADOK. Fallback NESMIE tvrdiť, že sa nič nezmenilo —
   * pri neznámej chybe to appka nemeria a mutácia mohla spadnúť uprostred.
   *
   * Test je napísaný nad VÝZNAMOM, nie nad jednou vetou: hľadá tvrdenie
   * o nezmenenom stave v ktorejkoľvek jeho podobe, ktorú by na to niekto použil.
   */
  it('NETVRDÍ „nič sa nezmenilo" — to by bolo tvrdenie bez merania (I11 naopak)', () => {
    const varianty = [
      describeActionFailure(null, { action: 'Uloženie API kľúča' }),
      describeActionFailure({}, { action: 'Uloženie nastavení' }),
      describeActionFailure({ code: 'internal_error' }, { action: 'Zmena rozsahu' }),
      describeActionFailure({ code: 'x', message: '  ' }, { action: 'Odomknutie zápisov' }),
    ];
    for (const f of varianty) {
      const veta = f.message.toLowerCase();
      expect(veta).not.toContain('nič sa nezmenilo');
      expect(veta).not.toContain('nič nezmenilo');
      expect(veta).not.toContain('nič sa neuložilo');
      expect(veta).not.toContain('neuložilo sa nič');
      expect(veta).not.toContain('nezapísalo');
      expect(veta).not.toContain('nezapísali');
    }
  });

  /*
   * Opačná strana tej istej hranice: keď hlášku o nezmenenom stave pošle SERVER,
   * prejsť SMIE. Server o svojom zápise vie to, čo prehliadač nie.
   */
  it('ale hlášku servera o nezmenenom stave NEBLOKUJE — server to vie', () => {
    const f = describeActionFailure(
      { code: 'validation_failed', message: 'Kľúč sa neuložil, v DB sa nič nezmenilo.' },
      { action: 'Uloženie API kľúča' },
    );
    expect(f.message).toBe('Kľúč sa neuložil, v DB sa nič nezmenilo.');
  });
});

describe('describeActionFailure — po zrušení prihlásenia (D99)', () => {
  /*
   * `needsLogin` a odkaz na `/login` zmizli s prihlásením. Keby sa vrátili,
   * appka by ponúkala cestu, ktorá neexistuje — 404 namiesto pomoci.
   */
  it('výsledok NEOBSAHUJE `needsLogin` ani nič o prihlásení', () => {
    const f = describeActionFailure({ code: 'unauthorized' }, { action: 'Uloženie kľúča' });
    expect(f).not.toHaveProperty('needsLogin');
    expect(f.message.toLowerCase()).not.toContain('prihlás');
  });

  /*
   * `unauthorized` už nemá zvláštne postavenie: je to obyčajná chyba servera.
   * Keby ho niekto začal opäť rozlišovať, dostal by iný tón než ostatné chyby.
   */
  it('`unauthorized` nemá zvláštne zaobchádzanie — je to bežná chyba', () => {
    const un = describeActionFailure(
      { code: 'unauthorized', message: 'Neoprávnené.' },
      { action: 'Uloženie kľúča' },
    );
    const other = describeActionFailure(
      { code: 'shop_unreachable', message: 'Neoprávnené.' },
      { action: 'Uloženie kľúča' },
    );
    expect(un.tone).toBe(other.tone);
    expect(un.message).toBe(other.message);
  });
});
