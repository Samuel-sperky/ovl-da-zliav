/**
 * Aura Zľavy — testy crypto vrstvy a repozitára API kľúča (A1).
 *
 * Pokrývajú akceptačné kritériá A1:
 *  - roundtrip encrypt/decrypt funguje,
 *  - zmena jediného bitu ciphertextu / IV / tagu / AAD zhodí autentifikáciu,
 *  - `SecretRef` po `release()` obsahuje vynulovaný buffer (D64, I1),
 *  - master key sa kontroluje na dĺžku aj práva a fail-fast hodí výnimku (D61, I14),
 *  - `loadForUse()` po `expires_at` nevráti kľúč a spustí wipe (D63),
 *  - wipe najprv prepíše ciphertext náhodnými bajtmi, potom riadok zmaže
 *    a nakoniec zapíše audit `key_wiped` (D63) — presne v tomto poradí.
 *
 * Poznámka k umiestneniu: A1 vlastní len `test/unit/crypto.spec.ts` a
 * `test/unit/preview-token.spec.ts`, preto sú testy `api-key.repo.ts` tu.
 * Repozitár sa testuje proti falošnému `Queryable` — žiadna DB, žiadny fetch (I6).
 * Integračný test wipe procedúry proti testovacej DB patrí A17
 * (`test/integration/**`), ktorý A1 nevlastní.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuditInput, AuditWriter, EncryptedSecret, Queryable } from '@/contracts';
import {
  MASTER_KEY_BYTES,
  SecretFileError,
  checkSecretFile,
  decodeSecretMaterial,
  loadMasterKey,
  loadSessionSecret,
  masterKeyAvailable,
  resetSecretCache,
} from '@/lib/crypto/master-key';
import {
  AAD_PREFIX,
  AUTH_TAG_BYTES,
  CURRENT_KEY_VERSION,
  IV_BYTES,
  MAX_SECRET_BYTES,
  SecretBoxError,
  aadFor,
  createSecretHandle,
  createSecretRef,
  decryptApiKey,
  encryptApiKey,
  wipeBuffer,
  withSecret,
} from '@/lib/crypto/secret-box';
import {
  API_KEY_MAX_TTL_HOURS,
  ApiKeyError,
  auditEventForWipe,
  computeLast4,
  createApiKeyRepo,
} from '@/lib/repo/api-key.repo';

/* ────────────────────────────── pomôcky ────────────────────────────────── */

const MASTER_KEY = randomBytes(MASTER_KEY_BYTES);
const BOX = { masterKey: MASTER_KEY };
const API_KEY_PLAINTEXT = 'fake-shop-key-ABCDEFGHIJKLMNOPQRSTUV1234';

let tempDir: string;

function writeKeyFile(name: string, content: string, mode = 0o400): string {
  const path = join(tempDir, name);
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, mode);
  return path;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ovl-zliav-crypto-'));
  resetSecretCache();
});

afterEach(() => {
  resetSecretCache();
  rmSync(tempDir, { recursive: true, force: true });
});

/* ═══════════════════════════════ master key ════════════════════════════════ */

describe('master-key: dekódovanie materiálu', () => {
  it('prijme 64 hex znakov a base64, odmietne odpad', () => {
    expect(decodeSecretMaterial(MASTER_KEY.toString('hex'))?.length).toBe(32);
    expect(decodeSecretMaterial(MASTER_KEY.toString('base64'))?.length).toBe(32);
    expect(decodeSecretMaterial(`${MASTER_KEY.toString('hex')}\n`)?.length).toBe(32);
    expect(decodeSecretMaterial('')).toBeNull();
    expect(decodeSecretMaterial('   ')).toBeNull();
    expect(decodeSecretMaterial('toto nie je kľúč!')).toBeNull();
  });
});

describe('master-key: kontrola dĺžky a práv (D61, I14)', () => {
  it('prijme 32 B kľúč s právami 400', () => {
    const path = writeKeyFile('ok.key', `${MASTER_KEY.toString('hex')}\n`);
    const check = checkSecretFile(path, { exactBytes: 32, strictPermissions: true });
    expect(check.ok).toBe(true);
    expect(check.problems).toEqual([]);
    expect(check.bytes).toBe(32);
    expect(check.mode).toBe(0o400);
  });

  it('odmietne zlú dĺžku', () => {
    const path = writeKeyFile('short.key', randomBytes(16).toString('hex'));
    const check = checkSecretFile(path, { exactBytes: 32, strictPermissions: true });
    expect(check.ok).toBe(false);
    expect(check.codes).toContain('bad_length');
  });

  it('odmietne obsah, ktorý nie je hex ani base64', () => {
    const path = writeKeyFile('junk.key', 'toto nie je kľúč');
    const check = checkSecretFile(path, { exactBytes: 32, strictPermissions: true });
    expect(check.ok).toBe(false);
    expect(check.codes).toContain('bad_encoding');
  });

  it('práva 644 sú v strict režime chyba a mimo neho varovanie', () => {
    const path = writeKeyFile('loose.key', MASTER_KEY.toString('hex'), 0o644);

    const strict = checkSecretFile(path, { exactBytes: 32, strictPermissions: true });
    expect(strict.ok).toBe(false);
    expect(strict.codes).toContain('bad_permissions');

    const lenient = checkSecretFile(path, { exactBytes: 32, strictPermissions: false });
    expect(lenient.ok).toBe(true);
    expect(lenient.warnings.join(' ')).toContain('644');
  });

  it('chýbajúci súbor je chyba, nie prázdny kľúč', () => {
    const check = checkSecretFile(join(tempDir, 'niet.key'), { exactBytes: 32 });
    expect(check.ok).toBe(false);
    expect(check.codes).toContain('unreadable');
  });

  it('loadMasterKey() hodí SecretFileError a NIKDY nevypíše obsah (I1)', () => {
    const secret = MASTER_KEY.toString('hex');
    const path = writeKeyFile('loose2.key', secret, 0o666);

    let thrown: unknown;
    try {
      loadMasterKey(path, { strictPermissions: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SecretFileError);
    const message = (thrown as SecretFileError).message;
    expect(message).toContain(path);
    expect(message).not.toContain(secret);
    expect(message).not.toContain(secret.slice(-8));
  });

  it('loadMasterKey() načíta súbor raz a výsledok memoizuje (§7)', () => {
    const path = writeKeyFile('cached.key', MASTER_KEY.toString('hex'));
    const first = loadMasterKey(path, { strictPermissions: true });
    const second = loadMasterKey(path, { strictPermissions: true });
    expect(first.equals(MASTER_KEY)).toBe(true);
    expect(second).toBe(first);

    resetSecretCache();
    // Po resete je pôvodný buffer vynulovaný — cache nedrží materiál naveky.
    expect(first.every((byte) => byte === 0)).toBe(true);
  });

  it('masterKeyAvailable() je fail-closed pri chýbajúcom súbore', () => {
    expect(masterKeyAvailable(join(tempDir, 'niet.key'))).toBe(false);
  });

  it('session secret vyžaduje aspoň 32 B', () => {
    const shortPath = writeKeyFile('session-short.key', randomBytes(16).toString('hex'));
    expect(() => loadSessionSecret(shortPath, { strictPermissions: true })).toThrow(SecretFileError);

    const okPath = writeKeyFile('session.key', randomBytes(48).toString('hex'));
    expect(loadSessionSecret(okPath, { strictPermissions: true }).length).toBe(48);
  });
});

/* ═══════════════════════════════ secret box ════════════════════════════════ */

describe('secret-box: AES-256-GCM (§7)', () => {
  it('AAD má formát ovl_zliav:api_key:v<version>', () => {
    expect(aadFor(1).toString('utf8')).toBe(`${AAD_PREFIX}1`);
    expect(aadFor().toString('utf8')).toBe(`${AAD_PREFIX}${CURRENT_KEY_VERSION}`);
    expect(() => aadFor(0)).toThrow(SecretBoxError);
  });

  it('roundtrip encrypt → decrypt vráti pôvodné bajty', () => {
    const plain = Buffer.from(API_KEY_PLAINTEXT, 'utf8');
    const record = encryptApiKey(Buffer.from(plain), BOX);

    expect(record.iv).toHaveLength(IV_BYTES);
    expect(record.authTag).toHaveLength(AUTH_TAG_BYTES);
    expect(record.keyVersion).toBe(CURRENT_KEY_VERSION);
    expect(record.ciphertext).toHaveLength(plain.length);
    expect(record.ciphertext.equals(plain)).toBe(false);

    const decrypted = decryptApiKey(record, BOX);
    expect(decrypted.equals(plain)).toBe(true);
  });

  it('rovnaký plaintext dá pri každom zápise iné IV aj iný ciphertext', () => {
    const a = encryptApiKey(Buffer.from(API_KEY_PLAINTEXT, 'utf8'), BOX);
    const b = encryptApiKey(Buffer.from(API_KEY_PLAINTEXT, 'utf8'), BOX);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  const flipBit = (buf: Buffer, index = 0): Buffer => {
    const copy = Buffer.from(buf);
    copy[index] ^= 0x01;
    return copy;
  };

  it('zmena jediného bitu ciphertextu, IV, tagu alebo verzie (AAD) zhodí autentifikáciu', () => {
    const record = encryptApiKey(Buffer.from(API_KEY_PLAINTEXT, 'utf8'), BOX);

    const variants: Array<[string, EncryptedSecret]> = [
      ['ciphertext', { ...record, ciphertext: flipBit(record.ciphertext) }],
      ['ciphertext (posledný bajt)', {
        ...record,
        ciphertext: flipBit(record.ciphertext, record.ciphertext.length - 1),
      }],
      ['iv', { ...record, iv: flipBit(record.iv) }],
      ['authTag', { ...record, authTag: flipBit(record.authTag) }],
      ['keyVersion (AAD)', { ...record, keyVersion: record.keyVersion + 1 }],
    ];

    for (const [label, tampered] of variants) {
      let thrown: unknown;
      try {
        decryptApiKey(tampered, BOX);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, label).toBeInstanceOf(SecretBoxError);
      expect((thrown as SecretBoxError).code, label).toBe('auth_failed');
      expect((thrown as SecretBoxError).message, label).not.toContain(API_KEY_PLAINTEXT);
    }
  });

  it('iný master key nedokáže dešifrovať (D62)', () => {
    const record = encryptApiKey(Buffer.from(API_KEY_PLAINTEXT, 'utf8'), BOX);
    expect(() => decryptApiKey(record, { masterKey: randomBytes(32) })).toThrowError(
      SecretBoxError,
    );
  });

  it('odmietne prázdny vstup, príliš dlhý vstup a nesprávne tvary záznamu', () => {
    expect(() => encryptApiKey(Buffer.alloc(0), BOX)).toThrow(SecretBoxError);
    expect(() => encryptApiKey(randomBytes(MAX_SECRET_BYTES + 1), BOX)).toThrow(SecretBoxError);
    expect(() => decryptApiKey({ ...encryptApiKey(Buffer.from('x'), BOX), iv: randomBytes(11) }, BOX)).toThrow(
      SecretBoxError,
    );
    expect(() =>
      decryptApiKey({ ...encryptApiKey(Buffer.from('x'), BOX), authTag: randomBytes(8) }, BOX),
    ).toThrow(SecretBoxError);
    expect(() => encryptApiKey(Buffer.from('x'), { masterKey: randomBytes(16) })).toThrow(
      SecretBoxError,
    );
  });
});

describe('secret-box: SecretHandle / SecretRef (D64, I1)', () => {
  it('po release() je buffer vynulovaný a druhý release nič nezhodí', () => {
    const handle = createSecretHandle(Buffer.from(API_KEY_PLAINTEXT, 'utf8'));
    expect(handle.value.toString('utf8')).toBe(API_KEY_PLAINTEXT);
    expect(handle.released).toBe(false);

    handle.release();

    expect(handle.released).toBe(true);
    expect(handle.value).toHaveLength(API_KEY_PLAINTEXT.length);
    expect(handle.value.every((byte) => byte === 0)).toBe(true);
    expect(() => handle.release()).not.toThrow();
  });

  it('handle sa nedá vyzradiť ani serializáciou (I1)', () => {
    const handle = createSecretHandle(Buffer.from(API_KEY_PLAINTEXT, 'utf8'));
    try {
      expect(JSON.stringify({ key: handle })).not.toContain(API_KEY_PLAINTEXT);
      expect(JSON.stringify({ key: handle })).toContain('[REDACTED]');
      expect(String(handle)).not.toContain(API_KEY_PLAINTEXT);
    } finally {
      handle.release();
    }
  });

  it('SecretRef dešifruje až pri volaní — bez cache (D64)', async () => {
    const record = encryptApiKey(Buffer.from(API_KEY_PLAINTEXT, 'utf8'), BOX);
    let loads = 0;
    const ref = createSecretRef(async () => {
      loads += 1;
      return record;
    }, BOX);

    expect(loads).toBe(0);

    const first = await ref();
    expect(first.value.toString('utf8')).toBe(API_KEY_PLAINTEXT);
    first.release();

    const second = await ref();
    expect(second.value.toString('utf8')).toBe(API_KEY_PLAINTEXT);
    second.release();

    // Dve použitia = dve dešifrovania, žiadny zdieľaný plaintext.
    expect(loads).toBe(2);
    expect(first.value.every((byte) => byte === 0)).toBe(true);
    expect(second.value.every((byte) => byte === 0)).toBe(true);
  });

  it('withSecret() uvoľní tajomstvo aj keď callback hodí výnimku', async () => {
    const record = encryptApiKey(Buffer.from(API_KEY_PLAINTEXT, 'utf8'), BOX);
    let captured: Buffer | null = null;
    const ref = createSecretRef(async () => record, BOX);

    await expect(
      withSecret(ref, async (secret) => {
        captured = secret;
        throw new Error('zápis zlyhal');
      }),
    ).rejects.toThrow('zápis zlyhal');

    expect(captured).not.toBeNull();
    expect((captured as unknown as Buffer).every((byte) => byte === 0)).toBe(true);
  });

  it('wipeBuffer() prepíše nulami a znesie prázdny buffer', () => {
    const buf = Buffer.from('tajomstvo', 'utf8');
    wipeBuffer(buf);
    expect(buf.every((byte) => byte === 0)).toBe(true);
    expect(() => wipeBuffer(Buffer.alloc(0))).not.toThrow();
  });
});

/* ═══════════════════════════ api-key repozitár ═════════════════════════════ */

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

interface FakeDb {
  conn: Queryable;
  queries: RecordedQuery[];
  audits: AuditInput[];
  audit: AuditWriter;
}

function createFakeDb(row: Record<string, unknown> | null = null): FakeDb {
  const queries: RecordedQuery[] = [];
  const audits: AuditInput[] = [];
  const state: { row: Record<string, unknown> | null } = { row };

  const query = async (sql: string, values?: unknown): Promise<unknown> => {
    queries.push({ sql, values: Array.isArray(values) ? values : [] });

    if (sql.startsWith('SELECT')) return state.row ? [state.row] : [];
    if (sql.startsWith('UPDATE api_key SET ciphertext')) {
      return { affectedRows: state.row ? 1 : 0 };
    }
    if (sql.startsWith('DELETE')) {
      const affectedRows = state.row ? 1 : 0;
      state.row = null;
      return { affectedRows };
    }
    if (sql.startsWith('INSERT')) {
      state.row = {
        ciphertext: values instanceof Array ? values[1] : null,
        iv: values instanceof Array ? values[2] : null,
        auth_tag: values instanceof Array ? values[3] : null,
        key_version: values instanceof Array ? values[4] : 1,
        last4: values instanceof Array ? values[5] : '',
        created_at: values instanceof Array ? values[6] : new Date(),
        expires_at: values instanceof Array ? values[7] : new Date(),
        verify_status: 'unverified',
        verified_at: null,
        last_used_at: null,
      };
      return { affectedRows: 1 };
    }
    return { affectedRows: state.row ? 1 : 0 };
  };

  return {
    conn: { query } as unknown as Queryable,
    queries,
    audits,
    audit: {
      appendAudit: async (input: AuditInput) => {
        audits.push(input);
      },
    },
  };
}

function encryptedRow(expiresAt: Date, plaintext = API_KEY_PLAINTEXT): Record<string, unknown> {
  const record = encryptApiKey(Buffer.from(plaintext, 'utf8'), BOX);
  return {
    ciphertext: record.ciphertext,
    iv: record.iv,
    auth_tag: record.authTag,
    key_version: record.keyVersion,
    last4: plaintext.slice(-4),
    created_at: new Date(expiresAt.getTime() - 48 * 3_600_000),
    expires_at: expiresAt,
    verify_status: 'valid',
    verified_at: new Date(),
    last_used_at: null,
  };
}

describe('api-key.repo: computeLast4 a mapovanie wipe eventov', () => {
  it('last4 je posledné 4 znaky kľúča (D65)', () => {
    expect(computeLast4(Buffer.from('fake-shop-key-ABCD1234', 'utf8'))).toBe('1234');
    expect(computeLast4(Buffer.from('ab', 'utf8'))).toBe('**ab');
  });

  it('panic button má vlastný audit event (D67)', () => {
    expect(auditEventForWipe('ttl_expired')).toBe('key_wiped');
    expect(auditEventForWipe('http_401')).toBe('key_wiped');
    expect(auditEventForWipe('replaced_by_new_key')).toBe('key_wiped');
    expect(auditEventForWipe('panic_button')).toBe('key_panic_wipe');
  });
});

describe('api-key.repo: wipe procedúra (D63)', () => {
  it('prepíše ciphertext náhodnými bajtmi, POTOM zmaže riadok a POTOM zapíše audit', async () => {
    const db = createFakeDb(encryptedRow(new Date(Date.now() + 3_600_000)));
    const repo = createApiKeyRepo({
      audit: db.audit,
      masterKey: MASTER_KEY,
      defaultConn: db.conn,
    });

    expect(await repo.wipe('ttl_expired')).toBe(true);

    const sqls = db.queries.map((q) => q.sql);
    const overwriteIndex = sqls.findIndex((sql) => sql.includes('RANDOM_BYTES'));
    const deleteIndex = sqls.findIndex((sql) => sql.startsWith('DELETE'));

    expect(overwriteIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(overwriteIndex);
    expect(sqls[overwriteIndex]).toContain('RANDOM_BYTES(LENGTH(ciphertext))');
    expect(sqls[overwriteIndex]).toContain('RANDOM_BYTES(12)');
    expect(sqls[overwriteIndex]).toContain('RANDOM_BYTES(16)');

    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]?.eventType).toBe('key_wiped');
    expect(db.audits[0]?.message).toBe('ttl_expired');
  });

  it('bez uloženého kľúča vráti false a nič neauditje', async () => {
    const db = createFakeDb(null);
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    expect(await repo.wipe('http_401')).toBe(false);
    expect(db.queries.some((q) => q.sql.startsWith('DELETE'))).toBe(false);
    expect(db.audits).toHaveLength(0);
  });

  it('panic button sa zapíše do auditu aj keď už kľúč nebol (D67)', async () => {
    const db = createFakeDb(null);
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    expect(await repo.wipe('panic_button', undefined, { actor: 'user', userId: 7 })).toBe(false);
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]?.eventType).toBe('key_panic_wipe');
    expect(db.audits[0]?.userId).toBe(7);
  });
});

describe('api-key.repo: store() (R2, D64, D65)', () => {
  it('zašifruje kľúč, vynuluje plaintext volajúceho a zapíše audit key_stored', async () => {
    const db = createFakeDb(null);
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    const plain = Buffer.from(API_KEY_PLAINTEXT, 'utf8');
    const result = await repo.store(plain, API_KEY_PLAINTEXT.slice(-4), 48);

    expect(result.last4).toBe(API_KEY_PLAINTEXT.slice(-4));
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // D64 — plaintext v pamäti volajúceho už neexistuje.
    expect(plain.every((byte) => byte === 0)).toBe(true);

    const insert = db.queries.find((q) => q.sql.startsWith('INSERT'));
    expect(insert).toBeDefined();
    const ciphertext = insert?.values[1] as Buffer;
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect(ciphertext.toString('utf8')).not.toContain(API_KEY_PLAINTEXT);

    const stored = db.audits.find((a) => a.eventType === 'key_stored');
    expect(stored).toBeDefined();
    // I1 — v audite nesmie byť kľúč v žiadnej forme.
    expect(JSON.stringify(db.audits)).not.toContain(API_KEY_PLAINTEXT);
    expect(JSON.stringify(db.audits)).not.toContain(API_KEY_PLAINTEXT.slice(-8));
  });

  it('starý kľúč najprv riadne wipne (replaced_by_new_key, D63)', async () => {
    const db = createFakeDb(encryptedRow(new Date(Date.now() + 3_600_000)));
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    await repo.store(Buffer.from('fake-shop-key-NOVYKLUC9999', 'utf8'), '9999', 48);

    const sqls = db.queries.map((q) => q.sql);
    const overwriteIndex = sqls.findIndex((sql) => sql.includes('RANDOM_BYTES'));
    const insertIndex = sqls.findIndex((sql) => sql.startsWith('INSERT'));
    expect(overwriteIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(overwriteIndex);
    expect(db.audits.map((a) => a.eventType)).toEqual(['key_wiped', 'key_stored']);
  });

  it('odmietne TTL nad 48 h aj neprázdny vstup a plaintext aj tak vynuluje (R2)', async () => {
    const db = createFakeDb(null);
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    const plain = Buffer.from(API_KEY_PLAINTEXT, 'utf8');
    await expect(repo.store(plain, '1234', API_KEY_MAX_TTL_HOURS + 1)).rejects.toBeInstanceOf(
      ApiKeyError,
    );
    expect(plain.every((byte) => byte === 0)).toBe(true);

    await expect(repo.store(Buffer.alloc(0), '1234', 48)).rejects.toBeInstanceOf(ApiKeyError);
    expect(db.queries.some((q) => q.sql.startsWith('INSERT'))).toBe(false);
  });
});

describe('api-key.repo: loadForUse() a lazy TTL (D63, D64)', () => {
  it('bez uloženého kľúča vráti null', async () => {
    const db = createFakeDb(null);
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });
    expect(await repo.loadForUse()).toBeNull();
  });

  it('platný kľúč dešifruje až v SecretRef a po release() je vynulovaný', async () => {
    const db = createFakeDb(encryptedRow(new Date(Date.now() + 3_600_000)));
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    const ref = await repo.loadForUse();
    expect(ref).not.toBeNull();

    const handle = await ref!();
    expect(handle.value.toString('utf8')).toBe(API_KEY_PLAINTEXT);
    handle.release();
    expect(handle.value.every((byte) => byte === 0)).toBe(true);
  });

  it('po expires_at nevráti kľúč a spustí wipe (audit key_wiped)', async () => {
    const db = createFakeDb(encryptedRow(new Date(Date.now() - 1000)));
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    expect(await repo.loadForUse()).toBeNull();
    expect(db.queries.some((q) => q.sql.includes('RANDOM_BYTES'))).toBe(true);
    expect(db.queries.some((q) => q.sql.startsWith('DELETE'))).toBe(true);
    expect(db.audits.map((a) => a.eventType)).toEqual(['key_wiped']);
    expect(db.audits[0]?.message).toBe('ttl_expired');
  });

  it('TTL sa kontroluje aj pri KAŽDOM volaní SecretRef, nie len raz', async () => {
    let nowMs = Date.now();
    const expiresAt = new Date(nowMs + 60_000);
    const db = createFakeDb(encryptedRow(expiresAt));
    const repo = createApiKeyRepo({
      audit: db.audit,
      masterKey: MASTER_KEY,
      defaultConn: db.conn,
      now: () => new Date(nowMs),
    });

    const ref = await repo.loadForUse();
    expect(ref).not.toBeNull();

    // Medzi načítaním a použitím TTL vypršalo (D63).
    nowMs += 120_000;
    await expect(ref!()).rejects.toBeInstanceOf(ApiKeyError);
    expect(db.audits.map((a) => a.eventType)).toEqual(['key_wiped']);
  });

  it('SecretRef po wipe hodí unavailable, nikdy nevráti prázdny kľúč', async () => {
    const db = createFakeDb(encryptedRow(new Date(Date.now() + 3_600_000)));
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    const ref = await repo.loadForUse();
    await repo.wipe('panic_button');

    await expect(ref!()).rejects.toBeInstanceOf(ApiKeyError);
  });
});

describe('api-key.repo: getMeta() nikdy nevracia kľúč (D65, I1)', () => {
  it('vráti last4, časy a odpočet', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    const db = createFakeDb(encryptedRow(expiresAt));
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    const meta = await repo.getMeta();
    expect(meta.present).toBe(true);
    expect(meta.last4).toBe(API_KEY_PLAINTEXT.slice(-4));
    expect(meta.verifyStatus).toBe('valid');
    expect(meta.secondsLeft).toBeGreaterThan(3500);
    expect(JSON.stringify(meta)).not.toContain(API_KEY_PLAINTEXT);
    expect(Object.keys(meta)).not.toContain('ciphertext');
  });

  it('expirovaný kľúč hlási ako chýbajúci a wipne ho (D63)', async () => {
    const db = createFakeDb(encryptedRow(new Date(Date.now() - 1)));
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    const meta = await repo.getMeta();
    expect(meta).toEqual({
      present: false,
      last4: null,
      savedAt: null,
      expiresAt: null,
      secondsLeft: null,
      verifyStatus: null,
      lastUsedAt: null,
    });
    expect(db.audits.map((a) => a.eventType)).toEqual(['key_wiped']);
  });
});

describe('api-key.repo: setVerifyStatus a touchLastUsed', () => {
  it('setVerifyStatus zapíše status aj audit key_verified', async () => {
    const db = createFakeDb(encryptedRow(new Date(Date.now() + 3_600_000)));
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    await repo.setVerifyStatus('invalid');
    const update = db.queries.find((q) => q.sql.includes('verify_status = ?'));
    expect(update?.values[0]).toBe('invalid');
    expect(db.audits[0]?.eventType).toBe('key_verified');
    expect(db.audits[0]?.ok).toBe(false);
  });

  it('touchLastUsed aktualizuje len last_used_at', async () => {
    const db = createFakeDb(encryptedRow(new Date(Date.now() + 3_600_000)));
    const repo = createApiKeyRepo({ audit: db.audit, masterKey: MASTER_KEY, defaultConn: db.conn });

    await repo.touchLastUsed();
    const update = db.queries.find((q) => q.sql.includes('last_used_at = ?'));
    expect(update).toBeDefined();
    expect(db.audits).toHaveLength(0);
  });
});
