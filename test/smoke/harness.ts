/**
 * Aura Zľavy — HARNESS SMOKE TESTU NAD ZBUILDOVANOU APPKOU (F.7, D100).
 *
 * Postaví produkčný artefakt (`next build`, `output: 'standalone'`) a spustí ho
 * tak, ako ho spúšťa kontejner: `node .next/standalone/server.js`
 * s `NODE_ENV=production`, heslami zo SÚBOROV (D89), master keyom a session
 * secretom zo súborov (D61, D69), proti reálnej MariaDB, na `127.0.0.1`.
 *
 * PREČO EXISTUJE: chyba §A.3 protokolu (`docs/13-OVERENIE.md`) — Turbopack
 * zahodil `if (!row)` guardy v `src/lib/repo/api-key.repo.ts` a `GET /api/key`
 * vracalo 500 vždy, keď nebol uložený kľúč. 614 unit/integračných testov ju
 * nemohlo vidieť, pretože vitest kompiluje cez esbuild — chyba existovala
 * VÝHRADNE v nasadzovanom artefakte. Tento harness je poistka proti celej tej
 * triede chýb pri každom upgrade Next.js.
 *
 * INVARIANT I6: appka tu NEMÁ `SHOP_BASE_URL_OVERRIDE` (v produkcii je zakázaný)
 * a v `settings` sa NENASTAVUJE žiadna doména shopu — smoke test teda nemá ako
 * poslať request na akýkoľvek shop. Žiadny mock ani reálna doména sa tu
 * nevyskytuje.
 * INVARIANT I13: `WRITES_ENABLED` sa nenastavuje (default `false`), takže ostrý
 * zápis je fyzicky vypnutý aj keby test spravil chybu.
 * INVARIANT I1: všetky tajomstvá sú vygenerované náhodne do gitignorovaného
 * `secrets/`; v tomto súbore nie je ani jedna hodnota tajomstva.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

import argon2 from 'argon2';
import mariadb from 'mariadb';

/** Koreň repozitára — vitest beží s `cwd` = koreň. */
export const REPO_ROOT = process.cwd();

/** Jediný povolený host (I5, I6). */
export const SMOKE_HOST = '127.0.0.1';

export const SMOKE = {
  /**
   * Schéma pre smoke test. V CI dostane vlastnú (`DB_ROOT_PASSWORD` je
   * k dispozícii, takže sa dá vytvoriť); lokálne sa použije už existujúca
   * e2e schéma, pretože migračný user nemá právo `CREATE DATABASE`.
   */
  dbName: process.env.SMOKE_DB_NAME ?? process.env.DB_NAME ?? 'ovl_zliav_e2e',
  dbHost: process.env.DB_HOST ?? SMOKE_HOST,
  dbPort: Number(process.env.DB_PORT ?? 3306),
  dbUser: process.env.DB_USER ?? 'ovl_zliav_app',
  dbPassword: process.env.DB_PASSWORD ?? 'test_app_password',
  migUser: process.env.DB_MIGRATION_USER ?? 'ovl_zliav_mig',
  migPassword: process.env.DB_MIGRATION_PASSWORD ?? 'test_mig_password',
  adminUsername: 'smoke-admin',
  /** ≥ 12 znakov (D68), syntetické, nikde inde sa nepoužíva (I1). */
  adminPassword: 'smoke-heslo-1234567',
  /** Port appky. 0 = necháme OS vybrať a prečítame ho z logu. */
  port: Number(process.env.SMOKE_PORT ?? 3141),
} as const;

export const BASE_URL = `http://${SMOKE_HOST}:${SMOKE.port}`;

const SECRET_DIR = resolvePath(REPO_ROOT, 'secrets');
const FILES = {
  masterKey: resolvePath(SECRET_DIR, 'smoke-master.key'),
  sessionSecret: resolvePath(SECRET_DIR, 'smoke-session.key'),
  dbPassword: resolvePath(SECRET_DIR, 'smoke-db-app.password'),
  dbMigPassword: resolvePath(SECRET_DIR, 'smoke-db-mig.password'),
} as const;

/* ═══════════════════════════ 1. Tajomstvá a DB ═════════════════════════════ */

function writeSecret(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600, flag: 'w' });
}

/** Master key + session secret (32 B hex) a DB heslá v súboroch (D61, D69, D89). */
export function ensureSecrets(): void {
  if (!existsSync(FILES.masterKey)) {
    writeSecret(FILES.masterKey, `${randomBytes(32).toString('hex')}\n`);
  }
  if (!existsSync(FILES.sessionSecret)) {
    writeSecret(FILES.sessionSecret, `${randomBytes(32).toString('hex')}\n`);
  }
  // Heslá DB userov sú dané prostredím (CI service container / lokálna DB),
  // v produkčnom režime ich appka ale smie čítať LEN zo súboru (D89).
  writeSecret(FILES.dbPassword, `${SMOKE.dbPassword}\n`);
  writeSecret(FILES.dbMigPassword, `${SMOKE.migPassword}\n`);
}

/**
 * Vytvorí schému a DB userov, ak je k dispozícii root heslo (CI). Bez neho sa
 * mlčky preskočí a predpokladá sa, že schéma existuje (lokálny vývoj).
 */
export async function ensureDatabase(): Promise<boolean> {
  const rootPassword = process.env.DB_ROOT_PASSWORD;
  if (!rootPassword) return false;
  const conn = await mariadb.createConnection({
    host: SMOKE.dbHost,
    port: SMOKE.dbPort,
    user: 'root',
    password: rootPassword,
    allowPublicKeyRetrieval: true,
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${SMOKE.dbName}\` ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    );
    for (const [user, password] of [
      [SMOKE.migUser, SMOKE.migPassword],
      [SMOKE.dbUser, SMOKE.dbPassword],
    ] as const) {
      await conn.query(`CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY ?`, [password]);
      await conn.query(`ALTER USER '${user}'@'%' IDENTIFIED BY ?`, [password]);
    }
    await conn.query(
      `GRANT ALL PRIVILEGES ON \`${SMOKE.dbName}\`.* TO '${SMOKE.migUser}'@'%' WITH GRANT OPTION`,
    );
    await conn.query(`GRANT USAGE ON *.* TO '${SMOKE.dbUser}'@'%'`);
    await conn.query(`GRANT SELECT ON \`${SMOKE.dbName}\`.* TO '${SMOKE.dbUser}'@'%'`);
    await conn.query('FLUSH PRIVILEGES');
    return true;
  } finally {
    await conn.end();
  }
}

/** Migrácie tým istým runnerom ako produkcia (`scripts/migrate.ts`, D88). */
export function runMigrations(): void {
  const result = spawnSync(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/migrate.ts'],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DB_HOST: SMOKE.dbHost,
        DB_PORT: String(SMOKE.dbPort),
        DB_NAME: SMOKE.dbName,
        DB_USER: SMOKE.dbUser,
        DB_MIGRATION_USER: SMOKE.migUser,
        DB_MIGRATION_PASSWORD: SMOKE.migPassword,
        DB_MIGRATION_PASSWORD_FILE: undefined,
      },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`[smoke] migrácie zlyhali: ${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
}

/** Tabuľky v poradí bezpečnom pre FK. */
const DATA_TABLES = [
  'audit_log',
  'campaign_items',
  'campaigns',
  'catalog_cache',
  'products_allowlist',
  'api_key',
  'login_attempts',
  'users',
] as const;

/**
 * Čistý východiskový stav: žiadny API kľúč, žiadna doména shopu (I6 — appka
 * teda nemá kam volať), jeden admin používateľ na login flow.
 */
export async function seedBaseline(): Promise<void> {
  const conn = await mariadb.createConnection({
    host: SMOKE.dbHost,
    port: SMOKE.dbPort,
    user: SMOKE.migUser,
    password: SMOKE.migPassword,
    database: SMOKE.dbName,
    allowPublicKeyRetrieval: true,
  });
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of DATA_TABLES) await conn.query(`DELETE FROM \`${table}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.query(
      'UPDATE settings SET shop_domain = NULL, shop_domain_confirmed_at = NULL, ' +
        'writes_locked = 0, writes_locked_reason = NULL, writes_locked_at = NULL WHERE id = 1',
    );
    const hash = await argon2.hash(SMOKE.adminPassword, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    await conn.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?) ' +
        'ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
      [SMOKE.adminUsername, hash],
    );
  } finally {
    await conn.end();
  }
}

/* ═══════════════════════════ 2. Produkčný build ════════════════════════════ */

export const STANDALONE_SERVER = resolvePath(REPO_ROOT, '.next', 'standalone', 'server.js');

/**
 * `next build`. Preskočí sa len explicitne (`SMOKE_REUSE_BUILD=1`) — to je
 * pomôcka pri ladení samotného testu, nie default: celý zmysel tohto testu je
 * overiť ARTEFAKT, ktorý build práve vyrobil.
 */
export function runNextBuild(): void {
  if (process.env.SMOKE_REUSE_BUILD === '1' && existsSync(STANDALONE_SERVER)) return;
  const result = spawnSync(
    process.execPath,
    [resolvePath(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
    {
      cwd: REPO_ROOT,
      // Build NESMIE vyžadovať reálne ENV (env.ts je lazy) — nepodsúvame mu nič
      // okrem `NODE_ENV`, presne ako Docker build (I1: žiadne tajomstvo v builde).
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 900_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `[smoke] \`next build\` zlyhal (exit ${String(result.status)}):\n` +
        `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  if (!existsSync(STANDALONE_SERVER)) {
    throw new Error(`[smoke] build prešiel, ale ${STANDALONE_SERVER} neexistuje.`);
  }
}

/* ═════════════════════ 3. Beh produkčného artefaktu ════════════════════════ */

/** ENV produkčného behu. Zámerne bez `SHOP_BASE_URL_OVERRIDE` (I6). */
export function productionEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PUBLIC_BIND: SMOKE_HOST,
    HOSTNAME: SMOKE_HOST,
    PORT: String(SMOKE.port),
    DB_HOST: SMOKE.dbHost,
    DB_PORT: String(SMOKE.dbPort),
    DB_NAME: SMOKE.dbName,
    DB_USER: SMOKE.dbUser,
    // D89 — v produkcii výhradne zo súborov; holé heslá musia zmiznúť.
    DB_PASSWORD: undefined,
    DB_MIGRATION_PASSWORD: undefined,
    DB_PASSWORD_FILE: FILES.dbPassword,
    DB_MIGRATION_USER: SMOKE.migUser,
    DB_MIGRATION_PASSWORD_FILE: FILES.dbMigPassword,
    MASTER_KEY_FILE: FILES.masterKey,
    SESSION_SECRET_FILE: FILES.sessionSecret,
    // Scheduler v smoke teste nepotrebujeme — a nesmie nič dopáliť.
    SCHEDULER_ENABLED: 'false',
    // I6/I13 — override zakázaný v produkcii, ostrý zápis vypnutý.
    SHOP_BASE_URL_OVERRIDE: undefined,
    WRITES_ENABLED: 'false',
    LOG_LEVEL: 'warn',
    ...overrides,
  };
  return env;
}

export interface StartedServer {
  child: ChildProcess;
  output: () => string;
  stop: () => Promise<void>;
}

/** Spustí `node .next/standalone/server.js` a zbiera jeho výstup. */
export function startStandalone(overrides: Record<string, string> = {}): StartedServer {
  let buffer = '';
  const child = spawn(process.execPath, [STANDALONE_SERVER], {
    cwd: REPO_ROOT,
    env: productionEnv(overrides),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
  });
  return {
    child,
    output: () => buffer,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((done) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          done();
        }, 10_000);
        child.once('exit', () => {
          clearTimeout(timer);
          done();
        });
      });
    },
  };
}

/** Počká na `/api/health` (bez auth — presne ako docker healthcheck, D87). */
export async function waitForHealth(server: StartedServer, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'žiadna odpoveď';
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `[smoke] server skončil s exit=${String(server.child.exitCode)}:\n${server.output()}`,
      );
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status < 500) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`[smoke] appka nenabehla do ${timeoutMs} ms (${lastError}):\n${server.output()}`);
}

/* ══════════════════════════ 4. HTTP pomôcky ════════════════════════════════ */

export interface HttpResult {
  status: number;
  text: string;
  json: unknown;
  setCookie: string[];
}

/**
 * Jedno HTTP volanie na appku. `Origin` posielame pri mutáciách — bez neho je
 * každý POST/PUT/DELETE odmietnutý ako `origin_missing` (CSRF obrana, D72).
 */
export async function call(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string | null } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    headers.Origin = BASE_URL;
  }
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: res.status,
    text,
    json,
    setCookie: res.headers.getSetCookie(),
  };
}

export interface LoginResult {
  /** Hodnota do hlavičky `Cookie`. */
  cookie: string;
  /** Celé `Set-Cookie` (kontrola atribútov D69). */
  rawSetCookie: string;
  status: number;
}

/** Prihlásenie cez `POST /api/auth/login` — po ňom platí sudo okno (D70). */
export async function login(): Promise<LoginResult> {
  const res = await call('POST', '/api/auth/login', {
    body: { username: SMOKE.adminUsername, password: SMOKE.adminPassword },
  });
  const raw = res.setCookie.find((c) => c.startsWith('ovl_zliav_session=')) ?? '';
  const value = raw.split(';')[0] ?? '';
  return { cookie: value, rawSetCookie: raw, status: res.status };
}
