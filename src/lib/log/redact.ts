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
 *   3. **Substring scan na aktuálne uložené kľúče** — `lib/repo/api-key.repo.ts`
 *      ohlási kľúč pri uložení a pri načítaní na použitie; ak sa on alebo jeho
 *      posledných 8 znakov objaví kdekoľvek v serializovanom výstupe, redaktor
 *      ho nahradí a nahlási `redaction_hit` (§6).
 *
 *      Vrstva je ZÁMERNE viac-tajomstvová (`setScanSecretForOwner()`): appka
 *      drží DVA kľúče naraz (`shop_write`, `orders_read`, P5) a keby bol slot
 *      jediný, načítanie jedného kľúča by zhaslo alarm tomu druhému.
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

interface ScanEntry {
  /** Celý kľúč. */
  secret: string;
  /** Posledných 8 znakov kľúča (§6). */
  tail: string;
}

/**
 * Aktívne tajomstvá podľa VLASTNÍKA (`owner`). Vlastníkom je druh kľúča
 * (`shop_write` / `orders_read`, P5), takže načítanie objednávkového kľúča
 * nezhasne scan zápisového a naopak. `Map` je zámerne bez stropu veľkosti —
 * vlastníkov je uzavretý číselník a každý má práve jednu položku.
 */
const scan = new Map<string, ScanEntry>();

/** Vlastník pre jedno-tajomstvové volanie `setActiveSecretForScan()`. */
export const DEFAULT_SCAN_OWNER = 'default';

let totalHits = 0;

/**
 * Zapne substring scan na kľúč jedného vlastníka; `null` ho zabudne (D66).
 * Volá sa z `lib/repo/api-key.repo.ts` (A1) pri uložení, načítaní na použitie
 * a pri wipe kľúča — `owner` je druh kľúča.
 *
 * Samotný kľúč tu žije ako `string` VÝHRADNE preto, aby ho redaktor vedel
 * rozpoznať v už serializovanom texte — nikam sa neloguje ani nevracia.
 */
export function setScanSecretForOwner(owner: string, secret: string | null): void {
  if (secret === null || secret.length < MIN_SCANNABLE_SECRET_LENGTH) {
    // Kratšie „tajomstvo" by pri substring scane zmazalo pol logu (napr. sekvencia
    // 2 znakov). Kľúč shopu má min. 16 znakov (§5, `/api/key`), takže sem sa dá
    // dostať len omylom — scan sa nezapne a `getRedactionState()` to prizná.
    scan.delete(owner);
    return;
  }
  scan.set(owner, { secret, tail: secret.slice(-SECRET_TAIL_LENGTH) });
}

/**
 * Jedno-tajomstvová podoba (kontrakt `RedactorModule`, A0).
 *
 * `null` je ZÁMERNE „zabudni všetko", nie „zabudni default": je to jediná
 * panic/reset cesta, akú kontrakt pozná, a zúžiť ju na jedného vlastníka by
 * znamenalo, že po nej v redaktore ticho zostane kľúč.
 */
export function setActiveSecretForScan(secret: string | null): void {
  if (secret === null || secret.length === 0) {
    scan.clear();
    return;
  }
  setScanSecretForOwner(DEFAULT_SCAN_OWNER, secret);
}

/** Zabudne kľúče VŠETKÝCH vlastníkov (panic wipe, D67). */
export function clearScanSecrets(): void {
  scan.clear();
}

/** Diagnostika pre testy a pre `/api/health` — nikdy nevracia samotný kľúč. */
export function getRedactionState(): {
  hasActiveSecret: boolean;
  /** Koľko kľúčov (vlastníkov) scan práve stráži. */
  activeSecrets: number;
  /** Dĺžka kľúča, keď je aktívny práve jeden; inak `null`. */
  secretLength: number | null;
  totalHits: number;
} {
  const only = scan.size === 1 ? scan.values().next().value : undefined;
  return {
    hasActiveSecret: scan.size > 0,
    activeSecrets: scan.size,
    secretLength: only ? only.secret.length : null,
    totalHits,
  };
}

/** Výhradne pre testy. */
export function resetRedactionState(): void {
  scan.clear();
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

/* ═════════════ 3b. Úzka výnimka: bezpečná dvojica `{present, expiresAt}` ═══ */

/**
 * Tvary, ktoré sa POD menom z denylistu NEMASKUJÚ celé (a rekurzia ide dovnútra).
 *
 * Dôvod: `GET /api/health` musí podľa NORMATÍVNEHO kontraktu (BUILD-SPEC §5)
 * vracať `key: {present, expiresAt}` a telo každej odpovede prechádza
 * `redact()` (`lib/http/responses.ts`, I1). Meno `key` je v denylistu, takže sa
 * celá dvojica maskovala na `***REDACTED***` — UI potom **vždy** hlásilo „kľúč
 * chýba" a natrvalo zobrazovalo režim len na čítanie, aj keď kľúč platil
 * (nahlásené v `test/integration/health.spec.ts` ako „A11/A19").
 *
 * Prečo to NEOSLABUJE I1:
 *   - výnimka platí len pre **plain objekt** s PRESNE týmito menami polí; kľúč
 *     je vždy `string` (alebo `Buffer`) → naň sa výnimka nikdy nevzťahuje,
 *   - hodnoty smú byť len `boolean | number | null | Date | string`, pričom
 *     stringy vnútri **stále** prechádzajú `scrub()` (inline scan + substring
 *     scan na aktuálny kľúč a jeho posledných 8 znakov, §6),
 *   - akýkoľvek iný tvar (extra pole, vnorený objekt, pole hodnôt) sa maskuje
 *     celý ako doteraz — fail-closed.
 */
const SAFE_DENIED_SHAPES: readonly ReadonlySet<string>[] = [new Set(['present', 'expiresAt'])];

/** True, keď hodnota poľa z denylistu je jeden z tvarov `SAFE_DENIED_SHAPES`. */
export function isSafeDeniedShape(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  const shapeMatches = SAFE_DENIED_SHAPES.some(
    (shape) => keys.length === shape.size && keys.every((k) => shape.has(k)),
  );
  if (!shapeMatches) return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) =>
      v === null ||
      typeof v === 'boolean' ||
      typeof v === 'number' ||
      typeof v === 'string' ||
      v instanceof Date,
  );
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

  // 3. vrstva — aktuálne uložené kľúče a ich posledných 8 znakov (§6, D66).
  for (const entry of scan.values()) {
    out = replaceAll(out, entry.secret, state, 'secret');
    out = replaceAll(out, entry.tail, state, 'tail');
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
        out[scrub(key, state)] =
          isDeniedFieldName(key) && !isSafeDeniedShape(rawValue)
            ? REDACTED
            : walk(rawValue, depth + 1, path, state);
      }
      return out;
    }

    const source = isHeadersLike(obj) ? headersToObject(obj) : (obj as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const safeKey = scrub(key, state);
      out[safeKey] =
        isDeniedFieldName(key) && !isSafeDeniedShape(source[key])
          ? REDACTED
          : walk(source[key], depth + 1, path, state);
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
