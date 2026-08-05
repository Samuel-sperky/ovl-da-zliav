/**
 * Aura Zľavy — Playwright fixtures pre e2e (A18, BUILD-SPEC §12, D99).
 *
 * Poskytuje:
 *  - `db`      — priamy prístup do e2e schémy (reset medzi testami, seed stavov,
 *                ktoré sa v e2e inak vyrobiť nedajú: expirovaný kľúč, kampaň
 *                s čiastočným zlyhaním, audit záznam s `price_mismatch`),
 *  - `control` — klient control servera harnessu (`serve.ts`): scenáre mocku
 *                a jeho `recordedRequests`,
 *  - `login()` / `storeApiKey()` / `addAllowlist()` — kroky, ktoré takmer každý
 *    scenár potrebuje. Kľúč a allowlist idú **cez API appky**, nie do DB
 *    (kľúč je šifrovaný master keyom a e2e ho zámerne nikdy neobchádza, I1).
 *
 * INVARIANT I6: v tomto súbore ani v žiadnom scenári nie je iná adresa než
 * `127.0.0.1`; appka má shop výhradne na mocku (`SHOP_BASE_URL_OVERRIDE`).
 * INVARIANT I1: jediný „kľúč" je `fake-shop-key-…` z fixtures A6.
 * INVARIANT I4: `db` NIKDY nemaže ani nemení `audit_log` inak než `INSERT`
 * (seed), a to výhradne migračným userom mimo aplikačnej cesty.
 *
 * Vlastník: A18.
 */
import { test as base, expect, type Page } from '@playwright/test';
import mariadb, { type Pool } from 'mariadb';

import { VALID_API_KEY } from '../mock-shop/fixtures';
import type { MockFailureKind, MockTarget } from '../mock-shop/state';

import { APP_BASE_URL, CONTROL_BASE_URL, E2E_CONFIG } from './config';

export { expect };
export { VALID_API_KEY };

/** Prihlasovacie údaje e2e admina (syntetické, I1). */
export const ADMIN = {
  username: E2E_CONFIG.adminUsername,
  password: E2E_CONFIG.adminPassword,
} as const;

/** Produkty z default katalógu mocku, ktoré scenáre používajú. */
export const E2E_PRODUCTS = [201, 202, 203] as const;

/* ═════════════════════════════ 1. DB helper ════════════════════════════════ */

/** Tabuľky v poradí bezpečnom pre FK. */
const DATA_TABLES = [
  'audit_log',
  'campaign_items',
  'campaigns',
  'catalog_cache',
  'products_allowlist',
  'api_key',
  'login_attempts',
] as const;

let pool: Pool | null = null;

function getPool(): Pool {
  pool ??= mariadb.createPool({
    host: E2E_CONFIG.dbHost,
    port: E2E_CONFIG.dbPort,
    user: E2E_CONFIG.migUser,
    password: E2E_CONFIG.migPassword,
    database: E2E_CONFIG.dbName,
    connectionLimit: 2,
    allowPublicKeyRetrieval: true,
  });
  return pool;
}

/** ULID-podobný identifikátor: 26 znakov Crockford base32 (stačí na CHAR(26)). */
function fakeUlid(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < 26; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export interface SeededItem {
  productId: number;
  status: 'ok' | 'failed' | 'uncertain' | 'pending' | 'skipped' | 'not_found';
  priceAtPreview?: number;
  priceAtWrite?: number;
  priceMismatch?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface SeedCampaignInput {
  name: string;
  percent: number;
  from: string;
  to: string;
  status: 'draft' | 'scheduled' | 'needs_key' | 'running' | 'done' | 'partial' | 'failed' | 'missed' | 'cancelled' | 'lapsed';
  mode?: 'eager' | 'scheduled';
  kind?: 'new' | 'extend' | 'overwrite' | 'retry';
  items: SeededItem[];
}

export interface DbHelper {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** INSERT, ktorý vráti `insertId` z toho istého spojenia (viď `insert()`). */
  insert(sql: string, params?: unknown[]): Promise<number>;
  /** Vyčistí dáta a vráti singletony do východiskového stavu. */
  reset(): Promise<void>;
  adminUserId(): Promise<number>;
  /** Priamy seed allowlistu (keď scenár nemá dôvod prechádzať UI). */
  seedAllowlist(productIds: readonly number[]): Promise<void>;
  seedCampaign(input: SeedCampaignInput): Promise<number>;
  /** D39c — audit záznam s príznakom nezhody cien v `after_snapshot`. */
  seedAuditRow(input: {
    eventType: string;
    ok: boolean | null;
    productId?: number | null;
    campaignId?: number | null;
    message: string;
    priceMismatch?: boolean;
    httpStatus?: number | null;
  }): Promise<number>;
  /** R2/D10 — posunie expiráciu kľúča do minulosti (read-only režim). */
  expireApiKey(): Promise<void>;
  keyRowCount(): Promise<number>;
  lockWrites(reason: string): Promise<void>;
}

function makeDb(): DbHelper {
  const p = getPool();

  const query = async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => {
    const rows: unknown = await p.query(sql, params);
    return Array.isArray(rows) ? (rows as T[]) : [];
  };

  /**
   * INSERT s návratom `insertId`.
   *
   * POZOR: `SELECT LAST_INSERT_ID()` ako SAMOSTATNÝ dotaz nad poolom je chyba —
   * pool ho môže poslať na INÉ spojenie, kde je hodnota z iného (alebo žiadneho)
   * INSERT-u. Prejavovalo sa to zlyhaním FK `fk_items_campaign` pri seede
   * kampane. `insertId` z výsledku INSERT-u je vždy z toho istého spojenia.
   */
  const insert = async (sql: string, params: unknown[] = []): Promise<number> => {
    const result: unknown = await p.query(sql, params);
    const id = (result as { insertId?: number | bigint } | null)?.insertId;
    if (id === undefined) throw new Error(`INSERT nevrátil insertId: ${sql}`);
    return Number(id);
  };

  const adminUserId = async (): Promise<number> => {
    const rows = await query<{ id: number }>('SELECT id FROM users WHERE username = ?', [
      ADMIN.username,
    ]);
    if (rows.length === 0) throw new Error('E2E admin používateľ nie je nasedený — beží harness?');
    return Number(rows[0].id);
  };

  return {
    query,
    insert,
    adminUserId,

    async reset(): Promise<void> {
      await query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of DATA_TABLES) await query(`DELETE FROM \`${table}\``);
      await query('SET FOREIGN_KEY_CHECKS = 1');
      await query(
        'UPDATE settings SET shop_domain = ?, shop_domain_confirmed_at = UTC_TIMESTAMP(3), ' +
          'eager_write_default = 1, writes_locked = 0, writes_locked_reason = NULL, ' +
          'writes_locked_at = NULL, onboarding_done_at = NULL WHERE id = 1',
        [E2E_CONFIG.shopDomain],
      );
    },

    async seedAllowlist(productIds: readonly number[]): Promise<void> {
      let slot = 1;
      for (const productId of productIds) {
        await query(
          'INSERT INTO products_allowlist (product_id, slot, label, shop_status) VALUES (?, ?, ?, ?)',
          [productId, slot, `Šperk ${productId}`, 'ok'],
        );
        await query(
          'INSERT INTO catalog_cache (product_id, name, price, has_attributes, source, fetched_at) ' +
            'VALUES (?, ?, ?, 0, ?, UTC_TIMESTAMP(3)) ' +
            'ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price)',
          [productId, `Šperk ${productId}`, 19.99, 'list'],
        );
        slot += 1;
      }
    },

    async seedCampaign(input: SeedCampaignInput): Promise<number> {
      const userId = await adminUserId();
      const itemsOk = input.items.filter((i) => i.status === 'ok').length;
      const itemsFailed = input.items.filter((i) => i.status === 'failed').length;
      const itemsUncertain = input.items.filter((i) => i.status === 'uncertain').length;
      const campaignId = await insert(
        'INSERT INTO campaigns (operation_id, name, kind, percent, date_from, date_to, mode, status, ' +
          'items_total, items_ok, items_failed, items_uncertain, confirmed_at, confirm_payload_hash, ' +
          'sudo_at, finished_at, created_by) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?)',
        [
          fakeUlid(),
          input.name,
          input.kind ?? 'new',
          input.percent,
          input.from,
          input.to,
          input.mode ?? 'eager',
          input.status,
          input.items.length,
          itemsOk,
          itemsFailed,
          itemsUncertain,
          'e'.repeat(64),
          userId,
        ],
      );
      let position = 1;
      for (const item of input.items) {
        await query(
          'INSERT INTO campaign_items (campaign_id, product_id, position, status, attempt_count, ' +
            'name_at_write, price_at_preview, price_at_write, price_mismatch, error_code, error_message) ' +
            'VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
          [
            campaignId,
            item.productId,
            position,
            item.status,
            `Šperk ${item.productId}`,
            item.priceAtPreview ?? 19.99,
            item.priceAtWrite ?? item.priceAtPreview ?? 19.99,
            item.priceMismatch ? 1 : 0,
            item.errorCode ?? (item.status === 'failed' ? 'server_error' : null),
            item.errorMessage ??
              (item.status === 'failed' ? 'Shop odpovedal chybou servera — zápis neprešiel.' : null),
          ],
        );
        position += 1;
      }
      return campaignId;
    },

    async seedAuditRow(input): Promise<number> {
      // I4 — výhradne INSERT; audit sa v e2e nikdy nemení ani nemaže.
      return insert(
        'INSERT INTO audit_log (actor, user_id, event_type, ok, campaign_id, product_id, ' +
          'http_status, before_snapshot, after_snapshot, message) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'user',
          await adminUserId(),
          input.eventType,
          input.ok === null ? null : input.ok ? 1 : 0,
          input.campaignId ?? null,
          input.productId ?? null,
          input.httpStatus ?? null,
          JSON.stringify({ price: 19.99, reduction_unverifiable: true }),
          JSON.stringify({
            status: input.ok === false ? 'failed' : 'ok',
            price_mismatch: input.priceMismatch === true,
          }),
          input.message,
        ],
      );
    },

    async expireApiKey(): Promise<void> {
      await query('UPDATE api_key SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 HOUR WHERE id = 1');
    },

    async keyRowCount(): Promise<number> {
      const [row] = await query<{ n: number }>('SELECT COUNT(*) AS n FROM api_key');
      return Number(row.n);
    },

    async lockWrites(reason: string): Promise<void> {
      await query(
        'UPDATE settings SET writes_locked = 1, writes_locked_reason = ?, ' +
          'writes_locked_at = UTC_TIMESTAMP(3) WHERE id = 1',
        [reason],
      );
    },
  };
}

/* ═══════════════════════════ 2. Control klient ═════════════════════════════ */

export interface MockStateSnapshot {
  requestCount: number;
  writeCount: number;
  readCount: number;
  seenApiKeys: string[];
  keyLeakedToReads: boolean;
  writeGapsMs: number[];
  writePaths: string[];
}

export interface Control {
  reset(): Promise<void>;
  state(): Promise<MockStateSnapshot>;
  failNth(
    n: number,
    kind: MockFailureKind,
    opts?: { target?: MockTarget; times?: number; retryAfterSeconds?: number },
  ): Promise<void>;
  changePrice(productId: number, price: number): Promise<void>;
  rateLimit(retryAfterSeconds?: number): Promise<void>;
}

function makeControl(): Control {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${CONTROL_BASE_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Control server ${path} vrátil ${res.status} — beží harness (serve.ts)?`);
    }
    return (await res.json()) as T;
  }

  return {
    reset: () => call<{ ok: true }>('/reset', {}).then(() => undefined),
    state: () => call<MockStateSnapshot>('/state'),
    failNth: (n, kind, opts = {}) =>
      call('/fail-nth', { n, kind, ...opts }).then(() => undefined),
    changePrice: (productId, price) =>
      call('/change-price', { id: productId, price }).then(() => undefined),
    rateLimit: (retryAfterSeconds = 30) =>
      call('/rate-limit', { retryAfterSeconds }).then(() => undefined),
  };
}

/* ══════════════════════════ 3. Kroky scenárov ══════════════════════════════ */

/**
 * Volanie API appky z kontextu prihlásenej stránky. Hlavička `Origin` je
 * POVINNÁ na každej mutácii (D72, CSRF obrana) — `page.request` ju sám
 * nepridáva, takže bez nej by každý POST/PUT/DELETE skončil na `origin_missing`.
 */
export async function api(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<import('@playwright/test').APIResponse> {
  return page.request.fetch(path, {
    method,
    headers: { Origin: APP_BASE_URL, 'content-type': 'application/json' },
    ...(data === undefined ? {} : { data }),
  });
}

/** Prihlásenie cez UI (`/login`) — po ňom platí sudo okno (D70). */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(page.getByTestId('login-page')).toBeVisible();
  await page.getByTestId('login-username').fill(ADMIN.username);
  await page.getByTestId('login-password').fill(ADMIN.password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-page')).toBeHidden({ timeout: 15_000 });
}

/**
 * Uloží kľúč cez `PUT /api/key` v kontexte prihlásenej stránky (sudo okno platí
 * od loginu). Kľúč je syntetický `fake-shop-key-…` a appka ho overí sondou
 * proti mocku (I6).
 */
export async function storeApiKey(page: Page, apiKey: string = VALID_API_KEY): Promise<void> {
  const res = await api(page, 'PUT', '/api/key', { apiKey });
  expect(res.status(), await res.text()).toBe(200);
}

/** Pridá produkty do allowlistu cez `POST /api/allowlist` (max 10, I2). */
export async function addAllowlist(page: Page, productIds: readonly number[]): Promise<void> {
  for (const productId of productIds) {
    const res = await api(page, 'POST', '/api/allowlist', { productId });
    expect(res.status(), await res.text()).toBe(200);
  }
}

/**
 * Vynúti sudo re-auth na strane klienta: `ConfirmPanel` porovnáva `sudoUntil`
 * s časom prehliadača, takže posun hodín v prehliadači zodpovedá „od poslednej
 * autentifikácie ubehlo viac než 15 minút" (D70). Serverové sudo okno zostáva
 * platné — testujeme UI cestu, nie obídenie autentifikácie.
 */
export async function expireClientSudo(page: Page): Promise<void> {
  await page.clock.fastForward('20:00');
}

/* ════════════════════════════ 4. Fixtures ═════════════════════════════════ */

interface E2EFixtures {
  db: DbHelper;
  control: Control;
  /** Auto fixture — čistý stav DB aj mocku pred každým testom. */
  cleanState: void;
}

export const test = base.extend<E2EFixtures>({
  // Playwright vyžaduje destrukturalizáciu prvého argumentu (analyzuje si z nej
  // závislosti fixture); tieto dve fixtures nezávisia od ničoho.
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    await use(makeDb());
  },
  // eslint-disable-next-line no-empty-pattern
  control: async ({}, use) => {
    await use(makeControl());
  },
  cleanState: [
    async ({ db, control }, use) => {
      await db.reset();
      await control.reset();
      await use();
    },
    { auto: true },
  ],
});
