/**
 * Aura Zľavy — INVARIANT I8: „len scope `product:edit`" (A17).
 *
 * Appka NESMIE volať žiadny endpoint pod `/api/order` a NESMIE ukladať
 * čokoľvek zo zákazníckych dát. Test grepuje SKUTOČNÉ zdroje (`src/**`)
 * aj DB schému (`db/migrations/**`) — žiadny mock.
 *
 * Skener je tu zámerne duplikovaný z `no-clear-reduction.spec.ts`: import
 * medzi spec súbormi by testy druhého súboru registroval dvakrát a A17 nesmie
 * vytvoriť zdieľaný helper mimo svojho zoznamu vlastnených súborov.
 *
 * Vlastník: A17.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface SourceFile {
  path: string;
  code: string;
  lines: string[];
}

function listFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, pattern));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out.sort();
}

/** Odstráni `//` a `/* *\/` komentáre, zachová reťazce a počet riadkov. */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
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
      if (ch === '\n') out += ch;
      i += 1;
      continue;
    }
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

function load(dir: string, pattern: RegExp, strip: boolean): SourceFile[] {
  return listFiles(resolve(process.cwd(), dir), pattern).map((path) => {
    const raw = readFileSync(path, 'utf8');
    const code = strip ? stripComments(raw) : raw;
    return { path: relative(process.cwd(), path), code, lines: code.split('\n') };
  });
}

function scan(files: SourceFile[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
      if (re.test(text)) hits.push(`${file.path}:${index + 1}  ${text.trim()}`);
    });
  }
  return hits;
}

const sources = load('src', /\.(ts|tsx|mts|cts)$/, true);
const migrations = load('db/migrations', /\.sql$/, false);

describe('I8 — appka nikdy nesiaha na objednávky ani zákaznícke dáta', () => {
  it('sanity — skenujú sa skutočné zdroje aj migrácie', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(migrations.length).toBeGreaterThanOrEqual(8);
  });

  it('žiadna referencia na `/api/order`', () => {
    expect(scan(sources, /\/api\/orders?\b/i).join('\n')).toBe('');
  });

  it('žiadna referencia na `/api/cart`, `/api/customer` ani `/api/user` shopu', () => {
    expect(scan(sources, /\/api\/(cart|customers?|clients?|invoices?)\b/i).join('\n')).toBe('');
  });

  it('žiadny scope okrem `product:edit`', () => {
    const scopes = new Set<string>();
    for (const file of sources) {
      for (const match of file.code.matchAll(/['"`]([a-z_]+:[a-z_]+)['"`]/g)) {
        const value = match[1] ?? '';
        if (/^(product|order|customer|cart|invoice|user)s?:/.test(value)) scopes.add(value);
      }
    }
    expect([...scopes].sort()).toEqual(expect.not.arrayContaining(['orders:read']));
    for (const scope of scopes) expect(scope).toBe('product:edit');
  });

  it('slovo `orders:read` sa v zdrojoch nevyskytuje ani ako komentár typu kódu', () => {
    expect(scan(sources, /orders\s*:\s*read/i).join('\n')).toBe('');
  });

  it('DB schéma neobsahuje žiadnu tabuľku ani stĺpec so zákazníckymi dátami', () => {
    const forbidden =
      /\b(order|orders|customer|customers|cart|invoice|email|phone|address|surname|first_name|last_name|iban|payment)\b/i;
    const hits = scan(
      migrations.map((file) => ({
        ...file,
        // Zaujímajú nás len DDL riadky (definície tabuliek a stĺpcov).
        lines: file.lines.map((line) => (line.trimStart().startsWith('--') ? '' : line)),
      })),
      forbidden,
    );
    expect(hits.join('\n'), 'I8: zákaznícke dáta sa neukladajú nikdy').toBe('');
  });

  it('kontrakty nedefinujú žiadny typ objednávky ani zákazníka', () => {
    const contracts = sources.find((f) => f.path === 'src/contracts.ts');
    expect(contracts).toBeDefined();
    const hits = scan(
      [contracts as SourceFile],
      /\b(interface|type)\s+\w*(Order|Customer|Cart|Invoice)\w*\b/,
    );
    expect(hits.join('\n')).toBe('');
  });
});
