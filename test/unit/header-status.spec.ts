/**
 * Aura Zľavy — testy PRAVDIVOSTI CHRÓMU (hlavička + stavový pruh).
 *
 * Tri klamlivé stavy, ktoré tento súbor stráži:
 *
 *  1. Chróm hlásil červené „stav appky nedostupný" aj vtedy, keď appka bežala
 *     úplne v poriadku a stavový endpoint len odmietol požiadavku bez session
 *     (401). Chýbajúca session NIE JE porucha appky a nesmie sa tak hlásiť —
 *     poslalo to používateľa hľadať neexistujúcu poruchu.
 *  2. Menovka režimu zápisov písala „dev · zápisy vypnuté", hoci appka bežala
 *     v `NODE_ENV=production` a vypnuté zápisy boli dané výhradne
 *     `WRITES_ENABLED=false`. Appka zapisuje do PRODUKČNÉHO shopu, takže
 *     označenie režimu zápisov nesmie tvrdiť nič o `NODE_ENV`.
 *  3. Čísla sa obnovovali samy. Kontrakt UI (13. 8. 2026, bod 4) automatické
 *     obnovovanie ruší: čísla sa načítajú pri otvorení a potom na vyžiadanie.
 *     Časovač v chróme je odteraz chyba, ktorú chytí test — nie vec názoru.
 *
 * HISTÓRIA NOSITEĽOV (aby bolo jasné, že sa tvrdenia nezoslabujú, len sťahujú)
 * --------------------------------------------------------------------------
 * Bod 2 strážila najprv čistá funkcia `writeModeView()` z
 * `components/layout/WriteModeBadge.tsx`, potom pruh `HeaderWritesStrip`
 * v `HeaderStatus.tsx`. V3 badge z hlavičky odstránil (ARCHITEKTURA §0 —
 * v hlavičke je výhradne fronta a téma) a kontrakt UI odstránil aj pruh: bol
 * to druhý nositeľ toho istého faktu a ukrajoval z výšky obrazovky, ktorú
 * obmedzuje P4. Fakt dnes nesie `writesChip()` v `layout/status.ts`, takže sa
 * proti nemu testuje priamo.
 *
 * Bod 1 strážila `headerStatusView()` z `HeaderStatus.tsx`; po zjednotení
 * chrómu na jedno čítanie `/api/status` ho nesie `connectionChip()` v
 * `layout/status.ts`. Štyri kombinácie (session × beží) sa testujú tam.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyHealthStatus } from '@/components/layout/health';
import { connectionChip, writesChip, type StatusState } from '@/components/layout/status';
import type { StatusPayload } from '@/lib/status/snapshot';

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

const NOW = '2026-08-12T10:00:00.000Z';

function payload(overrides: Partial<StatusPayload> = {}): StatusPayload {
  return {
    now: NOW,
    writes: { enabled: true, locked: false, lockedReason: null, lockedAt: null },
    apiKey: { present: true, expiresAt: '2026-09-09T10:00:00.000Z' },
    writeBudget: { day: '2026-08-12', budget: 200, spent: 21, remaining: 179, exhausted: false },
    scope: { mode: 'pilot', maxProductsSetting: 10, maxProducts: 10, failClosed: false },
    catalog: {
      loadedProducts: 2900,
      shopTotalProducts: 41_082,
      lastFetchedAt: '2026-08-12T09:40:00.000Z',
    },
    catalogReads: null,
    salesSync: null,
    blockers: [],
    summary: {
      blocked: false,
      blockingCount: 0,
      worstBlockerId: null,
      waitUntil: null,
      anyAssumed: false,
    },
    unreadable: [],
    ...overrides,
  };
}

describe('chróm netvrdí poruchu, ktorá neexistuje (štyri kombinácie)', () => {
  const cases: readonly { name: string; state: StatusState; tone: string }[] = [
    { name: 'prvé načítanie', state: { kind: 'loading', payload: null }, tone: 'idle' },
    {
      name: 'neprihlásený + appka beží',
      state: { kind: 'unauthenticated', payload: null },
      tone: 'idle',
    },
    { name: 'appka neodpovedá', state: { kind: 'unreachable', payload: null }, tone: 'critical' },
    { name: 'prihlásený + appka beží', state: { kind: 'ok', payload: payload() }, tone: 'good' },
  ];

  for (const { name, state, tone } of cases) {
    it(name, () => {
      expect(connectionChip(state).tone).toBe(tone);
    });
  }

  it('NEPRIHLÁSENÝ nikdy nehlási poruchu ani nedostupnosť', () => {
    const chip = connectionChip({ kind: 'unauthenticated', payload: null });
    expect(chip.label.toLowerCase()).not.toContain('nedostupn');
    expect(chip.label.toLowerCase()).not.toContain('chyba');
    expect(chip.label.toLowerCase()).toContain('prihlás');
  });

  it('stav bez payloadu je fail-closed, nikdy „ok"', () => {
    expect(connectionChip({ kind: 'ok', payload: null }).tone).toBe('critical');
  });
});

describe('menovka zápisov — režim zápisov je odlíšený od NODE_ENV', () => {
  it('vypnuté zápisy NETVRDIA „dev" ani nič o prostredí', () => {
    const chip = writesChip(
      payload({ writes: { enabled: false, locked: false, lockedReason: null, lockedAt: null } }),
    );
    expect(chip.label).toBe('Ostrý zápis vypnutý');
    expect(chip.label.toLowerCase()).not.toMatch(/\bdev\b/);
    expect(`${chip.label} ${chip.title}`).not.toMatch(/NODE_ENV/);
  });

  it('K10 — na povrchu nepadne „dry-run" ani názov premennej', () => {
    for (const enabled of [true, false]) {
      const chip = writesChip(
        payload({ writes: { enabled, locked: false, lockedReason: null, lockedAt: null } }),
      );
      const surface = `${chip.label} ${chip.title}`.toLowerCase();
      expect(surface).not.toContain('dry-run');
      expect(surface).not.toContain('writes_enabled');
    }
  });

  it('zapnuté zápisy sú kladné tvrdenie, nie ticho', () => {
    const chip = writesChip(payload());
    expect(chip.tone).toBe('good');
    expect(chip.label).toBe('Ostrý zápis zapnutý');
  });

  it('runaway zámok má prednosť pred vypnutými zápismi a je jediný červený', () => {
    const chip = writesChip(
      payload({ writes: { enabled: false, locked: true, lockedReason: null, lockedAt: NOW } }),
    );
    expect(chip.tone).toBe('critical');
    expect(chip.label).toBe('Zápisy zastavené');
  });
});

/* ═══════ Poistka bodu 4: v chróme nesmie byť ani jeden časovač ════════════ */

function layoutSources(): readonly { path: string; code: string }[] {
  const dir = resolve(process.cwd(), 'src/components/layout');
  const out: { path: string; code: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
    const full = join(dir, entry.name);
    out.push({
      path: relative(process.cwd(), full).split('\\').join('/'),
      code: readFileSync(full, 'utf8'),
    });
  }
  return out;
}

describe('kontrakt UI, bod 4 — nič sa v chróme neobnovuje samo', () => {
  const sources = layoutSources();

  it('sanity — skener naozaj číta chróm', () => {
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.some((f) => f.path.endsWith('StatusBar.tsx'))).toBe(true);
  });

  it('žiadny modul chrómu nespúšťa časovač', () => {
    const hits = sources
      .filter((f) => /\b(setInterval|setTimeout|requestAnimationFrame)\s*\(/.test(f.code))
      .map((f) => f.path);
    expect(
      hits.join('\n'),
      'čísla sa obnovujú výhradne na vyžiadanie — pozri components/layout/refresh.ts',
    ).toBe('');
  });

  it('tlačidlo Obnoviť je v celej appke presne jedno', () => {
    // Hľadá sa NOSITEĽ (trieda tlačidla), nie slovo — to je aj v doc-blokoch.
    const hits = sources.filter((f) => f.code.includes('ovl-sbar-refresh')).map((f) => f.path);
    expect(hits).toEqual(['src/components/layout/StatusBar.tsx']);
  });
});
