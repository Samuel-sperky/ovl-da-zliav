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
 * Testujú sa čisté funkcie (`classifyHealthStatus`, `headerStatusView`,
 * `writeModeView`) — rovnaký vzor ako `chart-frame.spec.ts`.
 */
import { describe, expect, it } from 'vitest';

import { classifyHealthStatus } from '@/components/layout/health';
import { headerStatusView } from '@/components/layout/HeaderStatus';
import { writeModeView } from '@/components/layout/WriteModeBadge';

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

describe('writeModeView — režim zápisov je odlíšený od NODE_ENV', () => {
  it('zápisy povolené = žiadny badge (absencia varovania = ostrý zápis)', () => {
    expect(writeModeView({ writesEnabled: true, writesLocked: false })).toBeNull();
  });

  it('zápisy vypnuté NETVRDÍ „dev" — vypnutie je vlastnosť WRITES_ENABLED', () => {
    const v = writeModeView({ writesEnabled: false, writesLocked: false });
    expect(v).not.toBeNull();
    if (v === null) throw new Error('nedosiahnuteľné');
    expect(v.state).toBe('disabled');
    // Jadro opravy: badge nesmie hlásiť vývojový režim ani nič o NODE_ENV.
    expect(v.label.toLowerCase()).not.toContain('dev');
    expect(v.title).not.toContain('NODE_ENV');
    // Musí ostať jasné, že sa nezapisuje ostro.
    expect(v.label.toLowerCase()).toContain('zápisy vypnuté');
    expect(v.label.toLowerCase()).toContain('dry-run');
  });

  it('runaway zámok zostáva critical a má prednosť', () => {
    const v = writeModeView({ writesEnabled: false, writesLocked: true });
    expect(v).not.toBeNull();
    if (v === null) throw new Error('nedosiahnuteľné');
    expect(v.state).toBe('locked');
    expect(v.tone).toBe('critical');
  });

  it('zámok platí aj keď sú zápisy inak povolené', () => {
    const v = writeModeView({ writesEnabled: true, writesLocked: true });
    expect(v?.state).toBe('locked');
  });
});
