/**
 * Aura Zľavy — štruktúrovaný logger (BUILD-SPEC §10, D92).
 *
 * D92: „Prevádzkové logy MUSIA byť štruktúrovaný JSON na stdout s docker logging
 * driverom; audit MUSÍ byť v DB a NESMIE sa tlačiť do logov."
 *
 * Preto:
 *   - jeden JSON objekt na riadok, na **stdout** (docker `json-file` driver),
 *   - žiadny prístup k DB — audit ide výhradne cez `lib/audit/write.ts`,
 *   - KAŽDÝ riadok (vrátane `msg`) prechádza `redact()` (I1, D66) — logger je
 *     druhý povinný priechod redaktorom vedľa auditu,
 *   - logger NIKDY nehodí výnimku smerom do volajúceho toku; zlyhanie
 *     serializácie skončí núdzovým riadkom, nie pádom operácie.
 *
 * Úroveň sa berie z `LOG_LEVEL` (§11). Keď ENV ešte nie je (alebo je zlé),
 * logger nespadne — použije `info`, aby sa dalo logovať aj počas boot chyby.
 *
 * Vlastník: A2.
 */
import type { LogFields, Logger, LogLevel } from '@/contracts';

import { redact, setRedactionHitSink } from '@/lib/log/redact';
import { APP_SLUG, APP_VERSION } from '@/version';

/* ═════════════════════════════ 1. Úrovne ══════════════════════════════════ */

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

let levelOverride: LogLevel | null = null;
let cachedLevel: LogLevel | null = null;

/**
 * Úroveň logovania. `LOG_LEVEL` sa číta priamo z `process.env`, nie cez zod
 * schému: logger musí fungovať aj vtedy, keď je ENV neplatné a práve to
 * potrebujeme zalogovať (I14 fail-fast hlásenie).
 */
export function getLogLevel(): LogLevel {
  if (levelOverride !== null) return levelOverride;
  if (cachedLevel !== null) return cachedLevel;
  const raw = process.env.LOG_LEVEL;
  cachedLevel = isLogLevel(raw) ? raw : 'info';
  return cachedLevel;
}

/** Výhradne pre testy a pre CLI skripty. `null` vráti čítanie z ENV. */
export function setLogLevel(level: LogLevel | null): void {
  levelOverride = level;
  cachedLevel = null;
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[getLogLevel()];
}

/* ═══════════════════════════════ 2. Sink ══════════════════════════════════ */

export type LogSink = (line: string) => void;

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

let sink: LogSink = stdoutSink;

/**
 * Presmerovanie výstupu — používajú ho testy (najmä povinný redakčný test
 * `test/integration/redaction.spec.ts`, ktorý musí zachytiť stdout riadky).
 * `null` vráti štandardný stdout.
 */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? stdoutSink;
}

/* ═════════════════════════════ 3. Serializácia ════════════════════════════ */

export interface LogLine extends LogFields {
  ts: string;
  level: LogLevel;
  msg: string;
  app: string;
  version: string;
}

function appVersion(): string {
  const fromEnv = process.env.APP_VERSION;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : APP_VERSION;
}

/** Chyba do logovateľného tvaru. Správa aj stacktrace prejdú redaktorom (I1). */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const out: Record<string, unknown> = { name: error.name, message: error.message };
    if (typeof error.stack === 'string') out.stack = error.stack;
    if (error.cause !== undefined) out.cause = serializeError(error.cause);
    return out;
  }
  if (typeof error === 'object' && error !== null) return { value: error };
  return { value: String(error) };
}

/** Kľúče, ktoré tvorí logger sám — volajúci ich nesmie prebiť. */
const RESERVED_LINE_KEYS: readonly string[] = ['ts', 'level', 'msg', 'app', 'version'];

function stringify(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
}

/**
 * Riadok bez redakcie — VÝHRADNE pre hlásenia, ktorých obsah tvorí len logger sám
 * (počty, úrovne). Nikdy sa doň nesmie dostať vstup od volajúceho.
 */
function emitRaw(level: LogLevel, msg: string, fields: Record<string, unknown>): void {
  if (!isLevelEnabled(level)) return;
  try {
    sink(
      stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        app: APP_SLUG,
        version: appVersion(),
        ...fields,
      }),
    );
  } catch {
    // Log nikdy nezhodí volajúci tok.
  }
}

function emit(level: LogLevel, msg: string, base: LogFields, fields?: LogFields): void {
  if (!isLevelEnabled(level)) return;
  try {
    // Redakcia sa robí nad CELÝM riadkom vrátane `msg` (I1, D66) — správy sa
    // niekedy skladajú z chybových hlášok shopu, ktoré môžu obsahovať čokoľvek.
    const safe = redact({ ...base, ...fields, msg });
    const { msg: safeMsg, ...rest } = safe;
    // Vyhradené kľúče riadku nesmie prebiť volajúci (inak by sa dala falšovať
    // úroveň alebo časová pečiatka v logu).
    const safeFields: Record<string, unknown> = { ...rest };
    for (const reserved of RESERVED_LINE_KEYS) delete safeFields[reserved];
    sink(
      stringify({
        ts: new Date().toISOString(),
        level,
        msg: safeMsg,
        app: APP_SLUG,
        version: appVersion(),
        ...safeFields,
      }),
    );
  } catch (error) {
    // Núdzový riadok: nič z pôvodných polí (mohli by byť neredigované).
    emitRaw('error', 'log_serialization_failed', {
      originalMsg: typeof msg === 'string' ? msg.slice(0, 120) : '(nie string)',
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/* ═════════════════════════════ 4. Logger ══════════════════════════════════ */

export function createLogger(base: LogFields = {}): Logger {
  const bound: LogFields = { ...base };
  return {
    debug: (message, fields) => emit('debug', message, bound, fields),
    info: (message, fields) => emit('info', message, bound, fields),
    warn: (message, fields) => emit('warn', message, bound, fields),
    error: (message, fields) => emit('error', message, bound, fields),
    child: (fields) => createLogger({ ...bound, ...fields }),
  };
}

/** Základný logger aplikácie. Podloggery sa robia cez `logger.child({…})`. */
export const logger: Logger = createLogger();

/* ═════════════════ 5. Registrácia hlásenia `redaction_hit` ════════════════ */

/**
 * §6: „ak sa v serializovanom výstupe nachádza aktuálne uložený kľúč (alebo jeho
 * posledných 8 znakov), redaktor ho nahradí `***REDACTED***` a zapíše
 * `logger.error('redaction_hit')`."
 *
 * Registruje sa tu (nie v `redact.ts`), aby redaktor nemal závislosť na loggeri
 * a nevznikol cyklický import. Do riadku ide výhradne počet zhôd — nikdy nič
 * z redigovaného obsahu (I1).
 */
setRedactionHitSink((hit) => {
  emitRaw('error', 'redaction_hit', { hits: hit.hits, kinds: hit.kinds });
});
