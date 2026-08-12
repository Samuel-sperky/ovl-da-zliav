/**
 * Aura Zľavy — limity shopu ako jediný zdroj pravdy.
 *
 * Tieto testy nestrážia implementáciu, strážia ČÍSLA. Keď sa niekto pokúsi
 * zrýchliť synchronizáciu tým, že zníži pauzu, alebo prepíše strop podľa
 * pocitu, spadne to tu — a nie až na 429 od produkčného shopu.
 *
 * Zdroj hodnôt: `docs/api/sperky-api-v4.md`, sekcia „Rate limiting".
 *
 * Vlastník: A3.
 */
import { describe, expect, it } from 'vitest';

import {
  ANON_READS_PER_MINUTE,
  ANON_READS_PER_UTC_DAY,
  MIN_ANON_READ_PAUSE_MS,
  RATE_SAFETY_FACTOR,
  SHOP_ANON_LIMIT,
  SHOP_KEYED_LIMIT,
  anonReadDaysNeeded,
  nextUtcDayReset,
  utcDayStart,
} from '@/lib/shop/rate-limits';

describe('limity shopu sedia s dokumentáciou v4', () => {
  it('anonymné čítanie je 30/min a 300/UTC deň', () => {
    expect(SHOP_ANON_LIMIT.perMinute).toBe(30);
    expect(SHOP_ANON_LIMIT.perUtcDay).toBe(300);
  });

  it('volania s kľúčom sú 20/min a 200/UTC deň', () => {
    expect(SHOP_KEYED_LIMIT.perMinute).toBe(20);
    expect(SHOP_KEYED_LIMIT.perUtcDay).toBe(200);
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
    expect(ANON_READS_PER_MINUTE).toBe(24);
    expect(ANON_READS_PER_UTC_DAY).toBe(240);
    expect(ANON_READS_PER_MINUTE).toBeLessThan(SHOP_ANON_LIMIT.perMinute);
    expect(ANON_READS_PER_UTC_DAY).toBeLessThan(SHOP_ANON_LIMIT.perUtcDay);
  });

  it('pauza je 2 500 ms a naozaj drží minútový strop', () => {
    expect(MIN_ANON_READ_PAUSE_MS).toBe(2_500);
    // Koľko volaní sa pri tejto pauze zmestí do minúty.
    expect(Math.floor(60_000 / MIN_ANON_READ_PAUSE_MS)).toBeLessThanOrEqual(
      SHOP_ANON_LIMIT.perMinute,
    );
  });
});

describe('plánovanie viacdňového čítania', () => {
  it('celý katalóg sa do jedného UTC dňa nezmestí', () => {
    const pages = Math.ceil(41_082 / 100); // 411
    expect(pages).toBeGreaterThan(ANON_READS_PER_UTC_DAY);
    expect(anonReadDaysNeeded(pages)).toBe(2);
  });

  it('nulová a záporná práca netrvá žiadny deň', () => {
    expect(anonReadDaysNeeded(0)).toBe(0);
    expect(anonReadDaysNeeded(-5)).toBe(0);
  });

  it('jedna stránka je jeden deň, presne denný strop tiež', () => {
    expect(anonReadDaysNeeded(1)).toBe(1);
    expect(anonReadDaysNeeded(ANON_READS_PER_UTC_DAY)).toBe(1);
    expect(anonReadDaysNeeded(ANON_READS_PER_UTC_DAY + 1)).toBe(2);
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
