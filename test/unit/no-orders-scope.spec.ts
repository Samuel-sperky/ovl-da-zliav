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

/**
 * I8' (KONTRAKT-PREDAJNOST-2026-08-06 §5): objednávky sa smú ČÍTAŤ, ale len
 * kvôli súčtom predaných kusov, len z jediného modulu, a do DB sa z nich nikdy
 * nesmie dostať riadok objednávky ani zákaznícky údaj.
 *
 * Jediný modul, ktorý smie volať objednávkové endpointy shopu. Whitelist je
 * úmyselne JEDNOPRVKOVÝ — každý ďalší modul s prístupom k objednávkam je
 * rozhodnutie, ktoré patrí do kontraktu, nie do kódu.
 */
const ORDERS_CLIENT = 'src/lib/shop/orders-client.ts';

/** Scopes, ktoré appka smie poznať. Nič iné (zákazníci, košíky, faktúry). */
const ALLOWED_SCOPES = ['orders:read', 'product:edit'];

function outsideOrdersClient(files: SourceFile[]): SourceFile[] {
  return files.filter((file) => file.path.split('\\').join('/') !== ORDERS_CLIENT);
}

describe("I8' — objednávky len na súčty predaja, nikdy zákaznícke dáta", () => {
  it('sanity — skenujú sa skutočné zdroje aj migrácie', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(migrations.length).toBeGreaterThanOrEqual(8);
  });

  it('`/api/order` sa volá VÝHRADNE z orders-client.ts', () => {
    expect(scan(outsideOrdersClient(sources), /\/api\/orders?\b/i).join('\n')).toBe('');
  });

  it('orders-client.ts nesmie volať zápisový endpoint shopu (setReduction)', () => {
    const client = sources.find((f) => f.path.split('\\').join('/') === ORDERS_CLIENT);
    // Modul nemusí existovať (invariant platí aj pred jeho vznikom), ale keď
    // existuje, nesmie mať so zápisom zliav nič spoločné — objednávkový kľúč
    // sa nikdy nesmie dostať k `setReduction` (I8' bod 4).
    if (client) {
      expect(scan([client], /setReduction/).join('\n')).toBe('');
    }
  });

  it('žiadna referencia na `/api/cart`, `/api/customer` ani `/api/user` shopu', () => {
    expect(scan(sources, /\/api\/(cart|customers?|clients?|invoices?)\b/i).join('\n')).toBe('');
  });

  it('žiadny scope okrem `product:edit` a `orders:read`', () => {
    const scopes = new Set<string>();
    for (const file of sources) {
      for (const match of file.code.matchAll(/['"`]([a-z_]+:[a-z_]+)['"`]/g)) {
        const value = match[1] ?? '';
        if (/^(product|order|customer|cart|invoice|user)s?:/.test(value)) scopes.add(value);
      }
    }
    for (const scope of scopes) expect(ALLOWED_SCOPES).toContain(scope);
  });

  it('zákaznícke scopes sú zakázané aj naďalej', () => {
    expect(scan(sources, /['"`](customers?|carts?|invoices?|users?):/i).join('\n')).toBe('');
  });

  it('DB schéma neobsahuje žiadnu tabuľku ani stĺpec so zákazníckymi dátami', () => {
    // P4: z objednávok sa ukladajú VÝHRADNE súčty (produkt, deň, kusy).
    // Preto sú zakázané aj `country` a `total_paid` — krajina je údaj o doručení
    // a suma sa dá priradiť len objednávke, nie položke.
    const forbidden =
      /\b(order|orders|customer|customers|cart|invoice|email|phone|address|surname|first_name|last_name|iban|payment|country|country_iso|total_paid)\b/i;
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
    // Na Windows vracia `relative()` cesty s obrátenými lomkami — porovnanie
    // musí byť na separátore nezávislé, inak test tichým `undefined` prejde.
    const contracts = sources.find((f) => f.path.split('\\').join('/') === 'src/contracts.ts');
    expect(contracts).toBeDefined();
    const hits = scan(
      [contracts as SourceFile],
      /\b(interface|type)\s+\w*(Order|Customer|Cart|Invoice)\w*\b/,
    );
    expect(hits.join('\n')).toBe('');
  });
});
