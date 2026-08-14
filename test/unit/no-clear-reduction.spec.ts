/**
 * Aura Zľavy — INVARIANT I7: „žiadne rušenie zľavy" (A17).
 *
 * V kóde NESMIE existovať cesta, ktorá pošle `setReduction` s `to` v minulosti
 * za účelom zrušenia, ani funkcia pojmenovaná ako `clear`/`cancel` zľavy
 * v shope. Rušiť sa dá len kampaň v NAŠEJ DB.
 *
 * Testuje sa zvonku, dvoma nezávislými spôsobmi:
 *   1. **grep skutočných zdrojov** `src/**` (s odstránenými komentármi — komentár
 *      smie invariant vysvetľovať, kód ho smie len dodržať),
 *   2. **behaviorálne** — skutočný guard `checkWriteWindow()` odmietne `to`
 *      v minulosti bez toho, aby sa čokoľvek poslalo na shop.
 *
 * Vlastník: A17.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** `src\lib\x.ts` → `src/lib/x.ts`. Porovnania ciest v teste sú s lomkami. */
const toPosix = (p: string): string => p.split(sep).join('/');

import { describe, expect, it } from 'vitest';

import type { DateOnly } from '@/contracts';
import { GUARD_CODES, checkWriteWindow } from '@/lib/engine/guards';

/* ══════════════════════════ zdrojový skener ═══════════════════════════════ */

const SRC_ROOT = resolve(process.cwd(), 'src');

interface SourceFile {
  path: string;
  /** Obsah bez komentárov — reťazcové literály zostávajú. */
  code: string;
  lines: string[];
}

function listSourceFiles(dir = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

/**
 * Odstráni riadkové aj blokové komentáre, ale zachová reťazce a template
 * literály (v nich by sa zakázaný endpoint dal schovať) a zachová počet riadkov.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let state: State = 'code';

  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      out += ch;
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += ch;
      }
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      if (ch === '\n') out += ch; // zachovaj číslovanie riadkov
      i += 1;
      continue;
    }

    // vnútro reťazca / template literálu
    if (ch === '\\') {
      out += ch + next;
      i += 2;
      continue;
    }
    if (
      (state === 'single' && ch === "'") ||
      (state === 'double' && ch === '"') ||
      (state === 'template' && ch === '`')
    ) {
      state = 'code';
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function loadSources(): SourceFile[] {
  return listSourceFiles().map((path) => {
    const code = stripComments(readFileSync(path, 'utf8'));
    // Lomky normalizujeme, lebo `relative()` dá na Windows `src\lib\…` a všetky
    // porovnania nižšie sú písané s `/`. Bez toho tieto testy na Windows
    // nekontrolujú invariant I7, len ticho padnú na sanity kroku.
    return { path: toPosix(relative(process.cwd(), path)), code, lines: code.split('\n') };
  });
}

export interface Hit {
  path: string;
  line: number;
  text: string;
}

export function scanSources(sources: SourceFile[], pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const file of sources) {
    file.lines.forEach((text, index) => {
      const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
      if (re.test(text)) hits.push({ path: file.path, line: index + 1, text: text.trim() });
    });
  }
  return hits;
}

function format(hits: Hit[]): string {
  return hits.map((h) => `${h.path}:${h.line}  ${h.text}`).join('\n');
}

const sources = loadSources();

/* ═══════════════════════════════ testy ════════════════════════════════════ */

describe('I7 — v zdrojoch neexistuje rušenie zľavy v shope', () => {
  it('načítali sa skutočné zdroje (sanity — inak by test bol falošne zelený)', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((f) => f.path.endsWith('src/lib/engine/executor.ts'))).toBe(true);
  });

  it('neexistuje identifikátor clearReduction / cancelReduction a spol.', () => {
    const hits = scanSources(
      sources,
      /\b(clear|cancel|remove|delete|reset|revoke|undo|drop)(Reduction|Discount|Zlava|Zlavu)\b/i,
    );
    expect(format(hits), 'I7: funkcia rušiaca zľavu v shope nesmie existovať').toBe('');
  });

  it('neexistuje cesta k shop endpointu, ktorý zľavu ruší', () => {
    const hits = scanSources(
      sources,
      /\/api\/products\/(clear|cancel|remove|delete|reset)[A-Za-z]*/i,
    );
    expect(format(hits)).toBe('');
  });

  it('okrem `setReduction` sa nepoužíva žiadny iný zápisový endpoint produktov', () => {
    const paths = new Set<string>();
    for (const file of sources) {
      for (const match of file.code.matchAll(/['"`](\/api\/[A-Za-z0-9/_.-]*)['"`]/g)) {
        paths.add(match[1] ?? '');
      }
    }
    const shopWritePaths = [...paths].filter(
      (p) => p.startsWith('/api/products/') || p.startsWith('/api/batch'),
    );
    // `getFull` pribudol 13. 8. 2026 s API v5 — je to ČÍTANIE so scope
    // `product:read` (vracia skutočný stav zľavy, maržu, sklad, kategórie).
    // Zapisovať sa ním nedá; v zozname je preto, že filter nižšie berie všetko
    // pod `/api/products/`, nielen zápisové cesty.
    for (const path of shopWritePaths) {
      expect([
        '/api/products/setReduction',
        '/api/products/get',
        '/api/products/getFull',
        '/api/batch',
      ]).toContain(path);
    }
  });

  it('žiadny literál dátumu v minulosti sa nepoužíva ako `to`', () => {
    // Tvary zakázaného hacku: `to: <niečo mínus dni>`, `to: addDays(..., -N)`,
    // `to: yesterday`, `to: '1970-…'`.
    const hits = scanSources(
      sources,
      /\bto\s*:\s*(?:addDays\s*\([^)]*,\s*-|sub\w*\s*\(|['"`](?:19\d\d|20[01]\d)-)/i,
    );
    expect(format(hits), 'I7: `to` v minulosti je zakázaný tvar zápisu').toBe('');
  });

  it('kompletná sada zdrojov je konzistentná — `setReduction` volá jediné miesto', () => {
    const callers = sources.filter((f) => /\.setReduction\s*\(/.test(f.code)).map((f) => f.path);
    // Volá ho executor (D46, I10); klient obsahuje jeho implementáciu.
    expect(callers.sort()).toEqual(['src/lib/engine/executor.ts']);
  });
});

describe('I7 — guard odmietne `to` v minulosti ešte pred shopom', () => {
  const now = new Date('2026-08-05T10:00:00.000Z');
  const deps = { now: () => now };

  it('`to` v minulosti => refuse s kódom to_in_past', () => {
    const result = checkWriteWindow(
      { percent: 20, from: '2026-08-01' as DateOnly, to: '2026-08-04' as DateOnly },
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.toInPast);
  });

  it('`to` = dnes je stále platné (expirácia nie je rušenie)', () => {
    const result = checkWriteWindow(
      { percent: 20, from: '2026-08-05' as DateOnly, to: '2026-08-05' as DateOnly },
      deps,
    );
    expect(result.ok).toBe(true);
  });

  it('`to < from` je odmietnuté (I9)', () => {
    const result = checkWriteWindow(
      { percent: 20, from: '2026-08-10' as DateOnly, to: '2026-08-09' as DateOnly },
      deps,
    );
    expect(result.ok).toBe(false);
  });
});
