/**
 * Aura Zľavy — repozitár `audit_log`: VÝHRADNE čítanie (INVARIANT I4, D74, D75).
 *
 * Audit je append-only. V tomto súbore preto nie je a nikdy nesmie byť žiadny
 * zápisový ani mazací SQL príkaz — každý dotaz začína `SELECT`, v celom súbore
 * sa nevyskytuje ani slovo iného SQL príkazu (kontroluje to test). Druhú poistku
 * dáva grant v `db/migrations/0008_grants.sql`, kde aplikačný DB user na
 * `audit_log` mutácie ani mazanie vôbec nemá (I4, D74).
 *
 * Jediná cesta pridania riadku je `src/lib/audit/write.ts` (`appendAudit()`).
 *
 * Časy: `ts` je v DB v UTC (§2, D31); filtre `from`/`to` sú kalendárne dni,
 * ktoré sa prekladajú na polootvorený interval `[from 00:00, to+1 den 00:00)`.
 *
 * Vlastník: A2.
 */
import type {
  AuditFilter,
  AuditRecord,
  AuditRepo,
  DbRow,
  Paged,
  Queryable,
  Ulid,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { RUNAWAY_COUNTED_EVENTS } from '@/lib/audit/events';

/* ═════════════════════════════ Konštanty ══════════════════════════════════ */

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

/** Zoznam stĺpcov — explicitne, aby zmena schémy nikdy netiekla do UI nečakane. */
const COLUMNS = `id, ts, actor, user_id, event_type, ok, campaign_id, campaign_item_id,
   product_id, operation_id, request_id, http_status, before_snapshot, after_snapshot,
   message, ip, user_agent`;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ═════════════════════════════ Pomocníci ══════════════════════════════════ */

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function toBoolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  return Number(value) !== 0;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

/**
 * `JSON` stĺpec prichádza z drivera raz ako string, raz ako už rozparsovaná
 * hodnota. Keď sa string nedá rozparsovať, vracia sa tak, ako je — auditný
 * riadok sa nikdy nezahodí (D75).
 */
function parseJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapRow(row: DbRow): AuditRecord {
  return {
    id: toNumberOrNull(row.id) ?? 0,
    ts: toDate(row.ts),
    actor: (toStringOrNull(row.actor) ?? 'system') as AuditRecord['actor'],
    userId: toNumberOrNull(row.user_id),
    eventType: toStringOrNull(row.event_type) ?? '',
    ok: toBoolOrNull(row.ok),
    campaignId: toNumberOrNull(row.campaign_id),
    campaignItemId: toNumberOrNull(row.campaign_item_id),
    productId: toNumberOrNull(row.product_id),
    operationId: toStringOrNull(row.operation_id),
    requestId: toStringOrNull(row.request_id),
    httpStatus: toNumberOrNull(row.http_status),
    beforeSnapshot: parseJsonColumn(row.before_snapshot),
    afterSnapshot: parseJsonColumn(row.after_snapshot),
    message: toStringOrNull(row.message),
    ip: toStringOrNull(row.ip),
    userAgent: toStringOrNull(row.user_agent),
  };
}

/** `YYYY-MM-DD` → `YYYY-MM-DD 00:00:00.000` (UTC hranica dňa). */
function dayStart(day: string): string {
  return `${day} 00:00:00.000`;
}

/** Nasledujúci kalendárny deň — pre polootvorený interval `ts < nextDay(to)`. */
function nextDayStart(day: string): string {
  const [y, m, d] = day.split('-').map((part) => Number(part));
  const base = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  base.setUTCDate(base.getUTCDate() + 1);
  return `${base.toISOString().slice(0, 10)} 00:00:00.000`;
}

function clampPerPage(perPage: number | undefined): number {
  if (perPage === undefined || !Number.isFinite(perPage)) return DEFAULT_PER_PAGE;
  const value = Math.trunc(perPage);
  if (value < 1) return 1;
  return value > MAX_PER_PAGE ? MAX_PER_PAGE : value;
}

function clampPage(page: number | undefined): number {
  if (page === undefined || !Number.isFinite(page)) return 1;
  const value = Math.trunc(page);
  return value < 1 ? 1 : value;
}

async function run<T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> {
  if (conn) return conn.query<T>(sql, values);
  return poolQuery<T>(sql, values);
}

/** Skladanie `WHERE` z filtrov — všetko parametrizované, nikdy interpolované. */
function buildWhere(filter: AuditFilter): { sql: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filter.productId !== undefined) {
    conditions.push('product_id = ?');
    values.push(Math.trunc(filter.productId));
  }
  if (filter.campaignId !== undefined) {
    conditions.push('campaign_id = ?');
    values.push(Math.trunc(filter.campaignId));
  }
  if (filter.eventType !== undefined && filter.eventType.length > 0) {
    conditions.push('event_type = ?');
    values.push(filter.eventType);
  }
  if (filter.ok !== undefined) {
    conditions.push('ok = ?');
    values.push(filter.ok ? 1 : 0);
  }
  if (filter.from !== undefined && DATE_ONLY_RE.test(filter.from)) {
    conditions.push('ts >= ?');
    values.push(dayStart(filter.from));
  }
  if (filter.to !== undefined && DATE_ONLY_RE.test(filter.to)) {
    conditions.push('ts < ?');
    values.push(nextDayStart(filter.to));
  }

  return {
    sql: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

/* ═══════════════════════════ Čítacie operácie ═════════════════════════════ */

/** Stránkovaný výpis pre `/api/audit` (D18). Najnovšie riadky ako prvé. */
export async function list(filter: AuditFilter, conn?: Queryable): Promise<Paged<AuditRecord>> {
  const page = clampPage(filter.page);
  const perPage = clampPerPage(filter.perPage);
  const where = buildWhere(filter);

  const countRows = await run<Array<{ total: unknown }>>(
    conn,
    `SELECT COUNT(*) AS total FROM audit_log${where.sql}`,
    where.values,
  );
  const total = toNumberOrNull(countRows[0]?.total) ?? 0;

  const offset = (page - 1) * perPage;
  const rows: DbRow[] =
    offset >= total
      ? []
      : await run<DbRow[]>(
          conn,
          `SELECT ${COLUMNS} FROM audit_log${where.sql} ORDER BY id DESC LIMIT ? OFFSET ?`,
          [...where.values, perPage, offset],
        );

  return { data: rows.map(mapRow), page, perPage, total };
}

/** Plný záznam pre `/api/audit/[id]` vrátane snapshotov (D18, D39c). */
export async function getById(id: number, conn?: Queryable): Promise<AuditRecord | null> {
  const rows = await run<DbRow[]>(conn, `SELECT ${COLUMNS} FROM audit_log WHERE id = ? LIMIT 1`, [
    Math.trunc(id),
  ]);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Runaway počítadlo neodpovedalo číslom. `SELECT COUNT(*)` vracia práve jeden
 * riadok s jedným číslom — keď ho tam niet, nevieme, koľko zápisov za poslednú
 * hodinu odišlo. To NIE JE nula: nula je povoľujúca odpoveď a runaway strop
 * (D79, I12) je fail-closed poistka. Volajúci to má spracovať ako „neviem",
 * nie ako „nezapisovalo sa".
 */
export class AuditCountUnreadableError extends Error {
  constructor(message = 'Počítadlo auditu sa nepodarilo prečítať.') {
    super(message);
    this.name = 'AuditCountUnreadableError';
  }
}

/**
 * Runaway počítadlo (D79, I12): `write_ok` + `write_uncertain` za poslednú
 * hodinu. Presne dotaz z BUILD-SPEC §3 — počíta sa z append-only tabuľky,
 * takže sa nedá obísť (O3).
 *
 * Nečitateľná odpoveď HODÍ (`AuditCountUnreadableError`). Predtým tu bola
 * `?? 0`, čo znamenalo „tento hodinu sa nezapisovalo" — runaway strop by nad
 * pokazeným počítadlom pustil ďalší zápis. Neistota sa v tomto smere
 * zaokrúhľuje nadol na „nezapisuj", nie nahor na „zapisuj".
 */
export async function countWritesInLastHour(conn?: Queryable): Promise<number> {
  const placeholders = RUNAWAY_COUNTED_EVENTS.map(() => '?').join(', ');
  const rows = await run<Array<{ total: unknown }>>(
    conn,
    `SELECT COUNT(*) AS total FROM audit_log
      WHERE event_type IN (${placeholders})
        AND ts >= UTC_TIMESTAMP(3) - INTERVAL 1 HOUR`,
    [...RUNAWAY_COUNTED_EVENTS],
  );
  const total = toNumberOrNull(Array.isArray(rows) ? rows[0]?.total : undefined);
  if (total === null) {
    throw new AuditCountUnreadableError(
      'Runaway počítadlo (`write_ok` + `write_uncertain` za hodinu) sa nepodarilo prečítať — zápis sa nespustí (D79, I12).',
    );
  }
  return Math.max(0, Math.trunc(total));
}

/**
 * Podklad pre reconciliáciu po havárii (D86): položky kampane, ktorých zápis
 * shop POTVRDIL (`write_ok`). Všetko ostatné zostáva `uncertain` na manuálne
 * rozhodnutie — automatický re-run NESMIE prebehnúť.
 */
export async function findConfirmedWrites(
  campaignId: number,
  conn?: Queryable,
): Promise<Array<{ requestId: Ulid | null; productId: number | null }>> {
  const rows = await run<DbRow[]>(
    conn,
    `SELECT request_id, product_id FROM audit_log
      WHERE campaign_id = ? AND event_type = 'write_ok' AND ok = 1
      ORDER BY id ASC`,
    [Math.trunc(campaignId)],
  );
  return rows.map((row) => ({
    requestId: toStringOrNull(row.request_id),
    productId: toNumberOrNull(row.product_id),
  }));
}

/**
 * Auditná stopa jednej kampane pre `/api/campaigns/[id]` (§5). Nad kontraktom
 * `AuditRepo` — čítanie, chronologicky vzostupne, s tvrdým stropom riadkov.
 */
export async function listByCampaign(
  campaignId: number,
  limit = 500,
  conn?: Queryable,
): Promise<AuditRecord[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 2000);
  const rows = await run<DbRow[]>(
    conn,
    `SELECT ${COLUMNS} FROM audit_log WHERE campaign_id = ? ORDER BY id ASC LIMIT ?`,
    [Math.trunc(campaignId), capped],
  );
  return rows.map(mapRow);
}

/** Posledný výskyt eventu — napr. `boot`, `writes_locked` pre stavové badge. */
export async function findLatestByEvent(
  eventType: string,
  conn?: Queryable,
): Promise<AuditRecord | null> {
  const rows = await run<DbRow[]>(
    conn,
    `SELECT ${COLUMNS} FROM audit_log WHERE event_type = ? ORDER BY id DESC LIMIT 1`,
    [eventType],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/* ═══════════════════════════ Kontrakt A0 ══════════════════════════════════ */

/** Objektová podoba pre injektáž; zhoda s `AuditRepo` sa kontroluje typom nižšie. */
export const auditRepo = {
  list,
  getById,
  countWritesInLastHour,
  findConfirmedWrites,
  // nad kontraktom A0 — čítanie, ktoré potrebujú route-y §5
  listByCampaign,
  findLatestByEvent,
};

/** Kontrola konformity s `AuditRepo` (`src/contracts.ts`). */
const _conformsToContract: AuditRepo = auditRepo;
void _conformsToContract;
