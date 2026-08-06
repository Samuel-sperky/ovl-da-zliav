/**
 * Aura Zľavy — DRUHÝ API kľúč (`orders_read`) end-to-end
 * (KONTRAKT-PREDAJNOST-2026-08-06: P2, P5, I8' bod 4, akceptačné kritériá 3 a 5).
 *
 * Čo tieto testy strážia:
 *  1. výber kľúča podľa `kind` — objednávkový repozitár NIKDY nevidí zápisový
 *     kľúč a naopak (to je zároveň dôkaz, že objednávkový kľúč nie je dosažiteľný
 *     zo zápisovej cesty, ktorá používa výhradne `apiKeyRepo`),
 *  2. DVE rôzne TTL: `shop_write` 48 h (R2), `orders_read` 30 dní (P2),
 *  3. panic button maže OBA kľúče a zapíše audit za KAŽDÝ z nich (D63, D67),
 *  4. `/api/key` vie oba druhy vložiť aj prečítať a objednávkový kľúč sa
 *     NEULOŽÍ, keď mu shop čítanie objednávok nepovolí,
 *  5. do odpovede nejde nikdy nič viac než `last4`, `present` a časy (D65, I1).
 *
 * Objednávkový endpoint sa tu NEVOLÁ (I8' bod 1) — sonda objednávkového kľúča
 * je nafejkovaná proti dohodnutému rozhraniu `OrdersKeyProbe`
 * (`src/lib/keys/orders-key-probe.ts`).
 *
 * Žiadna DB a žiadny fetch: repozitár beží nad falošným `Queryable` (I6).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuditInput, AuditWriter, KeyProbeResult, Queryable } from '@/contracts';

import { encryptApiKey } from '@/lib/crypto/secret-box';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import {
  API_KEY_MAX_TTL_HOURS,
  ApiKeyError,
  ORDERS_KEY_MAX_TTL_HOURS,
  apiKeyRepo,
  apiKeyRepoForKind,
  createApiKeyRepo,
  maxTtlHoursForKind,
  ordersKeyRepo,
  type ApiKeyKind,
} from '@/lib/repo/api-key.repo';
import {
  ORDERS_PROBE_MISSING_CODE,
  getOrdersKeyProbe,
  registerOrdersKeyProbe,
  resetOrdersKeyProbe,
} from '@/lib/keys/orders-key-probe';
import {
  createKeyDeleteRoute,
  createKeyGetRoute,
  createKeyPutRoute,
  PANIC_CONFIRM_LITERAL,
  ttlHoursForKind,
  type KeyRouteDeps,
} from '@/app/api/key/route';

import { TEST_NOW } from '../helpers/factories';

/* ═══════════════════════════ falošná DB s `kind` ═══════════════════════════ */

const MASTER_KEY = Buffer.alloc(32, 0x5a);
const BOX = { masterKey: MASTER_KEY };

const SHOP_KEY_PLAINTEXT = 'fake-shop-key-ZAPIS1111';
const ORDERS_KEY_PLAINTEXT = 'fake-shop-key-OBJEDNAVKY2222';

interface StoredRow {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_version: number;
  last4: string;
  created_at: Date;
  expires_at: Date;
  verify_status: string;
  verified_at: Date | null;
  last_used_at: Date | null;
}

interface FakeDb {
  conn: Queryable;
  rows: Map<ApiKeyKind, StoredRow>;
  audits: AuditInput[];
  audit: AuditWriter;
  sqls: string[];
  values: unknown[][];
}

function rowFor(plaintext: string, expiresAt: Date): StoredRow {
  const record = encryptApiKey(Buffer.from(plaintext, 'utf8'), BOX);
  return {
    ciphertext: record.ciphertext,
    iv: record.iv,
    auth_tag: record.authTag,
    key_version: record.keyVersion,
    last4: plaintext.slice(-4),
    created_at: new Date(expiresAt.getTime() - 3_600_000),
    expires_at: expiresAt,
    verify_status: 'valid',
    verified_at: new Date(),
    last_used_at: null,
  };
}

/**
 * Falošné spojenie, ktoré — na rozdiel od fake DB v `crypto.spec` — pozná
 * `kind`. Bez toho by sa výber podľa druhu nedal dokázať.
 */
function createFakeDb(initial: Partial<Record<ApiKeyKind, StoredRow>> = {}): FakeDb {
  const rows = new Map<ApiKeyKind, StoredRow>();
  for (const [kind, row] of Object.entries(initial)) {
    if (row) rows.set(kind as ApiKeyKind, row);
  }
  const audits: AuditInput[] = [];
  const sqls: string[] = [];
  const allValues: unknown[][] = [];

  const query = async (sql: string, params?: unknown): Promise<unknown> => {
    const values = Array.isArray(params) ? params : [];
    sqls.push(sql);
    allValues.push(values);

    if (sql.startsWith('SELECT kind FROM api_key')) {
      return [...rows.keys()].map((kind) => ({ kind }));
    }
    if (sql.startsWith('SELECT')) {
      const row = rows.get(values[0] as ApiKeyKind);
      return row ? [row] : [];
    }
    if (sql.startsWith('UPDATE api_key SET ciphertext')) {
      // Bez `WHERE kind` ide o panic wipe cez všetky druhy.
      if (!sql.includes('WHERE kind')) return { affectedRows: rows.size };
      return { affectedRows: rows.has(values[0] as ApiKeyKind) ? 1 : 0 };
    }
    if (sql.startsWith('DELETE')) {
      if (!sql.includes('WHERE kind')) {
        const affectedRows = rows.size;
        rows.clear();
        return { affectedRows };
      }
      const kind = values[0] as ApiKeyKind;
      const affectedRows = rows.delete(kind) ? 1 : 0;
      return { affectedRows };
    }
    if (sql.startsWith('INSERT')) {
      rows.set(values[0] as ApiKeyKind, {
        ciphertext: values[1] as Buffer,
        iv: values[2] as Buffer,
        auth_tag: values[3] as Buffer,
        key_version: values[4] as number,
        last4: values[5] as string,
        created_at: values[6] as Date,
        expires_at: values[7] as Date,
        verify_status: values[8] as string,
        verified_at: null,
        last_used_at: null,
      });
      return { affectedRows: 1 };
    }
    if (sql.includes('verify_status = ?')) {
      const row = rows.get(values[2] as ApiKeyKind);
      if (!row) return { affectedRows: 0 };
      row.verify_status = values[0] as string;
      return { affectedRows: 1 };
    }
    if (sql.includes('last_used_at = ?')) {
      const row = rows.get(values[1] as ApiKeyKind);
      if (!row) return { affectedRows: 0 };
      row.last_used_at = values[0] as Date;
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  };

  return {
    conn: { query } as unknown as Queryable,
    rows,
    audits,
    sqls,
    values: allValues,
    audit: {
      appendAudit: async (input: AuditInput) => {
        audits.push(input);
      },
    },
  };
}

function repoOver(db: FakeDb, kind: ApiKeyKind) {
  return createApiKeyRepo({ kind, audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });
}

/* ═════════════════════════ 1. výber podľa `kind` ═══════════════════════════ */

describe('api_key: výber podľa druhu kľúča (P5)', () => {
  it('singletony sú previazané na svoj druh a mapovanie je jednoznačné', () => {
    expect(apiKeyRepo.kind).toBe('shop_write');
    expect(ordersKeyRepo.kind).toBe('orders_read');
    expect(apiKeyRepoForKind('shop_write')).toBe(apiKeyRepo);
    expect(apiKeyRepoForKind('orders_read')).toBe(ordersKeyRepo);
  });

  it('každý repozitár vidí VÝHRADNE svoj kľúč, aj keď sú v tabuľke oba', async () => {
    const future = new Date(Date.now() + 3_600_000);
    const db = createFakeDb({
      shop_write: rowFor(SHOP_KEY_PLAINTEXT, future),
      orders_read: rowFor(ORDERS_KEY_PLAINTEXT, future),
    });

    const shop = repoOver(db, 'shop_write');
    const orders = repoOver(db, 'orders_read');

    expect((await shop.getMeta()).last4).toBe(SHOP_KEY_PLAINTEXT.slice(-4));
    expect((await orders.getMeta()).last4).toBe(ORDERS_KEY_PLAINTEXT.slice(-4));

    // SELECT ide vždy s filtrom na `kind`, nikdy na `id`.
    const selects = db.sqls.filter((sql) => sql.startsWith('SELECT ciphertext'));
    expect(selects.length).toBeGreaterThan(0);
    for (const sql of selects) {
      expect(sql).toContain('WHERE kind = ?');
      expect(sql).not.toContain('id = ?');
    }

    // A plaintext, ktorý dostane zápisová cesta, je naozaj zápisový kľúč.
    const ref = await shop.loadForUse();
    const handle = await ref!();
    expect(handle.value.toString('utf8')).toBe(SHOP_KEY_PLAINTEXT);
    handle.release();
  });

  it('objednávkový kľúč nie je dosažiteľný cez zápisový repozitár', async () => {
    const db = createFakeDb({
      orders_read: rowFor(ORDERS_KEY_PLAINTEXT, new Date(Date.now() + 3_600_000)),
    });
    const shop = repoOver(db, 'shop_write');

    // Zápisová cesta (executor) berie kľúč VÝHRADNE cez `loadForUse()`. Keď je
    // v tabuľke len objednávkový kľúč, dostane `null` → read-only režim (D10),
    // nikdy nie objednávkový kľúč (I8' bod 4).
    expect(await shop.loadForUse()).toBeNull();
    expect((await shop.getMeta()).present).toBe(false);
    expect(db.rows.has('orders_read')).toBe(true);
  });

  it('uloženie zapíše druh do riadku a nezhodí druhý kľúč', async () => {
    const db = createFakeDb({
      shop_write: rowFor(SHOP_KEY_PLAINTEXT, new Date(Date.now() + 3_600_000)),
    });
    const orders = repoOver(db, 'orders_read');

    await orders.store(Buffer.from(ORDERS_KEY_PLAINTEXT, 'utf8'), '2222', 720);

    const insert = db.sqls.findIndex((sql) => sql.startsWith('INSERT'));
    expect(insert).toBeGreaterThanOrEqual(0);
    expect(db.values[insert]?.[0]).toBe('orders_read');
    expect(db.rows.has('shop_write')).toBe(true);
    expect(db.rows.get('orders_read')?.last4).toBe('2222');

    // Rotácia objednávkového kľúča nesmie wipnúť zápisový.
    const wipes = db.sqls.filter((sql) => sql.startsWith('DELETE'));
    for (const sql of wipes) expect(sql).toContain('WHERE kind = ?');
  });
});

/* ═══════════════════════════ 2. dve rôzne TTL ══════════════════════════════ */

describe('TTL podľa druhu kľúča (R2 vs P2)', () => {
  it('stropy sú rôzne: 48 h pre zápis, 90 dní pre objednávky', () => {
    expect(maxTtlHoursForKind('shop_write')).toBe(48);
    expect(maxTtlHoursForKind('shop_write')).toBe(API_KEY_MAX_TTL_HOURS);
    expect(maxTtlHoursForKind('orders_read')).toBe(ORDERS_KEY_MAX_TTL_HOURS);
    expect(ORDERS_KEY_MAX_TTL_HOURS).toBe(90 * 24);
  });

  it('route počíta TTL 48 h pre zápisový a 30 dní pre objednávkový kľúč', () => {
    expect(ttlHoursForKind('shop_write')).toBe(48);
    expect(ttlHoursForKind('orders_read')).toBe(30 * 24);
  });

  it('repozitár odmietne TTL nad strop SVOJHO druhu', async () => {
    const shopDb = createFakeDb();
    const ordersDb = createFakeDb();
    const shop = repoOver(shopDb, 'shop_write');
    const orders = repoOver(ordersDb, 'orders_read');

    // 720 h (30 dní) je pre zápisový kľúč neprípustné, pre objednávkový správne.
    await expect(
      shop.store(Buffer.from(SHOP_KEY_PLAINTEXT, 'utf8'), '1111', 720),
    ).rejects.toBeInstanceOf(ApiKeyError);
    expect(shopDb.rows.size).toBe(0);

    const stored = await orders.store(Buffer.from(ORDERS_KEY_PLAINTEXT, 'utf8'), '2222', 720);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3_600_000);

    // Ani objednávkový kľúč nie je bez stropu.
    await expect(
      orders.store(Buffer.from(ORDERS_KEY_PLAINTEXT, 'utf8'), '2222', ORDERS_KEY_MAX_TTL_HOURS + 1),
    ).rejects.toBeInstanceOf(ApiKeyError);
  });

  it('expirovaný objednávkový kľúč sa wipne a zápisový zostane', async () => {
    const db = createFakeDb({
      shop_write: rowFor(SHOP_KEY_PLAINTEXT, new Date(Date.now() + 3_600_000)),
      orders_read: rowFor(ORDERS_KEY_PLAINTEXT, new Date(Date.now() - 1000)),
    });
    const orders = repoOver(db, 'orders_read');

    expect((await orders.getMeta()).present).toBe(false);
    expect(db.rows.has('orders_read')).toBe(false);
    expect(db.rows.has('shop_write')).toBe(true);
    expect(db.audits.map((a) => a.eventType)).toEqual(['key_wiped']);
    expect(db.audits[0]?.message).toBe('ttl_expired');
  });
});

/* ══════════════════ 3. panic button maže OBA kľúče (D67) ═══════════════════ */

const GOOD_PASSWORD = 'Spravne-Heslo-123';
const APP_ORIGIN = 'https://zlavy.local';
const APP_HOST = 'zlavy.local';
const NOW = TEST_NOW;

function claims(sudoMinutes: number | null) {
  return {
    sub: 7,
    username: 'admin',
    absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    sudoUntil: sudoMinutes === null ? null : new Date(NOW.getTime() + sudoMinutes * 60_000),
  };
}

function routeDeps(sessionClaims: ReturnType<typeof claims> | null): RouteDeps {
  return {
    now: () => NOW,
    verifySession: async (token) => {
      if (!token || !sessionClaims) {
        const error = new Error('Session chýba alebo je neplatná.');
        error.name = 'SessionError';
        (error as Error & { code: string }).code = 'missing';
        throw error;
      }
      return {
        claims: sessionClaims,
        refreshed: {
          token: 'refreshed',
          claims: sessionClaims,
          cookie: {
            name: 'ovl_zliav_session' as const,
            value: 'refreshed',
            options: {
              httpOnly: true as const,
              secure: true as const,
              sameSite: 'strict' as const,
              path: '/',
              maxAge: 1800,
            },
          },
        },
      };
    },
  };
}

function makeRequest(
  options: { method?: string; body?: unknown; query?: string } = {},
): Request {
  const method = options.method ?? 'GET';
  const headers = new Headers({ host: APP_HOST, 'x-forwarded-for': '127.0.0.1' });
  headers.set('origin', APP_ORIGIN);
  headers.set('cookie', 'ovl_zliav_session=token');
  const init: RequestInit = { method, headers };
  if (options.body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(options.body);
    headers.set('content-type', 'application/json');
  }
  return new Request(`${APP_ORIGIN}/api/key${options.query ?? ''}`, init);
}

interface Body {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}
const readBody = async (r: Response): Promise<Body> => (await r.json()) as Body;

function baseDeps(db: FakeDb, overrides: Partial<KeyRouteDeps> = {}): KeyRouteDeps {
  return {
    apiKey: repoOver(db, 'shop_write'),
    ordersKey: repoOver(db, 'orders_read'),
    campaigns: {
      async findNeedsKey() {
        return [];
      },
      async list() {
        return { data: [], page: 1, perPage: 0, total: 0 };
      },
      async setStatus() {},
    },
    users: { getById: async () => ({ passwordHash: 'argon2-fake-hash' }) },
    verify: async (_hash, password) => password === GOOD_PASSWORD,
    audit: async () => {},
    probeKey: async () => 'valid' as KeyProbeResult,
    now: () => NOW,
    timeZone: 'Europe/Bratislava',
    routeDeps: routeDeps(claims(10)),
    ...overrides,
  };
}

beforeEach(() => {
  resetRateLimiter();
  resetOrdersKeyProbe();
});

afterEach(() => {
  resetOrdersKeyProbe();
});

describe('panic button (DELETE /api/key) — akceptačné kritérium 3', () => {
  it('wipne OBA kľúče jedným volaním a zapíše audit za každý z nich', async () => {
    const future = new Date(Date.now() + 3_600_000);
    const db = createFakeDb({
      shop_write: rowFor(SHOP_KEY_PLAINTEXT, future),
      orders_read: rowFor(ORDERS_KEY_PLAINTEXT, future),
    });
    const route = createKeyDeleteRoute(baseDeps(db));

    const response = await route(
      makeRequest({
        method: 'DELETE',
        body: { password: GOOD_PASSWORD, confirm: PANIC_CONFIRM_LITERAL },
      }),
    );

    expect(response.status).toBe(200);
    expect((await readBody(response)).data?.wiped).toBe(true);

    // V tabuľke nezostal ANI JEDEN kľúč.
    expect(db.rows.size).toBe(0);

    // Audit za oba druhy (I4) — a nikde v ňom nie je kľúč (I1).
    const panics = db.audits.filter((a) => a.eventType === 'key_panic_wipe');
    expect(panics).toHaveLength(2);
    expect(panics.map((a) => a.message).join('|')).toContain('kind=shop_write');
    expect(panics.map((a) => a.message).join('|')).toContain('kind=orders_read');
    const serialized = JSON.stringify(db.audits);
    expect(serialized).not.toContain(SHOP_KEY_PLAINTEXT);
    expect(serialized).not.toContain(ORDERS_KEY_PLAINTEXT);
    expect(serialized).not.toContain(ORDERS_KEY_PLAINTEXT.slice(-8));
  });

  it('panic wipe prepíše ciphertext PRED zmazaním aj pri viacerých druhoch (D63)', async () => {
    const future = new Date(Date.now() + 3_600_000);
    const db = createFakeDb({
      shop_write: rowFor(SHOP_KEY_PLAINTEXT, future),
      orders_read: rowFor(ORDERS_KEY_PLAINTEXT, future),
    });

    await repoOver(db, 'shop_write').wipe('panic_button');

    const overwrite = db.sqls.findIndex((sql) => sql.includes('RANDOM_BYTES'));
    const del = db.sqls.findIndex((sql) => sql.startsWith('DELETE'));
    expect(overwrite).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThan(overwrite);
    // Cez všetky druhy: ani prepis, ani DELETE nesmú filtrovať na `kind`.
    expect(db.sqls[overwrite]).not.toContain('WHERE kind');
    expect(db.sqls[del]).not.toContain('WHERE kind');
    expect(db.rows.size).toBe(0);
  });

  it('panic wipe volaný z objednávkového repozitára zmaže rovnako oba', async () => {
    const future = new Date(Date.now() + 3_600_000);
    const db = createFakeDb({
      shop_write: rowFor(SHOP_KEY_PLAINTEXT, future),
      orders_read: rowFor(ORDERS_KEY_PLAINTEXT, future),
    });

    expect(await repoOver(db, 'orders_read').wipe('panic_button')).toBe(true);
    expect(db.rows.size).toBe(0);
    expect(db.audits.filter((a) => a.eventType === 'key_panic_wipe')).toHaveLength(2);
  });

  it('wipe z iného dôvodu sa drží svojho druhu (TTL zápisového nezhodí objednávkový)', async () => {
    const future = new Date(Date.now() + 3_600_000);
    const db = createFakeDb({
      shop_write: rowFor(SHOP_KEY_PLAINTEXT, future),
      orders_read: rowFor(ORDERS_KEY_PLAINTEXT, future),
    });

    await repoOver(db, 'shop_write').wipe('ttl_expired');

    expect(db.rows.has('shop_write')).toBe(false);
    expect(db.rows.has('orders_read')).toBe(true);
    expect(db.audits.map((a) => a.eventType)).toEqual(['key_wiped']);
  });
});

/* ═══════════════ 4. `/api/key` pre objednávkový kľúč (P2, I8') ═════════════ */

describe('GET /api/key?kind=orders_read', () => {
  it('vracia metadáta objednávkového kľúča a NIKDY nič naviac (D65, I1)', async () => {
    const db = createFakeDb({
      shop_write: rowFor(SHOP_KEY_PLAINTEXT, new Date(Date.now() + 3_600_000)),
      orders_read: rowFor(ORDERS_KEY_PLAINTEXT, new Date(Date.now() + 30 * 24 * 3_600_000)),
    });
    const route = createKeyGetRoute(baseDeps(db));

    const body = await readBody(await route(makeRequest({ query: '?kind=orders_read' })));

    expect(body.data).toMatchObject({ present: true, last4: ORDERS_KEY_PLAINTEXT.slice(-4) });
    expect(Object.keys(body.data ?? {}).sort()).toEqual(
      ['expiresAt', 'last4', 'present', 'savedAt', 'secondsLeft', 'verifyStatus'].sort(),
    );
    // Presne to zlyhalo v minulosti: redaktor zamaskoval celý stav kľúča a UI
    // tvrdilo, že kľúč chýba. Odpoveď je preto plochá a `present` je pravdivé.
    expect(body.data?.present).toBe(true);
    expect(JSON.stringify(body)).not.toContain(ORDERS_KEY_PLAINTEXT);
  });

  it('bez parametra hovorí o zápisovom kľúči (spätná kompatibilita)', async () => {
    const db = createFakeDb({
      orders_read: rowFor(ORDERS_KEY_PLAINTEXT, new Date(Date.now() + 3_600_000)),
    });
    const route = createKeyGetRoute(baseDeps(db));

    const body = await readBody(await route(makeRequest()));
    expect(body.data?.present).toBe(false);
  });

  it('neznámy druh odmietne zod 400', async () => {
    const db = createFakeDb();
    const route = createKeyGetRoute(baseDeps(db));
    const response = await route(makeRequest({ query: '?kind=customers_read' }));
    expect(response.status).toBe(400);
  });
});

describe('PUT /api/key s kind=orders_read', () => {
  it('uloží kľúč s TTL 30 dní, keď sonda čítania objednávok prejde (P2)', async () => {
    const db = createFakeDb();
    const probed: string[] = [];
    const route = createKeyPutRoute(
      baseDeps(db, {
        probeOrdersKey: async (key) => {
          const handle = await key();
          probed.push(handle.value.toString('utf8'));
          handle.release();
          return 'valid';
        },
        probeKey: async () => {
          throw new Error('sonda zápisového kľúča sa pri objednávkovom kľúči nesmie volať');
        },
      }),
    );

    const response = await route(
      makeRequest({
        method: 'PUT',
        body: { apiKey: ORDERS_KEY_PLAINTEXT, kind: 'orders_read' },
      }),
    );

    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data?.kind).toBe('orders_read');
    expect(body.data?.last4).toBe(ORDERS_KEY_PLAINTEXT.slice(-4));
    expect(body.data?.verifyStatus).toBe('valid');
    expect(JSON.stringify(body)).not.toContain(ORDERS_KEY_PLAINTEXT);

    // Uložilo sa pod správnym druhom a s TTL 30 dní (P2), nie 48 h.
    const row = db.rows.get('orders_read');
    expect(row).toBeDefined();
    expect(db.rows.has('shop_write')).toBe(false);
    const ttlMs = row!.expires_at.getTime() - row!.created_at.getTime();
    expect(ttlMs).toBe(30 * 24 * 3_600_000);
    expect(probed).toEqual([ORDERS_KEY_PLAINTEXT]);
  });

  it('kľúč bez povolenia na čítanie objednávok sa NEULOŽÍ (409 key_invalid)', async () => {
    const db = createFakeDb();
    const route = createKeyPutRoute(baseDeps(db, { probeOrdersKey: async () => 'forbidden' }));

    const response = await route(
      makeRequest({ method: 'PUT', body: { apiKey: ORDERS_KEY_PLAINTEXT, kind: 'orders_read' } }),
    );

    expect(response.status).toBe(409);
    const body = await readBody(response);
    expect(body.error?.code).toBe('key_invalid');
    expect(body.error?.message).toContain('NEULOŽIL');
    expect(db.rows.size).toBe(0);
  });

  it('odmietnutý kľúč (401) sa NEULOŽÍ', async () => {
    const db = createFakeDb();
    const route = createKeyPutRoute(baseDeps(db, { probeOrdersKey: async () => 'invalid' }));
    const response = await route(
      makeRequest({ method: 'PUT', body: { apiKey: ORDERS_KEY_PLAINTEXT, kind: 'orders_read' } }),
    );
    expect(response.status).toBe(409);
    expect(db.rows.size).toBe(0);
  });

  it('bez zapojenej sondy sa kľúč NEULOŽÍ a hláška to pravdivo priznáva', async () => {
    const db = createFakeDb();
    // `probeOrdersKey` nie je v deps a nikto sondu nezaregistroval.
    const route = createKeyPutRoute(baseDeps(db));
    const response = await route(
      makeRequest({ method: 'PUT', body: { apiKey: ORDERS_KEY_PLAINTEXT, kind: 'orders_read' } }),
    );

    expect(response.status).toBe(409);
    const body = await readBody(response);
    expect(body.error?.code).toBe(ORDERS_PROBE_MISSING_CODE);
    expect(body.error?.message).toContain('NEULOŽIL');
    expect(db.rows.size).toBe(0);
  });

  it('sonda zaregistrovaná objednávkovým klientom sa použije (dohodnuté rozhranie)', async () => {
    const db = createFakeDb();
    let calls = 0;
    registerOrdersKeyProbe(async () => {
      calls += 1;
      return 'valid';
    });
    expect(getOrdersKeyProbe()).not.toBeNull();

    const route = createKeyPutRoute(baseDeps(db));
    const response = await route(
      makeRequest({ method: 'PUT', body: { apiKey: ORDERS_KEY_PLAINTEXT, kind: 'orders_read' } }),
    );

    expect(response.status).toBe(200);
    expect(calls).toBe(1);
    expect(db.rows.has('orders_read')).toBe(true);
  });

  it('bez sudo okna sa objednávková sonda ani nespustí (I3)', async () => {
    const db = createFakeDb();
    let probed = false;
    const route = createKeyPutRoute(
      baseDeps(db, {
        routeDeps: routeDeps(claims(null)),
        probeOrdersKey: async () => {
          probed = true;
          return 'valid';
        },
      }),
    );
    const response = await route(
      makeRequest({ method: 'PUT', body: { apiKey: ORDERS_KEY_PLAINTEXT, kind: 'orders_read' } }),
    );
    expect(response.status).toBe(401);
    expect((await readBody(response)).error?.code).toBe('sudo_required');
    expect(probed).toBe(false);
    expect(db.rows.size).toBe(0);
  });

  it('zápisový kľúč sa ďalej overuje sondou reduction=0 a objednávkovou NIE', async () => {
    const db = createFakeDb();
    let ordersProbed = false;
    const route = createKeyPutRoute(
      baseDeps(db, {
        probeKey: async () => 'valid',
        probeOrdersKey: async () => {
          ordersProbed = true;
          return 'valid';
        },
      }),
    );

    const response = await route(
      makeRequest({ method: 'PUT', body: { apiKey: SHOP_KEY_PLAINTEXT } }),
    );

    expect(response.status).toBe(200);
    expect(ordersProbed).toBe(false);
    const row = db.rows.get('shop_write');
    expect(row).toBeDefined();
    expect(row!.expires_at.getTime() - row!.created_at.getTime()).toBe(48 * 3_600_000);
  });
});

/* ═════ 5. objednávkový kľúč nie je dosažiteľný zo zápisovej cesty (I8' 4) ══ */

interface SourceFile {
  path: string;
  code: string;
}

function listFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, pattern));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function loadSources(): SourceFile[] {
  return listFiles(resolve(process.cwd(), 'src'), /\.(ts|tsx)$/).map((path) => ({
    // Na Windows vracia `relative()` obrátené lomky — normalizujeme.
    path: relative(process.cwd(), path).split('\\').join('/'),
    code: readFileSync(path, 'utf8'),
  }));
}

/**
 * Moduly, ktoré smú vôbec vysloviť objednávkový repozitár. Zoznam je zámerne
 * krátky: každý ďalší je rozhodnutie do kontraktu, nie do kódu.
 */
const ORDERS_REPO_ALLOWLIST: readonly string[] = [
  'src/lib/repo/api-key.repo.ts',
  'src/app/api/key/route.ts',
  // Spúšťač synchronizácie predajov. Existuje PRÁVE PRETO, aby objednávkový
  // kľúč nemusel byť v `scheduler/boot.ts`: scheduler vidí len nepriehľadné
  // `runSalesSyncIfDue()`, takže zápisová cesta o kľúči ďalej nevie vôbec
  // (I8' bod 4). Pridané pri integrácii šprintu predajnosti.
  'src/lib/sales/sync-runner.ts',
];

describe("I8' bod 4 — objednávkový kľúč sa nikdy nedostane k zápisu zliav", () => {
  const sources = loadSources();

  it('sanity — skenujú sa skutočné zdroje', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((f) => f.path === 'src/lib/engine/executor.ts')).toBe(true);
  });

  it('`ordersKeyRepo` sa spomína len v repozitári a v `/api/key`', () => {
    const hits = sources
      .filter((f) => /\bordersKeyRepo\b/.test(f.code))
      .map((f) => f.path)
      .filter((path) => !ORDERS_REPO_ALLOWLIST.includes(path));
    expect(hits.join('\n')).toBe('');
  });

  it('zápisová cesta (engine, scheduler) o objednávkovom kľúči nevie vôbec', () => {
    const writePath = sources.filter(
      (f) => f.path.startsWith('src/lib/engine/') || f.path.startsWith('src/lib/scheduler/'),
    );
    expect(writePath.length).toBeGreaterThan(5);
    const hits = writePath
      .filter((f) => /ordersKeyRepo|orders_read|apiKeyRepoForKind/.test(f.code))
      .map((f) => f.path);
    expect(hits.join('\n')).toBe('');
  });

  it('záloha nevynáša ANI JEDEN kľúč — vylúčenie je na úrovni tabuľky (D76, I1)', () => {
    const backup = readFileSync(resolve(process.cwd(), 'scripts/backup.sh'), 'utf8');
    // Vylúčená je celá tabuľka `api_key`, nie konkrétny riadok — druhý kľúč
    // (`kind='orders_read'`) je preto chránený bez ďalšej zmeny skriptu (P5).
    expect(backup).toContain('--ignore-table=');
    expect(backup).toContain('.api_key');
    // Žiadny `--where`, ktorý by vylúčil len jeden riadok/druh.
    expect(backup).not.toContain('--where');
  });

  it('`setReduction` volá jediný modul a ten berie kľúč z `apiKeyRepo`', () => {
    const callers = sources
      .filter((f) => /\.setReduction\s*\(/.test(f.code))
      .map((f) => f.path);
    expect(callers).toEqual(['src/lib/engine/executor.ts']);

    const executor = sources.find((f) => f.path === 'src/lib/engine/executor.ts');
    expect(executor).toBeDefined();
    expect(executor!.code).toContain('apiKeyRepo as defaultApiKeyRepo');
    expect(/\bordersKeyRepo\b/.test(executor!.code)).toBe(false);
  });
});
