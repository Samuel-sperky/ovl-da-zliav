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
 *  4. Hlavička písala „Fronta prázdna" aj vtedy, keď o fronte nevedela nič —
 *     pri nečitateľnej odpovedi `/api/queue`, pri nesúlade tvaru aj vždy, keď
 *     appka neodpovedala. Bolo to KLADNÉ tvrdenie, že na zápis nič nečaká, na
 *     každej obrazovke appky, hoci vo fronte mohli stáť tisíce položiek.
 *     „Prázdna" smie padnúť len z `total === 0` od servera.
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

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { QueueLink } from '@/components/layout/HeaderStatus';

import { classifyHealthStatus } from '@/components/layout/health';
import { parseQueueHeader, queueHeaderLabel } from '@/components/layout/queue';
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

/**
 * PRIMITÍVA SÚ TIEŽ CHRÓM (doplnené 3. 9. 2026).
 *
 * Skener meral len `src/components/layout/`. V6a k nemu pridal celú vrstvu
 * `src/components/ui/` — a tam už bod 4 nestrážil nikto: verifikácia V6c
 * vložila `setInterval(…, 30_000)` do `StatusPill.tsx` a celý balík zostal
 * zelený. Je to presne pasca „grep nad priečinkom A nepovie nič o diere
 * v priečinku B": primitívum s vlastným časovačom obnovuje čísla po celej
 * appke naraz a nikto o tom nevie.
 */
const CHROME_DIRS: readonly string[] = ['src/components/layout', 'src/components/ui'];

/**
 * Jediná povolená výnimka, a je vymenovaná: `Countdown` odpočítava čas, takže
 * tikať MUSÍ — bez tiku by zobrazoval zmrznutý údaj a to je horšie než pohyb.
 * Nič sa tým neobnovuje: komponent nesiaha na sieť, len prepočíta rozdiel.
 */
const TIMER_ALLOWED: readonly string[] = ['src/components/ui/Countdown.tsx'];

function chromeSources(): readonly { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  for (const dir of CHROME_DIRS) {
    const full = resolve(process.cwd(), dir);
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      const file = join(full, entry.name);
      out.push({
        path: relative(process.cwd(), file).split('\\').join('/'),
        /* Komentáre von: docblocky v tomto repe o zakázaných veciach PÍŠU
           (`refresh.ts` má v hlavičke vetu „v tomto module nie je
           `setInterval`") a naivný grep by ich označil za porušenie. */
        code: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' '),
      });
    }
  }
  return out;
}

describe('kontrakt UI, bod 4 — nič sa v chróme neobnovuje samo', () => {
  const sources = layoutSources();
  const chrome = chromeSources();

  it('sanity — skener naozaj číta chróm', () => {
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.some((f) => f.path.endsWith('StatusBar.tsx'))).toBe(true);
    // A skener časovačov musí vidieť AJ primitíva, inak stráži polovicu chrómu.
    expect(chrome.length).toBeGreaterThan(sources.length);
    expect(chrome.some((f) => f.path === 'src/components/ui/StatusPill.tsx')).toBe(true);
    expect(chrome.some((f) => f.path === 'src/components/ui/Countdown.tsx')).toBe(true);
  });

  it('žiadny modul chrómu ani primitívum nespúšťa časovač', () => {
    const hits = chrome
      .filter((f) => /\b(setInterval|setTimeout|requestAnimationFrame)\s*\(/.test(f.code))
      .filter((f) => !TIMER_ALLOWED.includes(f.path))
      .map((f) => f.path);
    expect(
      hits.join('\n'),
      'čísla sa obnovujú výhradne na vyžiadanie — pozri components/layout/refresh.ts',
    ).toBe('');
  });

  it('vymenovaná výnimka nesmie hniť — `Countdown` časovač naozaj má', () => {
    /* Keby `Countdown` tikať prestal, zoznam výnimiek by kryl prázdno a druhá
       vec, ktorá doň pribudne, by prešla bez povšimnutia. */
    const countdown = chrome.find((f) => f.path === 'src/components/ui/Countdown.tsx');
    expect(countdown).toBeDefined();
    expect(countdown!.code).toMatch(/\bsetInterval\s*\(/);
  });

  it('tlačidlo Obnoviť je v celej appke presne jedno', () => {
    // Hľadá sa NOSITEĽ (trieda tlačidla), nie slovo — to je aj v doc-blokoch.
    const hits = sources.filter((f) => f.code.includes('ovl-sbar-refresh')).map((f) => f.path);
    expect(hits).toEqual(['src/components/layout/StatusBar.tsx']);
  });
});

/* ════ Bod 4: „prázdna fronta" je tvrdenie, nie náhrada za nevedomosť ══════ */

describe('menovka fronty v hlavičke — nevieme sa nezlieva s prázdne', () => {
  /** Toľko položiek stálo vo fronte v deň, keď sa tento defekt našiel. */
  const WAITING = 4480;

  it('nečitateľné `done` NEHLÁSI prázdnu frontu', () => {
    const view = queueHeaderLabel(null, WAITING);
    expect(view.kind).toBe('unknown');
    expect(view.label.toLowerCase()).not.toContain('prázdn');
    expect(view.fraction).toBeNull();
  });

  it('nečitateľné `total` NEHLÁSI prázdnu frontu', () => {
    const view = queueHeaderLabel(0, null);
    expect(view.kind).toBe('unknown');
    expect(view.label.toLowerCase()).not.toContain('prázdn');
  });

  it('nič sa nevie (appka neodpovedá, `state.kind !== "ok"`) = pomlčka a slovo', () => {
    // Presne to, čo `HeaderRight` posiela, keď stav appky nie je `ok`.
    const view = queueHeaderLabel(null, null);
    expect(view.kind).toBe('unknown');
    expect(view.label).toContain('—');
    expect(view.label.toLowerCase()).toContain('nevieme');
    expect(view.label.toLowerCase()).not.toContain('prázdn');
    // Vysvetlenie musí ten rozdiel pomenovať, nielen mlčať.
    expect(view.title.toLowerCase()).toContain('prázdna fronta');
  });

  it('„prázdna" padne LEN z nuly, ktorú povedal server', () => {
    const view = queueHeaderLabel(0, 0);
    expect(view.kind).toBe('empty');
    expect(view.label).toBe('Fronta prázdna');
  });

  it('bežiaca fronta kreslí zlomok a nič nepriznáva', () => {
    const view = queueHeaderLabel(3420, 8000);
    expect(view.kind).toBe('running');
    expect(view.fraction).toBe('3 420/8 000');
    expect(view.label).toBe('Fronta');
  });

  it('tri stavy majú tri rôzne `data-state` — obrazovka ich musí odlíšiť', () => {
    const kinds = [
      queueHeaderLabel(null, null).kind,
      queueHeaderLabel(0, 0).kind,
      queueHeaderLabel(1, 2).kind,
    ];
    expect(new Set(kinds).size).toBe(3);
  });
});

describe('celá cesta od odpovede /api/queue po slovo na obrazovke', () => {
  /** Čo hlavička napíše pre dané telo odpovede. */
  function labelFor(body: unknown) {
    const { queue } = parseQueueHeader(body);
    return queueHeaderLabel(queue === null ? null : queue.done, queue === null ? null : queue.total);
  }

  it('telo, ktoré nie je objekt (HTML chybovky, prázdna odpoveď)', () => {
    for (const body of [null, undefined, '<html>502</html>', 42, []]) {
      expect(labelFor(body).kind, JSON.stringify(body) ?? 'undefined').toBe('unknown');
    }
  });

  it('`total` prišlo ako text — 4 480 položiek sa nesmie zmeniť na „prázdna"', () => {
    const view = labelFor({ queue: { done: 0, total: String(4480), campaigns: 1 } });
    expect(view.kind).toBe('unknown');
    expect(view.label.toLowerCase()).not.toContain('prázdn');
  });

  it('sekcia `queue` v odpovedi celkom chýba', () => {
    const view = labelFor({ writes: { spentToday: 10, budget: 200, resumeAt: null } });
    expect(view.kind).toBe('unknown');
  });

  it('server naozaj povedal nulu → prázdna fronta, a to je v poriadku', () => {
    expect(labelFor({ queue: { done: 0, total: 0, campaigns: 0 } }).kind).toBe('empty');
  });

  it('server povedal čísla → zlomok', () => {
    const view = labelFor({ queue: { done: 45, total: 4480, campaigns: 1 } });
    expect(view.kind).toBe('running');
    expect(view.fraction).toBe('45/4 480');
  });
});

/* ══════ A to isté nad naozaj vykresleným odkazom, nie len nad modelom ═════ */

describe('vykreslená menovka fronty (renderToStaticMarkup)', () => {
  const html = (done: number | null, total: number | null) =>
    renderToStaticMarkup(createElement(QueueLink, { done, total }));

  /**
   * To, čo používateľ NAOZAJ prečíta. Vysvetlenie v `title` slovo „prázdna
   * fronta" obsahovať SMIE (práve tým ten rozdiel pomenúva), na povrchu odkazu
   * pri neznámom stave nesmie padnúť.
   */
  const text = (out: string) => out.replace(/<[^>]*>/g, '').trim();

  it('nič sa nevie → na povrchu NIE JE „prázdna" a stav je `unknown`', () => {
    const out = html(null, null);
    expect(out).toContain('data-state="unknown"');
    expect(text(out).toLowerCase()).not.toContain('prázdn');
    expect(text(out)).toContain('nevieme');
    expect(text(out)).toContain('—');
  });

  it('server povedal nulu → „Fronta prázdna" a stav `empty`', () => {
    const out = html(0, 0);
    expect(out).toContain('data-state="empty"');
    expect(text(out)).toBe('Fronta prázdna');
  });

  it('bežiaca fronta → zlomok v `<b>` a stav `running`', () => {
    const out = html(3420, 8000);
    expect(out).toContain('data-state="running"');
    expect(out).toContain('<b>3 420/8 000</b>');
    expect(out).toContain('class="hqueue"');
  });

  it('oba nekladné stavy sú tlmené existujúcim tokenom `hqueue off`', () => {
    expect(html(null, null)).toContain('class="hqueue off"');
    expect(html(0, 0)).toContain('class="hqueue off"');
  });

  it('tri stavy = tri rôzne povrchy, ani dva sa nesmú zliať', () => {
    const surfaces = [text(html(null, null)), text(html(0, 0)), text(html(1, 2))];
    expect(new Set(surfaces).size).toBe(3);
  });
});
