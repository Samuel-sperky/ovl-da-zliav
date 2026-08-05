/**
 * Aura Zľavy — repozitár singleton tabuľky `api_key` (BUILD-SPEC §3/§7, R2, D63–D65).
 *
 * Toto je JEDINÉ miesto v appke, kde sa API kľúč šifruje, dešifruje a maže.
 *
 * Invarianty držané tu:
 *  - I1  — plaintext kľúča neopustí `Buffer` vnútri `SecretHandle`; `getMeta()`
 *          vracia výhradne `last4` + časy (D65). Žiadna metóda nevracia
 *          ciphertext ani plaintext, žiadna chybová správa neobsahuje bajty kľúča.
 *  - D63 — TTL sa kontroluje LAZY pri každom prístupe (`getMeta`, `loadForUse`
 *          a znova pri každom dešifrovaní vnútri `SecretRef`). Wipe najprv
 *          PREPÍŠE ciphertext/iv/tag náhodnými bajtmi (`RANDOM_BYTES`), potom
 *          riadok ZMAŽE a nakoniec zapíše audit `key_wiped`.
 *  - D64 — nulová in-memory cache: každé volanie `SecretRef` znova čítá riadok
 *          z DB a znova dešifruje; po `release()` je buffer vynulovaný.
 *  - I4  — audit sa zapisuje VÝHRADNE cez `AuditWriter.appendAudit()` (A2).
 *          Tento súbor neobsahuje žiadny `INSERT INTO audit_log`.
 *  - I14 — chýbajúci/zlý master key = výnimka, nikdy „uložím to nešifrovane".
 *
 * Prepojenie na audit (A2) a logger (A2) je ZÁMERNE injektované cez
 * `configureApiKeyRepo()`: A1 nesmie zapisovať do cudzích súborov a v čase jeho
 * vlny `src/lib/audit/write.ts` ešte neexistuje. Kým sa wiring nespraví, wipe
 * a uloženie kľúča sa nestratia mlčky — vypíšu sa ako `audit_fallback` na stdout.
 */
import type {
  ApiKeyMeta,
  ApiKeyRepo,
  AuditActor,
  AuditEventType,
  AuditInput,
  AuditWriter,
  EncryptedSecret,
  KeyVerifyStatus,
  KeyWipeReason,
  Queryable,
  SecretRef,
  UtcDate,
} from '@/contracts';
import { withTransaction } from '@/db/tx';
import {
  createSecretHandle,
  decryptApiKey,
  encryptApiKey,
  wipeBuffer,
  type SecretBoxOptions,
} from '@/lib/crypto/secret-box';

/** Strop TTL podľa R2 — vyššiu hodnotu repozitár odmietne, nie zaokrúhli. */
export const API_KEY_MAX_TTL_HOURS = 48;

/** `api_key` je singleton (`CHECK (id = 1)`, §3). */
export const API_KEY_ROW_ID = 1;

export type ApiKeyErrorCode = 'bad_input' | 'unavailable' | 'expired';

export class ApiKeyError extends Error {
  readonly code: ApiKeyErrorCode;

  constructor(code: ApiKeyErrorCode, message: string) {
    super(message);
    this.name = 'ApiKeyError';
    this.code = code;
  }
}

/* ───────────────────────────── SQL (singleton) ─────────────────────────── */

const SQL_SELECT =
  'SELECT ciphertext, iv, auth_tag, key_version, last4, created_at, expires_at, ' +
  'verify_status, verified_at, last_used_at FROM api_key WHERE id = ?';

/**
 * Krok 1 wipe procedúry (D63) — prepis náhodnými bajtmi PRED zmazaním, aby sa
 * ciphertext nedal obnoviť z uvoľnených stránok tabuľky.
 */
const SQL_WIPE_OVERWRITE =
  'UPDATE api_key SET ciphertext = RANDOM_BYTES(LENGTH(ciphertext)), ' +
  'iv = RANDOM_BYTES(12), auth_tag = RANDOM_BYTES(16) WHERE id = ?';

const SQL_WIPE_DELETE = 'DELETE FROM api_key WHERE id = ?';

const SQL_INSERT =
  'INSERT INTO api_key (id, ciphertext, iv, auth_tag, key_version, last4, created_at, ' +
  'expires_at, verify_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

const SQL_SET_VERIFY = 'UPDATE api_key SET verify_status = ?, verified_at = ? WHERE id = ?';

const SQL_TOUCH_LAST_USED = 'UPDATE api_key SET last_used_at = ? WHERE id = ?';

/* ─────────────────────────────── DB riadok ─────────────────────────────── */

interface ApiKeyRow {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_version: number;
  last4: string;
  created_at: Date;
  expires_at: Date;
  verify_status: KeyVerifyStatus;
  verified_at: Date | null;
  last_used_at: Date | null;
}

interface WriteResult {
  affectedRows?: number;
}

const ABSENT_META: ApiKeyMeta = {
  present: false,
  last4: null,
  savedAt: null,
  expiresAt: null,
  secondsLeft: null,
  verifyStatus: null,
  lastUsedAt: null,
};

/* ─────────────────────────── injektovateľné okolie ─────────────────────── */

type MinimalLogger = {
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export interface ApiKeyRepoDeps {
  /** `appendAudit()` z `src/lib/audit/write.ts` (A2) — jediná cesta do `audit_log` (I4). */
  audit?: AuditWriter | null;
  logger?: MinimalLogger | null;
  /** Injektovateľný čas pre testy. */
  now?: () => Date;
  /** Výhradne pre testy: master key namiesto `MASTER_KEY_FILE`. */
  masterKey?: Buffer;
  /**
   * Výhradne pre testy: spojenie, ktoré sa použije namiesto `withTransaction()`
   * z poolu. Produkčný singleton ho NEMÁ — beží nad `src/db/tx.ts`.
   */
  defaultConn?: Queryable;
}

/**
 * Fallback audit: nikdy nemlčí. `appendAudit()` sa nesmie stať dôvodom
 * zlyhania wipe (rovnaká politika ako A2), preto len logujeme.
 */
function fallbackAudit(logger: MinimalLogger | null, input: AuditInput): void {
  const line = JSON.stringify({
    level: 'warn',
    msg: 'audit_fallback',
    detail:
      'AuditWriter nie je nakonfigurovaný (configureApiKeyRepo). Event sa NEZAPÍSAL do audit_log.',
    eventType: input.eventType,
    actor: input.actor,
    ok: input.ok ?? null,
    message: input.message ?? null,
    ts: new Date().toISOString(),
  });
  if (logger) logger.warn('audit_fallback', { eventType: input.eventType });
  else console.warn(line);
}

/* ─────────────────────────────── pomocníci ─────────────────────────────── */

function asRow(result: unknown): ApiKeyRow | null {
  if (!Array.isArray(result) || result.length === 0) return null;
  return result[0] as ApiKeyRow;
}

function affected(result: unknown): number {
  const value = (result as WriteResult | null)?.affectedRows;
  return typeof value === 'number' ? value : 0;
}

/** `last4` je JEDINÉ, čo smie ísť do UI (D65). Počíta sa z plaintextu, nie z UI. */
export function computeLast4(plain: Buffer): string {
  const text = plain.toString('utf8');
  return text.slice(-4).padStart(4, '*');
}

/** Wipe dôvod → audit event (§3, §7). Panic button má vlastný event (D67). */
export function auditEventForWipe(reason: KeyWipeReason): AuditEventType {
  return reason === 'panic_button' ? 'key_panic_wipe' : 'key_wiped';
}

function actorForWipe(reason: KeyWipeReason): AuditActor {
  switch (reason) {
    case 'panic_button':
    case 'replaced_by_new_key':
      return 'user';
    case 'ttl_expired':
      return 'scheduler';
    default:
      return 'system';
  }
}

/* ───────────────────────────────── factory ─────────────────────────────── */

/** Hook na doplnenie auditu/loggera po boote (viď `configureApiKeyRepo`). */
const configureHooks = new WeakMap<
  ApiKeyRepo,
  (deps: Pick<ApiKeyRepoDeps, 'audit' | 'logger'>) => void
>();

export interface ApiKeyRepository extends ApiKeyRepo {
  /** Nadstavba kontraktu: wipe s explicitným aktérom (route/scheduler, D67). */
  wipe(
    reason: KeyWipeReason,
    conn?: Queryable,
    context?: { actor?: AuditActor; userId?: number | null; message?: string },
  ): Promise<boolean>;
  /** Uloženie s aktérom pre audit `key_stored`. */
  store(
    plain: Buffer,
    last4: string,
    ttlHours: number,
    conn?: Queryable,
    context?: { userId?: number | null },
  ): Promise<{ expiresAt: UtcDate; last4: string }>;
}

export function createApiKeyRepo(deps: ApiKeyRepoDeps = {}): ApiKeyRepository {
  let audit = deps.audit ?? null;
  let logger = deps.logger ?? null;
  const now = deps.now ?? (() => new Date());
  const boxOptions: SecretBoxOptions = deps.masterKey ? { masterKey: deps.masterKey } : {};

  const runInTx = async <T>(
    conn: Queryable | undefined,
    fn: (conn: Queryable) => Promise<T>,
  ): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return fn(target);
    return withTransaction((tx) => fn(tx));
  };

  const writeAudit = async (input: AuditInput, conn?: Queryable): Promise<void> => {
    if (!audit) {
      fallbackAudit(logger, input);
      return;
    }
    try {
      await audit.appendAudit(input, conn);
    } catch (error) {
      // Audit nikdy nesmie zhodiť operáciu (politika A2) — ale ani zmiznúť.
      const message = error instanceof Error ? error.message : String(error);
      if (logger) logger.error('audit_write_failed', { eventType: input.eventType, message });
      else
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'audit_write_failed',
            eventType: input.eventType,
            detail: message,
            ts: new Date().toISOString(),
          }),
        );
    }
  };

  const selectRow = async (conn?: Queryable): Promise<ApiKeyRow | null> =>
    runInTx(conn, async (tx) => asRow(await tx.query(SQL_SELECT, [API_KEY_ROW_ID])));

  const isExpired = (row: ApiKeyRow): boolean => {
    const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
    return expiresAt.getTime() <= now().getTime();
  };

  /** Wipe procedúra v POŽADOVANOM poradí: prepis → DELETE → audit (D63). */
  const wipeWithConn = async (
    conn: Queryable,
    reason: KeyWipeReason,
    context?: { actor?: AuditActor; userId?: number | null; message?: string },
  ): Promise<boolean> => {
    const overwritten = affected(await conn.query(SQL_WIPE_OVERWRITE, [API_KEY_ROW_ID]));
    if (overwritten > 0) {
      await conn.query(SQL_WIPE_DELETE, [API_KEY_ROW_ID]);
    }

    // Pri panic buttone auditujeme aj vtedy, keď už nebolo čo mazať — operátor
    // stlačil panic a to sa MUSÍ objaviť v audite (D67, I4).
    if (overwritten > 0 || reason === 'panic_button') {
      await writeAudit(
        {
          actor: context?.actor ?? actorForWipe(reason),
          userId: context?.userId ?? null,
          eventType: auditEventForWipe(reason),
          ok: true,
          message: context?.message ?? reason,
        },
        conn,
      );
    }
    return overwritten > 0;
  };

  const repo: ApiKeyRepository = {
    async getMeta(conn?: Queryable): Promise<ApiKeyMeta> {
      const row = await selectRow(conn);
      if (row === null) return { ...ABSENT_META };

      // Lazy TTL kontrola aj tu (D63): expirovaný kľúč sa pre UI neexistuje
      // a rovno sa wipne — nečaká sa na tick schedulera.
      if (isExpired(row)) {
        await repo.wipe('ttl_expired');
        return { ...ABSENT_META };
      }

      const expiresAt =
        row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
      const savedAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
      const secondsLeft = Math.max(
        0,
        Math.floor((expiresAt.getTime() - now().getTime()) / 1000),
      );

      return {
        present: true,
        last4: row.last4,
        savedAt,
        expiresAt,
        secondsLeft,
        verifyStatus: row.verify_status,
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      };
    },

    /**
     * Uloží kľúč. Existujúci záznam sa najprv riadne wipne
     * (`replaced_by_new_key`, D63) — nikdy sa neprepisuje `UPDATE`-om.
     *
     * POZOR (D64): `plain` je po návrate VYNULOVANÝ. Volajúci ho už nesmie
     * použiť — plaintext má žiť najkratšie možný čas.
     */
    async store(plain, last4, ttlHours, conn?, context?) {
      if (!Buffer.isBuffer(plain) || plain.length === 0) {
        throw new ApiKeyError('bad_input', 'API kľúč musí byť neprázdny Buffer.');
      }
      if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > API_KEY_MAX_TTL_HOURS) {
        wipeBuffer(plain);
        throw new ApiKeyError(
          'bad_input',
          `TTL musí byť celé číslo 1–${API_KEY_MAX_TTL_HOURS} h (R2, ENV strop 48).`,
        );
      }

      // `last4` z UI je len kontrolná hodnota; smerodajný je plaintext (D65).
      const computed = computeLast4(plain);
      if (typeof last4 === 'string' && last4.length === 4 && last4 !== computed) {
        if (logger) logger.warn('api_key_last4_mismatch');
      }

      const record: EncryptedSecret = ((): EncryptedSecret => {
        try {
          return encryptApiKey(plain, boxOptions);
        } finally {
          // Plaintext v pamäti končí tu — nech sa stalo čokoľvek (D64, I1).
          wipeBuffer(plain);
        }
      })();

      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + ttlHours * 3_600_000);

      return runInTx(conn, async (tx) => {
        await wipeWithConn(tx, 'replaced_by_new_key', {
          actor: 'user',
          userId: context?.userId ?? null,
          message: 'nahradenie starého kľúča novým',
        });
        await tx.query(SQL_INSERT, [
          API_KEY_ROW_ID,
          record.ciphertext,
          record.iv,
          record.authTag,
          record.keyVersion,
          computed,
          createdAt,
          expiresAt,
          'unverified',
        ]);
        await writeAudit(
          {
            actor: 'user',
            userId: context?.userId ?? null,
            eventType: 'key_stored',
            ok: true,
            // Do auditu ide výhradne fakt a TTL — nikdy kľúč ani `last4` (I1).
            message: `API kľúč uložený, TTL ${ttlHours} h`,
          },
          tx,
        );
        return { expiresAt, last4: computed };
      });
    },

    /**
     * Lazy TTL kontrola (D63) + `SecretRef`, ktorý dešifruje až v momente
     * použitia (D64). Vracia `null`, keď kľúč nie je použiteľný — volajúci potom
     * ide do read-only režimu (D10) alebo kampaň do `needs_key`.
     */
    async loadForUse(): Promise<SecretRef | null> {
      const row = await selectRow();
      if (row === null) return null;
      if (isExpired(row)) {
        await repo.wipe('ttl_expired');
        return null;
      }

      // ŽIADNA cache (D64): `SecretRef` si riadok načíta znova pri každom volaní
      // a znova skontroluje TTL — medzi `loadForUse()` a zápisom mohlo TTL vypršať.
      return async () => {
        const fresh = await selectRow();
        if (fresh === null) {
          throw new ApiKeyError('unavailable', 'API kľúč už v DB nie je (bol wipnutý).');
        }
        if (isExpired(fresh)) {
          await repo.wipe('ttl_expired');
          throw new ApiKeyError('expired', 'API kľúč expiroval (TTL 48 h) — zadaj nový v UI (R2).');
        }
        return createSecretHandle(
          decryptApiKey(
            {
              ciphertext: fresh.ciphertext,
              iv: fresh.iv,
              authTag: fresh.auth_tag,
              keyVersion: fresh.key_version,
            },
            boxOptions,
          ),
        );
      };
    },

    async wipe(reason, conn?, context?) {
      return runInTx(conn, (tx) => wipeWithConn(tx, reason, context));
    },

    async setVerifyStatus(status: KeyVerifyStatus, conn?: Queryable): Promise<void> {
      await runInTx(conn, async (tx) => {
        const result = await tx.query(SQL_SET_VERIFY, [status, now(), API_KEY_ROW_ID]);
        if (affected(result) === 0) return;
        await writeAudit(
          {
            actor: 'user',
            eventType: 'key_verified',
            ok: status === 'valid',
            message: `verify_status=${status}`,
          },
          tx,
        );
      });
    },

    async touchLastUsed(conn?: Queryable): Promise<void> {
      await runInTx(conn, async (tx) => {
        await tx.query(SQL_TOUCH_LAST_USED, [now(), API_KEY_ROW_ID]);
      });
    },
  };

  /** Dodatočný wiring po boote (A2 audit + logger). */
  const configure = (next: Pick<ApiKeyRepoDeps, 'audit' | 'logger'>): void => {
    if (next.audit !== undefined) audit = next.audit;
    if (next.logger !== undefined) logger = next.logger;
  };
  configureHooks.set(repo, configure);

  return repo;
}

/** Singleton pre route-y, engine a scheduler. */
export const apiKeyRepo: ApiKeyRepository = createApiKeyRepo();

/**
 * Doplní audit writer a logger singletonu. MUSÍ sa zavolať pri boote, hneď ako
 * je `src/lib/audit/write.ts` (A2) k dispozícii:
 *
 * ```ts
 * configureApiKeyRepo({ audit: { appendAudit }, logger });
 * ```
 *
 * Bez toho sa audit `key_wiped` / `key_stored` nezapíše do `audit_log` a len sa
 * zaloguje ako `audit_fallback` (viď hlavička súboru).
 */
export function configureApiKeyRepo(
  deps: Pick<ApiKeyRepoDeps, 'audit' | 'logger'>,
  target: ApiKeyRepo = apiKeyRepo,
): void {
  configureHooks.get(target)?.(deps);
}
