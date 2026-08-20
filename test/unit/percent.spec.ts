/**
 * Aura Zľavy — testy percenta zľavy (A7, D11, I9).
 *
 * Akceptačné kritérium A7: `percent.ts` odmietne `0`, `31`, `12.5`, `"15"`.
 * Navyše: zod schéma pre route vstupy sa správa rovnako (bez coerce)
 * a orientačná zľavnená cena (pricing.ts) počíta v centoch, nie floatom.
 */
import { describe, expect, it } from 'vitest';

import {
  assertPercent,
  formatPercentSk,
  isValidPercent,
  PERCENT_CHIPS,
  PERCENT_MAX,
  PERCENT_MIN,
  percentSchema,
} from '@/lib/domain/percent';
import {
  centsToMoney,
  discountedPrice,
  formatMoneySk,
  isPriceMismatch,
  moneyEquals,
  moneyToCents,
} from '@/lib/domain/pricing';
import { DomainError } from '@/lib/domain/errors';

describe('isValidPercent / assertPercent (D11, I9)', () => {
  it('prijme celé čísla 1–30 vrátane hraníc', () => {
    for (const v of [1, 5, 15, 29, 30]) {
      expect(isValidPercent(v)).toBe(true);
      expect(assertPercent(v)).toBe(v);
    }
    expect(PERCENT_MIN).toBe(1);
    expect(PERCENT_MAX).toBe(30);
  });

  it('odmietne 0 (vyhradená pre sondu probeKey, D53)', () => {
    expect(isValidPercent(0)).toBe(false);
    expect(() => assertPercent(0)).toThrow(DomainError);
  });

  it('odmietne 31', () => {
    expect(isValidPercent(31)).toBe(false);
    expect(() => assertPercent(31)).toThrow(DomainError);
  });

  it('odmietne desatinné 12.5', () => {
    expect(isValidPercent(12.5)).toBe(false);
    expect(() => assertPercent(12.5)).toThrow(DomainError);
  });

  it('odmietne string "15" — žiadne tiché coerce', () => {
    expect(isValidPercent('15')).toBe(false);
    expect(() => assertPercent('15')).toThrow(DomainError);
  });

  it('odmietne NaN, Infinity, null, undefined, -5', () => {
    for (const v of [NaN, Infinity, -Infinity, null, undefined, -5]) {
      expect(isValidPercent(v)).toBe(false);
      expect(() => assertPercent(v)).toThrow(DomainError);
    }
  });

  it('chyba nesie stabilný kód percent_invalid', () => {
    try {
      assertPercent(31);
      expect.unreachable('malo hodiť');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('percent_invalid');
    }
  });
});

describe('percentSchema (zod, §5)', () => {
  it('parsne platné a odmietne 0/31/12.5/"15"', () => {
    expect(percentSchema.parse(15)).toBe(15);
    for (const v of [0, 31, 12.5, '15']) {
      expect(percentSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('PERCENT_CHIPS (D11)', () => {
  it('čipy sú 5/10/15/20/25/30 a všetky platné', () => {
    expect(PERCENT_CHIPS).toEqual([5, 10, 15, 20, 25, 30]);
    for (const chip of PERCENT_CHIPS) expect(isValidPercent(chip)).toBe(true);
  });
});

describe('formatPercentSk', () => {
  it('formátuje s medzerou pred %', () => {
    expect(formatPercentSk(15)).toBe('15 %');
  });
});

describe('pricing — orientačná zľavnená cena (D4, §2)', () => {
  it('počíta price × (1 − r/100) v centoch, half-up', () => {
    expect(discountedPrice('100.00', 10)).toBe('90.00');
    expect(discountedPrice('19.99', 15)).toBe('16.99'); // 1699.15 → 1699
    expect(discountedPrice('0.10', 30)).toBe('0.07'); // 7 centov (half-up zo 7.0)
    expect(discountedPrice('33.33', 3)).toBe('32.33'); // 3233.01 → 3233
  });

  it('odmietne neplatné percento aj neplatnú cenu', () => {
    expect(() => discountedPrice('100.00', 0)).toThrow(DomainError);
    expect(() => discountedPrice('abc', 10)).toThrow(DomainError);
  });

  it('moneyToCents/centsToMoney roundtrip a ekvivalencia bez floatu', () => {
    expect(moneyToCents('12.5')).toBe(1250);
    expect(moneyToCents('12')).toBe(1200);
    expect(centsToMoney(1250)).toBe('12.50');
    expect(moneyEquals('12.50', '12.5')).toBe(true);
    expect(moneyEquals('12.50', '12.51')).toBe(false);
  });

  it('isPriceMismatch je fail-closed pri null (D39c)', () => {
    expect(isPriceMismatch('10.00', '10.00')).toBe(false);
    expect(isPriceMismatch('10.00', '10.01')).toBe(true);
    expect(isPriceMismatch(null, '10.00')).toBe(true);
    expect(isPriceMismatch('10.00', null)).toBe(true);
  });

  it('formatMoneySk', () => {
    // pred € je nezalomiteľná medzera (NBSP) — slovenská typografia
    expect(formatMoneySk('1234.56')).toBe('1\u00A0234,56\u00A0€');
    expect(formatMoneySk('7.5')).toBe('7,50\u00A0€');
  });
});
