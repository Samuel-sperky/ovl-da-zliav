/**
 * Aura Zľavy — INVARIANT I14 (+ I2, I5, I6): boot assertions (A17, BUILD-SPEC §11).
 *
 * Zlý ENV, nečitateľný master key alebo neaplikované migrácie MUSIA proces
 * ukončiť — appka nikdy nesmie bežať v degradovanom režime, v ktorom by mohla
 * zapisovať. Testujú sa SKUTOČNÉ assertions z `src/instrumentation-node.ts`
 * (`register()` sa nevolá, aby test nezhodil `process.exit`).
 *
 * Vlastník: A17.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { resetEnvCache } from '@/env';
import {
  assertDbAndMigrations,
  assertEnvAndLimits,
  assertMasterKeyFile,
  listMigrationNames,
  runBootAssertions,
} from '@/instrumentation-node';
import { closePool } from '@/db/pool';

import { dbAvailable, setupTestDb } from '../helpers/db';

/* ═════════════════════════ ENV sandbox pre testy ══════════════════════════ */

const ORIGINAL_ENV = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  resetEnvCache();
});

/* ══════════════════════ 1.–4. konfigurácia (§11, I2, I5) ══════════════════ */

describe('boot assertions — konfigurácia (I2, I5, I6, I14)', () => {
  it('platné testovacie ENV nemá žiadny konfiguračný problém', () => {
    const { env, problems } = assertEnvAndLimits();
    expect(problems).toEqual([]);
    expect(env?.PUBLIC_BIND).toBe('127.0.0.1');
  });

  it('PUBLIC_BIND=0.0.0.0 boot zablokuje (I5, D78)', () => {
    withEnv({ PUBLIC_BIND: '0.0.0.0' });
    const { env, problems } = assertEnvAndLimits();
    // Zachytí to už zod schéma (krok 1), takže `env` je null a boot padá.
    expect(env).toBeNull();
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map((p) => p.message).join('\n')).toContain('PUBLIC_BIND');
    expect(problems.every((p) => p.step === 1)).toBe(true);
  });

  it('ALLOWLIST_MAX=11 aj MAX_PRODUCTS_PER_OPERATION=11 boot zablokujú (I2)', () => {
    withEnv({ ALLOWLIST_MAX: '11', MAX_PRODUCTS_PER_OPERATION: '11' });
    const { env, problems } = assertEnvAndLimits();
    expect(env).toBeNull();
    const text = problems.map((p) => p.message).join('\n');
    expect(text).toContain('ALLOWLIST_MAX');
    expect(text).toContain('MAX_PRODUCTS_PER_OPERATION');
  });

  it('API_KEY_TTL_HOURS=72 boot zablokuje (R2)', () => {
    withEnv({ API_KEY_TTL_HOURS: '72' });
    const { problems } = assertEnvAndLimits();
    expect(problems.map((p) => p.message).join('\n')).toContain('API_KEY_TTL_HOURS');
  });

  it('problémy pri boote nikdy neobsahujú hodnotu hesla ani kľúča (I1)', () => {
    withEnv({ DB_PASSWORD: 'fake-shop-key-7XY9', ALLOWLIST_MAX: '11' });
    const { problems } = assertEnvAndLimits();
    expect(problems.map((p) => p.message).join('\n')).not.toContain('fake-shop-key-7XY9');
  });
});

/* ═══════════════════════ 5. master key (D61, I14) ═════════════════════════ */

describe('boot assertions — master key (D61, I1, I14)', () => {
  let dir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ovl-zliav-boot-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function keyFile(name: string, content: string, mode = 0o400): string {
    const path = join(dir, name);
    writeFileSync(path, content, { mode });
    chmodSync(path, mode);
    return path;
  }

  it('32 B hex kľúč s právami 400 je v poriadku', () => {
    const path = keyFile('ok.key', 'a'.repeat(64));
    expect(assertMasterKeyFile(path, true)).toEqual({ ok: true, problems: [] });
  });

  it('chýbajúci súbor => boot padá', () => {
    const result = assertMasterKeyFile(join(dir, 'neexistuje.key'), true);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/Master key.*neexistuje\.key.*D61/);
  });

  it('kratší kľúč (16 B) => boot padá', () => {
    const path = keyFile('short.key', 'b'.repeat(32));
    const result = assertMasterKeyFile(path, true);
    expect(result.ok).toBe(false);
  });

  it('kľúč čitateľný pre group/other je v produkcii chyba (strict)', () => {
    const path = keyFile('loose.key', 'c'.repeat(64), 0o644);
    expect(assertMasterKeyFile(path, true).ok).toBe(false);
    // Mimo produkcie len varovanie — vývoj na bind mounte musí byť možný.
    expect(assertMasterKeyFile(path, false).ok).toBe(true);
  });

  it('hláška NIKDY neobsahuje obsah kľúča (I1)', () => {
    const secret = 'd'.repeat(30); // ani hex, ani 32 B => zaručene problém
    const path = keyFile('leak.key', secret, 0o644);
    const problems = [
      ...assertMasterKeyFile(path, true).problems,
      ...assertMasterKeyFile(path, false).problems,
    ].join('\n');
    expect(problems).not.toContain(secret);
  });
});

/* ═══════════════════════ 6. migrácie (D88, I14) ════════════════════════════ */

describe('boot assertions — migrácie (D88, I14)', () => {
  it('listMigrationNames vidí všetky SQL migrácie v poradí', () => {
    const names = listMigrationNames();
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(names).toEqual([...names].sort());
    expect(names[0]).toMatch(/^0001_/);
    expect(names.every((n) => n.endsWith('.sql'))).toBe(true);
  });

  it('neexistujúci priečinok migrácií je chyba nasadenia, nie tichý štart', () => {
    expect(() => listMigrationNames(resolve(process.cwd(), 'db/neexistuje'))).toThrow();
  });
});

const available = await dbAvailable();

describe.skipIf(!available)('boot assertions — DB a migrácie proti reálnej MariaDB', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closePool();
  });

  it('po migráciách nie sú žiadne problémy (D88)', async () => {
    expect(await assertDbAndMigrations()).toEqual([]);
  });

  it('runBootAssertions() je pri platnom stave prázdny', async () => {
    withEnv({ MASTER_KEY_FILE: process.env.MASTER_KEY_FILE });
    const problems = await runBootAssertions();
    // Master key súbor v CI existovať nemusí; iné problémy sú neprípustné.
    expect(problems.filter((p) => p.step !== 5)).toEqual([]);
  });

  it('chýbajúci záznam v `_migrations` boot zablokuje', async () => {
    const { withMigrationConn } = await import('../helpers/db');
    const removed = await withMigrationConn(async (conn) => {
      const rows = (await conn.query(
        'SELECT id, name, checksum FROM _migrations ORDER BY id DESC LIMIT 1',
      )) as Array<{ id: number; name: string; checksum: string }>;
      const row = rows[0];
      if (row) await conn.query('DELETE FROM _migrations WHERE id = ?', [row.id]);
      return row;
    });
    expect(removed).toBeDefined();
    try {
      const problems = await assertDbAndMigrations();
      expect(problems.join('\n')).toContain(removed?.name ?? '');
    } finally {
      // Vráť schému do konzistentného stavu pre ďalšie testy.
      await withMigrationConn(async (conn) => {
        await conn.query(
          'INSERT INTO _migrations (id, name, checksum) VALUES (?, ?, ?)',
          [removed?.id, removed?.name, removed?.checksum],
        );
      });
    }
  });
});
