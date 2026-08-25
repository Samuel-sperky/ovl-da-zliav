/**
 * Aura Zľavy — oprávnenia kľúča a živý rozpočet v `/api/key` (API v5, bod D).
 *
 * Čo tieto testy strážia:
 *
 *  1. **Dieru, ktorú otvorilo `whoami`.** Do v4 overovala zápisový kľúč sonda
 *     na `setReduction` a tá mimochodom overila aj scope — kľúč bez
 *     `product:edit` dostal 403 a neuložil sa. `whoami` nevyžaduje žiadny
 *     scope, takže ním prejde aj objednávkový kľúč. Kontrola musí byť výslovná,
 *     inak sa objednávkový kľúč uloží ako zápisový a zlyhá to až pri prvom
 *     skutočnom zápise zľavy, uprostred kampane.
 *  2. **„Nevieme" sa nesmie zmeniť na „nemá".** Kľúč so `product:read` zatiaľ
 *     nemáme; appka musí vedieť povedať všetky tri stavy.
 *  3. **I1.** Do odpovede route nesmie ísť nič z `whoami` okrem scopes
 *     a dvoch čísel rozpočtu — nikdy meno kľúča ani jeho vlastník.
 *  4. **Scopes zmiznú s kľúčom.** Po wipe si appka nesmie pamätať, že „kľúč má
 *     product:read", keď už žiadny kľúč nemá.
 *
 * Bez DB a bez `fetch` (I6): repozitár beží nad in-memory `Queryable`,
 * overenie kľúča je injektované cez `inspectKey`.
 *
 * Vlastník: A11.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { Queryable, SessionClaims } from '@/contracts';

import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import {
  createApiKeyRepo,
  resetKeyScopeMemory,
  type ApiKeyKind,
  type ApiKeyRepository,
} from '@/lib/repo/api-key.repo';
import type { ShopScope, WhoamiOutcome } from '@/lib/shop/client';
import {
  createKeyGetRoute,
  createKeyPutRoute,
  dualSlotReport,
  requiredScopeForKind,
  scopeReport,
  verifyNoteForStatus,
  whoamiToProbeResult,
  type KeyRouteDeps,
} from '@/app/api/key/route';

/* ═══════════════════════════ pomôcky a fixtures ═══════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const APP_HOST = 'zlavy.local';
const NOW = new Date('2026-08-14T08:00:00.000Z');
const MASTER_KEY = Buffer.alloc(32, 0x5a);

/** Nikdy nie tvar reálneho kľúča poskytovateľa (I1, GitHub push protection). */
const FAKE_KEY = 'fake-shop-key-ABCD1234EFGH';

/** Mená, ktoré `whoami` vracia a ktoré sa NIKDY nesmú objaviť v odpovedi (I1). */
const KEY_NAME = 'aura-zlavy-integracia';
const KEY_OWNER = 'Jana Testovacia';

function claims(): SessionClaims {
  return {
    sub: 7,
    username: 'admin',
    absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    sudoUntil: new Date(NOW.getTime() + 10 * 60_000),
  };
}

function routeDeps(): RouteDeps {
  const sessionClaims = claims();
  return {
    now: () => NOW,
    verifySession: async (token) => {
      if (!token) {
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

function makeRequest(options: { method?: string; body?: unknown } = {}): Request {
  const method = options.method ?? 'GET';
  const headers = new Headers({
    host: APP_HOST,
    origin: APP_ORIGIN,
    'x-forwarded-for': '127.0.0.1',
    cookie: 'ovl_zliav_session=token',
  });
  const init: RequestInit = { method, headers };
  if (options.body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(options.body);
    headers.set('content-type', 'application/json');
  }
  return new Request(`${APP_ORIGIN}/api/key`, init);
}

interface Body {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

const readBody = async (r: Response): Promise<Body> => (await r.json()) as Body;

/* ══════════════════ in-memory `api_key` (jeden riadok na druh) ════════════ */

interface FakeRow {
  kind: ApiKeyKind;
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

/**
 * Najmenšia možná náhrada tabuľky `api_key`. Nie je to SQL engine — dispatch
 * ide podľa začiatku príkazu, presne v poradí, v akom ich repozitár posiela.
 */
function makeDb(): { conn: Queryable; rows: Map<ApiKeyKind, FakeRow> } {
  const rows = new Map<ApiKeyKind, FakeRow>();

  const conn: Queryable = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string, values?: unknown): Promise<any> {
      const args = (Array.isArray(values) ? values : []) as unknown[];

      if (sql.startsWith('SELECT kind FROM api_key')) {
        return [...rows.keys()].map((kind) => ({ kind }));
      }
      if (sql.startsWith('SELECT ciphertext')) {
        const row = rows.get(args[0] as ApiKeyKind);
        return row ? [row] : [];
      }
      if (sql.startsWith('UPDATE api_key SET ciphertext')) {
        // Prepis náhodnými bajtmi (D63) — počet dotknutých riadkov stačí.
        const affected = sql.includes('WHERE kind = ?')
          ? (rows.has(args[0] as ApiKeyKind) ? 1 : 0)
          : rows.size;
        return { affectedRows: affected };
      }
      if (sql.startsWith('DELETE FROM api_key')) {
        if (sql.includes('WHERE kind = ?')) rows.delete(args[0] as ApiKeyKind);
        else rows.clear();
        return { affectedRows: 1 };
      }
      if (sql.startsWith('INSERT INTO api_key')) {
        rows.set(args[0] as ApiKeyKind, {
          kind: args[0] as ApiKeyKind,
          ciphertext: args[1] as Buffer,
          iv: args[2] as Buffer,
          auth_tag: args[3] as Buffer,
          key_version: args[4] as number,
          last4: args[5] as string,
          created_at: args[6] as Date,
          expires_at: args[7] as Date,
          verify_status: args[8] as string,
          verified_at: null,
          last_used_at: null,
        });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE api_key SET verify_status')) {
        const row = rows.get(args[2] as ApiKeyKind);
        if (!row) return { affectedRows: 0 };
        row.verify_status = args[0] as string;
        row.verified_at = args[1] as Date;
        return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE api_key SET last_used_at')) {
        return { affectedRows: rows.has(args[1] as ApiKeyKind) ? 1 : 0 };
      }
      throw new Error(`neočakávaný SQL v teste: ${sql}`);
    },
  };

  return { conn, rows };
}

function makeRepos(conn: Queryable): { write: ApiKeyRepository; orders: ApiKeyRepository } {
  const common = { audit: null, logger: null, masterKey: MASTER_KEY, defaultConn: conn, now: () => NOW };
  return {
    write: createApiKeyRepo({ ...common, kind: 'shop_write' }),
    orders: createApiKeyRepo({ ...common, kind: 'orders_read' }),
  };
}

/** `whoami`, ktoré odpovie presne tým, čo test potrebuje. */
function inspecting(outcome: WhoamiOutcome): NonNullable<KeyRouteDeps['inspectKey']> {
  return async () => outcome;
}

function whoamiOk(
  scopes: readonly ShopScope[],
  remaining: { perMinute: number | null; perUtcDay: number | null } = {
    perMinute: 59,
    perUtcDay: 9_987,
  },
): WhoamiOutcome {
  return { status: 'ok', info: { scopes, otherScopeCount: 0, remaining } };
}

function baseDeps(overrides: Partial<KeyRouteDeps> = {}): KeyRouteDeps {
  return {
    campaigns: {
      findNeedsKey: async () => [],
      list: async () => ({ data: [], page: 1, perPage: 0, total: 0 }),
      setStatus: async () => {},
    },
    users: { getById: async () => ({ passwordHash: 'argon2-fake-hash' }) },
    verify: async () => true,
    audit: async () => {},
    execute: async (campaignId) => ({
      campaignId,
      status: 'done' as const,
      itemsTotal: 0,
      itemsOk: 0,
      itemsFailed: 0,
      itemsUncertain: 0,
      items: [],
    }),
    now: () => NOW,
    timeZone: 'Europe/Bratislava',
    routeDeps: routeDeps(),
    ...overrides,
  };
}

beforeEach(() => {
  resetRateLimiter();
  resetKeyScopeMemory();
});

/* ══════════════════════ 1. Čisté pomôcky route ════════════════════════════ */

describe('pomôcky pre oprávnenia kľúča', () => {
  it('zápisový kľúč bez `product:edit` nemá zmysel ukladať', () => {
    expect(requiredScopeForKind('shop_write')).toBe('product:edit');
    // Objednávkový kľúč sa overuje čítaním objednávok (I8'), nie cez `whoami`.
    expect(requiredScopeForKind('orders_read')).toBeNull();
  });

  it('`whoami` sa prekladá na „platí / neplatí" fail-closed', () => {
    expect(whoamiToProbeResult(whoamiOk(['product:edit']))).toBe('valid');
    expect(
      whoamiToProbeResult({
        status: 'invalid',
        error: { kind: 'unauthorized', code: null, message: '', httpStatus: 401, retryable: false },
      }),
    ).toBe('invalid');
    expect(
      whoamiToProbeResult({
        status: 'forbidden',
        error: { kind: 'forbidden', code: null, message: '', httpStatus: 403, retryable: false },
      }),
    ).toBe('forbidden');
    expect(
      whoamiToProbeResult({
        status: 'unknown',
        error: { kind: 'server_error', code: null, message: '', httpStatus: 500, retryable: true },
      }),
    ).toBe('unknown');
  });

  /* ── Jeden kľúč v oboch slotoch (bod B, 24. 8. 2026) ──────────────────────
   *
   * Zisťuje sa z `last4`, nie zo scopes: I8' zakazuje, aby `shop/client.ts`
   * o objednávkovom oprávnení vedel čokoľvek, takže `whoami` ho nepovie a
   * povedať nesmie. Štyri znaky ale nie sú odtlačok, a práve to sem patrí
   * napísať ako test — nie ako želanie. */
  it('rovnaké `last4` v oboch slotoch sa prizná ako domnienka, nie ako fakt', () => {
    const withLast4 = (last4: string | null, present = true) => ({ present, last4 });

    const same = dualSlotReport(withLast4('9x2Q'), withLast4('9x2Q'));
    expect(same.looksLikeSameKey).toBe(true);
    // Veta smie hovoriť „vyzerá to", nikdy „je to".
    expect(String(same.note)).toContain('vyzerá');
    // A musí povedať dôsledok: TTL sa líšia, takže vkladať treba dvakrát.
    expect(String(same.note)).toContain('48 hodín');
    expect(String(same.note)).toContain('30 dní');

    const different = dualSlotReport(withLast4('9x2Q'), withLast4('7bC1'));
    expect(different.looksLikeSameKey).toBe(false);
    expect(different.note).toBeNull();
  });

  it('prázdny slot nie je „iný kľúč" — je to „niet čo porovnávať"', () => {
    const present = { present: true, last4: '9x2Q' };
    const missing = { present: false, last4: null };

    // Toto je jadro: `false` by znamenalo „sú to dva rôzne kľúče", čo je pri
    // prázdnom slote nepravda. Musí to byť `null`.
    expect(dualSlotReport(present, missing).looksLikeSameKey).toBeNull();
    expect(dualSlotReport(missing, present).looksLikeSameKey).toBeNull();
    expect(dualSlotReport(missing, missing).looksLikeSameKey).toBeNull();
    // Riadok s kľúčom a `last4 === null` je stav, ktorý appka nevie posúdiť.
    expect(dualSlotReport(present, { present: true, last4: null }).looksLikeSameKey).toBeNull();
  });

  it('veta o neovereniu z GET netvrdí príčinu, ktorú appka nepamätá', () => {
    // GET pozná len stav — dôvod (`ip_banned` vs. „shop neodpovedal") sa nikam
    // neukladá, takže veta ho nesmie hádať.
    const note = String(verifyNoteForStatus('unverified'));
    expect(note).toContain('nepamätá');
    expect(note.toLowerCase()).not.toContain('adres');
    expect(verifyNoteForStatus('valid')).toBeNull();
    expect(verifyNoteForStatus(null)).toBeNull();
  });

  it('`scopeReport` rozlišuje má / nemá / nevieme', () => {
    const ma = scopeReport(['product:read', 'product:edit']);
    expect(ma.productRead).toBe(true);
    expect(ma.productReadNote).toBeNull();

    const nema = scopeReport(['product:edit']);
    expect(nema.productRead).toBe(false);
    expect(nema.productReadNote).toContain('product:read');

    const nevieme = scopeReport(null);
    expect(nevieme.productRead).toBeNull();
    expect(nevieme.scopes).toBeNull();
    expect(nevieme.productReadNote).toContain('Nevieme');
    // „Nevieme" a „nemá" NIE SÚ tá istá veta — inak by používateľ po reštarte
    // appky chodil pýtať oprávnenie, ktoré kľúč už dávno má.
    expect(nevieme.productReadNote).not.toBe(nema.productReadNote);
  });
});

/* ═══════════════ 2. Pamäť oprávnení v repozitári kľúča ════════════════════ */

describe('repozitár si pamätá posledné známe oprávnenia kľúča', () => {
  it('bez overenia je to „nevieme", nie prázdny zoznam', () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    expect(write.recallScopes?.()).toEqual({ scopes: null, checkedAt: null });
  });

  it('zapamätá si scopes aj čas, kedy sa to zistilo', () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    write.rememberScopes?.(['product:read', 'product:edit']);
    expect(write.recallScopes?.()).toEqual({
      scopes: ['product:read', 'product:edit'],
      checkedAt: NOW,
    });
  });

  it('druhy kľúčov sa nemiešajú', () => {
    const { conn } = makeDb();
    const { write, orders } = makeRepos(conn);
    write.rememberScopes?.(['product:edit']);
    expect(orders.recallScopes?.().scopes).toBeNull();
  });

  it('wipe kľúča zabudne aj jeho oprávnenia', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    await write.store(Buffer.from(FAKE_KEY, 'utf8'), FAKE_KEY.slice(-4), 24);
    write.rememberScopes?.(['product:edit']);

    await write.wipe('ttl_expired');
    // Keby scopes prežili wipe, appka by tvrdila, že kľúč niečo môže — hoci
    // žiadny kľúč nemá.
    expect(write.recallScopes?.().scopes).toBeNull();
  });

  it('panic button zabudne oprávnenia VŠETKÝCH druhov naraz (D67)', async () => {
    const { conn } = makeDb();
    const { write, orders } = makeRepos(conn);
    await write.store(Buffer.from(FAKE_KEY, 'utf8'), FAKE_KEY.slice(-4), 24);
    await orders.store(Buffer.from(`${FAKE_KEY}-2`, 'utf8'), '4', 24);
    // Aké scopes to sú, tu nehrá rolu — ide o to, že panic vyprázdni OBA sloty.
    write.rememberScopes?.(['product:edit']);
    orders.rememberScopes?.(['product:read']);

    await write.wipe('panic_button');

    expect(write.recallScopes?.().scopes).toBeNull();
    expect(orders.recallScopes?.().scopes).toBeNull();
  });

  it('nový kľúč začína bez oprávnení — staré sa naň neprenesú', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    await write.store(Buffer.from(FAKE_KEY, 'utf8'), FAKE_KEY.slice(-4), 24);
    write.rememberScopes?.(['product:read', 'product:edit']);

    // Výmena kľúča ide cez `replaced_by_new_key` wipe vnútri `store()`.
    await write.store(Buffer.from(`${FAKE_KEY}-novy`, 'utf8'), 'ovy', 24);
    expect(write.recallScopes?.().scopes).toBeNull();
  });
});

/* ═════════════════ 3. PUT — kľúč bez `product:edit` sa neuloží ════════════ */

describe('PUT /api/key — oprávnenia rozhodujú, či sa kľúč uloží', () => {
  it('kľúč s `product:edit` sa uloží a odpoveď povie, čo ešte má', async () => {
    const { conn, rows } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({ apiKey: write, inspectKey: inspecting(whoamiOk(['product:read', 'product:edit'])) }),
    );

    const response = await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } }));
    expect(response.status).toBe(200);

    const body = await readBody(response);
    expect(body.data).toMatchObject({
      verifyStatus: 'valid',
      kind: 'shop_write',
      productRead: true,
      productReadNote: null,
    });
    expect(body.data?.scopes).toEqual(['product:read', 'product:edit']);
    expect(rows.has('shop_write')).toBe(true);
    expect(write.recallScopes?.().scopes).toEqual(['product:read', 'product:edit']);
  });

  /**
   * Najdôležitejší test súboru. Sonda na `setReduction` toto overovala
   * mimochodom (403). `whoami` nevyžaduje žiadny scope, takže bez výslovnej
   * kontroly by sa objednávkový kľúč uložil ako zápisový.
   */
  it('kľúč BEZ `product:edit` sa NEULOŽÍ, aj keď `whoami` prejde', async () => {
    const { conn, rows } = makeDb();
    const { write } = makeRepos(conn);
    // Kľúč len na čítanie: `whoami` ho pustí (nevyžaduje žiadny scope), ale
    // zľavu ním zapísať nejde.
    const route = createKeyPutRoute(
      baseDeps({ apiKey: write, inspectKey: inspecting(whoamiOk(['product:read'])) }),
    );

    const response = await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } }));
    expect(response.status).toBe(409);

    const body = await readBody(response);
    expect(body.error?.code).toBe('key_invalid');
    expect(body.error?.message).toContain('product:edit');
    expect(body.error?.message).toContain('NEULOŽIL');
    // Nič sa neuložilo a nič sa nezapamätalo.
    expect(rows.has('shop_write')).toBe(false);
    expect(write.recallScopes?.().scopes).toBeNull();
  });

  it('kľúč bez `product:read` sa uloží, ale appka to povie vetou (bod D3)', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({ apiKey: write, inspectKey: inspecting(whoamiOk(['product:edit'])) }),
    );

    const body = await readBody(
      await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } })),
    );
    expect(body.data?.productRead).toBe(false);
    expect(String(body.data?.productReadNote)).toContain('product:read');
    expect(String(body.data?.productReadNote)).toContain('správcu shopu');
  });

  it('401 zo shopu kľúč neuloží', async () => {
    const { conn, rows } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({
        apiKey: write,
        inspectKey: inspecting({
          status: 'invalid',
          error: { kind: 'unauthorized', code: null, message: '', httpStatus: 401, retryable: false },
        }),
      }),
    );

    const response = await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } }));
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('key_invalid');
    expect(rows.has('shop_write')).toBe(false);
  });

  it('neisté overenie kľúč uloží ako neoverený a oprávnenia nechá na „nevieme"', async () => {
    const { conn, rows } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({
        apiKey: write,
        inspectKey: inspecting({
          status: 'unknown',
          error: { kind: 'server_error', code: null, message: '', httpStatus: 500, retryable: true },
        }),
      }),
    );

    const body = await readBody(
      await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } })),
    );
    expect(body.data?.verifyStatus).toBe('unverified');
    expect(body.data?.scopes).toBeNull();
    expect(body.data?.productRead).toBeNull();
    expect(String(body.data?.productReadNote)).toContain('Nevieme');
    expect(rows.has('shop_write')).toBe(true);
  });

  /* ── 403: dve rôzne odpovede v jednom stavovom kóde (bod A, 24. 8. 2026) ──
   *
   * Meria sa SPRÁVANIE route: uložil sa kľúč, alebo nie, aký je `verifyStatus`
   * a či veta hovorí o adrese, alebo o kľúči. Poučenie zo Sprintu 20 — test,
   * ktorý hľadá reťazec v zdrojovom kóde, nemeria nič. */
  function forbidden403(code: string | null): WhoamiOutcome {
    return {
      status: code === 'ip_banned' ? 'address_banned' : 'forbidden',
      error: { kind: 'forbidden', code, message: '', httpStatus: 403, retryable: false },
    };
  }

  it('403 o kľúči kľúč NEULOŽÍ a veta hovorí o kľúči', async () => {
    const { conn, rows } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({ apiKey: write, inspectKey: inspecting(forbidden403('forbidden')) }),
    );

    const response = await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } }));
    expect(response.status).toBe(409);
    const body = await readBody(response);
    expect(body.error?.code).toBe('key_invalid');
    expect(rows.has('shop_write')).toBe(false);
    // Tu je obviňovanie kľúča správne — shop hovoril o kľúči.
    expect(String(body.error?.message)).toContain('kľúč');
  });

  it('403 `ip_banned` kľúč ULOŽÍ ako neoverený a nikdy neobviní kľúč', async () => {
    const { conn, rows } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({ apiKey: write, inspectKey: inspecting(forbidden403('ip_banned')) }),
    );

    const response = await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } }));
    expect(response.status).toBe(200);
    const body = await readBody(response);

    // 1. Kľúč sa uložil — používateľ s novým kľúčom má kam ísť.
    expect(rows.has('shop_write')).toBe(true);
    // 2. Ale NIE ako platný. Na tom stojí bezpečnosť celej výnimky.
    expect(body.data?.verifyStatus).toBe('unverified');
    // 3. Veta hovorí o adrese, nie o kľúči.
    const note = String(body.data?.verifyNote);
    expect(note).toContain('adres');
    expect(note.toLowerCase()).not.toContain('neplatn');
    // 4. Scopes zostávajú „nevieme" — počas banu ich shop nepovedal.
    expect(body.data?.scopes).toBeNull();
  });

  it('uložený neoverený kľúč zápis NEODOMKNE (fail-closed)', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({ apiKey: write, inspectKey: inspecting(forbidden403('ip_banned')) }),
    );
    await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } }));

    /* Toto je tá vlastnosť, kvôli ktorej sa uloženie neovereného kľúča smie
     * vôbec pripustiť: rozvrh aj fronta žiadajú `verifyStatus === 'valid'`
     * (`scheduler/due.ts`, `scheduler/queue.ts`), takže uložený kľúč sám
     * nezapne nič. Keby sa tam podmienka zmenila na „kľúč je prítomný",
     * appka by po vložení kľúča začala zapisovať uprostred banu. */
    const meta = await write.getMeta();
    expect(meta.present).toBe(true);
    expect(meta.verifyStatus).toBe('unverified');
  });

  it('overený kľúč vetu o neoverení nemá', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({ apiKey: write, inspectKey: inspecting(whoamiOk(['product:edit'])) }),
    );

    const body = await readBody(
      await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } })),
    );
    expect(body.data?.verifyStatus).toBe('valid');
    expect(body.data?.verifyNote).toBeNull();
  });

  it('vlastné overenie (`probeKey`) prebije `whoami` a oprávnenia sú „nevieme"', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({
        apiKey: write,
        probeKey: async () => 'valid',
        inspectKey: inspecting(whoamiOk(['product:edit'])),
      }),
    );

    const body = await readBody(
      await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } })),
    );
    expect(body.data?.verifyStatus).toBe('valid');
    expect(body.data?.scopes).toBeNull();
    expect(write.recallScopes?.().scopes).toBeNull();
  });
});

/* ══════════════════ 4. PUT — rozpočet z `whoami` v odpovedi ═══════════════ */

describe('PUT /api/key — rozpočet sa hlási aj so svojím pôvodom (bod D2)', () => {
  it('živé čísla zo shopu idú do odpovede tak, ako prišli', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({ apiKey: write, inspectKey: inspecting(whoamiOk(['product:edit'])) }),
    );

    const body = await readBody(
      await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } })),
    );
    expect(body.data?.budget).toMatchObject({ perMinute: 59, perUtcDay: 9_987, measured: true });
  });

  it('`per_day: null` spadne na zálohu — nie na nekonečno a nie na nulu', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({
        apiKey: write,
        inspectKey: inspecting(whoamiOk(['product:edit'], { perMinute: 59, perUtcDay: null })),
      }),
    );

    const body = await readBody(
      await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } })),
    );
    const budget = body.data?.budget as { perUtcDay: number; measured: boolean; note: string };
    expect(budget.perUtcDay).toBe(160);
    expect(budget.measured).toBe(false);
    expect(budget.note).toContain('odhad');
  });

  it('bez odpovede zo `whoami` je celý rozpočet zo zálohy', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({
        apiKey: write,
        inspectKey: inspecting({
          status: 'unknown',
          error: { kind: 'network', code: null, message: '', httpStatus: null, retryable: true },
        }),
      }),
    );

    const body = await readBody(
      await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } })),
    );
    expect(body.data?.budget).toMatchObject({ perMinute: 16, perUtcDay: 160, measured: false });
  });
});

/* ═══════════════════════ 5. GET — čo appka o kľúči vie ════════════════════ */

describe('GET /api/key — oprávnenia sa dajú prečítať bez ďalšieho volania shopu', () => {
  it('po uložení kľúča vidí GET jeho oprávnenia', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const deps = baseDeps({
      apiKey: write,
      inspectKey: inspecting(whoamiOk(['product:read', 'product:edit'])),
    });
    await createKeyPutRoute(deps)(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } }));

    const body = await readBody(await createKeyGetRoute(deps)(makeRequest()));
    expect(body.data?.present).toBe(true);
    expect(body.data?.scopes).toEqual(['product:read', 'product:edit']);
    expect(body.data?.productRead).toBe(true);
    expect(body.data?.scopesCheckedAt).toBe(NOW.toISOString());
  });

  it('bez kľúča sa oprávnenia nehlásia vôbec', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    // Pamäť by tu ešte niečo mať mohla — kľúč však už nie je, takže sa mlčí.
    write.rememberScopes?.(['product:edit']);

    const body = await readBody(await createKeyGetRoute(baseDeps({ apiKey: write }))(makeRequest()));
    expect(body.data?.present).toBe(false);
    expect(body.data?.scopes).toBeNull();
    expect(body.data?.productRead).toBeNull();
    expect(String(body.data?.productReadNote)).toContain('Nevieme');
  });

  it('kľúč uložený pred reštartom appky má oprávnenia „nevieme", nie „nemá"', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    await write.store(Buffer.from(FAKE_KEY, 'utf8'), FAKE_KEY.slice(-4), 24);
    // Reštart = pamäť v procese je prázdna, kľúč v DB zostal.
    resetKeyScopeMemory();

    const body = await readBody(await createKeyGetRoute(baseDeps({ apiKey: write }))(makeRequest()));
    expect(body.data?.present).toBe(true);
    expect(body.data?.scopes).toBeNull();
    expect(body.data?.productRead).toBeNull();
    expect(body.data?.scopesCheckedAt).toBeNull();
  });
});

/* ═════════════════════════════ 6. Invariant I1 ════════════════════════════ */

describe('I1 — z `whoami` sa do odpovede route nedostane nič o kľúči', () => {
  it('odpoveď PUT neobsahuje kľúč, meno kľúča ani vlastníka', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const route = createKeyPutRoute(
      baseDeps({
        apiKey: write,
        // Aj keby sa niekto pokúsil pretlačiť mená cez `inspectKey`, do odpovede
        // sa dostane výhradne to, čo route sama poskladá.
        inspectKey: async () => ({
          status: 'ok',
          info: {
            scopes: ['product:edit'],
            otherScopeCount: 0,
            remaining: { perMinute: 1, perUtcDay: 1 },
          },
        }),
      }),
    );

    const raw = await (await route(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } }))).text();
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain(KEY_NAME);
    expect(raw).not.toContain(KEY_OWNER);
    // `last4` je jediné, čo z kľúča smie von (D65).
    expect(raw).toContain(FAKE_KEY.slice(-4));
  });

  it('odpoveď GET nesie len dohodnuté polia — nič navyše', async () => {
    const { conn } = makeDb();
    const { write } = makeRepos(conn);
    const deps = baseDeps({ apiKey: write, inspectKey: inspecting(whoamiOk(['product:edit'])) });
    await createKeyPutRoute(deps)(makeRequest({ method: 'PUT', body: { apiKey: FAKE_KEY } }));

    const body = await readBody(await createKeyGetRoute(deps)(makeRequest()));
    expect(Object.keys(body.data ?? {}).sort()).toEqual(
      [
        'expiresAt',
        'last4',
        'present',
        'productRead',
        'productReadNote',
        'savedAt',
        'scopes',
        'scopesCheckedAt',
        'secondsLeft',
        'verifyStatus',
        // Pribudlo 24. 8. 2026 (body A a B). Ani jedno nenesie nič, z čoho by
        // sa dal odvodiť kľúč: `verifyNote` je veta o STAVE overenia,
        // `looksLikeSameKey` je porovnanie `last4`, ktoré v odpovedi beztak je,
        // a `sameKeyNote` je veta nad tým porovnaním.
        'verifyNote',
        'looksLikeSameKey',
        'sameKeyNote',
      ].sort(),
    );
  });
});
