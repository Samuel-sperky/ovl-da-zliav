/**
 * Aura Zľavy — E2E HARNESS SERVER (A18, BUILD-SPEC §12, D99).
 *
 * Jeden proces, ktorý postaví celé prostredie pre Playwright a drží ho pri
 * živote. Spúšťa ho `playwright.config.ts` ako `webServer`:
 *
 *   1. `startMockShop()` (A6) na ephemeral porte a **výhradne na 127.0.0.1**,
 *   2. **control server** na `127.0.0.1:E2E_CONTROL_PORT` — jediný spôsob, akým
 *      testy (bežia v iných procesoch) prepínajú scenáre mocku a čítajú jeho
 *      `recordedRequests`,
 *   3. migrácie proti e2e schéme + seed admin používateľa a `settings`,
 *   4. `next dev` s `SHOP_BASE_URL_OVERRIDE` na mock.
 *
 * INVARIANT I6 — nepodkročiteľné: mock aj appka žijú na `127.0.0.1`, appka nemá
 * inú cestu k shopu než override na mock a reálna doména shopu sa v tomto súbore
 * ani v ENV, ktoré appke podsúva, NEVYSKYTUJE. Doména v `settings` je
 * `https://shop.e2e.invalid` — TLD `.invalid` je podľa RFC 2606 nepoužiteľná,
 * takže ani omylom neexistuje host, na ktorý by sa dalo pripojiť.
 *
 * INVARIANT I1 — v ENV ani v seede nie je žiadne reálne tajomstvo; kľúč shopu
 * má tvar `fake-shop-key-…` (fixtures A6) a appke sa vkladá výhradne cez UI/API.
 *
 * INVARIANT I13 — appka tu **zámerne** nebeží s `NODE_ENV=production`: env
 * schéma (`src/env.ts`) zakazuje `SHOP_BASE_URL_OVERRIDE` v produkcii, takže
 * „produkčný" e2e beh by musel volať reálnu doménu (I6). Ostrý zápis je preto
 * v e2e vynútene odmietnutý a testy overujú práve túto fail-closed cestu.
 *
 * Vlastník: A18.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve as resolvePath } from 'node:path';
import { promisify } from 'node:util';

import argon2 from 'argon2';
import mariadb from 'mariadb';

import { DEFAULT_PRODUCTS, DEFAULT_KEYS } from '../mock-shop/fixtures';
import { startMockShop, type MockShopServer } from '../mock-shop/server';
import type { MockFailureKind, MockTarget } from '../mock-shop/state';

import { APP_BASE_URL, CONTROL_BASE_URL, E2E_CONFIG, E2E_HOST, REPO_ROOT } from './config';

const execFileAsync = promisify(execFile);

/** argon2id s parametrami zo `scripts/seed-admin.ts` (D68). */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/* ═══════════════════════════ 2. Tajomstvá a DB ═════════════════════════════ */

/** Master key a session secret pre e2e — 32 B hex v gitignorovanom `secrets/`. */
function ensureSecret(relativePath: string): void {
  const target = resolvePath(REPO_ROOT, relativePath);
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'w' });
}

function migrationEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DB_HOST: E2E_CONFIG.dbHost,
    DB_PORT: String(E2E_CONFIG.dbPort),
    DB_NAME: E2E_CONFIG.dbName,
    DB_USER: E2E_CONFIG.dbUser,
    DB_MIGRATION_USER: E2E_CONFIG.migUser,
    DB_MIGRATION_PASSWORD: E2E_CONFIG.migPassword,
  };
}

async function runMigrations(): Promise<void> {
  await execFileAsync(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/migrate.ts'],
    { cwd: REPO_ROOT, env: migrationEnv() },
  );
}

async function seedBaseline(): Promise<void> {
  const conn = await mariadb.createConnection({
    host: E2E_CONFIG.dbHost,
    port: E2E_CONFIG.dbPort,
    user: E2E_CONFIG.migUser,
    password: E2E_CONFIG.migPassword,
    database: E2E_CONFIG.dbName,
    allowPublicKeyRetrieval: true,
  });
  try {
    const hash = await argon2.hash(E2E_CONFIG.adminPassword, ARGON2_OPTIONS);
    await conn.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?) ' +
        'ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
      [E2E_CONFIG.adminUsername, hash],
    );
    await conn.query(
      'UPDATE settings SET shop_domain = ?, shop_domain_confirmed_at = UTC_TIMESTAMP(3) WHERE id = 1',
      [E2E_CONFIG.shopDomain],
    );
  } finally {
    await conn.end();
  }
}

/* ═══════════════════════════ 3. Control server ═════════════════════════════ */

/**
 * Riadenie mocku z testovacích workerov. Zámerne minimalistické REST-like API;
 * počúva len na loopbacku a mimo e2e behu neexistuje.
 */
export interface ControlFailNthBody {
  n: number;
  kind: MockFailureKind;
  target?: MockTarget;
  times?: number;
  retryAfterSeconds?: number;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function startControlServer(mock: MockShopServer): Promise<{ close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';
      const method = (req.method ?? 'GET').toUpperCase();

      if (method === 'GET' && path === '/health') {
        json(res, 200, { ok: true, mockBaseUrl: mock.baseUrl });
        return;
      }
      if (method === 'GET' && path === '/state') {
        json(res, 200, {
          ok: true,
          requestCount: mock.state.requestCount,
          writeCount: mock.state.writeCount,
          readCount: mock.state.readCount,
          seenApiKeys: mock.state.seenApiKeys(),
          keyLeakedToReads: mock.state.keyLeakedToReads(),
          writeGapsMs: mock.state.writeGapsMs(),
          writePaths: mock.state.writeRequests().map((r) => r.path),
        });
        return;
      }
      if (method === 'POST' && path === '/reset') {
        mock.state.reset();
        mock.state.setProducts(DEFAULT_PRODUCTS);
        for (const entry of DEFAULT_KEYS) mock.state.addKey(entry.key, entry.scopes);
        json(res, 200, { ok: true });
        return;
      }
      if (method === 'POST' && path === '/fail-nth') {
        const body = (await readJson(req)) as unknown as ControlFailNthBody;
        mock.state.failNth(Number(body.n), body.kind, {
          target: body.target ?? 'write',
          times: body.times ?? 1,
          ...(body.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: body.retryAfterSeconds }),
        });
        json(res, 200, { ok: true });
        return;
      }
      if (method === 'POST' && path === '/change-price') {
        const body = await readJson(req);
        const previous = mock.state.changePrice(Number(body.id), Number(body.price));
        json(res, 200, { ok: true, previous });
        return;
      }
      if (method === 'POST' && path === '/rate-limit') {
        const body = await readJson(req);
        mock.state.rateLimit(Number(body.retryAfterSeconds ?? 30));
        json(res, 200, { ok: true });
        return;
      }
      json(res, 404, { ok: false, error: 'unknown_control_action' });
    })();
  });

  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(E2E_CONFIG.controlPort, E2E_HOST, () => {
      resolveServer({
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/* ═══════════════════════════ 4. Next dev server ════════════════════════════ */

function appEnv(mockBaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // I13 — `production` sa tu NESMIE objaviť: v produkcii je override zakázaný
    // a e2e by muselo volať reálny shop (I6). Ostrý zápis je teda odmietnutý.
    NODE_ENV: 'development',
    WRITES_ENABLED: 'false',
    PUBLIC_BIND: E2E_HOST,
    PORT: String(E2E_CONFIG.appPort),
    // I6 — jediná cesta appky k „shopu" je lokálny mock.
    SHOP_BASE_URL_OVERRIDE: mockBaseUrl,
    DB_HOST: E2E_CONFIG.dbHost,
    DB_PORT: String(E2E_CONFIG.dbPort),
    DB_NAME: E2E_CONFIG.dbName,
    DB_USER: E2E_CONFIG.dbUser,
    DB_PASSWORD: E2E_CONFIG.dbPassword,
    DB_MIGRATION_USER: E2E_CONFIG.migUser,
    DB_MIGRATION_PASSWORD: E2E_CONFIG.migPassword,
    MASTER_KEY_FILE: E2E_CONFIG.masterKeyFile,
    SESSION_SECRET_FILE: E2E_CONFIG.sessionSecretFile,
    // Scheduler v e2e nebeží sám — inak by nedeterministicky pálil kampane.
    SCHEDULER_ENABLED: 'false',
    // Krátke pauzy — e2e nemá čakať 250 ms na položku (I10 overujú integračné testy).
    SHOP_WRITE_PAUSE_MS: '0',
    LOG_LEVEL: 'warn',
  };
}

function startNextDev(mockBaseUrl: string): ChildProcess {
  const child = spawn(
    process.execPath,
    [resolvePath(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(E2E_CONFIG.appPort), '-H', E2E_HOST],
    { cwd: REPO_ROOT, env: appEnv(mockBaseUrl), stdio: ['ignore', 'inherit', 'inherit'] },
  );
  return child;
}

/* ═════════════════════════ 5. Global setup Playwrightu ══════════════════════ */

/** Počká, kým appka odpovie na `/api/health` (bez auth). */
async function waitForApp(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `${APP_BASE_URL}/api/health`;
  let lastError = 'žiadna odpoveď';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`[e2e] appka na ${url} nenabehla do ${timeoutMs} ms: ${lastError}`);
}

/**
 * Playwright `globalSetup`. Vracia teardown funkciu — Playwright ju zavolá po
 * poslednom teste, takže mock, control server ani `next dev` neprežijú beh.
 *
 * Beží v runneri Playwrightu (transpiluje TS sám), preto sa harness NESPÚŠŤA
 * ako samostatný `node` skript — nemal by ako vyriešiť extensionless importy.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  ensureSecret(E2E_CONFIG.masterKeyFile);
  ensureSecret(E2E_CONFIG.sessionSecretFile);

  await runMigrations();
  await seedBaseline();

  const mock = await startMockShop({ products: DEFAULT_PRODUCTS, keys: DEFAULT_KEYS });
  const control = await startControlServer(mock);
  const app = startNextDev(mock.baseUrl);

  process.stdout.write(
    `[e2e] mock shop: ${mock.baseUrl} · control: ${CONTROL_BASE_URL} · app: ${APP_BASE_URL}\n`,
  );

  try {
    await waitForApp();
  } catch (error) {
    app.kill('SIGKILL');
    await control.close();
    await mock.close();
    throw error;
  }

  return async () => {
    app.kill('SIGTERM');
    await new Promise<void>((done) => {
      if (app.exitCode !== null || app.signalCode !== null) {
        done();
        return;
      }
      const timer = setTimeout(() => {
        app.kill('SIGKILL');
        done();
      }, 10_000);
      app.once('exit', () => {
        clearTimeout(timer);
        done();
      });
    });
    await control.close();
    await mock.close();
  };
}
