/**
 * Aura Zľavy — test sekvenčného strážcu proti race-u odpovedí (U9).
 *
 * AuditPanel pri rýchlej zmene filtrov odpaľuje viac `getAudit()` naraz;
 * stará (pomalšia) odpoveď nesmie prepísať novšiu. `createStaleGuard()`
 * čísluje požiadavky a `isCurrent()` pustí do stavu len tú poslednú.
 */
import { describe, expect, it } from 'vitest';

import { createStaleGuard } from '@/components/audit/AuditPanel';

describe('createStaleGuard (U9 — stará odpoveď neprepíše novšiu)', () => {
  it('posledná začatá požiadavka je jediná aktuálna', () => {
    const guard = createStaleGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false); // stará odpoveď sa zahodí
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('poradie doručenia odpovedí nerozhoduje — rozhoduje poradie štartu', () => {
    const guard = createStaleGuard();
    const a = guard.begin();
    const b = guard.begin();
    const c = guard.begin();
    // Odpovede prídu v poradí c, a, b — platná je len c.
    expect(guard.isCurrent(c)).toBe(true);
    expect(guard.isCurrent(a)).toBe(false);
    expect(guard.isCurrent(b)).toBe(false);
  });

  it('jediná požiadavka bez súbehu je aktuálna', () => {
    const guard = createStaleGuard();
    const token = guard.begin();
    expect(guard.isCurrent(token)).toBe(true);
  });
});
