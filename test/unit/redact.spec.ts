/**
 * Aura Zľavy — test centrálneho redaktora (INVARIANT I1, D66, BUILD-SPEC §6).
 *
 * Toto je blokujúci test invariantu I1: „API kľúč nikdy v repe, logoch, audite
 * ani v UI. Redaktor je centrálny a test, ktorý ho overuje, MUSÍ existovať
 * a byť blokujúci."
 *
 * Overuje akceptačné kritérium A2:
 *   - maskovanie hlavičiek `authorization`, `x-api-key`, `cookie`,
 *   - maskovanie polí `apiKey`/`api_key`/`key`/`token`/`password`/`secret`
 *     v ľubovoľnej hĺbke vnorenia vrátane polí (arrays),
 *   - substring scan na aktuálny kľúč a jeho posledných 8 znakov + `redaction_hit`,
 *   - `audit.repo.ts` neobsahuje žiadny zápisový príkaz (I4),
 *   - `appendAudit()` nikdy nehodí výnimku smerom do volajúceho toku.
 *
 * Vlastník: A2.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Queryable } from '@/contracts';

import { appendAudit, appendAuditResult, getAuditWriteFailureCount, resetAuditWriteFailureCount } from '@/lib/audit/write';
import { AUDIT_EVENT_TYPES, isAuditEventType } from '@/lib/audit/events';
import { setLogLevel, setLogSink } from '@/lib/log/logger';
import {
  REDACTED,
  TRUNCATED,
  isDeniedFieldName,
  redact,
  redactString,
  resetRedactionState,
  setActiveSecretForScan,
} from '@/lib/log/redact';

/** Kľúč z povinného scenára BUILD-SPEC §12 (`TESTKEY-abc123…`). */
const TEST_KEY = 'TESTKEY-abc123deadbeef99';
const TEST_KEY_TAIL = TEST_KEY.slice(-8);

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  resetRedactionState();
  resetAuditWriteFailureCount();
  setLogLevel('debug');
  setLogSink((line) => lines.push(line));
});

afterEach(() => {
  setLogSink(null);
  setLogLevel(null);
  resetRedactionState();
});

const dump = (value: unknown): string => JSON.stringify(value);

/* ═══════════════════════ 1. hlavičky a mená polí ══════════════════════════ */

describe('redact() — hlavičky (§6)', () => {
  it('zamaskuje authorization, x-api-key a cookie v ľubovoľnom zápise mena', () => {
    const out = redact({
      headers: {
        Authorization: `Bearer ${TEST_KEY}`,
        'X-Api-Key': TEST_KEY,
        'x-api-key': TEST_KEY,
        Cookie: 'ovl_zliav_session=abc.def.ghi',
        'set-cookie': 'ovl_zliav_session=abc; HttpOnly',
        'X-Request-Id': '01J0000000000000000000000A',
        'User-Agent': 'aura-zlavy/0.1.0',
      },
    });

    expect(out.headers.Authorization).toBe(REDACTED);
    expect(out.headers['X-Api-Key']).toBe(REDACTED);
    expect(out.headers['x-api-key']).toBe(REDACTED);
    expect(out.headers.Cookie).toBe(REDACTED);
    expect(out.headers['set-cookie']).toBe(REDACTED);
    // Korelačné a identifikačné hlavičky musia zostať čitateľné (D58).
    expect(out.headers['X-Request-Id']).toBe('01J0000000000000000000000A');
    expect(out.headers['User-Agent']).toBe('aura-zlavy/0.1.0');
    expect(dump(out)).not.toContain(TEST_KEY);
  });

  it('zamaskuje hlavičky aj vo `Headers` instancii', () => {
    const headers = new Headers({ authorization: `Bearer ${TEST_KEY}`, accept: 'application/json' });
    const out = redact({ headers }) as unknown as { headers: Record<string, unknown> };

    expect(out.headers.authorization).toBe(REDACTED);
    expect(out.headers.accept).toBe('application/json');
    expect(dump(out)).not.toContain(TEST_KEY);
  });
});

describe('redact() — denylist polí do ľubovoľnej hĺbky (D66)', () => {
  it('pozná všetky mená z denylistu vrátane variantov zápisu', () => {
    for (const name of [
      'apiKey',
      'api_key',
      'API-KEY',
      'key',
      'token',
      'password',
      'secret',
      'authorization',
      'x-api-key',
      'cookie',
      'shopApiKey',
      'adminPassword',
      'sessionSecret',
      'previewToken',
    ]) {
      expect(isDeniedFieldName(name), name).toBe(true);
    }
  });

  it('neredaguje neškodné mená polí', () => {
    for (const name of [
      'productId',
      'operationId',
      'requestId',
      'httpStatus',
      'eventType',
      'keyVersion',
      'keyExpiresBeforeStart',
      'name',
      'price',
      'ok',
    ]) {
      expect(isDeniedFieldName(name), name).toBe(false);
    }
  });

  it('zamaskuje polia hlboko vnorené v objektoch aj v poliach', () => {
    const input = {
      level1: {
        level2: [
          { harmless: 'ok', api_key: TEST_KEY },
          { nested: { deeper: [{ token: TEST_KEY }, { password: 'Heslo1234567' }] } },
        ],
        list: [[[{ secret: TEST_KEY }]]],
      },
      meta: { productId: 42, key: TEST_KEY },
    };

    const out = redact(input);
    const serialized = dump(out);

    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain(TEST_KEY_TAIL);
    expect(serialized).not.toContain('Heslo1234567');
    expect(out.level1.level2[0]?.api_key).toBe(REDACTED);
    expect(out.level1.level2[0]?.harmless).toBe('ok');
    expect(out.meta.productId).toBe(42);
    expect(out.meta.key).toBe(REDACTED);
  });

  it('vstup nemutuje', () => {
    const input = { apiKey: TEST_KEY, nested: { token: TEST_KEY } };
    const out = redact(input);

    expect(out).not.toBe(input);
    expect(input.apiKey).toBe(TEST_KEY);
    expect(input.nested.token).toBe(TEST_KEY);
  });

  it('zvládne cyklus, Map, Set, Buffer a Error bez pádu', () => {
    setActiveSecretForScan(TEST_KEY);
    const cyclic: Record<string, unknown> = { name: 'cyklus' };
    cyclic.self = cyclic;

    const out = redact({
      cyclic,
      map: new Map<string, unknown>([
        ['apiKey', TEST_KEY],
        ['productId', 7],
      ]),
      set: new Set([TEST_KEY, 'ok']),
      buffer: Buffer.from(TEST_KEY, 'utf8'),
      error: new Error(`zlyhalo s kľúčom ${TEST_KEY}`),
    });

    const serialized = dump(out);
    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).toContain('[Circular]');
    // Binárne dáta sa nikdy neserializujú — plaintext kľúča žije ako Buffer (D64).
    expect(serialized).toContain('BINARY(');
    const mapped = out.map as unknown as Record<string, unknown>;
    expect(mapped.apiKey).toBe(REDACTED);
    expect(mapped.productId).toBe(7);
  });

  it('pri prekročení hĺbky maskuje, nie prepúšťa (fail-closed)', () => {
    let deep: Record<string, unknown> = { leaf: TEST_KEY };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };

    const serialized = dump(redact(deep));
    expect(serialized).toContain(TRUNCATED);
    expect(serialized).not.toContain(TEST_KEY);
  });
});

/* ═════════════════ 2. substring scan na aktuálny kľúč (§6) ════════════════ */

describe('redact() — substring scan na aktuálny kľúč (§6, I1)', () => {
  it('bez aktívneho kľúča nechá bežný text nedotknutý', () => {
    const out = redact({ message: 'kampaň dokončená', productId: 1 });
    expect(out.message).toBe('kampaň dokončená');
  });

  it('nahradí celý kľúč v hlbokom stringu a zaloguje redaction_hit', () => {
    setActiveSecretForScan(TEST_KEY);

    const out = redact({
      nested: { raw: `curl -H 'X-Custom: ${TEST_KEY}' https://example.test/api` },
    });

    expect(dump(out)).not.toContain(TEST_KEY);
    expect(out.nested.raw).toContain(REDACTED);

    const hit = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.msg === 'redaction_hit');
    expect(hit, 'redaction_hit musí byť v logu (§6)').toBeDefined();
    expect(hit?.level).toBe('error');
    expect(dump(hit)).not.toContain(TEST_KEY);
  });

  it('nahradí aj posledných 8 znakov kľúča', () => {
    setActiveSecretForScan(TEST_KEY);

    const out = redact({ hint: `koniec kľúča je ${TEST_KEY_TAIL}` });

    expect(out.hint).not.toContain(TEST_KEY_TAIL);
    expect(out.hint).toContain(REDACTED);
    expect(lines.some((l) => l.includes('redaction_hit'))).toBe(true);
  });

  it('nájde kľúč aj v mene poľa, v URL a v stacktrace', () => {
    setActiveSecretForScan(TEST_KEY);

    const error = new Error('boom');
    error.stack = `Error: boom\n    at send (/app/send.ts:1:1) key=${TEST_KEY}`;

    const out = redact({
      [`pole-${TEST_KEY}`]: 'hodnota',
      url: `https://example.test/api/products?api_key=${TEST_KEY}&page=1`,
      error,
    });

    const serialized = dump(out);
    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain(TEST_KEY_TAIL);
    expect(Object.keys(out).some((k) => k.includes(REDACTED))).toBe(true);
  });

  it('`setActiveSecretForScan(null)` kľúč zabudne', () => {
    setActiveSecretForScan(TEST_KEY);
    expect(redactString(`x ${TEST_KEY}`)).not.toContain(TEST_KEY);

    setActiveSecretForScan(null);
    expect(redactString(`x ${TEST_KEY}`)).toContain(TEST_KEY);
  });

  it('príliš krátke „tajomstvo" scan nezapne (inak by zmazalo pol logu)', () => {
    setActiveSecretForScan('ab');
    expect(redactString('abrakadabra')).toBe('abrakadabra');
  });
});

/* ══════════════════ 3. inline scan bez aktívneho kľúča ═══════════════════ */

describe('redactString() — inline tvary v jednom stringu', () => {
  it('zamaskuje hodnotu za Authorization, X-Api-Key a v query parametri', () => {
    expect(redactString(`Authorization: Bearer ${TEST_KEY}`)).not.toContain(TEST_KEY);
    expect(redactString(`X-Api-Key: ${TEST_KEY}`)).not.toContain(TEST_KEY);
    expect(redactString(`GET /api/products?api_key=${TEST_KEY}&page=2`)).not.toContain(TEST_KEY);
    expect(redactString(`{"password":"Heslo1234567"}`)).not.toContain('Heslo1234567');
  });

  it('nechá bežnú slovenskú vetu bez zmeny', () => {
    const text = 'Zápis prebehol, produkt 12345 dostal zľavu 20 %.';
    expect(redactString(text)).toBe(text);
  });
});

/* ═══════════════════════ 4. logger je za redaktorom ══════════════════════ */

describe('logger — každý riadok prechádza redaktorom (D66, D92)', () => {
  it('zamaskuje polia aj `msg` a udrží tvar JSON riadku', async () => {
    setActiveSecretForScan(TEST_KEY);
    const { logger } = await import('@/lib/log/logger');

    logger.info(`odosielam s kľúčom ${TEST_KEY}`, {
      operationId: '01J0000000000000000000000A',
      headers: { 'x-api-key': TEST_KEY },
      level: 'debug',
    });

    const line = lines.find((l) => l.includes('01J0000000000000000000000A'));
    expect(line).toBeDefined();
    expect(line).not.toContain(TEST_KEY);

    const parsed = JSON.parse(line as string) as Record<string, unknown>;
    expect(parsed.level).toBe('info'); // volajúci nesmie prebiť úroveň
    expect(parsed.app).toBe('aura-zlavy');
    expect(typeof parsed.ts).toBe('string');
    expect(dump(parsed.headers)).toBe(dump({ 'x-api-key': REDACTED }));
  });
});

/* ═════════════════ 5. audit: append-only a bez výnimiek ══════════════════ */

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('audit (I4) — append-only', () => {
  it('`audit.repo.ts` neobsahuje žiadny zápisový ani mazací príkaz', () => {
    const source = readSource('src/lib/repo/audit.repo.ts');
    expect(/UPDATE/.test(source)).toBe(false);
    expect(/DELETE/.test(source)).toBe(false);
    expect(/\bINSERT\b/i.test(source)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(source)).toBe(false);
  });

  it('`write.ts` má jediný SQL príkaz a je to INSERT do audit_log', () => {
    const source = readSource('src/lib/audit/write.ts');

    // Jediný SQL príkaz v module — a je to INSERT (I4).
    const inserts = source.match(/\bINSERT\s+INTO\s+audit_log\b/g) ?? [];
    expect(inserts).toHaveLength(1);

    // Žiadna mutácia ani mazanie nad auditom, ani v komentároch.
    expect(/UPDATE/.test(source)).toBe(false);
    expect(/DELETE/.test(source)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(source)).toBe(false);
    expect(/\bREPLACE\s+INTO\b/i.test(source)).toBe(false);
  });

  it('zoznam `event_type` je kompletný a v limite VARCHAR(48)', () => {
    expect(AUDIT_EVENT_TYPES.length).toBe(38);
    for (const event of AUDIT_EVENT_TYPES) {
      expect(event.length, event).toBeLessThanOrEqual(48);
      expect(isAuditEventType(event)).toBe(true);
    }
    expect(isAuditEventType('neexistuje')).toBe(false);
  });
});

/** Falošné spojenie — zapamätá si parametre `INSERT`u, nič nikam nezapíše. */
function capturingConn(captured: unknown[][]): Queryable {
  return {
    query: (async (_sql: string, values?: unknown) => {
      captured.push(values as unknown[]);
      return [] as never;
    }) as Queryable['query'],
  };
}

describe('appendAudit() — nikdy nehodí výnimku do volajúceho toku', () => {
  it('zlyhanie DB sa zaloguje a tok pokračuje', async () => {
    const failing: Queryable = {
      query: (async () => {
        throw new Error('grant chýba');
      }) as Queryable['query'],
    };

    await expect(appendAudit({ actor: 'system', eventType: 'boot' }, failing)).resolves.toBeUndefined();
    expect(getAuditWriteFailureCount()).toBe(1);

    const failLine = lines.find((l) => l.includes('audit_write_failed'));
    expect(failLine).toBeDefined();
    expect(failLine).toContain('boot');
  });

  it('kľúč sa do INSERT parametrov nedostane ani zo snapshotu (I1)', async () => {
    setActiveSecretForScan(TEST_KEY);
    const captured: unknown[][] = [];
    const spy = capturingConn(captured);

    const ok = await appendAuditResult(
      {
        actor: 'user',
        eventType: 'write_ok',
        ok: true,
        productId: 12345,
        operationId: '01J0000000000000000000000A',
        beforeSnapshot: { name: 'Prsteň', price: '19.90' },
        afterSnapshot: {
          headers: { 'X-Api-Key': TEST_KEY },
          sent: { id: 12345, reduction: 20 },
          raw: `{"ok":true,"debug":"${TEST_KEY}"}`,
        },
        message: `zápis s kľúčom ${TEST_KEY}`,
        userAgent: 'aura-zlavy/0.1.0',
      },
      spy,
    );

    expect(ok).toBe(true);
    const serialized = dump(captured);
    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain(TEST_KEY_TAIL);
    expect(serialized).toContain('12345');
    expect(serialized).toContain(REDACTED);
  });

  it('neznámy event type sa nezahodí, len sa označí v logu', async () => {
    const captured: unknown[][] = [];
    const spy = capturingConn(captured);

    // Zámerne mimo kontraktu — audit sa nikdy nemaže, teda ani nezahadzuje (D75).
    await appendAudit({ actor: 'system', eventType: 'vymyslene' as never }, spy);

    expect(captured).toHaveLength(1);
    expect(lines.some((l) => l.includes('audit_unknown_event_type'))).toBe(true);
  });
});
