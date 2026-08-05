/**
 * Aura Zľavy — repozitár tabuľky `campaigns` (BUILD-SPEC §3, §4; KONTRAKT O1, D84).
 *
 * Kampaň JE job — `status` je jediný zdroj pravdy o životnom cykle. Tento
 * repozitár drží výhradne prácu s riadkami; VALIDÁCIE a STAVOVÝ STROJ vlastní
 * A7 (`lib/domain/status.ts`) — repozitár prechody NEVYNUCUJE, iba ich zapisuje.
 *
 * Invarianty a rozhodnutia držané tu:
 *  - **D84 / I12** — `claim()` je JEDINÁ obrana proti dvojitému spusteniu:
 *    presne jeden `UPDATE … WHERE id = ? AND status IN (…)`, návrat podľa
 *    `affectedRows`. ŽIADNY `SELECT … then UPDATE`.
 *  - **I4** — žiadny prístup k `audit_log`; eventy `campaign_*` zapisuje
 *    volajúci cez `appendAudit()` (A2).
 *  - **I11** — `lastOwnWrite()` vracia „posledný VLASTNÝ zápis", nikdy pravdu
 *    o shope.
 *
 * Vlastník: A8.
 */
import type {
  CampaignListFilter,
  CampaignRecord,
  CampaignStatus,
  CampaignsRepo,
  CreateCampaignInput,
  DateOnly,
  LastOwnWrite,
  Paged,
  Queryable,
  UtcDate,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ─────────────────────── whitelist stavov (obrana SQL) ─────────────────── */

/** Kópia enumu z DB — placeholdery sú vždy `?`, toto je len sanity filter. */
const KNOWN_STATUSES: readonly CampaignStatus[] = [
  'draft',
  'scheduled',
  'needs_key',
  'running',
  'done',
  'partial',
  'failed',
  'missed',
  'cancelled',
  'lapsed',
];

const isKnownStatus = (value: unknown): value is CampaignStatus =>
  KNOWN_STATUSES.includes(value as CampaignStatus);

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS =
  'id, operation_id, name, kind, parent_campaign_id, percent, date_from, date_to, ' +
  'date_from_original, mode, status, status_reason, fire_at, scheduled_at, ' +
  'needs_key_since, claimed_at, started_at, finished_at, items_total, items_ok, ' +
  'items_failed, items_uncertain, confirmed_at, confirm_payload_hash, sudo_at, ' +
  'result_ack_at, created_by, created_at, updated_at';

const SQL_BY_ID = `SELECT ${COLUMNS} FROM campaigns WHERE id = ? LIMIT 1`;

const SQL_INSERT =
  'INSERT INTO campaigns (operation_id, name, kind, parent_campaign_id, percent, ' +
  'date_from, date_to, mode, status, fire_at, scheduled_at, confirmed_at, ' +
  'confirm_payload_hash, sudo_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

const SQL_FIND_DUE =
  `SELECT ${COLUMNS} FROM campaigns WHERE status = 'scheduled' AND fire_at IS NOT NULL ` +
  'AND fire_at <= ? ORDER BY fire_at ASC, id ASC';

const SQL_FIND_MISSED =
  `SELECT ${COLUMNS} FROM campaigns WHERE status = 'scheduled' AND fire_at IS NOT NULL ` +
  'AND fire_at < ? ORDER BY fire_at ASC, id ASC';

const SQL_FIND_NEEDS_KEY =
  `SELECT ${COLUMNS} FROM campaigns WHERE status = 'needs_key' ORDER BY needs_key_since ASC, id ASC`;

const SQL_FIND_RUNNING_UNFINISHED =
  `SELECT ${COLUMNS} FROM campaigns WHERE status = 'running' AND finished_at IS NULL ` +
  'ORDER BY claimed_at ASC, id ASC';

/** Notifikačný panel (D17, O6): dobehnuté výsledky bez potvrdenia. */
const SQL_FIND_UNACKED =
  `SELECT ${COLUMNS} FROM campaigns WHERE result_ack_at IS NULL ` +
  "AND status IN ('done','partial','failed','missed','lapsed') " +
  'ORDER BY finished_at DESC, id DESC';

const SQL_ACK =
  'UPDATE campaigns SET result_ack_at = UTC_TIMESTAMP(3) WHERE id = ? AND result_ack_at IS NULL';

/** D40: kampane, ktoré blokujú odobranie produktu z allowlistu (§5). */
const SQL_PLANNED_FOR_PRODUCT =
  `SELECT DISTINCT ${COLUMNS.replace(/(^|, )/g, '$1c.')} FROM campaigns c ` +
  'JOIN campaign_items i ON i.campaign_id = c.id ' +
  "WHERE i.product_id = ? AND c.status IN ('scheduled','needs_key','missed','running') " +
  'ORDER BY c.id ASC';

/** D28: prekryv okna s inou NEterminálnou/aktívnou kampaňou na tých produktoch. */
const SQL_FUTURE_OVERLAPS_PREFIX =
  `SELECT DISTINCT ${COLUMNS.replace(/(^|, )/g, '$1c.')} FROM campaigns c ` +
  'JOIN campaign_items i ON i.campaign_id = c.id WHERE i.product_id IN ';
const SQL_FUTURE_OVERLAPS_SUFFIX =
  " AND c.status IN ('scheduled','needs_key','running','missed','done','partial') " +
  'AND c.date_from <= ? AND c.date_to >= ? ORDER BY c.date_from ASC, c.id ASC';

/** I11: posledný VLASTNÝ úspešný zápis (`campaign_items.status = 'ok'`). */
const SQL_LAST_OWN_WRITE =
  'SELECT c.id AS campaign_id, c.percent, c.date_from, c.date_to, i.finished_at ' +
  'FROM campaign_items i JOIN campaigns c ON c.id = i.campaign_id ' +
  "WHERE i.product_id = ? AND i.status = 'ok' AND i.finished_at IS NOT NULL " +
  'ORDER BY i.finished_at DESC, i.id DESC LIMIT 1';

/* ──────────────────────────────── mapovanie ────────────────────────────── */

interface CampaignRow {
  id: number;
  operation_id: string;
  name: string;
  kind: CampaignRecord['kind'];
  parent_campaign_id: number | null;
  percent: number;
  date_from: Date | string;
  date_to: Date | string;
  date_from_original: Date | string | null;
  mode: CampaignRecord['mode'];
  status: CampaignStatus;
  status_reason: string | null;
  fire_at: Date | string | null;
  scheduled_at: Date | string | null;
  needs_key_since: Date | string | null;
  claimed_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  items_total: number;
  items_ok: number;
  items_failed: number;
  items_uncertain: number;
  confirmed_at: Date | string | null;
  confirm_payload_hash: string | null;
  sudo_at: Date | string | null;
  result_ack_at: Date | string | null;
  created_by: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const toDateOrNull = (value: Date | string | null): Date | null =>
  value == null ? null : toDate(value);

/** `DATE` stĺpec → holé `YYYY-MM-DD` (pool má `timezone:'Z'`, D13, §2). */
const toDateOnly = (value: Date | string): DateOnly =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

function mapRow(row: CampaignRow): CampaignRecord {
  return {
    id: Number(row.id),
    operationId: row.operation_id,
    name: row.name,
    kind: row.kind,
    parentCampaignId: row.parent_campaign_id == null ? null : Number(row.parent_campaign_id),
    percent: Number(row.percent),
    dateFrom: toDateOnly(row.date_from),
    dateTo: toDateOnly(row.date_to),
    dateFromOriginal: row.date_from_original == null ? null : toDateOnly(row.date_from_original),
    mode: row.mode,
    status: row.status,
    statusReason: row.status_reason,
    fireAt: toDateOrNull(row.fire_at),
    scheduledAt: toDateOrNull(row.scheduled_at),
    needsKeySince: toDateOrNull(row.needs_key_since),
    claimedAt: toDateOrNull(row.claimed_at),
    startedAt: toDateOrNull(row.started_at),
    finishedAt: toDateOrNull(row.finished_at),
    itemsTotal: Number(row.items_total),
    itemsOk: Number(row.items_ok),
    itemsFailed: Number(row.items_failed),
    itemsUncertain: Number(row.items_uncertain),
    confirmedAt: toDateOrNull(row.confirmed_at),
    confirmPayloadHash: row.confirm_payload_hash,
    sudoAt: toDateOrNull(row.sudo_at),
    resultAckAt: toDateOrNull(row.result_ack_at),
    createdBy: Number(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

const isValidId = (id: number): boolean => Number.isInteger(id) && id > 0;

/** Mapovanie patch polí `setStatus()` na stĺpce — nič mimo tohto zoznamu. */
const PATCH_COLUMNS: Record<string, string> = {
  statusReason: 'status_reason',
  needsKeySince: 'needs_key_since',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  itemsTotal: 'items_total',
  itemsOk: 'items_ok',
  itemsFailed: 'items_failed',
  itemsUncertain: 'items_uncertain',
  resultAckAt: 'result_ack_at',
  dateFrom: 'date_from',
  dateFromOriginal: 'date_from_original',
  confirmedAt: 'confirmed_at',
  confirmPayloadHash: 'confirm_payload_hash',
  sudoAt: 'sudo_at',
};

/* ──────────────────────────────── factory ──────────────────────────────── */

export interface CampaignsRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createCampaignsRepo(deps: CampaignsRepoDeps = {}): CampaignsRepo {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const selectMany = async (
    conn: Queryable | undefined,
    sql: string,
    values: unknown[],
  ): Promise<CampaignRecord[]> => {
    const rows = await run<CampaignRow[]>(conn, sql, values);
    return (Array.isArray(rows) ? rows : []).map(mapRow);
  };

  const repo: CampaignsRepo = {
    async create(input: CreateCampaignInput, conn?: Queryable): Promise<CampaignRecord> {
      // Validácie hodnôt (percento, okno, dátumy) vlastní A7 — DB constrainty
      // sú posledná poistka (ck_campaigns_percent, ck_campaigns_window).
      const result = (await run<{ insertId?: number | bigint }>(conn, SQL_INSERT, [
        input.operationId,
        input.name,
        input.kind,
        input.parentCampaignId ?? null,
        input.percent,
        input.dateFrom,
        input.dateTo,
        input.mode,
        input.status,
        input.fireAt ?? null,
        input.scheduledAt ?? null,
        input.confirmedAt ?? null,
        input.confirmPayloadHash ?? null,
        input.sudoAt ?? null,
        input.createdBy,
      ])) ?? {};
      const id = Number(result.insertId ?? 0);
      const rows = await run<CampaignRow[]>(conn, SQL_BY_ID, [id]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) throw new Error(`Kampaň ${id} sa po zápise nedá načítať.`);
      return mapRow(row);
    },

    async getById(id: number, conn?: Queryable): Promise<CampaignRecord | null> {
      if (!isValidId(id)) return null;
      const rows = await run<CampaignRow[]>(conn, SQL_BY_ID, [id]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      return row ? mapRow(row) : null;
    },

    async list(filter: CampaignListFilter, conn?: Queryable): Promise<Paged<CampaignRecord>> {
      const page = Math.max(1, Math.trunc(filter.page ?? 1));
      const perPage = Math.min(100, Math.max(1, Math.trunc(filter.perPage ?? 20)));

      const where: string[] = [];
      const values: unknown[] = [];

      const statuses = (
        Array.isArray(filter.status) ? filter.status : filter.status ? [filter.status] : []
      ).filter(isKnownStatus);
      if (statuses.length > 0) {
        where.push(`c.status IN (${statuses.map(() => '?').join(', ')})`);
        values.push(...statuses);
      }
      if (filter.productId !== undefined) {
        if (!isValidId(filter.productId)) {
          return { data: [], page, perPage, total: 0 };
        }
        where.push('EXISTS (SELECT 1 FROM campaign_items i WHERE i.campaign_id = c.id AND i.product_id = ?)');
        values.push(filter.productId);
      }

      const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
      const countRows = await run<Array<{ total: number | bigint }>>(
        conn,
        `SELECT COUNT(*) AS total FROM campaigns c${whereSql}`,
        values,
      );
      const total = Array.isArray(countRows) ? Number(countRows[0]?.total ?? 0) : 0;

      const dataSql =
        `SELECT ${COLUMNS.replace(/(^|, )/g, '$1c.')} FROM campaigns c${whereSql} ` +
        'ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?';
      const data = await selectMany(conn, dataSql, [...values, perPage, (page - 1) * perPage]);

      return { data, page, perPage, total };
    },

    /**
     * Atomický claim (D84, I12): PRESNE jeden UPDATE s podmienkou na status.
     * Dva paralelné volania na tú istú kampaň uspejú presne raz — druhé dostane
     * `affectedRows = 0`, teda `false`. Žiadny SELECT-then-UPDATE.
     */
    async claim(id: number, allowedFrom: CampaignStatus[], conn?: Queryable): Promise<boolean> {
      if (!isValidId(id)) return false;
      const statuses = allowedFrom.filter(isKnownStatus);
      if (statuses.length === 0) return false;
      const sql =
        "UPDATE campaigns SET status = 'running', claimed_at = UTC_TIMESTAMP(3) " +
        `WHERE id = ? AND status IN (${statuses.map(() => '?').join(', ')})`;
      const result = (await run<{ affectedRows?: number }>(conn, sql, [id, ...statuses])) ?? {};
      return typeof result.affectedRows === 'number' ? result.affectedRows === 1 : false;
    },

    async setStatus(
      id: number,
      status: CampaignStatus,
      patch: Parameters<CampaignsRepo['setStatus']>[2] = {},
      conn?: Queryable,
    ): Promise<void> {
      if (!isValidId(id)) return;
      if (!isKnownStatus(status)) {
        throw new Error(`Neznámy stav kampane: ${String(status)}.`);
      }
      const sets: string[] = ['status = ?'];
      const values: unknown[] = [status];
      for (const [field, column] of Object.entries(PATCH_COLUMNS)) {
        if (patch && Object.prototype.hasOwnProperty.call(patch, field)) {
          sets.push(`${column} = ?`);
          values.push((patch as Record<string, unknown>)[field] ?? null);
        }
      }
      values.push(id);
      await run(conn, `UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`, values);
    },

    async findDue(now: UtcDate, conn?: Queryable): Promise<CampaignRecord[]> {
      return selectMany(conn, SQL_FIND_DUE, [now]);
    },

    async findMissedCandidates(threshold: UtcDate, conn?: Queryable): Promise<CampaignRecord[]> {
      return selectMany(conn, SQL_FIND_MISSED, [threshold]);
    },

    async findNeedsKey(conn?: Queryable): Promise<CampaignRecord[]> {
      return selectMany(conn, SQL_FIND_NEEDS_KEY, []);
    },

    async findRunningUnfinished(conn?: Queryable): Promise<CampaignRecord[]> {
      return selectMany(conn, SQL_FIND_RUNNING_UNFINISHED, []);
    },

    async findUnacked(conn?: Queryable): Promise<CampaignRecord[]> {
      return selectMany(conn, SQL_FIND_UNACKED, []);
    },

    async ack(id: number, conn?: Queryable): Promise<void> {
      if (!isValidId(id)) return;
      await run(conn, SQL_ACK, [id]);
    },

    async findPlannedForProduct(productId: number, conn?: Queryable): Promise<CampaignRecord[]> {
      if (!isValidId(productId)) return [];
      return selectMany(conn, SQL_PLANNED_FOR_PRODUCT, [productId]);
    },

    async findFutureOverlaps(
      productIds: number[],
      from: DateOnly,
      to: DateOnly,
      conn?: Queryable,
    ): Promise<CampaignRecord[]> {
      const unique = [...new Set(productIds.filter(isValidId))];
      if (unique.length === 0) return [];
      const sql =
        SQL_FUTURE_OVERLAPS_PREFIX +
        `(${unique.map(() => '?').join(', ')})` +
        SQL_FUTURE_OVERLAPS_SUFFIX;
      // Prekryv okien: c.date_from <= to AND c.date_to >= from.
      return selectMany(conn, sql, [...unique, to, from]);
    },

    async lastOwnWrite(productId: number, conn?: Queryable): Promise<LastOwnWrite | null> {
      if (!isValidId(productId)) return null;
      const rows = await run<
        Array<{
          campaign_id: number;
          percent: number;
          date_from: Date | string;
          date_to: Date | string;
          finished_at: Date | string;
        }>
      >(conn, SQL_LAST_OWN_WRITE, [productId]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) return null;
      return {
        percent: Number(row.percent),
        from: toDateOnly(row.date_from),
        to: toDateOnly(row.date_to),
        at: toDate(row.finished_at),
        campaignId: Number(row.campaign_id),
      };
    },
  };

  return repo;
}

/** Singleton pre route-y, engine a scheduler. */
export const campaignsRepo: CampaignsRepo = createCampaignsRepo();
