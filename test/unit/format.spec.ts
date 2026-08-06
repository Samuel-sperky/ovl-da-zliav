/**
 * Aura Zľavy — testy formátovacích utilít (U11).
 *
 * Neplatný `expiresAt` (rozbitý string zo servera) nesmie nikdy vyústiť do
 * „kľúč: NaN h NaN min“: `formatCountdownSk` musí na nekonečno/NaN vrátiť
 * `—` a `secondsLeftFrom` (KeyTtlBadge) musí na neplatný ISO string vrátiť
 * `null`, čo badge zobrazí ako „kľúč chýba“.
 */
import { describe, expect, it } from 'vitest';

import { secondsLeftFrom } from '@/components/layout/KeyTtlBadge';
import { formatCountdownSk } from '@/lib/ui/format';

describe('formatCountdownSk (U11 — NaN guard)', () => {
  it('NaN → "—", nikdy "NaN h NaN min"', () => {
    expect(formatCountdownSk(Number.NaN)).toBe('—');
  });

  it('Infinity → "—"', () => {
    expect(formatCountdownSk(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('null/undefined → "—"', () => {
    expect(formatCountdownSk(null)).toBe('—');
    expect(formatCountdownSk(undefined)).toBe('—');
  });

  it('platné hodnoty formátuje ako doteraz', () => {
    expect(formatCountdownSk(0)).toBe('expirovaný');
    expect(formatCountdownSk(-5)).toBe('expirovaný');
    expect(formatCountdownSk(42)).toBe('42 s');
    expect(formatCountdownSk(58 * 60 + 3)).toBe('58 min 3 s');
    expect(formatCountdownSk(47 * 3600 + 12 * 60)).toBe('47 h 12 min');
  });
});

describe('secondsLeftFrom (U11 — neplatný expiresAt v KeyTtlBadge)', () => {
  const NOW = Date.parse('2026-08-06T10:00:00.000Z');

  it('neplatný ISO string → null (badge zobrazí „kľúč chýba“)', () => {
    expect(secondsLeftFrom('nie-je-datum', NOW)).toBeNull();
    expect(secondsLeftFrom('', NOW)).toBeNull();
  });

  it('platný ISO string → zvyšné sekundy', () => {
    expect(secondsLeftFrom('2026-08-06T11:00:00.000Z', NOW)).toBe(3600);
  });

  it('expirovaný kľúč → záporné/nulové sekundy, nie null', () => {
    expect(secondsLeftFrom('2026-08-06T09:00:00.000Z', NOW)).toBe(-3600);
  });
});
