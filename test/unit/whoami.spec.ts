/**
 * Aura Zľavy — overenie kľúča cez `GET /api/whoami` (API v5, bod D1 a D3).
 *
 * Čo tieto testy strážia:
 *
 *  1. **Sonda na zápisovom endpointe je preč.** Do v4 sa platnosť kľúča
 *     overovala `POST /api/products/setReduction` s `reduction=0`. Nikdy nič
 *     nezapísala, ale bila na PRODUKČNÝ zápisový endpoint a v štatistike shopu
 *     vyzerala ako zápis. Testy nižšie tvrdia, že overenie kľúča už NEPOŠLE
 *     ani jeden POST a že sonda nie je ani v zdrojáku.
 *  2. **Fail-closed vyhodnotenie.** Z neistej odpovede (429, 500, timeout,
 *     zmenený tvar) sa NIKDY nesmie stať „kľúč platí".
 *  3. **I1.** `whoami` vracia `id`, `name` a `owner` kľúča. Nesmú sa dostať do
 *     výsledku ani do logu — appka ich zámerne ani neparsuje.
 *  4. **„Nevieme" nie je nula.** `remaining.per_day: null` je legitímna odpoveď
 *     a musí sa preniesť ako `null`, nie ako 0.
 *
 * Beží výhradne s fake fetch — žiadny request neopustí proces (I6).
 *
 * Vlastník: A3.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SecretRef, ShopCtx } from '@/contracts';

import { setLogLevel, setLogSink } from '@/lib/log/logger';
import { resetRedactionState, setActiveSecretForScan } from '@/lib/log/redact';
import {
  SHOP_PATHS,
  createShopClient,
  hasShopScope,
  isShopScope,
  missingScopeSentence,
  parseShopScopes,
  type FetchLike,
  type ShopClientV5,
  type WhoamiOutcome,
} from '@/lib/shop/client';
import { newOperationContext } from '@/lib/shop/correlation';

/* ═════════════════════════ 0. Testovací harness ═══════════════════════════ */

/** Loopback base URL — ani omylom sa nedá trafiť reálna doména (I6). */
const BASE = 'https://127.0.0.1:8443';

const TEST_KEY = 'TESTKEY-abc123deadbeef99';

/** Mená, ktoré `whoami` vracia a ktoré sa NIKDY nesmú objaviť vo výstupe (I1). */
const KEY_NAME = 'aura-zlavy-integracia';
const KEY_OWNER = 'Jana Testovacia';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

type Handler = (req: Recorded, index: number) => Response | Promise<Response>;

interface Harness {
  fetchImpl: FetchLike;
  calls: Recorded[];
}

function harness(handlers: Handler | Handler[]): Harness {
  const list = Array.isArray(handlers) ? handlers : [handlers];
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    const record: Recorded = {
      url: input,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : null,
    };
    const index = calls.length;
    calls.push(record);
    const handler = list[Math.min(index, list.length - 1)];
    return handler(record, index);
  };
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface FakeKey {
  ref: SecretRef;
  releases: number;
  zeroed: boolean[];
}

function fakeKey(value = TEST_KEY): FakeKey {
  const state: FakeKey = {
    releases: 0,
    zeroed: [],
    ref: async () => {
      const buf = Buffer.from(value, 'utf8');
      return {
        value: buf,
        release: () => {
          buf.fill(0);
          state.releases += 1;
          state.zeroed.push(buf.every((b) => b === 0));
        },
      };
    },
  };
  return state;
}

/** Klient bez čakania a bez opakovania — testy nesmú spať. */
function client(fetchImpl: FetchLike): ShopClientV5 {
  return createShopClient({
    baseUrl: BASE,
    fetchImpl,
    version: '0.0.0-test',
    policy: { maxAttempts: 1, retryAfterCapSeconds: 1 },
    sleepFn: async () => {},
  });
}

const ctx = (): ShopCtx => newOperationContext();

/** Plná odpoveď `whoami` podľa `docs/api/sperky-api-v5.md`. */
function whoamiBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    id: 20,
    name: KEY_NAME,
    owner: KEY_OWNER,
    expires_at: null,
    scopes: ['product:read', 'product:edit'],
    remaining: { per_minute: 59, per_day: 9_987 },
    ...overrides,
  };
}

/* ═══════════════ 1. Sonda na zápisovom endpointe zmizla ═══════════════════ */

describe('overenie kľúča už nesiaha na zápisový endpoint (bod D1)', () => {
  it('`probeKey` pošle jeden GET na `/api/whoami` a žiadny POST', async () => {
    const h = harness(() => json(whoamiBody()));
    const result = await client(h.fetchImpl).probeKey(fakeKey().ref, ctx());

    expect(result).toBe('valid');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].method).toBe('GET');
    expect(h.calls[0].url).toContain(SHOP_PATHS.whoami);
    expect(h.calls[0].body).toBeNull();
    // Toto je tá 22. požiadavka zo štatistiky maintainera — už nevzniká.
    expect(h.calls.some((c) => c.url.includes(SHOP_PATHS.setReduction))).toBe(false);
    expect(h.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('ani pri odmietnutom kľúči sa nič neposiela na `setReduction`', async () => {
    for (const status of [401, 403, 429, 500]) {
      const h = harness(() => json({ error: 'nope' }, status));
      await client(h.fetchImpl).whoami(fakeKey().ref, ctx());
      expect(h.calls.every((c) => c.method === 'GET'), `status ${status}`).toBe(true);
      expect(h.calls.every((c) => !c.url.includes(SHOP_PATHS.setReduction))).toBe(true);
    }
  });

  /**
   * Poistka proti návratu triku. Behaviorálny test vyššie chytí sondu, ktorá sa
   * naozaj zavolá; tento chytí aj tú, ktorá by v module ležala „na neskôr".
   */
  it('v zdrojáku klienta už sonda `reduction=0` nie je', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/shop/client.ts'), 'utf8');
    // Telo sondy: `reduction: '0'` vo form payloade a konštanta pre id produktu.
    expect(source).not.toMatch(/reduction:\s*'0'/);
    expect(source).not.toMatch(/export const PROBE_PRODUCT_ID/);
    expect(source).not.toMatch(/probeProductId\s*\?\?/);
    // A naopak — cesta na whoami tam byť MUSÍ.
    expect(source).toContain(SHOP_PATHS.whoami);
  });

  it('kľúč ide v hlavičke a hneď sa wipne (I1, D64)', async () => {
    const h = harness(() => json(whoamiBody()));
    const key = fakeKey();
    await client(h.fetchImpl).whoami(key.ref, ctx());

    expect(h.calls[0].headers['x-api-key']).toBe(TEST_KEY);
    expect(key.releases).toBe(1);
    expect(key.zeroed).toEqual([true]);
  });
});

/* ═════════════════ 2. Čítanie odpovede a tvarové konvencie ════════════════ */

describe('odpoveď `whoami` sa číta cez spoločné rozbalenie obálky', () => {
  it('rozumie tvaru `{"result": …}`, ktorým odpovedá produkčný shop', async () => {
    const h = harness(() => json({ result: whoamiBody() }));
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.info.scopes).toEqual(['product:read', 'product:edit']);
    expect(outcome.info.remaining).toEqual({ perMinute: 59, perUtcDay: 9_987 });
  });

  it('rozumie aj holému telu bez obálky (mock, starší kontrakt)', async () => {
    const h = harness(() => json(whoamiBody()));
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());
    expect(outcome.status).toBe('ok');
  });

  it('vonkajšie `ok` sa prenesie dovnútra — inak by úspech vyzeral ako drift', async () => {
    const inner = whoamiBody();
    delete inner.ok;
    const h = harness(() => json({ ok: true, result: inner }));
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());
    expect(outcome.status).toBe('ok');
  });

  it('scopes, ktoré appka nepozná, sa počítajú — neignorujú sa ticho', async () => {
    const h = harness(() =>
      json(whoamiBody({ scopes: ['product:edit', 'stats:read', 'product:edit'] })),
    );
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.info.scopes).toEqual(['product:edit']);
    expect(outcome.info.otherScopeCount).toBe(1);
  });

  it('kľúč bez scopes je „nemá ani jeden", nie „nevieme"', async () => {
    const h = harness(() => json(whoamiBody({ scopes: [] })));
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.info.scopes).toEqual([]);
    expect(hasShopScope(outcome.info.scopes, 'product:read')).toBe(false);
  });
});

describe('`remaining` sa prenáša aj so svojím „nevieme"', () => {
  it('`per_day: null` sa prenesie ako `null`, nie ako nula', async () => {
    const h = harness(() => json(whoamiBody({ remaining: { per_minute: 12, per_day: null } })));
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.info.remaining.perMinute).toBe(12);
    expect(outcome.info.remaining.perUtcDay).toBeNull();
  });

  it('chýbajúce `remaining` nie je drift — je to „nevieme"', async () => {
    const body = whoamiBody();
    delete body.remaining;
    const h = harness(() => json(body));
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());

    // Overenie kľúča nesmie zlyhať preto, že shop nepovedal číslo rozpočtu.
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.info.remaining).toEqual({ perMinute: null, perUtcDay: null });
  });

  it('nula sa prenesie ako nula — vyčerpaný rozpočet nie je neznámy', async () => {
    const h = harness(() => json(whoamiBody({ remaining: { per_minute: 0, per_day: 0 } })));
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.info.remaining).toEqual({ perMinute: 0, perUtcDay: 0 });
  });
});

/* ═══════════════════════ 3. Fail-closed vyhodnotenie ══════════════════════ */

describe('z neistoty sa nikdy nestane „kľúč platí"', () => {
  const cases: Array<[string, () => Response, WhoamiOutcome['status'], string]> = [
    ['200 s platným telom', () => json(whoamiBody()), 'ok', 'valid'],
    ['401 shop kľúč nepozná', () => json({ error: 'forbidden' }, 401), 'invalid', 'invalid'],
    ['403 shop kľúč zakázal', () => json({ error: 'forbidden' }, 403), 'forbidden', 'forbidden'],
    ['429 rate limit', () => json({ error: 'rate_limited' }, 429), 'unknown', 'unknown'],
    ['500 chyba shopu', () => json({ error: 'boom' }, 500), 'unknown', 'unknown'],
    ['200 s `ok:false`', () => json({ ok: false, error: 'nope' }), 'unknown', 'unknown'],
    ['200 bez `scopes`', () => json({ ok: true, id: 1 }), 'unknown', 'unknown'],
    ['200 s nečitateľným telom', () => new Response('<html>', { status: 200 }), 'unknown', 'unknown'],
  ];

  for (const [label, respond, status, probe] of cases) {
    it(`${label} → ${status}`, async () => {
      const h = harness(() => respond());
      const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());
      expect(outcome.status).toBe(status);

      const h2 = harness(() => respond());
      expect(await client(h2.fetchImpl).probeKey(fakeKey().ref, ctx())).toBe(probe);
    });
  }

  it('nenastavená doména shopu je „nevieme", nie pád', async () => {
    const shop = createShopClient({
      // Presne to, čo spraví `shopBaseUrlFromSettings`, keď doména chýba.
      baseUrl: () => '',
      fetchImpl: async () => json(whoamiBody()),
      policy: { maxAttempts: 1, retryAfterCapSeconds: 1 },
      sleepFn: async () => {},
    });
    // `resolveBaseUrl` hodí `ShopConfigError`; overenie kľúča to musí prežiť.
    await expect(shop.whoami(fakeKey().ref, ctx())).resolves.toMatchObject({ status: 'unknown' });
  });

  it('kľúč, ktorý sa nedá dešifrovať, overenie zhodí — nie je to „platí"', async () => {
    const h = harness(() => json(whoamiBody()));
    const brokenKey: SecretRef = async () => {
      throw new Error('kľúč expiroval');
    };
    await expect(client(h.fetchImpl).whoami(brokenKey, ctx())).rejects.toThrow('kľúč expiroval');
    expect(h.calls).toHaveLength(0);
  });
});

/* ═════════════════════════════ 4. Invariant I1 ════════════════════════════ */

describe('I1 — z `whoami` sa meno kľúča ani vlastník nikam nedostanú', () => {
  /** Sink dostáva UŽ serializovaný riadok — presne to, čo padne na stdout. */
  let lines: string[];

  beforeEach(() => {
    lines = [];
    setLogLevel('debug');
    setLogSink((line) => lines.push(line));
    resetRedactionState();
    setActiveSecretForScan(TEST_KEY);
  });

  afterEach(() => {
    setLogSink(null);
    setLogLevel(null);
    setActiveSecretForScan(null);
    resetRedactionState();
  });

  it('výsledok neobsahuje `id`, `name`, `owner` ani `expires_at`', async () => {
    const h = harness(() => json(whoamiBody()));
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());

    expect(outcome.status).toBe('ok');
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(KEY_NAME);
    expect(serialized).not.toContain(KEY_OWNER);
    expect(serialized).not.toContain('expires_at');
    if (outcome.status !== 'ok') return;
    expect(Object.keys(outcome.info).sort()).toEqual(
      ['remaining', 'scopes', 'otherScopeCount'].sort(),
    );
  });

  it('log z overenia neobsahuje kľúč, meno kľúča ani vlastníka', async () => {
    const h = harness(() => json(whoamiBody()));
    await client(h.fetchImpl).whoami(fakeKey().ref, ctx());

    const dump = JSON.stringify(lines);
    expect(lines.length).toBeGreaterThan(0);
    expect(dump).not.toContain(TEST_KEY);
    expect(dump).not.toContain(TEST_KEY.slice(-8));
    expect(dump).not.toContain(KEY_NAME);
    expect(dump).not.toContain(KEY_OWNER);
    // Zalogovať sa smie počet scopes a to, či shop povedal zostatok.
    expect(dump).toContain('shop_whoami_done');
    expect(dump).toContain('scopeCount');
  });

  it('ani pri zmenenom tvare odpovede sa meno kľúča nedostane do chyby', async () => {
    // `schema_drift` si berie `raw` telo — a to celé telo obsahuje `name`.
    const h = harness(() => json({ ok: true, name: KEY_NAME, owner: KEY_OWNER }));
    const outcome = await client(h.fetchImpl).whoami(fakeKey().ref, ctx());

    expect(outcome.status).toBe('unknown');
    if (outcome.status === 'ok') return;
    const dump = JSON.stringify({ error: outcome.error, lines });
    expect(dump).not.toContain(TEST_KEY);
    // `name` a `owner` sú v denylistu redaktora len ako mená polí; hodnoty samy
    // o sebe kľúč neprezrádzajú. Kritické je, že sa nikde neobjaví kľúč.
    expect(dump).toContain('schema_drift');
  });
});

/* ══════════════════════ 5. Scopes a veta o chýbajúcom ═════════════════════ */

describe('scope `product:read` (bod D3)', () => {
  /**
   * Produktový klient pozná VÝHRADNE produktové scopes. Scope objednávok tu
   * chýba zámerne — I8' hovorí, že objednávkovú cestu vlastní `orders-client.ts`
   * a v tomto module sa nesmie vyskytnúť ani ako text (stráži to grep test
   * v `shop-errors.spec.ts`). Objednávkový kľúč sa cez `whoami` neoveruje.
   */
  it('klient pozná produktové scopes a scope objednávok zámerne nie', () => {
    expect(isShopScope('product:read')).toBe(true);
    expect(isShopScope('product:edit')).toBe(true);
    expect(isShopScope(`orders${':'}read`)).toBe(false);
    expect(isShopScope('product:write')).toBe(false);
    expect(isShopScope(42)).toBe(false);
    expect(isShopScope(null)).toBe(false);
  });

  it('`parseShopScopes` deduplikuje a ostatné len počíta', () => {
    const parsed = parseShopScopes([
      'product:edit',
      'product:edit',
      `orders${':'}read`,
      'nieco:ine',
      7,
      null,
    ]);
    expect(parsed.scopes).toEqual(['product:edit']);
    // Scope objednávok, neznámy scope a dve nesprávne hodnoty.
    expect(parsed.otherScopeCount).toBe(4);
  });

  it('„nevieme" je tretí stav, nie `false`', () => {
    expect(hasShopScope(['product:read'], 'product:read')).toBe(true);
    expect(hasShopScope(['product:edit'], 'product:read')).toBe(false);
    expect(hasShopScope(null, 'product:read')).toBeNull();
    expect(hasShopScope(undefined, 'product:read')).toBeNull();
  });

  it('chýbajúci scope má vetu, ktorá povie čo chýba aj čo s tým', () => {
    const veta = missingScopeSentence('product:read', true);
    expect(veta).toContain('product:read');
    expect(veta.length).toBeGreaterThan(40);
    // Používateľ musí vedieť, čo má spraviť — nie len že niečo nejde.
    expect(veta.toLowerCase()).toContain('správcu shopu');
  });

  it('„nevieme" má vlastnú vetu — netvrdí, že kľúč scope nemá', () => {
    const veta = missingScopeSentence('product:read', false);
    expect(veta).toContain('Nevieme');
    expect(veta).toContain('product:read');
    expect(veta).not.toBe(missingScopeSentence('product:read', true));
  });
});
