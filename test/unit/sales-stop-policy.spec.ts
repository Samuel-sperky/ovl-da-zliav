/**
 * Aura Zľavy — politika zastavenia predajnosti (`lib/sales/stop-policy.ts`).
 *
 * Modul je čistý, takže test nepotrebuje DB, shop ani čas systému. Testuje sa
 * jediná otázka: kedy sa appka smie ozvať a kedy má mlčať.
 */
import { describe, expect, it } from 'vitest';

import {
  IP_BAN_MAX_WAIT_MS,
  IP_BAN_MIN_WAIT_MS,
  classifySalesStop,
  decideSalesBlock,
  ipBanWaitMs,
  salesBlockNextStep,
  salesBlockWhat,
} from '@/lib/sales/stop-policy';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const AT = new Date('2026-08-22T06:00:00.000Z');

describe('stop-policy — zaradenie kódu', () => {
  it('403 a 401 sú trvalé prekážky, nie chyby na zopakovanie', () => {
    expect(classifySalesStop('forbidden')).toBe('permission');
    expect(classifySalesStop('unauthorized')).toBe('permission');
  });

  it('zablokovaná IP je vlastný, prísnejší stupeň', () => {
    expect(classifySalesStop('ip_banned')).toBe('ip_ban');
  });

  it('429, 500 a sieť trvalou prekážkou NIE SÚ — tie sa opakovaním vyliečia', () => {
    for (const code of ['rate_limited', 'server_error', 'network', 'local_Error', 'not_found']) {
      expect(classifySalesStop(code)).toBeNull();
    }
    expect(classifySalesStop(null)).toBeNull();
    expect(classifySalesStop('  ')).toBeNull();
  });
});

describe('stop-policy — ako sa z prekážky vychádza', () => {
  it('chýbajúce oprávnenie NEDOSTANE termín — na rozvrhu sa neskúša', () => {
    const block = decideSalesBlock(
      { code: 'forbidden', at: AT, since: new Date(AT.getTime() - 12 * DAY) },
      { keySavedAt: null },
    );

    expect(block?.kind).toBe('permission');
    expect(block?.probeAt).toBeNull();
  });

  it('nový objednávkový kľúč prekážku zruší, starší ju nechá stáť', () => {
    const record = { code: 'forbidden', at: AT, since: AT };

    const after = decideSalesBlock(record, { keySavedAt: new Date(AT.getTime() + 1) });
    expect(after).toBeNull();

    const before = decideSalesBlock(record, { keySavedAt: new Date(AT.getTime() - 1) });
    expect(before?.kind).toBe('permission');
  });

  it('prvý pokus po zablokovanej IP je o šesť hodín, nie o dvadsať', () => {
    const block = decideSalesBlock({ code: 'ip_banned', at: AT, since: AT }, { keySavedAt: null });

    expect(block?.probeAt?.getTime()).toBe(AT.getTime() + IP_BAN_MIN_WAIT_MS);
  });

  it('odstup rastie s vekom prekážky a zastaví sa na týždni', () => {
    expect(ipBanWaitMs(0)).toBe(IP_BAN_MIN_WAIT_MS);
    expect(ipBanWaitMs(HOUR)).toBe(IP_BAN_MIN_WAIT_MS);
    expect(ipBanWaitMs(12 * HOUR)).toBe(12 * HOUR);
    expect(ipBanWaitMs(30 * DAY)).toBe(IP_BAN_MAX_WAIT_MS);
  });

  it('odstup sa počíta k poslednému pokusu, nie k „teraz" — inak sa termín nikdy nedostaví', () => {
    // Rovnaký záznam vráti rovnaký termín bez ohľadu na to, kedy sa naň pýtame.
    const record = { code: 'ip_banned', at: AT, since: new Date(AT.getTime() - 2 * DAY) };

    const first = decideSalesBlock(record, { keySavedAt: null });
    const later = decideSalesBlock(record, { keySavedAt: null });

    expect(first?.probeAt?.getTime()).toBe(AT.getTime() + 2 * DAY);
    expect(later?.probeAt?.getTime()).toBe(first?.probeAt?.getTime());
  });

  it('čistý stav nie je prekážka', () => {
    expect(decideSalesBlock({ code: null, at: null, since: null }, { keySavedAt: null })).toBeNull();
    expect(
      decideSalesBlock({ code: 'rate_limited', at: AT, since: AT }, { keySavedAt: null }),
    ).toBeNull();
  });
});

describe('stop-policy — vety pre povrch', () => {
  it('obe vety sa zmestia do 90 znakov (P2)', () => {
    for (const kind of ['permission', 'ip_ban'] as const) {
      expect(salesBlockWhat(kind).length).toBeLessThanOrEqual(90);
      expect(salesBlockNextStep(kind).length).toBeLessThanOrEqual(90);
    }
  });

  it('veta hovorí, čo shop odpovedal, nie prečo (P8)', () => {
    for (const kind of ['permission', 'ip_ban'] as const) {
      expect(salesBlockWhat(kind)).not.toMatch(/pretože|lebo|kvôli|zaban/i);
    }
  });

  it('krok pre človeka nie je prázdny a nesľubuje, že to appka vyrieši sama', () => {
    expect(salesBlockNextStep('permission')).toContain('Nastaveniach');
    expect(salesBlockNextStep('ip_ban')).toContain('eshop');
  });
});
