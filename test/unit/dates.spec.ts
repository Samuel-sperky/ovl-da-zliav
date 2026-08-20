/**
 * Aura Zľavy — testy dátumovej logiky (A7, D13, D29, D31, D32, D59).
 *
 * Akceptačné kritériá A7:
 *  - `fire_at` = `date_from` 00:05 Europe/Bratislava → UTC, korektne cez OBE
 *    DST hranice (marec aj október),
 *  - „+3 mesiace" je KALENDÁRNE (31.1. + 3M = 30.4.), nie 90 dní,
 *  - zamrznutie ±60 s okolo lokálnej polnoci (D59),
 *  - zobrazovací formát DD.MM.YYYY (D13).
 *
 * Čisté funkcie — čas sa posiela ako parameter, žiadny fake timer nie je nutný.
 */
import { describe, expect, it } from 'vitest';

import {
  addCalendarMonths,
  addDays,
  assertNotMidnightFrozen,
  compareDateOnly,
  DEFAULT_FIRE_TIME,
  diffDays,
  endOfDayExclusiveUtc,
  fireAtUtc,
  formatDateOnlySk,
  isDateOnly,
  isDue,
  isMidnightFrozen,
  isMissedFire,
  isWindowStillOpen,
  isWithinMaxWindow,
  maxAllowedTo,
  parseDateOnly,
  resolveLocalTimeToUtc,
  startOfDayUtc,
  todayInZone,
  zonedParts,
} from '@/lib/domain/dates';
import { DomainError } from '@/lib/domain/errors';

describe('parseDateOnly / isDateOnly', () => {
  it('prijme platný kalendárny deň', () => {
    expect(parseDateOnly('2026-08-05')).toEqual({ year: 2026, month: 8, day: 5 });
    expect(isDateOnly('2024-02-29')).toBe(true); // priestupný rok
  });

  it('odmietne neexistujúce dni a zlé tvary', () => {
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('2025-02-29')).toBe(false); // nepriestupný rok
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-00-10')).toBe(false);
    expect(isDateOnly('05.08.2026')).toBe(false);
    expect(isDateOnly('2026-8-5')).toBe(false);
    expect(isDateOnly(20260805)).toBe(false);
    expect(() => parseDateOnly('2026-02-30')).toThrow(DomainError);
  });
});

describe('formatDateOnlySk (D13)', () => {
  it('formátuje DD.MM.YYYY', () => {
    expect(formatDateOnlySk('2026-08-05')).toBe('05.08.2026');
    expect(formatDateOnlySk('2026-12-31')).toBe('31.12.2026');
  });
});

describe('kalendárna aritmetika (D29)', () => {
  it('+3 mesiace je kalendárne: 31.1. + 3M = 30.4.', () => {
    expect(addCalendarMonths('2026-01-31', 3)).toBe('2026-04-30');
  });

  it('zasekne sa na poslednom dni cieľového mesiaca (február)', () => {
    expect(addCalendarMonths('2025-11-30', 3)).toBe('2026-02-28');
    expect(addCalendarMonths('2023-11-30', 3)).toBe('2024-02-29'); // priestupný
  });

  it('prechádza cez koniec roka', () => {
    expect(addCalendarMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('NIE JE 90 dní: 31.1. + 90 dní by bolo 1.5., kalendárne je 30.4.', () => {
    expect(addDays('2026-01-31', 90)).toBe('2026-05-01');
    expect(addCalendarMonths('2026-01-31', 3)).not.toBe(addDays('2026-01-31', 90));
  });

  it('maxAllowedTo / isWithinMaxWindow strážia strop (I9)', () => {
    expect(maxAllowedTo('2026-01-31')).toBe('2026-04-30');
    expect(isWithinMaxWindow('2026-01-31', '2026-04-30')).toBe(true);
    expect(isWithinMaxWindow('2026-01-31', '2026-05-01')).toBe(false);
  });

  it('diffDays a porovnania', () => {
    expect(diffDays('2026-08-01', '2026-08-05')).toBe(4);
    expect(compareDateOnly('2026-08-01', '2026-08-05')).toBe(-1);
    expect(() => compareDateOnly('zlé', '2026-08-05')).toThrow(DomainError);
  });
});

describe('fire_at v Europe/Bratislava → UTC (D31, D32)', () => {
  it('v zime (CET, +01:00): 00:05 lokálne = 23:05 UTC predchádzajúceho dňa', () => {
    const fire = fireAtUtc('2026-01-15');
    expect(fire.toISOString()).toBe('2026-01-14T23:05:00.000Z');
  });

  it('v lete (CEST, +02:00): 00:05 lokálne = 22:05 UTC predchádzajúceho dňa', () => {
    const fire = fireAtUtc('2026-07-15');
    expect(fire.toISOString()).toBe('2026-07-14T22:05:00.000Z');
  });

  it('deň jarného prechodu (29.3.2026): 00:05 je ešte CET → 23:05 UTC', () => {
    // DST skok je o 02:00 CET → 03:00 CEST; polnoc je ešte +01:00.
    expect(fireAtUtc('2026-03-29').toISOString()).toBe('2026-03-28T23:05:00.000Z');
    // deň PO prechode je už CEST
    expect(fireAtUtc('2026-03-30').toISOString()).toBe('2026-03-29T22:05:00.000Z');
  });

  it('deň jesenného prechodu (25.10.2026): 00:05 je ešte CEST → 22:05 UTC', () => {
    expect(fireAtUtc('2026-10-25').toISOString()).toBe('2026-10-24T22:05:00.000Z');
    // deň PO prechode je už CET
    expect(fireAtUtc('2026-10-26').toISOString()).toBe('2026-10-25T23:05:00.000Z');
  });

  it('rešpektuje SCHEDULER_FIRE_TIME parameter', () => {
    expect(fireAtUtc('2026-01-15', '06:30').toISOString()).toBe('2026-01-15T05:30:00.000Z');
    expect(DEFAULT_FIRE_TIME).toBe('00:05');
  });

  it('odmietne neplatný čas', () => {
    expect(() => fireAtUtc('2026-01-15', '24:00')).toThrow(DomainError);
    expect(() => fireAtUtc('2026-01-15', '0:5')).toThrow(DomainError);
  });

  it('neexistujúci lokálny čas pri jarnom skoku vráti adjusted=true', () => {
    // 29.3.2026 02:30 CET neexistuje — zóna skočí na 03:30 CEST.
    const res = resolveLocalTimeToUtc('2026-03-29', '02:30');
    expect(res.adjusted).toBe(true);
  });
});

describe('todayInZone / hranice dňa (D31)', () => {
  it('deň sa v Bratislave zlomí skôr než v UTC', () => {
    // 22:30 UTC v lete = 00:30 nasledujúceho dňa v Bratislave (CEST)
    expect(todayInZone(new Date('2026-07-14T22:30:00Z'))).toBe('2026-07-15');
    // ale v zime (CET) je 22:30 UTC = 23:30 toho istého dňa
    expect(todayInZone(new Date('2026-01-14T22:30:00Z'))).toBe('2026-01-14');
  });

  it('startOfDayUtc a endOfDayExclusiveUtc rešpektujú zónu', () => {
    expect(startOfDayUtc('2026-07-15').toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(endOfDayExclusiveUtc('2026-07-15').toISOString()).toBe('2026-07-15T22:00:00.000Z');
    expect(startOfDayUtc('2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('zonedParts vracia lokálne zložky', () => {
    const p = zonedParts(new Date('2026-07-14T22:30:00Z'));
    expect(p).toMatchObject({ year: 2026, month: 7, day: 15, hour: 0, minute: 30 });
    expect(p.dateOnly).toBe('2026-07-15');
  });
});

describe('zamrznutie ±60 s okolo polnoci (D59)', () => {
  // lokálna polnoc 15.7.2026 v Bratislave = 14.7. 22:00:00 UTC
  const midnightUtc = new Date('2026-07-14T22:00:00Z');

  it('presne na polnoci a tesne okolo nej je zamrznuté', () => {
    expect(isMidnightFrozen(midnightUtc)).toBe(true);
    expect(isMidnightFrozen(new Date(midnightUtc.getTime() + 59_000))).toBe(true);
    expect(isMidnightFrozen(new Date(midnightUtc.getTime() - 59_000))).toBe(true);
  });

  it('60 s po polnoci už NIE JE zamrznuté; 60 s pred áno (hranica)', () => {
    expect(isMidnightFrozen(new Date(midnightUtc.getTime() + 60_000))).toBe(false);
    expect(isMidnightFrozen(new Date(midnightUtc.getTime() - 60_000))).toBe(true);
  });

  it('obed nie je zamrznutý a assert prejde', () => {
    const noon = new Date('2026-07-15T10:00:00Z');
    expect(isMidnightFrozen(noon)).toBe(false);
    expect(() => assertNotMidnightFrozen(noon)).not.toThrow();
  });

  it('assertNotMidnightFrozen hodí DomainError v zamrznutom okne', () => {
    expect(() => assertNotMidnightFrozen(midnightUtc)).toThrow(DomainError);
  });
});

describe('due / missed / okno (D32, D33b, D25)', () => {
  it('isDue: fire_at ≤ now', () => {
    const fire = new Date('2026-08-05T00:00:00Z');
    expect(isDue(fire, new Date('2026-08-05T00:00:00Z'))).toBe(true);
    expect(isDue(fire, new Date('2026-08-04T23:59:59Z'))).toBe(false);
  });

  it('isMissedFire: starší než tolerancia 5 min', () => {
    const fire = new Date('2026-08-05T00:00:00Z');
    expect(isMissedFire(fire, new Date('2026-08-05T00:05:00Z'))).toBe(false);
    expect(isMissedFire(fire, new Date('2026-08-05T00:05:01Z'))).toBe(true);
  });

  it('isWindowStillOpen: to ≥ dnes', () => {
    expect(isWindowStillOpen('2026-08-05', '2026-08-05')).toBe(true);
    expect(isWindowStillOpen('2026-08-04', '2026-08-05')).toBe(false);
  });
});
