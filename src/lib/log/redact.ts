/**
 * Aura Zľavy — CENTRÁLNY REDAKTOR (BUILD-SPEC §6 „Korelácia a redakcia", D66, I1).
 *
 * Toto je jediná obrana invariantu I1: „API kľúč nikdy v repe, logoch, audite
 * ani v UI." Prechádza ním KAŽDÝ prevádzkový log (`lib/log/logger.ts`) a KAŽDÝ
 * zápis do `audit_log` (`lib/audit/write.ts`) — bez vypínateľného flagu.
 *
 * Tri vrstvy obrany:
 *   1. **Denylist mien polí a hlavičiek** — `authorization`, `x-api-key`,
 *      `cookie` a polia `apiKey`/`api_key`/`key`/`token`/`password`/`secret`
 *      v ĽUBOVOĽNEJ hĺbke vnorenia, vrátane polí (arrays), `Map`, `Set`
 *      a `Headers`.
 *   2. **Inline scan textu** — hodnota v serializovanom tvare
 *      (`Authorization: Bearer …`, `?api_key=…`) sa maskuje aj vtedy, keď je
 *      zaliata v jednom stringu (raw odpoveď, stacktrace, curl príkaz).
 *   3. **Substring scan na aktuálny kľúč** — `setActiveSecretForScan()` uloží
 *      aktuálne použitý kľúč; ak sa on alebo jeho posledných 8 znakov objaví
 *      kdekoľvek v serializovanom výstupe, redaktor ho nahradí a nahlási
 *      `redaction_hit` (§6).
 *
 * Fail-closed pravidlá:
 *   - binárne dáta (`Buffer`, `Uint8Array`) sa NIKDY neserializujú — vracia sa
 *     len ich veľkosť (plaintext kľúč žije práve v `Buffer`, D64),
 *   - pri prekročení maximálnej hĺbky sa vracia `***TRUNCATED***`, nie originál,
 *   - vstup sa NIKDY nemutuje; vracia sa nová štruktúra.
 *
 * Vlastník: A2. Súbor nemá žiadnu závislosť na DB, ENV ani na loggeri (aby ho
 * vedel použiť aj boot kód a aby nevznikol cyklický import) — hlásenie
 * `redaction_hit` ide cez sink, ktorý si `logger.ts` zaregistruje sám.
 */
import type { Redactor, RedactorModule } from '@/contracts';

/* ════════════════════════════ 1. Konštanty ════════════════════════════════ */

/** Maska, ktorou sa nahrádza všetko citlivé. */
export const REDACTED = '***REDACTED***';

/** Maska pri prekročení hĺbky vnorenia (fail-closed — originál sa nevracia). */
export const TRUNCATED = '***TRUNCATED***';

/** Maximálna hĺbka rekurzie. Hlbšie štruktúry sú maskované, nie prepustené. */
export const MAX_REDACT_DEPTH = 24;

/**
 * Presné (normalizované) mená polí a hlavičiek, ktorých HODNOTA sa maskuje celá.
 * Normalizácia: lowercase + odstránenie všetkého okrem `[a-z0-9]`, takže
 * `X-Api-Key`, `x_api_key` aj `apiKey` padnú na `xapikey` / `apikey`.
 */
const DENY_EXACT: ReadonlySet<string> = new Set([
  // hlavičky (§6)
  'authorization',
  'proxyauthorization',
  'cookie',
  'cookies',
  'setcookie',
  'xapikey',
  'xauthtoken',
  'xaccesstoken',
  'xsessiontoken',
  // polia z denylistu (§6, D66)
  'apikey',
  'key',
  'keys',
  'token',
  'tokens',
  'password',
  'passwords',
  'passwd',
  'pwd',
  'secret',
  'secrets',
  // rozšírenia v duchu I1 (nič z toho nemá byť v logu ani v audite)
  'credential',
  'credentials',
  'masterkey',
  'privatekey',
  'plaintext',
  'ciphertext',
  'authtag',
  'passwordhash',
]);

/**
 * Sufixy normalizovaného mena. Pokryjú `shopApiKey`, `adminPassword`,
 * `sessionSecret`, `previewToken`, `signingKey` aj `bearerToken`.
 * Over-redakcia je v logu prijateľná; under-redakcia je porušenie I1.
 */
const DENY_SUFFIX: readonly string[] = [
  'apikey',
  'key',
  'password',
  'passwd',
  'secret',
  'token',
  'credentials',
];

/** `Authorization: Bearer xyz`, `api_key=xyz`, `"password": "xyz"` v jednom stringu. */
const INLINE_ASSIGNMENT_RE =
  /\b(x[-_]?api[-_]?key|api[-_]?key|authorization|set[-_]?cookie|cookie|passwd|password|secret|token|bearer)\b(["']?\s*[:=]\s*["']?)((?:bearer\s+)?)([^\s"',;)}\]&]+)/gi;

/** `…?api_key=xyz&token=abc` v URL alebo v curl príkaze. */
const INLINE_QUERY_RE = /([?&](?:x[-_]?api[-_]?key|api[-_]?key|key|token|password|secret|auth)=)([^&#\s"']*)/gi;

/** Minimálna dĺžka tajomstva pre substring scan (kľúč shopu má min. 16 znakov). */
const MIN_SCANNABLE_SECRET_LENGTH = 8;

/** Koľko posledných znakov kľúča sa skenuje navyše (§6). */
export const SECRET_TAIL_LENGTH = 8;

/* ═══════════════════════ 2. Stav skenu a hlásenie ═════════════════════════ */

export interface RedactionHit {
  /** Počet nahradení v jednom `redact()` volaní. */
  hits: number;
  /** `secret` = zhoda na aktuálny kľúč, `tail` = zhoda na jeho posledných 8 znakov. */
  kinds: Array<'secret' | 'tail'>;
}

export type RedactionHitSink = (hit: RedactionHit) => void;

/** Fallback sink — keď sa `logger.ts` nikdy nenačíta, `redaction_hit` aj tak vznikne. */
const fallbackSink: RedactionHitSink = (hit) => {
  try {
    process.stdout.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        msg: 'redaction_hit',
        hits: hit.hits,
        kinds: hit.kinds,
      })}\n`,
    );
  } catch {
    // Logovanie nesmie zhodiť volajúci tok.
  }
};

let hitSink: RedactionHitSink = fallbackSink;

/** `logger.ts` sa tu registruje, aby `redaction_hit` išiel štandardným kanálom. */
export function setRedactionHitSink(sink: RedactionHitSink | null): void {
  hitSink = sink ?? fallbackSink;
}

interface ScanState {
  /** Celý kľúč. */
  secret: string | null;
  /** Posledných 8 znakov kľúča (§6). */
  tail: string | null;
}

const scan: ScanState = { secret: null, tail: null };

let totalHits = 0;

/**
 * Nastaví aktuálne uložený kľúč pre substring scan; `null` ho zabudne (D66).
 * Volá sa z `lib/repo/api-key.repo.ts` (A1) pri uložení, načítaní a wipe kľúča.
 *
 * Samotný kľúč tu žije ako `string` VÝHRADNE preto, aby ho redaktor vedel
 * rozpoznať v už serializovanom texte — nikam sa neloguje ani nevracia.
 */
export function setActiveSecretForScan(secret: string | null): void {
  if (secret === null || secret.length === 0) {
    scan.secret = null;
    scan.tail = null;
    return;
  }
  if (secret.length < MIN_SCANNABLE_SECRET_LENGTH) {
    // Kratšie „tajomstvo" by pri substring scane zmazalo pol logu (napr. sekvencia
    // 2 znakov). Kľúč shopu má min. 16 znakov (§5, `/api/key`), takže sem sa dá
    // dostať len omylom — scan sa nezapne a `getRedactionState()` to prizná.
    scan.secret = null;
    scan.tail = null;
    return;
  }
  scan.secret = secret;
  scan.tail = secret.slice(-SECRET_TAIL_LENGTH);
}

/** Diagnostika pre testy a pre `/api/health` — nikdy nevracia samotný kľúč. */
export function getRedactionState(): {
  hasActiveSecret: boolean;
  secretLength: number | null;
  totalHits: number;
} {
  return {
    hasActiveSecret: scan.secret !== null,
    secretLength: scan.secret?.length ?? null,
    totalHits,
  };
}

/** Výhradne pre testy. */
export function resetRedactionState(): void {
  scan.secret = null;
  scan.tail = null;
  totalHits = 0;
}

/* ═══════════════════════ 3. Rozpoznanie mena poľa ═════════════════════════ */

export function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True, keď sa hodnota poľa/hlavičky s týmto menom maskuje celá (D66). */
export function isDeniedFieldName(name: string): boolean {
  const normalized = normalizeFieldName(name);
  if (normalized.length === 0) return false;
  if (DENY_EXACT.has(normalized)) return true;
  return DENY_SUFFIX.some((suffix) => normalized.length > suffix.length && normalized.endsWith(suffix));
}

/* ══════════════════════════ 4. Skenovanie textu ═══════════════════════════ */

interface PassState {
  hits: number;
  kinds: Set<'secret' | 'tail'>;
}

function replaceAll(haystack: string, needle: string, state: PassState, kind: 'secret' | 'tail'): string {
  if (needle.length === 0 || !haystack.includes(needle)) return haystack;
  const parts = haystack.split(needle);
  state.hits += parts.length - 1;
  state.kinds.add(kind);
  return parts.join(REDACTED);
}

function scrub(input: string, state: PassState): string {
  let out = input;

  // 2. vrstva — inline `name: value` a `?name=value`.
  out = out.replace(
    INLINE_ASSIGNMENT_RE,
    (_match, name: string, sep: string, bearer: string) => `${name}${sep}${bearer}${REDACTED}`,
  );
  out = out.replace(INLINE_QUERY_RE, (_match, prefix: string) => `${prefix}${REDACTED}`);

  // 3. vrstva — aktuálny kľúč a jeho posledných 8 znakov (§6, D66).
  if (scan.secret !== null) {
    out = replaceAll(out, scan.secret, state, 'secret');
    if (scan.tail !== null) out = replaceAll(out, scan.tail, state, 'tail');
  }

  return out;
}

/**
 * Redakcia samotného stringu. Užitočná pre chybové hlášky a URL, ktoré sa
 * skladajú mimo štruktúrovaných polí.
 */
export function redactString(input: string): string {
  const state: PassState = { hits: 0, kinds: new Set() };
  const out = scrub(input, state);
  report(state);
  return out;
}

/* ════════════════════════════ 5. Walker ═══════════════════════════════════ */

function binarySize(value: object): number | null {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.length;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return null;
}

function isHeadersLike(value: object): boolean {
  if (typeof Headers !== 'undefined' && value instanceof Headers) return true;
  return (
    value.constructor?.name === 'Headers' &&
    typeof (value as { forEach?: unknown }).forEach === 'function'
  );
}

function headersToObject(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  (value as { forEach(cb: (v: string, k: string) => void): void }).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function errorToObject(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if (typeof error.stack === 'string') out.stack = error.stack;
  if ('cause' in error && error.cause !== undefined) out.cause = error.cause;
  if ('code' in error) out.code = (error as unknown as { code: unknown }).code;
  return out;
}

function walk(value: unknown, depth: number, path: Set<object>, state: PassState): unknown {
  if (depth > MAX_REDACT_DEPTH) return TRUNCATED;

  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case 'string':
      return scrub(value, state);
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'symbol':
      return scrub(value.toString(), state);
    case 'function':
      return '[Function]';
    default:
      break;
  }

  const obj = value as object;

  // Fail-closed: binárne dáta sa nikdy neserializujú (plaintext kľúča je Buffer, D64).
  const bytes = binarySize(obj);
  if (bytes !== null) return `***BINARY(${bytes}B)***`;

  if (obj instanceof Date) return obj;
  if (obj instanceof RegExp) return scrub(obj.toString(), state);
  if (obj instanceof URL) return scrub(obj.toString(), state);
  if (obj instanceof Error) return walk(errorToObject(obj), depth, path, state);

  if (path.has(obj)) return '[Circular]';
  path.add(obj);
  try {
    if (Array.isArray(obj)) {
      return obj.map((item) => walk(item, depth + 1, path, state));
    }

    if (obj instanceof Set) {
      return Array.from(obj, (item) => walk(item, depth + 1, path, state));
    }

    if (obj instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [rawKey, rawValue] of obj) {
        const key = typeof rawKey === 'string' ? rawKey : String(rawKey);
        out[scrub(key, state)] = isDeniedFieldName(key)
          ? REDACTED
          : walk(rawValue, depth + 1, path, state);
      }
      return out;
    }

    const source = isHeadersLike(obj) ? headersToObject(obj) : (obj as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const safeKey = scrub(key, state);
      out[safeKey] = isDeniedFieldName(key) ? REDACTED : walk(source[key], depth + 1, path, state);
    }
    return out;
  } finally {
    path.delete(obj);
  }
}

/* ════════════════════════════ 6. Verejné API ══════════════════════════════ */

let reporting = false;

function report(state: PassState): void {
  if (state.hits === 0) return;
  totalHits += state.hits;
  if (reporting) return; // sink loguje → logger znovu redaguje → žiadna rekurzia
  reporting = true;
  try {
    hitSink({ hits: state.hits, kinds: Array.from(state.kinds) });
  } catch {
    // Hlásenie nesmie zhodiť volajúci tok (audit ani log nie sú dôvod pádu).
  } finally {
    reporting = false;
  }
}

/**
 * Centrálny redaktor (D66, I1). Vracia NOVÚ štruktúru — vstup nemutuje.
 *
 * Nikdy nehodí výnimku: keď sa štruktúra nedá prejsť, vráti `***TRUNCATED***`,
 * pretože prepustiť neredigovaný originál by bolo porušenie I1.
 */
export function redact<T>(value: T): T {
  const state: PassState = { hits: 0, kinds: new Set() };
  let result: unknown;
  try {
    result = walk(value, 0, new Set<object>(), state);
  } catch {
    result = TRUNCATED;
  }
  report(state);
  return result as T;
}

/** Kontrola konformity s kontraktom A0 (`src/contracts.ts`). */
const _redactor: Redactor = redact;

export const redactorModule: RedactorModule = {
  redact: _redactor,
  setActiveSecretForScan,
};
