/**
 * Aura Zľavy — MIGRÁCIE: idempotencia, checksum ochrana, invariantné constrainty
 * (A17, BUILD-SPEC §3, D88, I2, I4, I14).
 *
 * Beží proti REÁLNEJ testovacej MariaDB rovnakým runnerom ako produkcia
 * (`scripts/migrate.ts` cez `test/helpers/db.ts`) — žiadna druhá cesta k schéme.
 * Bez dostupnej DB sa blok korektne preskočí (lokálny vývoj), v CI je MariaDB
 * service container povinný.
 *
 * Vlastník: A17.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listMigrationNames } from '@/instrumentation-node';

import {
  ALL_TABLES,
  applyMigrations,
  dbAvailable,
  listTables,
  setupTestDb,
  showCreateTable,
  withMigrationConn,
} from '../helpers/db';

const MIGRATIONS_DIR = resolve(process.cwd(), 'db/migrations');

function checksumOf(name: string): string {
  return createHash('sha256').update(readFileSync(join(MIGRATIONS_DIR, name), 'utf8')).digest('hex');
}

const available = await dbAvailable();

describe.skipIf(!available)('migrácie (A0) — schéma, idempotencia, checksum', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    // Schéma musí zostať konzistentná pre ostatné integračné testy.
    await applyMigrations();
  });

  it('vytvorí všetkých 11 tabuliek zo §3', async () => {
    const tables = await listTables();
    for (const table of ALL_TABLES) expect(tables).toContain(table);
    expect(ALL_TABLES.length).toBe(11);
  });

  it('opakované spustenie je no-op (idempotencia, D88)', async () => {
    const before = await withMigrationConn(async (conn) => {
      const rows = (await conn.query('SELECT name, checksum FROM _migrations ORDER BY id')) as Array<{
        name: string;
        checksum: string;
      }>;
      return rows;
    });
    const stdout = await applyMigrations();
    const after = await withMigrationConn(async (conn) =>
      (await conn.query('SELECT name, checksum FROM _migrations ORDER BY id')) as Array<{
        name: string;
        checksum: string;
      }>,
    );
    expect(after).toEqual(before);
    expect(stdout).not.toMatch(/password|secret|kľúč/i); // I1
  });

  it('`_migrations` obsahuje presne súbory z db/migrations a správne checksumy', async () => {
    const expected = listMigrationNames();
    const rows = await withMigrationConn(async (conn) =>
      (await conn.query('SELECT name, checksum FROM _migrations ORDER BY id')) as Array<{
        name: string;
        checksum: string;
      }>,
    );
    expect(rows.map((r) => r.name)).toEqual(expected);
    for (const row of rows) expect(row.checksum).toBe(checksumOf(row.name));
  });

  it('zmenený checksum už aplikovanej migrácie zhodí runner (fail-fast, D88, I14)', async () => {
    const target = listMigrationNames()[0] as string;
    const original = checksumOf(target);
    await withMigrationConn(async (conn) => {
      await conn.query('UPDATE _migrations SET checksum = ? WHERE name = ?', ['0'.repeat(64), target]);
    });
    try {
      await expect(applyMigrations()).rejects.toThrow();
    } finally {
      await withMigrationConn(async (conn) => {
        await conn.query('UPDATE _migrations SET checksum = ? WHERE name = ?', [original, target]);
      });
    }
    // Po obnovení checksumu runner opäť prejde.
    await expect(applyMigrations()).resolves.toBeTypeOf('string');
  });

  it('I2 — `products_allowlist` má slot constrainty na úrovni DB', async () => {
    const ddl = await showCreateTable('products_allowlist');
    expect(ddl).toContain('uq_allowlist_slot');
    expect(ddl).toMatch(/ck_allowlist_slot\b/);
    expect(ddl).toContain('ck_allowlist_slot_active');
    expect(ddl.replace(/\s+/g, ' ')).toMatch(/slot.*between 1 and 10/i);
  });

  it('I9 — percento a okno kampane majú CHECK constrainty', async () => {
    const ddl = (await showCreateTable('campaigns')).replace(/\s+/g, ' ').toLowerCase();
    expect(ddl).toContain('check');
    expect(ddl).toMatch(/percent.*between 1 and 30|percent >= 1/);
    expect(ddl).toMatch(/date_to.*>=.*date_from|date_from.*<=.*date_to/);
  });

  it('I4 — `audit_log` nemá ON DELETE CASCADE (audit nezmizne s kampaňou)', async () => {
    const ddl = (await showCreateTable('audit_log')).toLowerCase();
    // MariaDB `SHOW CREATE TABLE` implicitné RESTRICT nevypisuje, preto sa
    // overuje absencia mazacích akcií — tie by audit odviazali od pravdy.
    expect(ddl).not.toContain('on delete cascade');
    expect(ddl).not.toContain('on delete set null');
    expect(ddl).toContain('foreign key');
  });

  it('žiadna tabuľka neukladá plaintext kľúča (I1) — api_key má len ciphertext', async () => {
    const ddl = (await showCreateTable('api_key')).toLowerCase();
    expect(ddl).toMatch(/ciphertext|cipher|enc/);
    expect(ddl).not.toMatch(/\bplaintext\b|\bapi_key_value\b/);
    expect(ddl).toContain('last4');
  });
});
