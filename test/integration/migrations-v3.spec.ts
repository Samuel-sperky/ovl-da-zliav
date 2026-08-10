/**
 * Aura Zľavy — MIGRÁCIE V3 (0010–0012): fronta, pásma, rozsah, katalóg.
 * Kontrakt: `docs/50-KONTRAKT-V3.md` — K1 (režim rozsahu a DB strop),
 * K2 (stav `queued`, denný rozpočet), K3 (pásma a percento na položke),
 * K5 (príznak `late`), K7 (katalóg na 40k riadkov), I4 (audit append-only).
 *
 * Prečo tento súbor existuje popri `migrations.spec.ts`: ten overuje runner
 * a pôvodnú schému, tento overuje, že V3 objekty naozaj vznikli — a hlavne že
 * CHECK constrainty **skutočne odmietnu** hodnotu mimo rozsahu. `SHOW CREATE
 * TABLE` dokazuje len to, že text constraintu v schéme je; dôkaz, že brzda
 * drží, je až odmietnutý zápis. K1 bod 3 hovorí presne toto: aplikačná
 * validácia sama o sebe nikdy nestačila.
 *
 * Beží proti REÁLNEJ testovacej MariaDB tým istým runnerom ako produkcia
 * (`scripts/migrate.ts` cez `test/helpers/db.ts`). Bez dostupnej DB sa blok
 * korektne preskočí.
 *
 * Vlastník: V1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Connection } from 'mariadb';

import {
  applyMigrations,
  dbAvailable,
  setupTestDb,
  showCreateTable,
  truncateAll,
  withAppConn,
  withMigrationConn,
} from '../helpers/db';

/** ID mimo dosahu ostatných testov — tento súbor po sebe upratuje sám. */
const USER_ID = 9701;
const CAMPAIGN_ID = 9702;

interface ColumnInfo {
  column_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function columnInfo(
  conn: Connection,
  table: string,
  column: string,
): Promise<ColumnInfo | null> {
  const rows = (await conn.query(
    `SELECT COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable,
            COLUMN_DEFAULT AS column_default
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  )) as ColumnInfo[];
  // Turbopack tu už raz zahodil null-guard cez `!row` — porovnávaj explicitne.
  const row = rows[0];
  return row === undefined ? null : row;
}

/**
 * `information_schema.columns.COLUMN_DEFAULT` vracia v MariaDB reťazcové
 * defaulty ako SQL literál (`'pilot'`), nie holú hodnotu. Toto je len
 * odstránenie úvodzoviek — tvrdenie o hodnote sa tým neoslabuje.
 */
function defaultValue(info: ColumnInfo): string | null {
  const raw = info.column_default;
  if (raw === null) return null;
  const match = /^'(.*)'$/s.exec(raw);
  return match === null ? raw : (match[1] as string).replace(/''/g, "'");
}

async function indexNames(conn: Connection, table: string): Promise<string[]> {
  const rows = (await conn.query(
    `SELECT DISTINCT INDEX_NAME AS name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  )) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/** Vykoná SQL a vráti chybovú hlášku, alebo `null`, keď príkaz prešiel. */
async function rejectionOf(conn: Connection, sql: string, values?: unknown[]): Promise<string> {
  try {
    await conn.query(sql, values);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

async function seedCampaign(conn: Connection, percent: number, itemsTotal: number): Promise<void> {
  await conn.query(
    'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
    [USER_ID, 'v1-migration-test', 'argon2id$fake-hash-not-a-secret'],
  );
  await conn.query(
    `INSERT INTO campaigns
       (id, operation_id, name, percent, date_from, date_to, mode, status, items_total, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled', 'queued', ?, ?)`,
    [
      CAMPAIGN_ID,
      '01J0000000000000000MIGV3',
      'V1 migračný test',
      percent,
      '2026-09-01',
      '2026-09-30',
      itemsTotal,
      USER_ID,
    ],
  );
}

const available = await dbAvailable();

describe.skipIf(!available)('migrácie V3 (0010–0012) — fronta, pásma, rozsah', () => {
  beforeAll(async () => {
    await setupTestDb();
    await withMigrationConn(async (conn) => {
      await conn.query('DELETE FROM campaign_tiers');
      await seedCampaign(conn, 30, 0);
    });
  });

  afterAll(async () => {
    // `campaign_tiers` zatiaľ nie je v `DATA_TABLES` helpera, tak si po sebe
    // upratujeme sami — inak by osirené pásma prežili `truncateAll()`.
    await withMigrationConn(async (conn) => {
      await conn.query('DELETE FROM campaign_tiers WHERE campaign_id = ?', [CAMPAIGN_ID]);
      await conn.query('DELETE FROM campaign_items WHERE campaign_id = ?', [CAMPAIGN_ID]);
      await conn.query('DELETE FROM campaigns WHERE id = ?', [CAMPAIGN_ID]);
      await conn.query('DELETE FROM users WHERE id = ?', [USER_ID]);
    });
    await truncateAll();
    // Schéma musí zostať konzistentná pre ostatné integračné testy.
    await applyMigrations();
  });

  /* ─────────────────────── K2 — stav fronty a počítadlá ───────────────────── */

  it('K2 — `campaigns.status` pozná `queued` a NEPRIŠIEL o žiadny pôvodný stav', async () => {
    const info = await withMigrationConn((conn) => columnInfo(conn, 'campaigns', 'status'));
    expect(info).not.toBeNull();
    const type = (info as ColumnInfo).column_type;
    // ALTER na ENUM v MariaDB prepíše riadky, ktoré v novom zozname chýbajú —
    // preto sa overuje aj prítomnosť všetkých pôvodných hodnôt z 0004.
    for (const value of [
      'draft',
      'scheduled',
      'needs_key',
      'running',
      'done',
      'partial',
      'failed',
      'missed',
      'cancelled',
      'lapsed',
      'queued',
    ]) {
      expect(type).toContain(`'${value}'`);
    }
    expect(defaultValue(info as ColumnInfo)).toBe('draft');
  });

  it('K2 — počítadlá položiek sú INT UNSIGNED (10 000 sa do TINYINT nezmestí)', async () => {
    await withMigrationConn(async (conn) => {
      for (const column of ['items_total', 'items_ok', 'items_failed', 'items_uncertain']) {
        const info = await columnInfo(conn, 'campaigns', column);
        expect(info, column).not.toBeNull();
        expect((info as ColumnInfo).column_type, column).toMatch(/^int\(\d+\) unsigned$/);
      }
      // Dôkaz, nie len typ v schéme: 10 000 sa musí dať uložiť.
      await conn.query('UPDATE campaigns SET items_ok = 10000 WHERE id = ?', [CAMPAIGN_ID]);
      const rows = (await conn.query('SELECT items_ok FROM campaigns WHERE id = ?', [
        CAMPAIGN_ID,
      ])) as Array<{ items_ok: number }>;
      expect(Number(rows[0]?.items_ok)).toBe(10000);
      await conn.query('UPDATE campaigns SET items_ok = 0 WHERE id = ?', [CAMPAIGN_ID]);
    });
  });

  /* ──────────────── K1 bod 3 — tvrdý strop 10 000 v DB, nie v kóde ────────── */

  it('K1 — CHECK na `items_total` existuje a ODMIETNE 10 001', async () => {
    const ddl = (await showCreateTable('campaigns')).replace(/\s+/g, ' ').toLowerCase();
    expect(ddl).toContain('ck_campaigns_items_total');
    expect(ddl).toMatch(/items_total`? *<= *10000/);

    await withMigrationConn(async (conn) => {
      const rejection = await rejectionOf(
        conn,
        'UPDATE campaigns SET items_total = 10001 WHERE id = ?',
        [CAMPAIGN_ID],
      );
      expect(rejection).toContain('ck_campaigns_items_total');

      // Hranica 10 000 vrátane musí prejsť — strop nesmie byť o jedna vedla.
      await conn.query('UPDATE campaigns SET items_total = 10000 WHERE id = ?', [CAMPAIGN_ID]);
      const rows = (await conn.query('SELECT items_total FROM campaigns WHERE id = ?', [
        CAMPAIGN_ID,
      ])) as Array<{ items_total: number }>;
      expect(Number(rows[0]?.items_total)).toBe(10000);
      await conn.query('UPDATE campaigns SET items_total = 0 WHERE id = ?', [CAMPAIGN_ID]);
    });
  });

  /* ────────────────────────── K5 — príznak meškania ───────────────────────── */

  it('K5 — `campaigns.late` existuje, je NOT NULL a predvolene 0', async () => {
    const info = await withMigrationConn((conn) => columnInfo(conn, 'campaigns', 'late'));
    expect(info).not.toBeNull();
    expect((info as ColumnInfo).is_nullable).toBe('NO');
    expect(Number(defaultValue(info as ColumnInfo))).toBe(0);
  });

  /* ─────────────── K3 — percento na položke a jeho CHECK 1..30 ────────────── */

  it('K3 — `campaign_items.percent` je NOT NULL bez DEFAULT a `position` je INT UNSIGNED', async () => {
    await withMigrationConn(async (conn) => {
      const percent = await columnInfo(conn, 'campaign_items', 'percent');
      expect(percent).not.toBeNull();
      expect((percent as ColumnInfo).is_nullable).toBe('NO');
      // Bez DEFAULT: percento musí prísť z potvrdenia, nie z náhodnej nuly.
      expect(defaultValue(percent as ColumnInfo)).toBeNull();

      const position = await columnInfo(conn, 'campaign_items', 'position');
      expect(position).not.toBeNull();
      expect((position as ColumnInfo).column_type).toMatch(/^int\(\d+\) unsigned$/);
    });
  });

  it('K3 — CHECK na `campaign_items.percent` ODMIETNE 0 aj 31 a prijme 1 aj 30', async () => {
    const ddl = (await showCreateTable('campaign_items')).replace(/\s+/g, ' ').toLowerCase();
    expect(ddl).toContain('ck_items_percent');
    expect(ddl).toMatch(/percent`? between 1 and 30/);

    await withMigrationConn(async (conn) => {
      const insert =
        'INSERT INTO campaign_items (campaign_id, product_id, percent, position) VALUES (?, ?, ?, ?)';

      expect(await rejectionOf(conn, insert, [CAMPAIGN_ID, 5001, 0, 1])).toContain(
        'ck_items_percent',
      );
      expect(await rejectionOf(conn, insert, [CAMPAIGN_ID, 5002, 31, 2])).toContain(
        'ck_items_percent',
      );

      // Obe hranice rozsahu musia prejsť.
      expect(await rejectionOf(conn, insert, [CAMPAIGN_ID, 5003, 1, 3])).toBe('');
      expect(await rejectionOf(conn, insert, [CAMPAIGN_ID, 5004, 30, 4])).toBe('');

      // I10: `position` musí uniesť desaťtisíce, nie 255.
      expect(await rejectionOf(conn, insert, [CAMPAIGN_ID, 5005, 20, 9999])).toBe('');

      const rows = (await conn.query(
        'SELECT COUNT(*) AS n FROM campaign_items WHERE campaign_id = ?',
        [CAMPAIGN_ID],
      )) as Array<{ n: number }>;
      expect(Number(rows[0]?.n)).toBe(3);
      await conn.query('DELETE FROM campaign_items WHERE campaign_id = ?', [CAMPAIGN_ID]);
    });
  });

  /* ───────────────────────────── K3 — pásma zľavy ─────────────────────────── */

  it('K3 — `campaign_tiers` existuje, drží CHECK 1..30 a jedno poradie na zľavu', async () => {
    const ddl = (await showCreateTable('campaign_tiers')).replace(/\s+/g, ' ').toLowerCase();
    expect(ddl).toContain('ck_tiers_percent');
    expect(ddl).toContain('uq_tiers_campaign_ord');
    expect(ddl).toContain('fk_tiers_campaign');
    expect(ddl).not.toContain('on delete cascade');

    await withMigrationConn(async (conn) => {
      const insert =
        'INSERT INTO campaign_tiers (campaign_id, ord, label, percent) VALUES (?, ?, ?, ?)';

      expect(await rejectionOf(conn, insert, [CAMPAIGN_ID, 1, '0 predaných za 360 dní', 30])).toBe(
        '',
      );
      expect(await rejectionOf(conn, insert, [CAMPAIGN_ID, 2, '0 predaných za 180 dní', 20])).toBe(
        '',
      );
      expect(
        await rejectionOf(conn, insert, [CAMPAIGN_ID, 3, 'mimo rozsahu', 31]),
      ).toContain('ck_tiers_percent');
      expect(await rejectionOf(conn, insert, [CAMPAIGN_ID, 3, 'mimo rozsahu', 0])).toContain(
        'ck_tiers_percent',
      );
      // Dve pásma s rovnakým poradím v jednej zľave nedávajú zmysel.
      expect(await rejectionOf(conn, insert, [CAMPAIGN_ID, 1, 'duplicitné poradie', 10])).toMatch(
        /duplicate|uq_tiers_campaign_ord/i,
      );

      const rows = (await conn.query(
        'SELECT ord, percent FROM campaign_tiers WHERE campaign_id = ? ORDER BY ord',
        [CAMPAIGN_ID],
      )) as Array<{ ord: number; percent: number }>;
      expect(rows.map((row) => Number(row.percent))).toEqual([30, 20]);
      await conn.query('DELETE FROM campaign_tiers WHERE campaign_id = ?', [CAMPAIGN_ID]);
    });
  });

  /* ─────────────── K1/K2 — nastavenia rozsahu a denného rozpočtu ──────────── */

  it('K1 — `settings.scope_mode` je fail-closed: predvolene `pilot`', async () => {
    await withMigrationConn(async (conn) => {
      const info = await columnInfo(conn, 'settings', 'scope_mode');
      expect(info).not.toBeNull();
      expect((info as ColumnInfo).column_type).toBe("enum('pilot','plny')");
      expect(defaultValue(info as ColumnInfo)).toBe('pilot');

      // Singleton riadok z 0001 musí mať po migrácii tiež `pilot`, nie prázdno.
      const rows = (await conn.query(
        'SELECT scope_mode, max_products_per_campaign, daily_write_budget FROM settings WHERE id = 1',
      )) as Array<{
        scope_mode: string;
        max_products_per_campaign: number;
        daily_write_budget: number;
      }>;
      expect(rows[0]?.scope_mode).toBe('pilot');
      expect(Number(rows[0]?.max_products_per_campaign)).toBe(10000);
      expect(Number(rows[0]?.daily_write_budget)).toBe(200);
    });
  });

  it('K2 — rozpočet sa dá znížiť, ale nie zdvihnúť nad 200 ani na 0', async () => {
    await withMigrationConn(async (conn) => {
      expect(await rejectionOf(conn, 'UPDATE settings SET daily_write_budget = 50 WHERE id = 1')).toBe(
        '',
      );
      expect(
        await rejectionOf(conn, 'UPDATE settings SET daily_write_budget = 201 WHERE id = 1'),
      ).toContain('ck_settings_daily_budget');
      expect(
        await rejectionOf(conn, 'UPDATE settings SET daily_write_budget = 0 WHERE id = 1'),
      ).toContain('ck_settings_daily_budget');
      expect(
        await rejectionOf(conn, 'UPDATE settings SET max_products_per_campaign = 10001 WHERE id = 1'),
      ).toContain('ck_settings_max_products');
      await conn.query('UPDATE settings SET daily_write_budget = 200 WHERE id = 1');
    });
  });

  /* ───────────────────────────── K7 — katalóg 40k ─────────────────────────── */

  it('K7 — `catalog_cache` má indexy na filtre a stĺpec `shop_status`', async () => {
    await withMigrationConn(async (conn) => {
      const indexes = await indexNames(conn, 'catalog_cache');
      for (const name of [
        'ix_catalog_price',
        'ix_catalog_fetched',
        'ix_catalog_name',
        'ix_catalog_shop_status',
        'ix_catalog_status_price',
      ]) {
        expect(indexes, name).toContain(name);
      }

      const info = await columnInfo(conn, 'catalog_cache', 'shop_status');
      expect(info).not.toBeNull();
      // K1 bod 2: v režime `plny` je podmienkou zápisu „je v katalógu a nie je
      // `not_found`" — bez tohto stĺpca sa to nedá overiť.
      expect((info as ColumnInfo).column_type).toBe("enum('ok','not_found','unknown')");
      expect(defaultValue(info as ColumnInfo)).toBe('unknown');
    });
  });

  /* ─────────────────── 0012 — granty pre nové objekty (I4) ────────────────── */

  it('0012 — aplikačný user má DML na `campaign_tiers`, ale stále žiadne DDL', async () => {
    await withMigrationConn(async (conn) => {
      await conn.query(
        'INSERT INTO campaign_tiers (campaign_id, ord, label, percent) VALUES (?, 1, ?, 25)',
        [CAMPAIGN_ID, 'grant test'],
      );
    });

    await withAppConn(async (conn) => {
      const rows = (await conn.query('SELECT COUNT(*) AS n FROM campaign_tiers')) as Array<{
        n: number;
      }>;
      expect(Number(rows[0]?.n)).toBeGreaterThan(0);
      expect(
        await rejectionOf(conn, 'UPDATE campaign_tiers SET label = ? WHERE campaign_id = ?', [
          'app user smie meniť pásma',
          CAMPAIGN_ID,
        ]),
      ).toBe('');
      expect(await rejectionOf(conn, 'DELETE FROM campaign_tiers WHERE campaign_id = ?', [
        CAMPAIGN_ID,
      ])).toBe('');
      // D89: appka nesmie mať DDL ani na novej tabuľke.
      expect(await rejectionOf(conn, 'DROP TABLE campaign_tiers')).not.toBe('');
    });
  });

  it('I4 — 0012 nepridal `audit_log` právo na UPDATE ani DELETE', async () => {
    await withAppConn(async (conn) => {
      expect(
        await rejectionOf(conn, 'INSERT INTO audit_log (actor, event_type, message) VALUES (?, ?, ?)', [
          'system',
          'boot',
          'migrations-v3 probe',
        ]),
      ).toBe('');
      expect(
        await rejectionOf(conn, "UPDATE audit_log SET message = 'tampered' WHERE event_type = 'boot'"),
      ).not.toBe('');
      expect(await rejectionOf(conn, "DELETE FROM audit_log WHERE event_type = 'boot'")).not.toBe(
        '',
      );
    });
  });
});
