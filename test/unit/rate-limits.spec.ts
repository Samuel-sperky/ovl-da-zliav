/**
 * Aura Zľavy — rozpočet volaní na shop: živý zostatok z `whoami` a záloha z v4.
 *
 * Tieto testy nestrážia implementáciu, strážia ČÍSLA a to, ODKIAĽ sú. Keď sa
 * niekto pokúsi zrýchliť synchronizáciu tým, že zníži pauzu, alebo prepíše
 * strop podľa pocitu, spadne to tu — a nie až na 429 od produkčného shopu.
 *
 * Zdroje hodnôt po API v5:
 *  - anonymná vetva: `docs/api/sperky-api-v4.md`, sekcia „Rate limiting" —
 *    posledná dokumentácia, ktorá čísla uvádzala. V5 tú sekciu už nemá a
 *    `whoami` anonymnú vetvu nepokrýva, takže lepší zdroj neexistuje,
 *  - vetva s kľúčom: `GET /api/whoami` → `remaining`. Natvrdo zapísané 20/200
 *    sú od v5 iba ZÁLOHA a tieto testy to tvrdia nahlas.
 *
 * Vlastník: A3.
 */
import { describe, expect, it } from 'vitest';

import {
  ANON_READS_PER_MINUTE,
  ANON_READS_PER_UTC_DAY,
  KEYED_FALLBACK_PER_MINUTE,
  KEYED_FALLBACK_PER_UTC_DAY,
  MIN_ANON_READ_PAUSE_MS,
  RATE_SAFETY_FACTOR,
  REMAINING_UNKNOWN,
  SHOP_ANON_LIMIT,
  SHOP_KEYED_LIMIT,
  keyedBudgetSentence,
  lowerOfKnown,
  nextUtcDayReset,
  normalizeRemaining,
  resolveKeyedBudget,
  utcDayStart,
} from '@/lib/shop/rate-limits';
// Odhad dní má JEDNU formulu — tú, ktorou počíta aj `catalogRepo.syncStatus()`.
import { readDaysNeeded } from '@/lib/shop/read-budget';

describe('posledné známe limity sedia s dokumentáciou v4', () => {
  it('anonymné čítanie je 30/min a 300/UTC deň', () => {
    expect(SHOP_ANON_LIMIT.perMinute).toBe(30);
    expect(SHOP_ANON_LIMIT.perUtcDay).toBe(300);
  });

  it('záloha pre volania s kľúčom je 150/min a 1000/UTC deň (zdvihnuté 1. 9. 2026)', () => {
    // Do 1. 9. 2026 to bolo 20/200. Správca shopu kvótu kľúča „Discount
    // handler" zdvihol na 150/1000 a ohlásil ďalšie zdvihnutie — keď príde,
    // menia sa TIETO dve čísla a všetko ostatné sa prepočíta samo.
    expect(SHOP_KEYED_LIMIT.perMinute).toBe(150);
    expect(SHOP_KEYED_LIMIT.perUtcDay).toBe(1_000);
  });

  it('denný strop NIE JE minútový — na tejto zámene padol celý katalóg', () => {
    // Komentár v catalog-sync.ts roky tvrdil „300 volaní / 60 s". 300 je denný
    // strop, minútový je desaťnásobne nižší.
    expect(SHOP_ANON_LIMIT.perUtcDay).toBeGreaterThan(SHOP_ANON_LIMIT.perMinute);
    expect(SHOP_ANON_LIMIT.perMinute).toBe(30);
  });
});

describe('odvodené hodnoty držia rezervu pod stropom', () => {
  it('rezerva je 20 % a plánované tempo je pod stropom, nie na ňom', () => {
    expect(RATE_SAFETY_FACTOR).toBe(0.8);
    expect(ANON_READS_PER_MINUTE).toBe(
      Math.floor(SHOP_ANON_LIMIT.perMinute * RATE_SAFETY_FACTOR),
    );
    expect(ANON_READS_PER_UTC_DAY).toBe(
      Math.floor(SHOP_ANON_LIMIT.perUtcDay * RATE_SAFETY_FACTOR),
    );
    expect(ANON_READS_PER_MINUTE).toBeLessThan(SHOP_ANON_LIMIT.perMinute);
    expect(ANON_READS_PER_UTC_DAY).toBeLessThan(SHOP_ANON_LIMIT.perUtcDay);
  });

  it('záloha pre kľúčovú vetvu je tiež pod stropom, a je ODVODENÁ', () => {
    /*
     * Tvrdenie je o VZŤAHU, nie o čísle: záloha musí byť presne `strop × 0,8`
     * a nesmie na strop dosiahnuť. Keď správca shopu kvótu zdvihne znova, tento
     * test prejde bez úpravy — dovtedy tu stálo `16` a `160` a zdvihnutie
     * limitov ho zhodilo, hoci kód bol správny.
     */
    expect(KEYED_FALLBACK_PER_MINUTE).toBe(
      Math.floor(SHOP_KEYED_LIMIT.perMinute * RATE_SAFETY_FACTOR),
    );
    expect(KEYED_FALLBACK_PER_UTC_DAY).toBe(
      Math.floor(SHOP_KEYED_LIMIT.perUtcDay * RATE_SAFETY_FACTOR),
    );
    expect(KEYED_FALLBACK_PER_MINUTE).toBeLessThan(SHOP_KEYED_LIMIT.perMinute);
    expect(KEYED_FALLBACK_PER_UTC_DAY).toBeLessThan(SHOP_KEYED_LIMIT.perUtcDay);
  });

  it('pauza je 2 500 ms a naozaj drží minútový strop', () => {
    expect(MIN_ANON_READ_PAUSE_MS).toBe(2_500);
    // Koľko volaní sa pri tejto pauze zmestí do minúty.
    expect(Math.floor(60_000 / MIN_ANON_READ_PAUSE_MS)).toBeLessThanOrEqual(
      SHOP_ANON_LIMIT.perMinute,
    );
  });
});

/* ═════════════ Živý rozpočet z `whoami` (bod D2 kontraktu v5) ═════════════ */

describe('hodnota zo `whoami` sa číta fail-closed', () => {
  it('celé nezáporné číslo prejde, aj keď príde ako string (PHP)', () => {
    expect(normalizeRemaining(59)).toBe(59);
    expect(normalizeRemaining('59')).toBe(59);
    expect(normalizeRemaining(0)).toBe(0);
  });

  it('nula znamená „už nič", nikdy „nevieme"', () => {
    // Toto je celé jadro rozdielu: keby sa 0 čítala ako `null`, appka by pri
    // vyčerpanom rozpočte spadla na zálohu 160 a pokračovala v zápisoch.
    expect(normalizeRemaining(0)).toBe(0);
    expect(normalizeRemaining(0)).not.toBeNull();
  });

  it('čokoľvek nepoužiteľné je „nevieme", nie nula a nie nekonečno', () => {
    for (const value of [null, undefined, '', '  ', 'veľa', Number.NaN, Infinity, -1, -0.5]) {
      expect(normalizeRemaining(value), String(value)).toBeNull();
    }
  });

  it('desatiny sa zaokrúhľujú NADOL — 1,9 volania je jedno volanie', () => {
    expect(normalizeRemaining(1.9)).toBe(1);
    expect(normalizeRemaining('2.99')).toBe(2);
  });
});

describe('nižšia z hodnôt vyhráva, neznáme sa do výberu nedostane', () => {
  it('vyberá najnižšie známe číslo', () => {
    expect(lowerOfKnown(5, 9)).toBe(5);
    expect(lowerOfKnown(9, 5, 7)).toBe(5);
  });

  it('neznáma hodnota sa netvári ako nekonečno ani ako nula', () => {
    expect(lowerOfKnown(null, 9)).toBe(9);
    expect(lowerOfKnown(9, null)).toBe(9);
    expect(lowerOfKnown(null, null)).toBeNull();
  });
});

describe('rozpočet s kľúčom sa číta zo `whoami`, záloha je len záchranná sieť', () => {
  it('keď shop povie zostatok, platí ON — aj keď je vyšší než záloha', () => {
    // Bez tohto by čítanie zostatku nemalo zmysel a kľúč s väčšou kvótou by
    // sme ticho škrtili na 16/160 podľa dokumentácie, ktorá už neexistuje.
    const budget = resolveKeyedBudget({ perMinute: 59, perUtcDay: 9_987 });
    expect(budget.perMinute).toBe(59);
    expect(budget.perUtcDay).toBe(9_987);
    expect(budget.perMinuteSource).toBe('whoami');
    expect(budget.perUtcDaySource).toBe('whoami');
    expect(budget.hasUnknown).toBe(false);
  });

  it('nižší živý zostatok tiež platí — vyčerpaný rozpočet je nula, nie záloha', () => {
    const budget = resolveKeyedBudget({ perMinute: 0, perUtcDay: 3 });
    expect(budget.perMinute).toBe(0);
    expect(budget.perUtcDay).toBe(3);
    expect(budget.hasUnknown).toBe(false);
  });

  it('keď sa `whoami` nedá prečítať vôbec, platí záloha (nie nekonečno)', () => {
    const budget = resolveKeyedBudget(null);
    expect(budget.perMinute).toBe(KEYED_FALLBACK_PER_MINUTE);
    expect(budget.perUtcDay).toBe(KEYED_FALLBACK_PER_UTC_DAY);
    expect(budget.perMinuteSource).toBe('fallback');
    expect(budget.perUtcDaySource).toBe('fallback');
    expect(budget.hasUnknown).toBe(true);
  });

  it('`REMAINING_UNKNOWN` sa chová rovnako ako nedostupné `whoami`', () => {
    expect(resolveKeyedBudget(REMAINING_UNKNOWN)).toEqual(resolveKeyedBudget(null));
  });

  /**
   * Najdôležitejší test celého súboru. `per_day: null` znamená „kľúč nemá dennú
   * kvótu", čo je pre nás „nevieme, koľko ešte smieme" — a nie „smieme
   * neobmedzene". Keby sa z toho stalo nekonečno, appka by v jednom UTC dni
   * poslala tisíce zápisov a shop by kľúč zabanoval.
   */
  it('`per_day: null` NIE JE nekonečno ani nula — je to záloha', () => {
    const budget = resolveKeyedBudget({ perMinute: 59, perUtcDay: null });
    expect(budget.perUtcDay).toBe(KEYED_FALLBACK_PER_UTC_DAY);
    expect(budget.perUtcDaySource).toBe('fallback');
    expect(Number.isFinite(budget.perUtcDay)).toBe(true);
    expect(budget.perUtcDay).toBeGreaterThan(0);
    expect(budget.hasUnknown).toBe(true);
  });

  it('chýbajúci minútový zostatok padne na zálohu, denný zostáva živý', () => {
    const budget = resolveKeyedBudget({ perMinute: null, perUtcDay: 500 });
    expect(budget.perMinute).toBe(KEYED_FALLBACK_PER_MINUTE);
    expect(budget.perMinuteSource).toBe('fallback');
    expect(budget.perUtcDay).toBe(500);
    expect(budget.perUtcDaySource).toBe('whoami');
  });

  it('za minútu sa nedá minúť viac, než ostáva do konca dňa', () => {
    const budget = resolveKeyedBudget({ perMinute: 59, perUtcDay: 4 });
    expect(budget.perMinute).toBe(4);
    expect(budget.perUtcDay).toBe(4);
  });

  it('to isté platí, keď je denné číslo zo zálohy a minútové živé', () => {
    // Živé minútové číslo NAD dennou zálohou sa zastropuje na dennú hodnotu.
    // Musí byť odvodené: pri zdvihnutí kvóty by pevné „200" prestalo byť nad
    // zálohou (800) a test by tvrdil niečo iné, než čo má v názve.
    const budget = resolveKeyedBudget({
      perMinute: KEYED_FALLBACK_PER_UTC_DAY + 40,
      perUtcDay: null,
    });
    expect(budget.perMinute).toBe(KEYED_FALLBACK_PER_UTC_DAY);
    expect(budget.perMinute).toBeLessThanOrEqual(budget.perUtcDay);
  });

  it('rozpočet je vždy konečné nezáporné číslo, nech príde čokoľvek', () => {
    const cases = [
      null,
      { perMinute: null, perUtcDay: null },
      { perMinute: 0, perUtcDay: 0 },
      { perMinute: 1, perUtcDay: null },
      { perMinute: null, perUtcDay: 1 },
    ];
    for (const remaining of cases) {
      const budget = resolveKeyedBudget(remaining);
      expect(Number.isInteger(budget.perMinute), JSON.stringify(remaining)).toBe(true);
      expect(Number.isInteger(budget.perUtcDay), JSON.stringify(remaining)).toBe(true);
      expect(budget.perMinute).toBeGreaterThanOrEqual(0);
      expect(budget.perUtcDay).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('veta o rozpočte vždy povie, či je číslo merané alebo odhadnuté', () => {
  it('pri živých číslach sa odvoláva na shop', () => {
    const text = keyedBudgetSentence(resolveKeyedBudget({ perMinute: 59, perUtcDay: 9_987 }));
    expect(text).toContain('59');
    expect(text).toContain('9987');
    expect(text).toContain('shop');
  });

  it('pri zálohe to prizná — mlčať o odhade je horšie než odhad', () => {
    const text = keyedBudgetSentence(resolveKeyedBudget(null));
    expect(text).toContain('odhad');
  });

  it('keď chýba len denný zostatok, veta pomenuje ktorý', () => {
    const text = keyedBudgetSentence(resolveKeyedBudget({ perMinute: 59, perUtcDay: null }));
    expect(text).toContain('denný');
    expect(text).toContain('odhad');
  });
});

describe('plánovanie viacdňového čítania', () => {
  it('celý katalóg sa do jedného UTC dňa nezmestí', () => {
    const pages = Math.ceil(41_082 / 100); // 411
    expect(pages).toBeGreaterThan(ANON_READS_PER_UTC_DAY);
    // Dnes celý rozpočet voľný: dnes 240, zajtra zvyšok — teda JEDEN ďalší deň.
    expect(readDaysNeeded(pages, ANON_READS_PER_UTC_DAY)).toBe(1);
    // A keď z dneška neostalo nič, sú to dva.
    expect(readDaysNeeded(pages, 0)).toBe(2);
  });

  it('nulová a záporná práca netrvá žiadny deň', () => {
    expect(readDaysNeeded(0, 0)).toBe(0);
    expect(readDaysNeeded(-5, 0)).toBe(0);
  });

  it('odhad ráta s tým, čo z dnešného rozpočtu ostalo', () => {
    expect(readDaysNeeded(1, 0)).toBe(1);
    expect(readDaysNeeded(1, 1)).toBe(0);
    expect(readDaysNeeded(ANON_READS_PER_UTC_DAY, 0)).toBe(1);
    expect(readDaysNeeded(ANON_READS_PER_UTC_DAY + 1, 0)).toBe(2);
  });

  it('UTC deň sa počíta v UTC, nie v lokálnom čase', () => {
    // 23:30 v Bratislave (letný čas, UTC+2) je 21:30 UTC toho istého dňa.
    const at = new Date('2026-08-12T21:30:00Z');
    expect(utcDayStart(at).toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(nextUtcDayReset(at).toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });

  it('tesne pred polnocou UTC sa rozpočet obnoví o chvíľu, nie o deň', () => {
    const at = new Date('2026-08-12T23:59:59.000Z');
    expect(nextUtcDayReset(at).getTime() - at.getTime()).toBe(1_000);
  });
});
