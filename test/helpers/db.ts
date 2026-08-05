/**
 * Aura Zľavy — DB helper pre integračné testy (BUILD-SPEC §12).
 *
 * Poskytuje:
 *  - `applyMigrations()` — spustí `scripts/migrate.ts` proti testovacej DB
 *    (rovnaký runner ako v produkcii, žiadna druhá cesta k schéme),
 *  - `truncateAll()`     — vyčistí dáta medzi testami a obnoví singletony,
 *  - `dbAvailable()`     — testy, ktoré potrebujú DB, sa vedia korektne preskočiť,
 *  - `withMigrationConn()` / `withAppConn()` — spojenia pod správnym DB userom,
 *    aby sa dal overiť aj invariant I4 (app user nesmie `UPDATE`/`DELETE`
 *    na `audit_log`).
 *
 * Testovacia DB je vždy `DB_NAME` z `test/setup.ts` (default `ovl_zliav_test`).
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import mariadb from 'mariadb';
import type { Connection } from 'mariadb';

const execFileAsync = promisify(execFile);

/** Tabuľky v poradí, v akom sa dajú bezpečne mazať (FK). */
export const DATA_TABLES: readonly string[] = [
  'audit_log',
  'campaign_items',
  'campaigns',
  'catalog_cache',
  'products_allowlist',
  'api_key',
  'login_attempts',
  'users',
];

export const SINGLETON_TABLES: readonly string[] = ['settings', 'scheduler_state'];

/** Všetkých 11 tabuliek schémy (BUILD-SPEC §3) — poradie vytvárania. */
export const ALL_TABLES: readonly string[] = [
  '_migrations',
  'users',
  'settings',
  'scheduler_state',
  'api_key',
  'products_allowlist',
  'catalog_cache',
  'campaigns',
  'campaign_items',
  'audit_log',
  'login_attempts',
];

export interface TestDbConfig {
  host: string;
  port: number;
  database: string;
  appUser: string;
  appPassword: string;
  migrationUser: string;
  migrationPassword: string;
  rootPassword: string | undefined;
}

export function testDbConfig(): TestDbConfig {
  const e = process.env;
  return {
    host: e.DB_HOST ?? '127.0.0.1',
    port: Number(e.DB_PORT ?? 3306),
    database: e.DB_NAME ?? 'ovl_zliav_test',
    appUser: e.DB_USER ?? 'ovl_zliav_app',
    appPassword: e.DB_PASSWORD ?? 'test_app_password',
    migrationUser: e.DB_MIGRATION_USER ?? 'ovl_zliav_mig',
    migrationPassword: e.DB_MIGRATION_PASSWORD ?? 'test_mig_password',
    rootPassword: e.DB_ROOT_PASSWORD,
  };
}

async function connectAs(
  user: string,
  password: string,
  database?: string,
): Promise<Connection> {
  const config = testDbConfig();
  return mariadb.createConnection({
    host: config.host,
    port: config.port,
    user,
    password,
    database,
    timezone: 'Z',
    multipleStatements: false,
    connectTimeout: 5000,
  });
}

/** Spojenie migračným userom (plné DML + DDL na testovacej DB). */
export async function withMigrationConn<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
  const config = testDbConfig();
  const conn = await connectAs(config.migrationUser, config.migrationPassword, config.database);
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

/**
 * Spojenie APLIKAČNÝM userom — má presne tie granty, čo produkčná appka.
 * Použi ho, keď test overuje, že niečo NIE JE dovolené (I4).
 */
export async function withAppConn<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
  const config = testDbConfig();
  const conn = await connectAs(config.appUser, config.appPassword, config.database);
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

/** Je testovacia DB dostupná? Integračné testy sa podľa toho preskočia. */
export async function dbAvailable(): Promise<boolean> {
  const config = testDbConfig();
  try {
    const conn = await connectAs(config.migrationUser, config.migrationPassword);
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Vytvorí testovaciu DB a oboch DB userov. Vyžaduje `DB_ROOT_PASSWORD`
 * (v CI ho dodá MariaDB service container). Bez neho sa mlčky preskočí —
 * predpokladá sa, že useri už existujú.
 */
export async function ensureDbUsers(): Promise<boolean> {
  const config = testDbConfig();
  if (!config.rootPassword) return false;

  const conn = await connectAs('root', config.rootPassword);
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    );
    for (const [user, password] of [
      [config.migrationUser, config.migrationPassword],
      [config.appUser, config.appPassword],
    ] as const) {
      await conn.query(`CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY ?`, [password]);
      await conn.query(`ALTER USER '${user}'@'%' IDENTIFIED BY ?`, [password]);
    }
    // Migračný user má plné DDL+DML na testovacej DB (D89) a `WITH GRANT OPTION`,
    // bez ktorého by nemohol spustiť migráciu 0008 (granty aplikačného usera).
    await conn.query(
      `GRANT ALL PRIVILEGES ON \`${config.database}\`.* TO '${config.migrationUser}'@'%' ` +
        'WITH GRANT OPTION',
    );
    // Aplikačný user dostane granty až z migrácie 0008 (I4) — tu len USAGE,
    // aby REVOKE v 0008 mal čo odoberať.
    await conn.query(`GRANT USAGE ON *.* TO '${config.appUser}'@'%'`);
    await conn.query(`GRANT SELECT ON \`${config.database}\`.* TO '${config.appUser}'@'%'`);
    await conn.query('FLUSH PRIVILEGES');
    return true;
  } finally {
    await conn.end();
  }
}

/**
 * Spustí migrácie tým istým runnerom ako produkcia (`scripts/migrate.ts`).
 * Opakované spustenie je no-op — presne to overuje akceptačné kritérium A0.
 */
export async function applyMigrations(): Promise<string> {
  const config = testDbConfig();
  const script = resolve(process.cwd(), 'scripts/migrate.ts');
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', script],
    {
      env: {
        ...process.env,
        DB_HOST: config.host,
        DB_PORT: String(config.port),
        DB_NAME: config.database,
        DB_USER: config.appUser,
        DB_MIGRATION_USER: config.migrationUser,
        DB_MIGRATION_PASSWORD: config.migrationPassword,
        DB_MIGRATION_PASSWORD_FILE: undefined,
      },
      cwd: process.cwd(),
      timeout: 60_000,
    },
  );
  return stdout;
}

/** Pripraví čistú schému: useri -> migrácie -> prázdne tabuľky. */
export async function setupTestDb(): Promise<void> {
  await ensureDbUsers();
  await applyMigrations();
  await truncateAll();
}

/**
 * Vyčistí dáta a obnoví singleton riadky. Beží migračným userom — aplikačný
 * user `audit_log` mazať NEDOKÁŽE a to je zámer (I4).
 */
export async function truncateAll(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of [...DATA_TABLES, ...SINGLETON_TABLES]) {
        await conn.query(`TRUNCATE TABLE \`${table}\``);
      }
      for (const table of SINGLETON_TABLES) {
        await conn.query(`INSERT INTO \`${table}\` (id) VALUES (1)`);
      }
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

/** Zoznam tabuliek, ktoré v DB skutočne existujú (overenie migrácií). */
export async function listTables(): Promise<string[]> {
  return withMigrationConn(async (conn) => {
    const config = testDbConfig();
    const rows = (await conn.query(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
      [config.database],
    )) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  });
}

/** `SHOW CREATE TABLE` — pre kontrolu CHECK constraintov a UNIQUE indexov. */
export async function showCreateTable(table: string): Promise<string> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query(`SHOW CREATE TABLE \`${table}\``)) as Array<
      Record<string, string>
    >;
    const row = rows[0] ?? {};
    return row['Create Table'] ?? '';
  });
}

/**
 * Granty aplikačného usera. `SHOW GRANTS FOR <iný user>` vyžaduje `SELECT`
 * na schému `mysql`, ktorý migračný user nemá — preto to ide root spojením
 * a bez `DB_ROOT_PASSWORD` funkcia zlyhá s jasnou hláškou. Na overenie
 * invariantu I4 je robustnejší `auditLogPermissions()` nižšie.
 */
export async function showAppGrants(): Promise<string[]> {
  const config = testDbConfig();
  if (!config.rootPassword) {
    throw new Error(
      'showAppGrants() potrebuje DB_ROOT_PASSWORD. Na overenie I4 použi auditLogPermissions().',
    );
  }
  const conn = await connectAs('root', config.rootPassword);
  try {
    const rows = (await conn.query(`SHOW GRANTS FOR '${config.appUser}'@'%'`)) as Array<
      Record<string, string>
    >;
    return rows.map((row) => Object.values(row)[0] ?? '');
  } finally {
    await conn.end();
  }
}

export interface AuditLogPermissions {
  /** `INSERT` MUSÍ byť povolený — audit sa zapisuje (D74). */
  insertAllowed: boolean;
  /** `UPDATE` MUSÍ byť zamietnutý grantom (I4). */
  updateAllowed: boolean;
  /** `DELETE` MUSÍ byť zamietnutý grantom (I4, D75). */
  deleteAllowed: boolean;
  /** Aplikačný user NESMIE mať žiadne DDL (D89). */
  ddlAllowed: boolean;
}

/**
 * Zmeria, čo aplikačný DB user nad `audit_log` skutočne dokáže — priamo proti
 * DB, bez mockovania. Podklad pre `test/integration/audit-append-only.spec.ts`
 * (A17). Očakávaný výsledok:
 * `{ insertAllowed: true, updateAllowed: false, deleteAllowed: false, ddlAllowed: false }`.
 */
export async function auditLogPermissions(): Promise<AuditLogPermissions> {
  return withAppConn(async (conn) => {
    const attempt = async (sql: string, values?: unknown[]): Promise<boolean> => {
      try {
        await conn.query(sql, values);
        return true;
      } catch {
        return false;
      }
    };
    const insertAllowed = await attempt(
      'INSERT INTO audit_log (actor, event_type, message) VALUES (?, ?, ?)',
      ['system', 'boot', 'audit-append-only probe'],
    );
    const updateAllowed = await attempt(
      "UPDATE audit_log SET message = 'tampered' WHERE event_type = 'boot'",
    );
    const deleteAllowed = await attempt("DELETE FROM audit_log WHERE event_type = 'boot'");
    const ddlAllowed = await attempt('CREATE TABLE i4_probe (id INT)');
    if (ddlAllowed) await attempt('DROP TABLE i4_probe');
    return { insertAllowed, updateAllowed, deleteAllowed, ddlAllowed };
  });
}
