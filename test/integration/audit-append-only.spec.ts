/**
 * Aura Zľavy — INVARIANT I4: audit je append-only (A17, BUILD-SPEC §3, D74, D75).
 *
 * Dve nezávislé roviny, obe zvonku:
 *   1. **GRANTY v reálnej DB** — aplikačný user smie na `audit_log` len
 *      `SELECT, INSERT`; `UPDATE`, `DELETE` aj akékoľvek DDL musia zlyhať
 *      na chybe grantu (nie na aplikačnej kontrole, tú sa dá obísť).
 *   2. **grep zdrojov a migrácií** — v `src/**` neexistuje `UPDATE`/`DELETE`
 *      nad `audit_log`, `TRUNCATE` ani retenčný job, a migrácia grantov
 *      neudeľuje nič nad `SELECT, INSERT`.
 *
 * Vlastník: A17.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLogPermissions, dbAvailable, setupTestDb, withAppConn, withMigrationConn } from '../helpers/db';

/* ═════════════════════════ zdrojový skener (grep) ═════════════════════════ */

function listFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, pattern));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out.sort();
}

interface Loaded {
  path: string;
  text: string;
}

function load(dir: string, pattern: RegExp): Loaded[] {
  return listFiles(resolve(process.cwd(), dir), pattern).map((path) => ({
    // Na Windows dá `relative()` `src\lib\…`; porovnania nižšie sú s `/`, takže
    // bez normalizácie by sken invariantu I4 na Windows nebežal vôbec.
    path: relative(process.cwd(), path).split(sep).join('/'),
    text: readFileSync(path, 'utf8'),
  }));
}

/** Riadky, ktoré NIE SÚ komentár (`//`, `*`, `--`) a matchujú vzor. */
function codeHits(files: Loaded[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    file.text.split('\n').forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('--')) return;
      const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
      if (re.test(line)) hits.push(`${file.path}:${index + 1}  ${trimmed}`);
    });
  }
  return hits;
}

const sources = load('src', /\.(ts|tsx|mts|cts)$/);
const migrations = load('db/migrations', /\.sql$/);
const scripts = load('scripts', /\.ts$/);

/* ══════════════════════════ 1. statická rovina ════════════════════════════ */

describe('I4 — v kóde neexistuje mutácia auditu', () => {
  it('sanity — skenujú sa skutočné zdroje', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((f) => f.path === 'src/lib/audit/write.ts')).toBe(true);
  });

  it('žiadny UPDATE/DELETE/TRUNCATE/REPLACE nad audit_log v src/**', () => {
    const hits = codeHits(
      sources,
      /\b(update|delete\s+from|truncate(\s+table)?|replace\s+into|drop\s+table)\b[^;'"`]*audit_log/i,
    );
    expect(hits.join('\n'), 'I4: audit sa nemaže a nemení NIKDY').toBe('');
  });

  it('žiadny retenčný / rotačný job nad auditom (D75)', () => {
    const hits = codeHits(sources, /audit[^\n]*\b(retention|rotate|purge|prune|cleanup|vacuum)\b/i);
    expect(hits.join('\n')).toBe('');
  });

  it('do audit_log zapisuje jediný modul (jediná cesta, I4)', () => {
    const writers = [
      ...new Set(
        codeHits(sources, /INSERT\s+INTO\s+audit_log/i).map((hit) => hit.split(':')[0] ?? ''),
      ),
    ].sort();
    expect(writers).toEqual(['src/lib/audit/write.ts']);
  });

  it('migrácia grantov dáva na audit_log výhradne SELECT, INSERT', () => {
    const grants = migrations.find((f) => f.path.endsWith('0008_grants.sql'));
    expect(grants).toBeDefined();
    const lines = (grants?.text ?? '')
      .split('\n')
      .filter((line) => /audit_log/.test(line) && /^\s*GRANT/i.test(line));
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/GRANT\s+SELECT,\s*INSERT\s+ON/i);
    expect(lines[0]).not.toMatch(/UPDATE|DELETE|ALL PRIVILEGES/i);
  });

  it('žiadny skript (ani migračný runner) audit nemaže', () => {
    const hits = codeHits(
      scripts,
      /\b(update|delete\s+from|truncate(\s+table)?)\b[^;'"`]*audit_log/i,
    );
    expect(hits.join('\n')).toBe('');
  });

  it('žiadna migrácia audit_log nemaže ani nezmenšuje', () => {
    const hits = codeHits(
      migrations,
      /\b(drop\s+table|truncate|delete\s+from)\b[^;]*audit_log/i,
    );
    expect(hits.join('\n')).toBe('');
  });
});

/* ═════════════════════════ 2. rovina reálnych grantov ═════════════════════ */

const available = await dbAvailable();

describe.skipIf(!available)('I4 — granty aplikačného DB usera nad audit_log', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await withMigrationConn(async (conn) => {
      await conn.query("DELETE FROM audit_log WHERE message LIKE '%probe%'");
    });
  });

  it('INSERT áno, UPDATE/DELETE/DDL nie', async () => {
    const permissions = await auditLogPermissions();
    expect(permissions).toEqual({
      insertAllowed: true,
      updateAllowed: false,
      deleteAllowed: false,
      ddlAllowed: false,
    });
  });

  it('UPDATE zlyhá chybou grantu (1142/1143), nie aplikačnou kontrolou', async () => {
    const error = await withAppConn(async (conn) => {
      try {
        await conn.query("UPDATE audit_log SET message = 'tampered' WHERE id > 0");
        return null;
      } catch (caught) {
        return caught as { errno?: number; message?: string };
      }
    });
    expect(error, 'UPDATE nad audit_log MUSÍ zlyhať (I4)').not.toBeNull();
    expect([1142, 1143, 1044]).toContain(error?.errno);
  });

  it('DELETE zlyhá chybou grantu a riadok zostáva', async () => {
    const before = await withMigrationConn(async (conn) => {
      await conn.query(
        "INSERT INTO audit_log (actor, event_type, message) VALUES ('system', 'boot', 'i4 probe row')",
      );
      const rows = (await conn.query('SELECT COUNT(*) AS total FROM audit_log')) as Array<{
        total: number | bigint;
      }>;
      return Number(rows[0]?.total ?? 0);
    });

    const error = await withAppConn(async (conn) => {
      try {
        await conn.query('DELETE FROM audit_log');
        return null;
      } catch (caught) {
        return caught as { errno?: number };
      }
    });
    expect(error).not.toBeNull();
    expect([1142, 1143, 1044]).toContain(error?.errno);

    const after = await withMigrationConn(async (conn) => {
      const rows = (await conn.query('SELECT COUNT(*) AS total FROM audit_log')) as Array<{
        total: number | bigint;
      }>;
      return Number(rows[0]?.total ?? 0);
    });
    expect(after).toBe(before);
  });

  it('aplikačný user nemá ani DDL na schéme (D89)', async () => {
    const error = await withAppConn(async (conn) => {
      try {
        await conn.query('ALTER TABLE audit_log ADD COLUMN i4_probe INT NULL');
        return null;
      } catch (caught) {
        return caught as { errno?: number };
      }
    });
    expect(error).not.toBeNull();
  });
});
