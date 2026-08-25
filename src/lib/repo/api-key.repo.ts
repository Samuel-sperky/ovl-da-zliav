/**
 * Aura Zľavy — repozitár tabuľky `api_key` (BUILD-SPEC §3/§7, R2, D63–D65).
 *
 * Toto je JEDINÉ miesto v appke, kde sa API kľúč šifruje, dešifruje a maže.
 *
 * P5 (KONTRAKT-PREDAJNOST-2026-08-06): tabuľka drží najviac JEDEN záznam NA
 * DRUH kľúča (`kind` = `shop_write` | `orders_read`, UNIQUE na `kind`, migrácia
 * 0009). Repozitár je preto parametrizovaný druhom: `createApiKeyRepo({ kind })`
 * vracia inštanciu, ktorá vidí VÝHRADNE svoj druh. Cesta pre šifrovanie, TTL,
 * `last4`, `verify_status`, audit a wipe je pritom JEDNA a spoločná — presne
 * preto, aby sa zákaz logovania (I1) aj panic wipe (D63, D67) vzťahovali na oba
 * kľúče automaticky, bez druhej neotestovanej cesty.
 *
 * Dôsledok, ktorý je vedomý a testovaný: `wipe('panic_button')` maže OBA druhy
 * naraz (viď `wipeWithConn`). Panic button znamená „kľúč unikol" — v tej chvíli
 * nesmie v appke zostať žiadny kľúč, ani ten, ktorého sa incident „netýkal".
 * Wipe z iného dôvodu (TTL, 401/403, rotácia) sa naopak drží výhradne svojho
 * druhu: expirovaný shop kľúč nesmie zhodiť platný objednávkový a naopak.
 *
 * SCOPES KĽÚČA (API v5, bod D3)
 * -----------------------------
 * Od v5 vie shop cez `GET /api/whoami` povedať, aké scopes kľúč má. Repozitár
 * si posledný známy zoznam pamätá, aby sa appka nemusela pýtať shopu pri každom
 * zobrazení obrazovky. Pamäť je ZÁMERNE len v procese (`SCOPE_MEMORY`), nie
 * v DB: pridať stĺpec znamená migráciu a scopes sú údaj, ktorý sa dá kedykoľvek
 * znova zistiť. Cena je známa a je to tá správna strana omylu — po reštarte
 * appka scopes nepozná a povie „nevieme" (`null`), nikdy si nedomyslí, že ich má.
 *
 * Do pamäti ide VÝHRADNE uzavretý číselník produktových scopes (`product:read`,
 * `product:edit`) — nikdy `id`, `name` ani `owner` z `whoami`. Z tých by sa dalo
 * odvodiť, ktorý kľúč je v appke uložený (I1).
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
 * Prepojenie na audit (A2) a logger (A2) sa dá injektovať cez
 * `configureApiKeyRepo()`, ale repozitár sa naň UŽ NESPOLIEHA: `configureApiKeyRepo()`
 * volá výhradne `src/instrumentation-node.ts` a Next.js kompiluje instrumentation
 * do VLASTNÉHO module grafu, takže nakonfigurovaný singleton NIE JE ten, ktorý
 * vidia route handlery. Audit si preto repozitár dotiahne sám (`resolveAudit()`)
 * a rovnako aj logger (`resolveLogger()`). Bez toho bolo `if (logger)` v produkcii
 * VŽDY `false`: `audit_fallback`, `audit_write_failed` aj `api_key_last4_mismatch`
 * padali do `console.*`, teda MIMO centrálneho redaktora (I1) — a `last4 mismatch`
 * sa nezobrazilo nikde.
 *
 * TRETIA VRSTVA REDAKTORA (§6, D66, I1)
 * -------------------------------------
 * Substring scan redaktora na hodnotu kľúča vie zapnúť JEDINE tento súbor — je
 * jediné miesto, kde plaintext kľúča existuje. Preto sa `setScanSecretForOwner()`
 * volá pri `store()` (hneď po INSERTe), pri `loadForUse()` (hneď po TTL kontrole,
 * teda skôr, než sa kľúč vôbec dostane na drôt) a `clearScanSecrets()` /
 * `setScanSecretForOwner(kind, null)` pri wipe. Kým sa to nevolalo, vrstva 3
 * nikdy nebežala a `redaction_hit` sa nemohol vyvolať ani raz.
 *
 * Vlastníkom scanu je DRUH kľúča, nie inštancia: appka drží dva kľúče naraz
 * (P5) a jediný slot v redaktore by znamenal, že načítanie jedného zhasne alarm
 * druhému.
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
// Logger a redaktor sú tu STATICKY: `lib/log/logger.ts` závisí len na
// `contracts`, `lib/log/redact.ts` a `version`, takže cyklus nevzniká (na rozdiel
// od `lib/audit/write.ts`, ktoré sa preto ťahá dynamicky v `resolveAudit()`).
import { logger as defaultLogger } from '@/lib/log/logger';
import { clearScanSecrets, redactString, setScanSecretForOwner } from '@/lib/log/redact';
// Typ scopes je len typ (`import type` — žiadna runtime závislosť repozitára na
// klientovi shopu). Číselník vlastní `shop/client.ts`, lebo tam sa odpoveď
// `whoami` parsuje; repozitár si ho len pamätá.
import type { ShopScope } from '@/lib/shop/client';

/**
 * Druh kľúča (migrácia 0009, P5). Typ žije TU, nie v `src/contracts.ts` —
 * kontrakty vlastní iný agent a repozitár si svoj vstup musí vedieť opísať sám.
 */
export type ApiKeyKind = 'shop_write' | 'orders_read';

/** Poradie je normatívne pre panic wipe a pre UI (zápisový kľúč je prvý). */
export const API_KEY_KINDS: readonly ApiKeyKind[] = ['shop_write', 'orders_read'];

/** Default druh — kód, ktorý o druhoch nevie, hovorí o zápisovom kľúči do shopu. */
export const DEFAULT_API_KEY_KIND: ApiKeyKind = 'shop_write';

/** Strop TTL podľa R2 — vyššiu hodnotu repozitár odmietne, nie zaokrúhli. */
export const API_KEY_MAX_TTL_HOURS = 48;

/**
 * Strop TTL objednávkového kľúča (P2): 90 dní, teda strop premennej
 * `ORDERS_KEY_TTL_DAYS` (default 30 dní). Je to VEDOMÁ odchýlka od 48 h (R2/D69)
 * odôvodnená tým, že kľúč je len na čítanie a nevidí osobné údaje; panic button
 * ho maže kedykoľvek a TTL je viditeľné v UI.
 */
export const ORDERS_KEY_MAX_TTL_HOURS = 90 * 24;

/** Strop TTL podľa druhu kľúča (R2 pre zápis, P2 pre objednávky). */
export function maxTtlHoursForKind(kind: ApiKeyKind): number {
  return kind === 'orders_read' ? ORDERS_KEY_MAX_TTL_HOURS : API_KEY_MAX_TTL_HOURS;
}

/**
 * Kým bola `api_key` singleton (`CHECK (id = 1)`, §3), riadok mal pevné `id = 1`.
 * Migrácia 0009 CHECK zhodila a `id` je AUTO_INCREMENT — identita riadku je od
 * vtedy `kind` (UNIQUE), nie `id`. Konštanta zostáva len pre spätnú
 * kompatibilitu volajúcich; repozitár ju NEPOUŽÍVA.
 *
 * @deprecated Vyberaj podľa `kind`, nie podľa `id`.
 */
export const API_KEY_ROW_ID = 1;

/* ─────────────────────── scopes kľúča (v5, bod D3) ─────────────────────── */

/**
 * Posledné známe scopes kľúča daného druhu.
 *
 * `scopes: null` znamená **NEVIEME** — kľúč sa od štartu appky neoveroval,
 * `whoami` sa nedalo prečítať, alebo bol kľúč vymenený či wipnutý. Prázdne pole
 * je niečo iné: shop povedal, že kľúč nemá ani jeden scope. Volajúci MUSÍ tie
 * dva stavy rozlíšiť, inak by z „nevieme" spravil „nemá" a poslal používateľa
 * pýtať si kľúč, ktorý už dávno má.
 */
export interface KeyScopeMemory {
  readonly scopes: readonly ShopScope[] | null;
  readonly checkedAt: Date | null;
}

const SCOPES_UNKNOWN: KeyScopeMemory = { scopes: null, checkedAt: null };

/**
 * Pamäť scopes je na úrovni MODULU, nie inštancie, z jediného dôvodu:
 * `wipe('panic_button')` maže kľúče všetkých druhov jedným príkazom a musí
 * vedieť zabudnúť aj scopes všetkých druhov. Keby si každá inštancia držala
 * svoju, panic button by po sebe nechal scopes toho druhého kľúča.
 */
const SCOPE_MEMORY = new Map<ApiKeyKind, KeyScopeMemory>();

/** Výhradne pre testy — pamäť scopes prežíva medzi inštanciami repozitára. */
export function resetKeyScopeMemory(): void {
  SCOPE_MEMORY.clear();
}

export type ApiKeyErrorCode = 'bad_input' | 'unavailable' | 'expired';

export class ApiKeyError extends Error {
  readonly code: ApiKeyErrorCode;

  constructor(code: ApiKeyErrorCode, message: string) {
    super(message);
    this.name = 'ApiKeyError';
    this.code = code;
  }
}

/* ─────────────────────────── SQL (jeden riadok na druh) ────────────────── */

const SQL_SELECT =
  'SELECT ciphertext, iv, auth_tag, key_version, last4, created_at, expires_at, ' +
  'verify_status, verified_at, last_used_at FROM api_key WHERE kind = ?';

/**
 * Krok 1 wipe procedúry (D63) — prepis náhodnými bajtmi PRED zmazaním, aby sa
 * ciphertext nedal obnoviť z uvoľnených stránok tabuľky.
 */
const SQL_WIPE_OVERWRITE =
  'UPDATE api_key SET ciphertext = RANDOM_BYTES(LENGTH(ciphertext)), ' +
  'iv = RANDOM_BYTES(12), auth_tag = RANDOM_BYTES(16) WHERE kind = ?';

const SQL_WIPE_DELETE = 'DELETE FROM api_key WHERE kind = ?';

/**
 * Panic wipe (D67) ide zámerne BEZ filtra na `kind` — jediným príkazom prepíše
 * a zmaže VŠETKY kľúče. Keby sa mazalo v cykle po druhoch, pridanie tretieho
 * druhu by panic button tichým opomenutím obišlo.
 */
const SQL_WIPE_OVERWRITE_ALL =
  'UPDATE api_key SET ciphertext = RANDOM_BYTES(LENGTH(ciphertext)), ' +
  'iv = RANDOM_BYTES(12), auth_tag = RANDOM_BYTES(16)';

const SQL_WIPE_DELETE_ALL = 'DELETE FROM api_key';

/** Ktoré druhy práve existujú — kvôli auditu wipe za každý z nich (I4). */
const SQL_SELECT_KINDS = 'SELECT kind FROM api_key';

/**
 * `id` je od migrácie 0009 AUTO_INCREMENT, identitou riadku je `kind`. Poradie
 * ostatných hodnôt sa ZÁMERNE nemení (testy A1 kontrolujú pozície).
 */
const SQL_INSERT =
  'INSERT INTO api_key (kind, ciphertext, iv, auth_tag, key_version, last4, created_at, ' +
  'expires_at, verify_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

const SQL_SET_VERIFY = 'UPDATE api_key SET verify_status = ?, verified_at = ? WHERE kind = ?';

const SQL_TOUCH_LAST_USED = 'UPDATE api_key SET last_used_at = ? WHERE kind = ?';

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
  /**
   * Druh kľúča, ktorý inštancia vidí (P5). Default `shop_write`, aby sa chovanie
   * existujúcich volajúcich nezmenilo ani o čiarku.
   */
  kind?: ApiKeyKind;
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
 * Posledná záchrana, keď logger nie je k dispozícii (volajúci ho vypol cez
 * `logger: null`). `console.*` NEPRECHÁDZA centrálnym redaktorom, preto sa
 * riadok prežene `redactString()` — inak by táto vetva bola jediná cesta
 * v appke, ktorá obchádza I1.
 */
function consoleFallback(level: 'warn' | 'error', payload: Record<string, unknown>): void {
  const line = redactString(JSON.stringify({ ...payload, ts: new Date().toISOString() }));
  if (level === 'error') console.error(line);
  else console.warn(line);
}

/**
 * Fallback audit: nikdy nemlčí. `appendAudit()` sa nesmie stať dôvodom
 * zlyhania wipe (rovnaká politika ako A2), preto len logujeme.
 */
function fallbackAudit(logger: MinimalLogger | null, input: AuditInput): void {
  if (logger) {
    logger.warn('audit_fallback', { eventType: input.eventType });
    return;
  }
  consoleFallback('warn', {
    level: 'warn',
    msg: 'audit_fallback',
    detail:
      'AuditWriter nie je nakonfigurovaný (configureApiKeyRepo). Event sa NEZAPÍSAL do audit_log.',
    eventType: input.eventType,
    actor: input.actor,
    ok: input.ok ?? null,
    message: input.message ?? null,
  });
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
  /**
   * Druh, ktorý táto inštancia vidí (P5). Voliteľné zámerne: in-memory fakes
   * kontraktu v testoch druh nepoznajú a nemusia — vždy hovoria o zápisovom kľúči.
   */
  readonly kind?: ApiKeyKind;
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
  /**
   * Zapamätá si scopes, ktoré shop ohlásil cez `whoami` (v5, bod D3).
   *
   * Metódy sú NEPOVINNÉ zámerne: kontrakt `ApiKeyRepo` (A0) o scopes nevie
   * a in-memory fakes v cudzích testoch ich neimplementujú. Volajúci si preto
   * musí poradiť aj s tým, že tam nie sú — a „nie sú" znamená to isté ako
   * `null`, teda „nevieme".
   */
  rememberScopes?(scopes: readonly ShopScope[]): void;
  /** Posledné známe scopes; `{scopes: null}` = nevieme. */
  recallScopes?(): KeyScopeMemory;
  /** Zabudne scopes tohto druhu (kľúč sa vymenil alebo zmizol). */
  forgetScopes?(): void;
}

export function createApiKeyRepo(deps: ApiKeyRepoDeps = {}): ApiKeyRepository {
  const kind: ApiKeyKind = deps.kind ?? DEFAULT_API_KEY_KIND;
  const maxTtlHours = maxTtlHoursForKind(kind);
  let audit = deps.audit ?? null;
  /**
   * `audit` uvedený explicitne (aj ako `null`) = volajúci si audit riadi sám
   * (testy). Keď kľúč `audit` v `deps` vôbec nie je, repo si writer dotiahne
   * sám — viď `resolveAudit()`.
   */
  const auditExplicit = 'audit' in deps;
  let logger = deps.logger ?? null;
  /** To isté pravidlo ako pri audite: explicitný `logger` (aj `null`) je rozkaz. */
  const loggerExplicit = 'logger' in deps;
  const now = deps.now ?? (() => new Date());
  const boxOptions: SecretBoxOptions = deps.masterKey ? { masterKey: deps.masterKey } : {};

  /**
   * Logger PRE PRODUKČNÝ SINGLETON — rovnaká záchrana ako `resolveAudit()`.
   *
   * `configureApiKeyRepo()` volá len boot (`src/instrumentation-node.ts`), ktorý
   * je v inom module grafe než route handlery, takže `logger` v singletone
   * zostával `null` a všetky vetvy `if (logger)` boli mŕtve. Import je statický
   * (žiadny cyklus), takže riešenie je synchrónne a nemôže sa „nestihnúť".
   */
  const resolveLogger = (): MinimalLogger | null => {
    if (loggerExplicit) return logger;
    if (logger === null) logger = defaultLogger;
    return logger;
  };

  /**
   * Zapne 3. vrstvu redaktora (§6, D66) na plaintext kľúča tohto druhu.
   *
   * Plaintext sa tu mení na `string` VÝHRADNE preto, aby ho redaktor vedel
   * rozpoznať v už serializovanom texte (viď `lib/log/redact.ts`) — nikam sa
   * neloguje, nevracia ani neukladá. Zlyhanie redaktora NESMIE zhodiť prácu
   * s kľúčom, preto `try`.
   */
  const armRedactionScan = (plain: Buffer): void => {
    try {
      setScanSecretForOwner(kind, plain.toString('utf8'));
    } catch {
      // Redaktor je obrana, nie dôvod pádu; `getRedactionState()` to prizná.
    }
  };

  /**
   * To isté, ale zo zašifrovaného riadku — používa `loadForUse()`, ktorý sám
   * o sebe nedešifruje (D64). Buffer sa hneď nuluje; kľúč prežije len ako
   * `string` v redaktore, presne ako pri `store()`.
   */
  const armRedactionScanFromRow = (row: ApiKeyRow): void => {
    let plain: Buffer | null = null;
    try {
      plain = decryptApiKey(
        {
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.auth_tag,
          keyVersion: row.key_version,
        },
        boxOptions,
      );
      armRedactionScan(plain);
    } catch {
      // Nedešifrovateľný kľúč aj tak nie je použiteľný — scan sa nezapne
      // a volajúci narazí na tú istú chybu pri skutočnom použití.
    } finally {
      if (plain) wipeBuffer(plain);
    }
  };

  const runInTx = async <T>(
    conn: Queryable | undefined,
    fn: (conn: Queryable) => Promise<T>,
  ): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return fn(target);
    return withTransaction((tx) => fn(tx));
  };

  /**
   * Lazy dotiahnutie skutočného `AuditWriter`-a (A2) pre PRODUKČNÝ singleton.
   *
   * Prečo: `configureApiKeyRepo()` sa dá zavolať len z boot kódu
   * (`src/instrumentation-node.ts`), ale Next.js kompiluje instrumentation do
   * VLASTNÉHO module grafu — singleton, ktorý nakonfiguruje boot, NIE JE ten
   * istý objekt, aký vidia route handlery. Dôsledok bol, že `key_stored`,
   * `key_verified`, `key_wiped` ani `key_panic_wipe` sa NIKDY nezapísali do
   * `audit_log` a len sa logoval `audit_fallback` (pri panic buttone teda
   * neexistoval trvalý dôkaz o wipe — D67, I4).
   *
   * `import()` je dynamický zámerne: statický import by v čase A1 vytvoril
   * cyklus (A2 vtedy neexistoval). Jediná cesta do `audit_log` zostáva
   * `appendAudit()` z A2 (I4) — tu sa len získa referencia na ňu.
   */
  const resolveAudit = async (): Promise<void> => {
    if (audit || auditExplicit) return;
    try {
      const mod = await import('@/lib/audit/write');
      audit = mod.auditWriter;
    } catch {
      // Zostáva `fallbackAudit()` — audit nikdy nemlčí.
    }
  };

  const writeAudit = async (input: AuditInput, conn?: Queryable): Promise<void> => {
    await resolveAudit();
    if (!audit) {
      fallbackAudit(resolveLogger(), input);
      return;
    }
    try {
      await audit.appendAudit(input, conn);
    } catch (error) {
      // Audit nikdy nesmie zhodiť operáciu (politika A2) — ale ani zmiznúť.
      const message = error instanceof Error ? error.message : String(error);
      const log = resolveLogger();
      if (log) log.error('audit_write_failed', { eventType: input.eventType, message });
      else
        consoleFallback('error', {
          level: 'error',
          msg: 'audit_write_failed',
          eventType: input.eventType,
          detail: message,
        });
    }
  };

  const selectRow = async (conn?: Queryable): Promise<ApiKeyRow | null> =>
    runInTx(conn, async (tx) => asRow(await tx.query(SQL_SELECT, [kind])));

  /**
   * Druhy, ktoré v tabuľke práve existujú. Používa to len panic wipe, aby vedel
   * zapísať audit za KAŽDÝ zmazaný kľúč (I4) — sám o sebe nič nemaže.
   */
  const selectPresentKinds = async (conn: Queryable): Promise<ApiKeyKind[]> => {
    const result = await conn.query(SQL_SELECT_KINDS, []);
    if (!Array.isArray(result)) return [];
    return result.map((row) => {
      const value = (row as { kind?: unknown }).kind;
      // Fallback pre riadky z čias pred migráciou 0009 (stĺpec ešte nebol).
      return value === 'orders_read' ? 'orders_read' : 'shop_write';
    });
  };

  const isExpired = (row: ApiKeyRow): boolean => {
    const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
    return expiresAt.getTime() <= now().getTime();
  };

  /**
   * Wipe procedúra v POŽADOVANOM poradí: prepis → DELETE → audit (D63).
   *
   * `panic_button` je jediný dôvod, ktorý prekračuje hranicu druhu: maže VŠETKY
   * kľúče (D67, akceptačné kritérium 3 kontraktu) a zapíše audit za každý
   * skutočne zmazaný druh. Ostatné dôvody sa držia druhu tejto inštancie.
   */
  const wipeWithConn = async (
    conn: Queryable,
    reason: KeyWipeReason,
    context?: { actor?: AuditActor; userId?: number | null; message?: string },
  ): Promise<boolean> => {
    const allKinds = reason === 'panic_button';
    // Pri panic wipe treba vedieť, čo v tabuľke bolo, EŠTE pred zmazaním.
    const wipedKinds = allKinds ? await selectPresentKinds(conn) : [];

    // Scopes patria kľúču, nie druhu — s kľúčom teda musia zmiznúť, a to aj
    // vtedy, keď už nebolo čo mazať. Inak by si appka po wipe ďalej myslela,
    // že „kľúč má product:read", hoci žiadny kľúč nemá.
    if (allKinds) SCOPE_MEMORY.clear();
    else SCOPE_MEMORY.delete(kind);

    const overwritten = affected(
      allKinds
        ? await conn.query(SQL_WIPE_OVERWRITE_ALL, [])
        : await conn.query(SQL_WIPE_OVERWRITE, [kind]),
    );
    if (overwritten > 0) {
      if (allKinds) await conn.query(SQL_WIPE_DELETE_ALL, []);
      else await conn.query(SQL_WIPE_DELETE, [kind]);
    }

    // 3. vrstva redaktora: kľúč, ktorý už neexistuje, netreba skenovať (D66).
    // Odzbrojuje sa AŽ po zmazaní — keby wipe zlyhal, scan zostane zapnutý
    // a redaktor bude maskovať navyše. To je tá správna strana omylu.
    // Panic wipe (D67) zhasína scan VŠETKÝCH druhov, presne ako SCOPE_MEMORY.
    if (allKinds) clearScanSecrets();
    else setScanSecretForOwner(kind, null);

    const baseMessage = context?.message ?? reason;
    const auditEntry = (message: string) => ({
      actor: context?.actor ?? actorForWipe(reason),
      userId: context?.userId ?? null,
      eventType: auditEventForWipe(reason),
      ok: true,
      // Do auditu ide dôvod a druh kľúča — nikdy kľúč ani `last4` (I1).
      message,
    });

    if (overwritten > 0 && wipedKinds.length > 0) {
      // Panic: jeden audit event za KAŽDÝ zmazaný kľúč, aby bol v audite dôkaz
      // o oboch (a nie jeden riadok, z ktorého sa nedá zistiť, čo zmizlo).
      for (const wipedKind of wipedKinds) {
        await writeAudit(auditEntry(`${baseMessage} [kind=${wipedKind}]`), conn);
      }
      return true;
    }

    // Pri panic buttone auditujeme aj vtedy, keď už nebolo čo mazať — operátor
    // stlačil panic a to sa MUSÍ objaviť v audite (D67, I4).
    if (overwritten > 0 || reason === 'panic_button') {
      await writeAudit(auditEntry(baseMessage), conn);
    }
    return overwritten > 0;
  };

  const repo: ApiKeyRepository = {
    kind,

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
      if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > maxTtlHours) {
        wipeBuffer(plain);
        throw new ApiKeyError(
          'bad_input',
          kind === 'orders_read'
            ? `TTL musí byť celé číslo 1–${maxTtlHours} h (P2, strop ORDERS_KEY_TTL_DAYS 90 dní).`
            : `TTL musí byť celé číslo 1–${maxTtlHours} h (R2, ENV strop 48).`,
        );
      }

      // `last4` z UI je len kontrolná hodnota; smerodajný je plaintext (D65).
      const computed = computeLast4(plain);
      if (typeof last4 === 'string' && last4.length === 4 && last4 !== computed) {
        // Varovanie MUSÍ byť niekde vidieť: znamená, že to, čo appka ukáže
        // používateľovi ako „posledné 4 znaky", nesedí s tým, čo naozaj uloží.
        // Do polí NEJDE ani jedna z tých hodnôt (I1) — stačí druh kľúča.
        const log = resolveLogger();
        if (log) log.warn('api_key_last4_mismatch', { kind });
        else consoleFallback('warn', { level: 'warn', msg: 'api_key_last4_mismatch', kind });
      }

      /**
       * Kľúč pre 3. vrstvu redaktora (§6) sa musí odložiť PRED zašifrovaním —
       * `encryptApiKey()` buffer vzápätí vynuluje. Scan sa ale zapne až po
       * INSERTe: `wipeWithConn('replaced_by_new_key')` nižšie ho vzápätí zhasína.
       */
      const plaintextForScan = plain.toString('utf8');

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
          kind,
          record.ciphertext,
          record.iv,
          record.authTag,
          record.keyVersion,
          computed,
          createdAt,
          expiresAt,
          'unverified',
        ]);
        // Alarm sa zapína EŠTE PRED prvým auditným zápisom — `writeAudit()` už
        // ide cez redaktor s aktívnou 3. vrstvou (§6, D66, I1).
        setScanSecretForOwner(kind, plaintextForScan);
        await writeAudit(
          {
            actor: 'user',
            userId: context?.userId ?? null,
            eventType: 'key_stored',
            ok: true,
            // Do auditu ide výhradne fakt, druh a TTL — nikdy kľúč ani `last4` (I1).
            message: `API kľúč uložený, TTL ${ttlHours} h [kind=${kind}]`,
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

      /**
       * TU sa zapína 3. vrstva redaktora (§6, D66, I1).
       *
       * Prečo už tu a nie až vnútri `SecretRef`: od tejto chvíle je kľúč
       * „vydaný na použitie" a všetko, čo volajúci od teraz zaloguje (chybová
       * hláška knižnice, `nonJsonBody` z `shop/client.ts`, hláška z `mariadb`),
       * má byť pod alarmom — vrátane cesty, kde volajúci `SecretRef` nakoniec
       * ani nezavolá, lebo predtým spadol.
       *
       * Cena je jedno dešifrovanie navyše. NIE JE to porušenie D64 (nulová
       * cache): buffer sa hneď nuluje a plaintext prežije len ako `string`
       * v redaktore, čo je presne to, čo `redact.ts` na svoju prácu potrebuje.
       */
      armRedactionScanFromRow(row);

      // ŽIADNA cache (D64): `SecretRef` si riadok načíta znova pri každom volaní
      // a znova skontroluje TTL — medzi `loadForUse()` a zápisom mohlo TTL vypršať.
      return async () => {
        const fresh = await selectRow();
        if (fresh === null) {
          throw new ApiKeyError('unavailable', 'API kľúč už v DB nie je (bol wipnutý).');
        }
        if (isExpired(fresh)) {
          await repo.wipe('ttl_expired');
          throw new ApiKeyError(
            'expired',
            `API kľúč expiroval (TTL ${maxTtlHours} h) — zadaj nový v UI (R2, P2).`,
          );
        }
        const plain = decryptApiKey(
          {
            ciphertext: fresh.ciphertext,
            iv: fresh.iv,
            authTag: fresh.auth_tag,
            keyVersion: fresh.key_version,
          },
          boxOptions,
        );
        // Riadok sa medzitým mohol vymeniť (rotácia kľúča) — alarm musí strážiť
        // ten kľúč, ktorý sa práve ide použiť. Dešifrované je aj tak, takže
        // toto je zadarmo.
        armRedactionScan(plain);
        return createSecretHandle(plain);
      };
    },

    async wipe(reason, conn?, context?) {
      return runInTx(conn, (tx) => wipeWithConn(tx, reason, context));
    },

    async setVerifyStatus(status: KeyVerifyStatus, conn?: Queryable): Promise<void> {
      await runInTx(conn, async (tx) => {
        const result = await tx.query(SQL_SET_VERIFY, [status, now(), kind]);
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
        await tx.query(SQL_TOUCH_LAST_USED, [now(), kind]);
      });
    },

    /**
     * Zapíše scopes z `whoami` (v5, bod D3). Zoznam sa kopíruje a zmrazí —
     * volajúci nesmie po odovzdaní pamäť repozitára meniť.
     */
    rememberScopes(scopes: readonly ShopScope[]): void {
      SCOPE_MEMORY.set(kind, {
        scopes: Object.freeze([...scopes]),
        checkedAt: now(),
      });
    },

    recallScopes(): KeyScopeMemory {
      return SCOPE_MEMORY.get(kind) ?? SCOPES_UNKNOWN;
    },

    forgetScopes(): void {
      SCOPE_MEMORY.delete(kind);
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

/**
 * Singleton ZÁPISOVÉHO kľúča (`product:edit`) pre route-y, engine a scheduler.
 *
 * I8' bod 4: `setReduction` volá výhradne `src/lib/engine/executor.ts` a výhradne
 * týmto singletonom. Objednávkový kľúč sa k zápisu nedostane ani omylom —
 * inštancia nižšie vidí v SQL výhradne `kind = 'orders_read'`.
 */
export const apiKeyRepo: ApiKeyRepository = createApiKeyRepo();

/**
 * Singleton OBJEDNÁVKOVÉHO kľúča (`orders:read`, P2/P5). Používa ho `/api/key`
 * a synchronizácia predajov — NIKDY zápisová cesta.
 */
export const ordersKeyRepo: ApiKeyRepository = createApiKeyRepo({ kind: 'orders_read' });

/** Repozitár podľa druhu — jediné miesto, kde sa druh mapuje na inštanciu. */
export function apiKeyRepoForKind(kind: ApiKeyKind): ApiKeyRepository {
  return kind === 'orders_read' ? ordersKeyRepo : apiKeyRepo;
}

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
 *
 * Bez explicitného `target` sa nakonfigurujú OBA singletony — inak by
 * objednávkový kľúč mal audit len vo fallbacku (P5: jedna cesta pre oba).
 */
export function configureApiKeyRepo(
  deps: Pick<ApiKeyRepoDeps, 'audit' | 'logger'>,
  target?: ApiKeyRepo,
): void {
  if (target) {
    configureHooks.get(target)?.(deps);
    return;
  }
  configureHooks.get(apiKeyRepo)?.(deps);
  configureHooks.get(ordersKeyRepo)?.(deps);
}
