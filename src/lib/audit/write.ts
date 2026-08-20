/**
 * Aura Zľavy — `appendAudit()`: JEDINÁ cesta zápisu do `audit_log`
 * (BUILD-SPEC §3, INVARIANT I4, D50, D74, D75).
 *
 * Pravidlá, ktoré tento modul drží:
 *   - **Append-only (I4).** V celom súbore je jediný SQL príkaz a je to
 *     `INSERT`. Žiadny iný modul nesmie do `audit_log` zapisovať priamo;
 *     aplikačný DB user má na tejto tabuľke len `SELECT, INSERT` (0008_grants).
 *   - **Vždy cez redaktor (I1, D66).** Celý vstup — vrátane `before_snapshot`,
 *     `after_snapshot`, `message` a `user_agent` — prechádza `redact()`.
 *     Neexistuje flag, ktorý by redakciu vypol.
 *   - **Audit nikdy nezhodí volajúci tok.** Zlyhanie zápisu sa zaloguje
 *     (`audit_write_failed`) a `appendAudit()` sa vráti normálne. Audit nesmie
 *     byť dôvodom, prečo zlyhá ostrý zápis — ale stratu MUSÍ byť vidno v logu
 *     (akceptačné kritérium A2).
 *   - **Oddelené kanály (D92).** Obsah auditu sa NIKDY netlačí do stdout logu;
 *     do logu ide pri zlyhaní len metadáta (event, korelačné ID, dôvod).
 *   - **Čas je UTC.** `ts` sa neposiela z Node, používa sa `UTC_TIMESTAMP(3)`,
 *     takže hodnota je UTC bez ohľadu na časovú zónu DB servera (§2, D31).
 *
 * Vlastník: A2.
 */
import type { AuditActor, AuditInput, AuditWriter, Queryable } from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { AUDIT_EVENT_TYPE_MAX_LENGTH, isAuditActor, isAuditEventType } from '@/lib/audit/events';
import { logger } from '@/lib/log/logger';
import { redact } from '@/lib/log/redact';

/* ═══════════════════════════════ Limity ═══════════════════════════════════ */

/** `message VARCHAR(1000)` (§3). */
const MESSAGE_MAX = 1000;
/** `ip VARCHAR(45)` (§3) — IPv6 v plnom tvare. */
const IP_MAX = 45;
/** `user_agent VARCHAR(255)` (§3). */
const USER_AGENT_MAX = 255;
/**
 * Strop na jeden JSON snapshot. `before/after_snapshot` má držať celý payload aj
 * raw odpoveď (D50), ale jedna divoká odpoveď nesmie zaplniť tabuľku, ktorá sa
 * nikdy nemaže (D75). Nad limitom sa uloží skrátený tvar s príznakom.
 */
const SNAPSHOT_MAX_BYTES = 64 * 1024;

/* ══════════════════════════ Jediný SQL príkaz ═════════════════════════════ */

/**
 * Jediný zápis do `audit_log` v celej aplikácii (I4). `ts` ide z DB ako
 * `UTC_TIMESTAMP(3)`.
 */
const AUDIT_INSERT_SQL = `INSERT INTO audit_log
  (ts, actor, user_id, event_type, ok, campaign_id, campaign_item_id, product_id,
   operation_id, request_id, http_status, before_snapshot, after_snapshot,
   message, ip, user_agent)
 VALUES (UTC_TIMESTAMP(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/* ═════════════════════════════ Pomocníci ══════════════════════════════════ */

function clampString(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  if (text.length === 0) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function nullableBoolAsTinyint(value: unknown): 0 | 1 | null {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

/** JSON stĺpec: `null`, alebo serializovaný (a podľa potreby skrátený) snapshot. */
function toJsonColumn(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? 'null';
  } catch {
    // Neserializovateľná štruktúra (napr. cyklus, ktorý prežil redakciu) —
    // radšej príznak než stratený riadok auditu.
    return JSON.stringify({ serialization_failed: true });
  }
  if (text === 'null') return null;
  if (Buffer.byteLength(text, 'utf8') <= SNAPSHOT_MAX_BYTES) return text;
  return JSON.stringify({
    truncated: true,
    original_bytes: Buffer.byteLength(text, 'utf8'),
    preview: text.slice(0, SNAPSHOT_MAX_BYTES),
  });
}

async function runInsert(conn: Queryable | undefined, values: unknown[]): Promise<void> {
  if (conn) {
    await conn.query(AUDIT_INSERT_SQL, values);
    return;
  }
  await poolQuery(AUDIT_INSERT_SQL, values);
}

/* ══════════════════════════ Diagnostika strát ═════════════════════════════ */

let failureCount = 0;

/** Koľko auditných zápisov sa od štartu procesu nepodarilo uložiť. */
export function getAuditWriteFailureCount(): number {
  return failureCount;
}

/** Výhradne pre testy. */
export function resetAuditWriteFailureCount(): void {
  failureCount = 0;
}

/* ═════════════════════════════ appendAudit ════════════════════════════════ */

/**
 * Zapíše jeden riadok do `audit_log`. Jediná povolená cesta (I4).
 *
 * NIKDY nehodí výnimku smerom do volajúceho toku — zlyhanie sa len zaloguje.
 * Vracia `true`, keď riadok naozaj pribudol; volajúci to smie ignorovať.
 *
 * @param input vstup podľa `AuditInput` (`src/contracts.ts`)
 * @param conn  spojenie v transakcii; bez neho sa použije pool
 */
export async function appendAuditResult(input: AuditInput, conn?: Queryable): Promise<boolean> {
  let eventType: string = 'unknown_event';
  let operationId: string | null = null;

  try {
    // 1. REDAKCIA — povinná a nevypnuteľná (I1, D66). Robí sa PRED akoukoľvek
    //    ďalšou prácou, aby sa neredigované dáta nedostali ani do chybovej cesty.
    const safe = redact(input);

    // 2. Normalizácia hodnôt na tvar stĺpcov (§3).
    const actor: AuditActor = isAuditActor(safe.actor) ? safe.actor : 'system';
    if (!isAuditActor(safe.actor)) {
      logger.warn('audit_unknown_actor', { given: String(safe.actor), usedInstead: actor });
    }

    const rawEvent = clampString(safe.eventType, AUDIT_EVENT_TYPE_MAX_LENGTH) ?? 'unknown_event';
    eventType = rawEvent;
    if (!isAuditEventType(rawEvent)) {
      // Neznámy event je chyba v kóde, nie dôvod stratiť auditný riadok (D75).
      logger.warn('audit_unknown_event_type', { eventType: rawEvent });
    }

    operationId = clampString(safe.operationId, 26);

    const values: unknown[] = [
      actor,
      nullableInt(safe.userId),
      rawEvent,
      nullableBoolAsTinyint(safe.ok),
      nullableInt(safe.campaignId),
      nullableInt(safe.campaignItemId),
      nullableInt(safe.productId),
      operationId,
      clampString(safe.requestId, 26),
      nullableInt(safe.httpStatus),
      toJsonColumn(safe.beforeSnapshot),
      toJsonColumn(safe.afterSnapshot),
      clampString(safe.message, MESSAGE_MAX),
      clampString(safe.ip, IP_MAX),
      clampString(safe.userAgent, USER_AGENT_MAX),
    ];

    // 3. Zápis. Obsah auditu sa do stdout logu NIKDY netlačí (D92).
    await runInsert(conn, values);
    return true;
  } catch (error) {
    failureCount += 1;
    // Do logu idú len metadáta — nikdy snapshoty (D92, I1).
    logger.error('audit_write_failed', {
      eventType,
      operationId: operationId ?? undefined,
      failureCount,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Rozhranie podľa kontraktu (`AuditWriter`). Návratová hodnota je `void`, aby
 * volajúci nemal ako spraviť z auditu blokujúcu podmienku.
 */
export async function appendAudit(input: AuditInput, conn?: Queryable): Promise<void> {
  await appendAuditResult(input, conn);
}

export const auditWriter: AuditWriter = { appendAudit };
