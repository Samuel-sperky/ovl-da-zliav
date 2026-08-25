/**
 * Aura Zľavy — DB helper pre integračné testy (BUILD-SPEC §12).
 *
 * Poskytuje:
 *  - `applyMigrations()` — spustí `scripts/migrate.ts` proti testovacej DB
 *    (rovnaký runner ako v produkcii, žiadna druhá cesta k schéme),
 *  - `truncateAll()`     — vyčistí dáta medzi testami a obnoví singletony,
 *  - `probeTestDb()` / `dbAvailable()` — je testovacia DB vôbec pripojiteľná,
 *  - `withMigrationConn()` / `withAppConn()` — spojenia pod správnym DB userom,
 *    aby sa dal overiť aj invariant I4 (app user nesmie `UPDATE`/`DELETE`
 *    na `audit_log`).
 *
 * Testovacia DB je vždy `DB_NAME` z `test/setup.ts` (default `ovl_zliav_test`).
 *
 * TICHÉ PRESKOČENIE JE ZAKÁZANÉ (24. 8. 2026)
 * -------------------------------------------
 * `dbAvailable()` vracalo pri chybe spojenia `false` a chybu prehltlo. Štrnásť
 * súborov v `test/integration/` sa na tú hodnotu vešia cez
 * `describe.skipIf(!available)`, takže bez bežiacej MariaDB zmizlo 129 testov,
 * `vitest run` skončil s exit kódom 0 a balík bol „zelený" BEZ jediného dôkazu
 * o grantoch auditu (I4), strope allowlistu (I2), redakcii kľúča (I1) a
 * migráciách (A0). To isté platilo v CI: keby service kontajner MariaDB
 * nenabehol, `npm run test` by prešiel.
 *
 * Preto `dbAvailable()` teraz **HÁDŽE** — nedostupná DB je porucha prostredia,
 * nie dôvod tvrdiť menej. Kto naozaj chce bežať bez DB, musí to povedať
 * nahlas cez `ALLOW_SKIP_DB_TESTS=1`; vtedy sa preskočenie vypíše na stderr,
 * takže sa o ňom aspoň dozvie. `npm test` má navyše bránu ešte pred vitestom
 * (`scripts/require-test-db.ts`), aby z toho bola jedna zrozumiteľná veta a nie
 * štrnásť rovnakých pádov.
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

/**
 * ENV premenná, ktorou sa dá preskočenie integračných testov POVOLIŤ. Bez nej
 * je nedostupná DB tvrdá chyba. Meno je zámerne dlhé a nepríjemné — nemá sa
 * dostať do žiadneho skriptu, ktorý beží v CI.
 */
export const SKIP_DB_TESTS_ENV = 'ALLOW_SKIP_DB_TESTS';

export interface TestDbProbe {
  ok: boolean;
  /** Prečo sa nedá pripojiť. `null` = dá sa. Heslá sú vyREDIGOVANÉ (I1). */
  reason: string | null;
  /** `host:port/db` ako `ovl_zliav_mig` — bez hesla. */
  target: string;
}

/**
 * Vyredaguje hodnoty, ktoré sa do hlášky nikdy nesmú dostať (I1). Ovládač
 * MariaDB síce heslá do `Error.message` bežne nedáva, ale hláška ide do CI logu
 * a do terminálu, takže sa na „bežne" nespoliehame.
 */
function redactSecrets(text: string): string {
  const config = testDbConfig();
  let out = text;
  for (const secret of [config.appPassword, config.migrationPassword, config.rootPassword]) {
    if (typeof secret === 'string' && secret.length > 0) {
      out = out.split(secret).join('***');
    }
  }
  return out;
}

/**
 * Skúsi sa pripojiť migračným userom a POVIE, ako to dopadlo — vrátane dôvodu.
 * Nič nehádže; je to meranie, na ktorom stojí `dbAvailable()` aj brána
 * `scripts/require-test-db.ts`.
 */
export async function probeTestDb(): Promise<TestDbProbe> {
  const config = testDbConfig();
  const target = `${config.host}:${config.port}/${config.database}`;
  try {
    const conn = await connectAs(config.migrationUser, config.migrationPassword);
    await conn.end();
    return { ok: true, reason: null, target };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: redactSecrets(raw), target };
  }
}

/** Vypísané už bolo? Varovanie stačí raz na proces, nie raz na súbor. */
let skipWarningPrinted = false;

/**
 * Je testovacia DB dostupná?
 *
 * `true` alebo VÝNIMKA — tretia možnosť („false a ticho") je presne tá diera,
 * pre ktorú tento komentár existuje. `false` sa vráti len vtedy, keď človek
 * vedome nastavil `ALLOW_SKIP_DB_TESTS=1`, a aj vtedy to ide nahlas na stderr.
 */
export async function dbAvailable(): Promise<boolean> {
  const probe = await probeTestDb();
  if (probe.ok) return true;

  const detail =
    `Testovacia MariaDB na ${probe.target} neodpovedá, takže integračné testy ` +
    `nemajú čo merať.\n  Dôvod: ${probe.reason ?? 'neznámy'}\n` +
    '  Spusti kontajner: docker compose up -d ovl-zliav-test-db';

  if (process.env[SKIP_DB_TESTS_ENV] !== '1') {
    throw new Error(
      `[DB] ${detail}\n` +
        `  Vedomé preskočenie: ${SKIP_DB_TESTS_ENV}=1 — potom ale balík NIE JE ` +
        'dôkazom o migráciách, grantoch auditu, strope allowlistu ani redakcii kľúča.',
    );
  }

  if (!skipWarningPrinted) {
    skipWarningPrinted = true;
    process.stderr.write(
      `\n[DB] ${SKIP_DB_TESTS_ENV}=1 — integračné testy sa PRESKAKUJÚ.\n  ${detail}\n` +
        '  Zelený výsledok tohto behu nehovorí nič o schéme, grantoch ani redakcii.\n\n',
    );
  }
  return false;
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
