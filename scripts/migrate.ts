/**
 * Aura Zľavy — migračný runner (BUILD-SPEC §3, D88, I14).
 *
 * Spúšťa ho entrypoint kontajnera PRED appkou. Nenulový exit kód znamená, že
 * appka nesmie nabehnúť (fail-fast, I14). Rollback je vždy manuálny.
 *
 * Postup:
 *   1. pripojenie MIGRAČNÝM userom (`DB_MIGRATION_USER`) — appka nemá DDL (D89),
 *   2. `SELECT GET_LOCK('ovl_zliav_migrate', 30)` (D88),
 *   3. `CREATE TABLE IF NOT EXISTS _migrations`,
 *   4. `db/migrations/*.sql` v poradí číselného prefixu + SHA-256 checksum;
 *      zmena checksumu už aplikovanej migrácie => FAIL-FAST,
 *   5. chýbajúce migrácie v transakcii per súbor + zápis do `_migrations`
 *      + audit `migration_applied`,
 *   6. `RELEASE_LOCK`.
 *
 * Beží priamo cez `node scripts/migrate.ts` (Node 22 type stripping), preto
 * neimportuje nič z `src/` a používa len `node:*` + `mariadb`.
 *
 * INVARIANT I1: do stdout ide názov súboru a checksum — NIKDY heslo ani obsah
 * súborov s tajomstvami.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import mariadb from 'mariadb';
import type { Connection } from 'mariadb';

const MIGRATION_LOCK_NAME = 'ovl_zliav_migrate';
const LOCK_TIMEOUT_SECONDS = 30;
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{2,31}$/;

interface MigrationFile {
  id: number;
  name: string;
  path: string;
  raw: string;
  checksum: string;
}

interface AppliedRow {
  id: number;
  name: string;
  checksum: string;
}

/* ────────────────────────────── konfigurácia ───────────────────────────── */

function readSecretFile(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r?\n$/, '');
}

function requireIdentifier(value: string, varName: string): string {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(
      `${varName}="${value}" nie je povolený identifikátor (whitelist ^[a-z_][a-z0-9_]{2,31}$).`,
    );
  }
  return value;
}

interface MigrateConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  appUser: string;
  migrationsDir: string;
}

function loadConfig(): MigrateConfig {
  const e = process.env;
  const passwordFile = e.DB_MIGRATION_PASSWORD_FILE;
  const passwordPlain = e.DB_MIGRATION_PASSWORD;
  if (!passwordFile && passwordPlain === undefined) {
    throw new Error(
      'Chýba DB_MIGRATION_PASSWORD_FILE (produkcia) alebo DB_MIGRATION_PASSWORD (dev/test).',
    );
  }
  return {
    host: e.DB_HOST ?? '127.0.0.1',
    port: Number(e.DB_PORT ?? 3306),
    database: requireIdentifier(e.DB_NAME ?? 'ovl_zliav', 'DB_NAME'),
    user: requireIdentifier(e.DB_MIGRATION_USER ?? 'ovl_zliav_mig', 'DB_MIGRATION_USER'),
    password: passwordFile ? readSecretFile(passwordFile) : (passwordPlain as string),
    appUser: requireIdentifier(e.DB_USER ?? 'ovl_zliav_app', 'DB_USER'),
    migrationsDir: e.MIGRATIONS_DIR ?? resolve(process.cwd(), 'db/migrations'),
  };
}

/* ─────────────────────────── čítanie migrácií ──────────────────────────── */

export function loadMigrationFiles(dir: string): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const seen = new Map<number, string>();
  return files.map((name) => {
    const match = /^(\d{4})_/.exec(name);
    if (!match) {
      throw new Error(`Migrácia "${name}" nemá 4-ciferný numerický prefix (napr. 0001_core.sql).`);
    }
    const id = Number(match[1]);
    const duplicate = seen.get(id);
    if (duplicate) {
      throw new Error(`Migrácie "${duplicate}" a "${name}" majú rovnaké číslo ${id}.`);
    }
    seen.set(id, name);

    const path = join(dir, name);
    const raw = readFileSync(path, 'utf8');
    return {
      id,
      name,
      path,
      raw,
      checksum: createHash('sha256').update(raw, 'utf8').digest('hex'),
    };
  });
}

/* ───────────────────────── rozdelenie na príkazy ───────────────────────── */

export interface SqlStatement {
  sql: string;
  /** MariaDB errno, ktoré sa pri tomto príkaze tolerujú (`-- @tolerate-errno:`). */
  tolerateErrno: number[];
}

/**
 * Rozdelí SQL súbor na jednotlivé príkazy. Rešpektuje reťazce v `'`, `"`
 * a quotované identifikátory v backtickoch, riadkové komentáre `--` a `#`
 * aj blokové komentáre. Súbory neobsahujú `DELIMITER` ani uložené procedúry,
 * takže tento rozsah je dostatočný.
 */
export function splitSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let buffer = '';
  let i = 0;

  const push = () => {
    const chunk = buffer;
    buffer = '';
    if (!hasExecutableSql(chunk)) return;
    statements.push({ sql: chunk.trim(), tolerateErrno: parseTolerateErrno(chunk) });
  };

  while (i < sql.length) {
    const ch = sql[i] as string;
    const next = sql[i + 1];

    // riadkové komentáre
    if ((ch === '-' && next === '-') || ch === '#') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end + 1;
      buffer += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // blokový komentár
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      buffer += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // reťazce a quotované identifikátory
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      buffer += ch;
      i += 1;
      while (i < sql.length) {
        const c = sql[i] as string;
        if (c === '\\' && quote !== '`') {
          buffer += sql.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (c === quote) {
          // zdvojený quote = escapovaný quote
          if (sql[i + 1] === quote) {
            buffer += quote + quote;
            i += 2;
            continue;
          }
          buffer += quote;
          i += 1;
          break;
        }
        buffer += c;
        i += 1;
      }
      continue;
    }

    if (ch === ';') {
      push();
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }
  push();
  return statements;
}

/** Odstráni komentáre a zistí, či v chunku zostalo niečo vykonateľné. */
function hasExecutableSql(chunk: string): boolean {
  const withoutBlock = chunk.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const withoutLine = withoutBlock.replace(/(^|\n)\s*(--[^\n]*|#[^\n]*)/g, '$1');
  return withoutLine.trim().length > 0;
}

function parseTolerateErrno(chunk: string): number[] {
  const out: number[] = [];
  const re = /--\s*@tolerate-errno:\s*([0-9,\s]+)/g;
  let match: RegExpExecArray | null = re.exec(chunk);
  while (match !== null) {
    for (const part of (match[1] as string).split(',')) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n > 0) out.push(n);
    }
    match = re.exec(chunk);
  }
  return out;
}

/** Interpolácia identifikátorov z ENV (len whitelistované hodnoty). */
export function interpolate(sql: string, vars: Record<string, string>): string {
  return sql.replace(/\{\{([A-Z_]+)\}\}/g, (_full, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      throw new Error(`Migrácia používa neznámy placeholder {{${name}}}.`);
    }
    return value;
  });
}

/* ─────────────────────────────── beh migrácií ──────────────────────────── */

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS _migrations (
  id          INT UNSIGNED    NOT NULL PRIMARY KEY,
  name        VARCHAR(191)    NOT NULL,
  checksum    CHAR(64)        NOT NULL,
  applied_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

function errnoOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'errno' in error) {
    const value = (error as { errno?: unknown }).errno;
    if (typeof value === 'number') return value;
  }
  return null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const migrations = loadMigrationFiles(config.migrationsDir);
  if (migrations.length === 0) {
    throw new Error(`V ${config.migrationsDir} nie je žiadna migrácia — to je chyba nasadenia.`);
  }

  const conn = await connect(config, true);
  console.log(
    `[migrate] DB ${config.host}:${config.port}/${config.database} ako "${config.user}", ` +
      `${migrations.length} migrácií v ${config.migrationsDir}`,
  );

  const lockRows = (await conn.query('SELECT GET_LOCK(?, ?) AS got', [
    MIGRATION_LOCK_NAME,
    LOCK_TIMEOUT_SECONDS,
  ])) as Array<{ got: number | null }>;
  if (lockRows[0]?.got !== 1) {
    throw new Error(
      `Nepodarilo sa získať advisory lock "${MIGRATION_LOCK_NAME}" do ${LOCK_TIMEOUT_SECONDS} s ` +
        '— migruje niekto iný. Štart sa preruší (D88).',
    );
  }

  try {
    await conn.query(MIGRATIONS_TABLE_DDL);

    const appliedRows = (await conn.query(
      'SELECT id, name, checksum FROM _migrations ORDER BY id',
    )) as AppliedRow[];
    const applied = new Map(appliedRows.map((row) => [Number(row.id), row]));

    // 1) Fail-fast pri zmene checksumu už aplikovanej migrácie.
    const drift: string[] = [];
    for (const migration of migrations) {
      const row = applied.get(migration.id);
      if (!row) continue;
      if (row.checksum !== migration.checksum) {
        drift.push(
          `${migration.name}: v DB ${row.checksum.slice(0, 12)}…, v repe ${migration.checksum.slice(0, 12)}…`,
        );
      }
    }
    for (const row of applied.values()) {
      if (!migrations.some((m) => m.id === Number(row.id))) {
        drift.push(`${row.name}: aplikovaná v DB, ale v repe už neexistuje`);
      }
    }
    if (drift.length > 0) {
      throw new Error(
        'Migrácie sa rozišli s DB — už aplikovanú migráciu NESMIEŠ meniť ' +
          `(rollback je manuálny, D88):\n  - ${drift.join('\n  - ')}`,
      );
    }

    // 2) Aplikuj chýbajúce.
    const vars: Record<string, string> = {
      APP_USER: config.appUser,
      MIGRATION_USER: config.user,
      DB_NAME: config.database,
    };

    let appliedCount = 0;
    for (const migration of migrations) {
      if (applied.has(migration.id)) {
        console.log(`[migrate] ${migration.name} — už aplikovaná, preskakujem`);
        continue;
      }

      const statements = splitSqlStatements(interpolate(migration.raw, vars));
      console.log(`[migrate] ${migration.name} — aplikujem ${statements.length} príkazov`);

      await conn.beginTransaction();
      try {
        for (const statement of statements) {
          try {
            await conn.query(statement.sql);
          } catch (error) {
            const errno = errnoOf(error);
            if (errno !== null && statement.tolerateErrno.includes(errno)) {
              console.log(
                `[migrate]   tolerovaná chyba ${errno} pri: ${firstLine(statement.sql)}`,
              );
              continue;
            }
            throw new Error(
              `Migrácia ${migration.name} zlyhala pri príkaze: ${firstLine(statement.sql)}`,
              { cause: error },
            );
          }
        }
        await conn.query('INSERT INTO _migrations (id, name, checksum) VALUES (?, ?, ?)', [
          migration.id,
          migration.name,
          migration.checksum,
        ]);
        await conn.commit();
      } catch (error) {
        try {
          await conn.rollback();
        } catch {
          // pôvodná chyba je dôležitejšia
        }
        throw error;
      }

      await writeAuditMigrationApplied(conn, migration);
      appliedCount += 1;
    }

    console.log(
      appliedCount === 0
        ? '[migrate] nič nové — DB je aktuálna (opakovaný beh je no-op)'
        : `[migrate] hotovo, aplikovaných migrácií: ${appliedCount}`,
    );
  } finally {
    try {
      await conn.query('SELECT RELEASE_LOCK(?) AS released', [MIGRATION_LOCK_NAME]);
    } catch {
      // spojenie mohlo spadnúť — lock sa uvolní zavretím spojenia
    }
    await conn.end();
  }
}

function firstLine(sql: string): string {
  const line = sql
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('--') && !l.startsWith('#'));
  const text = line ?? sql.trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/**
 * Audit `migration_applied` (BUILD-SPEC §3). Tabuľka `audit_log` vzniká až
 * v 0006, takže pri prvých migráciách sa zápis (1146 = no such table) preskočí.
 * Ide o `INSERT` — append-only invariant I4 zostáva v platnosti.
 */
async function writeAuditMigrationApplied(
  conn: Connection,
  migration: MigrationFile,
): Promise<void> {
  try {
    await conn.query(
      'INSERT INTO audit_log (actor, event_type, ok, message) VALUES (?, ?, ?, ?)',
      ['system', 'migration_applied', 1, `${migration.name} (sha256 ${migration.checksum})`],
    );
  } catch (error) {
    if (errnoOf(error) === 1146) return;
    console.warn(`[migrate] audit migration_applied sa nezapísal: ${describe(error)}`);
  }
}

async function connect(config: MigrateConfig, createDbIfMissing: boolean): Promise<Connection> {
  const base = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    timezone: 'Z',
    multipleStatements: false,
    connectTimeout: 10_000,
  };
  try {
    return await mariadb.createConnection({ ...base, database: config.database });
  } catch (error) {
    // 1049 = Unknown database. Pri čistom setupe ju vytvorí migračný user.
    if (!createDbIfMissing || errnoOf(error) !== 1049) throw error;
    const bootstrap = await mariadb.createConnection(base);
    try {
      await bootstrap.query(
        `CREATE DATABASE IF NOT EXISTS \`${config.database}\` ` +
          'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
      );
    } finally {
      await bootstrap.end();
    }
    return mariadb.createConnection({ ...base, database: config.database });
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` <- ${error.cause.message}` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const isDirectRun = invokedPath === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(`[migrate] CHYBA: ${describe(error)}`);
      // Nenulový exit kód ⇒ entrypoint appku nespustí (I14, D88).
      process.exit(1);
    });
}
