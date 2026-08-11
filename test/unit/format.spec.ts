/**
 * Aura Zľavy — testy formátovacích utilít (U11).
 *
 * Neplatný `expiresAt` (rozbitý string zo servera) nesmie nikdy vyústiť do
 * „kľúč: NaN h NaN min“.
 *
 * ZMENA V3: nositeľom tejto poistky bol `secondsLeftFrom()` z
 * `components/layout/KeyTtlBadge.tsx`. V3 badge z hlavičky odstránil
 * (ARCHITEKTURA §0 — v hlavičke je len rozpočet, fronta a téma) a jediným
 * miestom, kde sa dnes odpočítava k `expiresAt`, je `components/ui/Countdown`.
 * Tvrdenie sa preto NEZOSLABUJE, len sa presúva na aktuálneho nositeľa:
 * `Countdown` s rozbitým dátumom musí vykresliť „—“, nie „NaN h NaN min“.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import Countdown from '@/components/ui/Countdown';
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

describe('Countdown (U11 — neplatný expiresAt sa nesmie stať „NaN h NaN min“)', () => {
  const html = (expiresAt: string | number | Date | null): string =>
    renderToStaticMarkup(createElement(Countdown, { expiresAt }));

  it('neplatný ISO string → „—“, nikdy NaN', () => {
    for (const broken of ['nie-je-datum', '', 'undefined']) {
      const out = html(broken);
      expect(out).not.toContain('NaN');
      expect(out).toContain('—');
    }
  });

  it('chýbajúca hodnota → „—“', () => {
    expect(html(null)).toContain('—');
  });

  it('platný budúci čas → zvyšný čas, žiadne NaN', () => {
    const out = html(new Date(Date.now() + 3_600_000 + 5_000));
    expect(out).not.toContain('NaN');
    expect(out).toMatch(/\d+\s*(h|min|s)/);
  });

  it('expirovaný čas → „expirovaný“, nie záporné číslo', () => {
    const out = html(new Date(Date.now() - 3_600_000));
    expect(out).toContain('expirovaný');
    expect(out).not.toContain('-');
  });
});
