/**
 * Aura Zľavy — testy pravdivosti stavových badgeov v hlavičke.
 *
 * Dva klamlivé stavy, ktoré tento súbor stráži:
 *
 *  1. Hlavička hlásila červené „stav appky nedostupný" aj vtedy, keď appka
 *     bežala úplne v poriadku a `/api/health` len odmietol požiadavku bez
 *     session (401). Chýbajúca session NIE JE porucha appky a nesmie sa tak
 *     hlásiť — poslalo to používateľa hľadať neexistujúcu poruchu.
 *  2. Badge režimu zápisov písal „dev · zápisy vypnuté", hoci appka bežala
 *     v `NODE_ENV=production` a vypnuté zápisy boli dané výhradne
 *     `WRITES_ENABLED=false`. Appka zapisuje do PRODUKČNÉHO shopu, takže
 *     označenie režimu zápisov nesmie tvrdiť nič o `NODE_ENV`.
 *
 * ZMENA V3: bod 2 strážil čistá funkcia `writeModeView()` z
 * `components/layout/WriteModeBadge.tsx`. V3 badge z hlavičky odstránil —
 * podľa ARCHITEKTURA §0 je v hlavičke výhradne rozpočet, fronta a téma — a
 * fakt o vypnutých zápisoch nesie pruh pod hlavičkou (`HeaderWritesStrip`
 * v `HeaderStatus.tsx`). Tvrdenie sa preto nezoslabuje, len sa presúva na
 * nového nositeľa; navyše sa sprísňuje o K10 (slovo „dry-run" je na povrchu
 * zakázané, takže pôvodné `toContain('dry-run')` by dnes bolo v rozpore
 * s kontraktom).
 *
 * Testujú sa čisté funkcie (`classifyHealthStatus`, `headerStatusView`) a
 * zdroj pruhu o zápisoch.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyHealthStatus } from '@/components/layout/health';
import { headerStatusView } from '@/components/layout/HeaderStatus';

describe('classifyHealthStatus — 401 nie je porucha appky', () => {
  it('200 = ok', () => {
    expect(classifyHealthStatus(200)).toBe('ok');
  });

  it('401 = chýbajúca session, NIE nedostupná appka', () => {
    expect(classifyHealthStatus(401)).toBe('unauthenticated');
  });

  it('403 = chýbajúce oprávnenie, NIE nedostupná appka', () => {
    expect(classifyHealthStatus(403)).toBe('unauthenticated');
  });

  it('500 a 502 = appka je naozaj nedostupná', () => {
    expect(classifyHealthStatus(500)).toBe('unreachable');
    expect(classifyHealthStatus(502)).toBe('unreachable');
  });

  it('404 = nedostupná (endpoint nie je tam, kde má byť)', () => {
    expect(classifyHealthStatus(404)).toBe('unreachable');
  });
});

const HEALTH = {
  status: 'ok' as const,
  db: true,
  key: { present: true, expiresAt: null },
  scheduler: { lastTickAt: null, ageSec: null },
  writesEnabled: false,
  writesLocked: false,
  version: 'test',
};

describe('headerStatusView — všetky štyri kombinácie (session × beží)', () => {
  it('prvé načítanie = shimmer, žiadne tvrdenie o stave', () => {
    const v = headerStatusView({
      loading: true,
      unauthenticated: false,
      unreachable: false,
      health: null,
    });
    expect(v.kind).toBe('loading');
  });

  it('prihlásený + appka beží = normálne badge', () => {
    const v = headerStatusView({
      loading: false,
      unauthenticated: false,
      unreachable: false,
      health: HEALTH,
    });
    expect(v.kind).toBe('ok');
  });

  it('prihlásený + appka nebeží = critical „nedostupný"', () => {
    const v = headerStatusView({
      loading: false,
      unauthenticated: false,
      unreachable: true,
      health: null,
    });
    expect(v.kind).toBe('unreachable');
    if (v.kind !== 'unreachable') throw new Error('nedosiahnuteľné');
    expect(v.tone).toBe('critical');
    expect(v.label).toContain('nedostupn');
  });

  it('NEPRIHLÁSENÝ + appka beží = neutrál, NIKDY nehlási poruchu', () => {
    const v = headerStatusView({
      loading: false,
      unauthenticated: true,
      unreachable: false,
      health: null,
    });
    expect(v.kind).toBe('unauthenticated');
    if (v.kind !== 'unauthenticated') throw new Error('nedosiahnuteľné');
    // Toto je jadro opravy: neutrálny tón, žiadne slovo o nedostupnosti.
    expect(v.tone).toBe('idle');
    expect(v.label.toLowerCase()).not.toContain('nedostupn');
    expect(v.label.toLowerCase()).not.toContain('chyba');
    expect(v.label.toLowerCase()).toContain('prihlás');
  });

  it('neprihlásený stav má prednosť pred `unreachable`, keď oba prídu spolu', () => {
    const v = headerStatusView({
      loading: false,
      unauthenticated: true,
      unreachable: true,
      health: null,
    });
    expect(v.kind).toBe('unauthenticated');
  });

  it('neprihlásený + appka nebeží (žiadna odpoveď) = critical nedostupný', () => {
    const v = headerStatusView({
      loading: false,
      unauthenticated: false,
      unreachable: true,
      health: null,
    });
    expect(v.kind).toBe('unreachable');
  });

  it('health chýba bez známeho dôvodu = fail-closed critical, nie „ok"', () => {
    const v = headerStatusView({
      loading: false,
      unauthenticated: false,
      unreachable: false,
      health: null,
    });
    expect(v.kind).toBe('unreachable');
  });
});

describe('pruh o zápisoch — režim zápisov je odlíšený od NODE_ENV', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/layout/HeaderStatus.tsx'),
    'utf8',
  );

  /** Telo `HeaderWritesStrip` — jediné miesto, kde sa o zápisoch tvrdí stav. */
  const strip = (() => {
    const start = source.indexOf('export function HeaderWritesStrip');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\nexport ', start + 1);
    return source.slice(start, end === -1 ? source.length : end);
  })();

  it('zápisy povolené = žiadny pruh (absencia varovania = ostrý zápis)', () => {
    expect(strip).toContain('return null');
  });

  it('vypnuté zápisy NETVRDIA „dev" ani nič o NODE_ENV', () => {
    // Jadro pôvodnej opravy: vypnutie je vlastnosť WRITES_ENABLED, nie prostredia.
    expect(strip).not.toMatch(/NODE_ENV/);
    expect(strip.toLowerCase()).not.toMatch(/\bdev\b/);
    // Musí ostať jasné, že sa nezapisuje ostro.
    expect(strip).toContain('Ostrý zápis vypnutý');
    expect(strip).toContain('data-state="disabled"');
  });

  it('K10 — na povrchu nepadne „dry-run" ani „WRITES_ENABLED"', () => {
    expect(strip.toLowerCase()).not.toContain('dry-run');
    // Premenná `writesEnabled` je v kóde v poriadku; zakázaný je len TEXT
    // vykreslený používateľovi.
    const rendered = strip.match(/>[^<>{}]*[A-Za-zÁ-ž][^<>{}]*</g) ?? [];
    for (const text of rendered) {
      expect(text.toLowerCase()).not.toContain('writes_enabled');
      expect(text.toLowerCase()).not.toContain('dry-run');
    }
  });

  it('runaway zámok má vlastný, prísnejší stav a prednosť pred vypnutými zápismi', () => {
    expect(strip).toContain('data-state="locked"');
    // Zámok sa vyhodnocuje PRED `writesEnabled` — inak by ho vypnuté zápisy prekryli.
    expect(strip.indexOf('writesLocked')).toBeLessThan(strip.indexOf('!health.writesEnabled'));
  });
});
