/**
 * Aura Zľavy — repozitár tabuľky `campaign_items` (BUILD-SPEC §3, D39c, I10).
 *
 * Jedna položka = jeden produkt dávky. `position` nesie deterministické
 * sekvenčné poradie zápisu (I10) — `listByCampaign()` vracia VŽDY podľa nej.
 * `price_at_preview`/`price_at_write`/`price_mismatch` sú povinná protiváha
 * D39c — nezhoda sa v tomto repozitári nikdy nezahadzuje ani neagreguje.
 *
 * `sent_payload` a `raw_response` MUSIA prísť už redigované (I1, D50, D66) —
 * repozitár ich len serializuje. I4: žiadny prístup k `audit_log`.
 *
 * Vlastník: A8.
 */
import type {
  CampaignItemRecord,
  CampaignItemsRepo,
  ItemStatus,
  MoneyString,
  Queryable,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS =
  'id, campaign_id, product_id, position, status, attempt_count, name_at_write, ' +
  'price_at_preview, price_at_write, price_mismatch, has_attributes, ' +
  'reduction_unverifiable, request_id, http_status, error_code, error_message, ' +
  'sent_payload, raw_response, started_at, finished_at';

const SQL_LIST =
  `SELECT ${COLUMNS} FROM campaign_items WHERE campaign_id = ? ORDER BY position ASC`;

const SQL_INSERT_PREFIX =
  'INSERT INTO campaign_items ' +
  '(campaign_id, product_id, position, price_at_preview, has_attributes) VALUES ';

/** D85 / D51: zvyšné položky pri SIGTERM alebo 401/403 — len z `pending`. */
const SQL_MARK_REMAINING =
  'UPDATE campaign_items SET status = ?, error_message = ?, finished_at = UTC_TIMESTAMP(3) ' +
  "WHERE campaign_id = ? AND position >= ? AND status = 'pending'";

/* ──────────────────────── whitelist stavov položky ─────────────────────── */

const KNOWN_ITEM_STATUSES: readonly ItemStatus[] = [
  'pending',
  'skipped',
  'ok',
  'failed',
  'uncertain',
  'interrupted',
  'not_found',
  'blocked',
];

const isKnownItemStatus = (value: unknown): value is ItemStatus =>
  KNOWN_ITEM_STATUSES.includes(value as ItemStatus);

/* ──────────────────────────────── mapovanie ────────────────────────────── */

interface ItemRow {
  id: number;
  campaign_id: number;
  product_id: number;
  position: number;
  status: ItemStatus;
  attempt_count: number;
  name_at_write: string | null;
  price_at_preview: string | number | null;
  price_at_write: string | number | null;
  price_mismatch: number | boolean;
  has_attributes: number | boolean;
  reduction_unverifiable: number | boolean;
  request_id: string | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  sent_payload: unknown;
  raw_response: unknown;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const toDateOrNull = (value: Date | string | null): Date | null =>
  value == null ? null : toDate(value);
const toMoney = (value: string | number | null): MoneyString | null =>
  value == null ? null : String(value);

function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapRow(row: ItemRow): CampaignItemRecord {
  return {
    id: Number(row.id),
    campaignId: Number(row.campaign_id),
    productId: Number(row.product_id),
    position: Number(row.position),
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nameAtWrite: row.name_at_write,
    priceAtPreview: toMoney(row.price_at_preview),
    priceAtWrite: toMoney(row.price_at_write),
    priceMismatch: Boolean(row.price_mismatch),
    hasAttributes: Boolean(row.has_attributes),
    reductionUnverifiable: Boolean(row.reduction_unverifiable),
    requestId: row.request_id,
    httpStatus: row.http_status == null ? null : Number(row.http_status),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    sentPayload: parseJsonColumn(row.sent_payload),
    rawResponse: parseJsonColumn(row.raw_response),
    startedAt: toDateOrNull(row.started_at),
    finishedAt: toDateOrNull(row.finished_at),
  };
}

const isValidId = (id: number): boolean => Number.isInteger(id) && id > 0;

/**
 * Mapovanie patch polí `update()` na stĺpce. JSON polia sa serializujú,
 * všetko mimo zoznamu sa ODMIETNE (žiadny dynamický SQL z názvov polí).
 */
const PATCH_COLUMNS: Record<string, { column: string; json?: boolean }> = {
  position: { column: 'position' },
  status: { column: 'status' },
  attemptCount: { column: 'attempt_count' },
  nameAtWrite: { column: 'name_at_write' },
  priceAtPreview: { column: 'price_at_preview' },
  priceAtWrite: { column: 'price_at_write' },
  priceMismatch: { column: 'price_mismatch' },
  hasAttributes: { column: 'has_attributes' },
  reductionUnverifiable: { column: 'reduction_unverifiable' },
  requestId: { column: 'request_id' },
  httpStatus: { column: 'http_status' },
  errorCode: { column: 'error_code' },
  errorMessage: { column: 'error_message' },
  sentPayload: { column: 'sent_payload', json: true },
  rawResponse: { column: 'raw_response', json: true },
  startedAt: { column: 'started_at' },
  finishedAt: { column: 'finished_at' },
};

function toColumnValue(field: string, value: unknown): unknown {
  const spec = PATCH_COLUMNS[field];
  if (spec?.json) return value == null ? null : JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (field === 'errorMessage' && typeof value === 'string') return value.slice(0, 500);
  return value ?? null;
}

/* ──────────────────────────────── factory ──────────────────────────────── */

export interface CampaignItemsRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createCampaignItemsRepo(deps: CampaignItemsRepoDeps = {}): CampaignItemsRepo {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const repo: CampaignItemsRepo = {
    async createMany(
      campaignId: number,
      items: Array<{
        productId: number;
        position: number;
        priceAtPreview: MoneyString | null;
        hasAttributes: boolean;
      }>,
      conn?: Queryable,
    ): Promise<void> {
      if (!isValidId(campaignId)) {
        throw new Error(`Neplatné ID kampane: ${String(campaignId)}.`);
      }
      if (items.length === 0) return;
      // Strop dávky vynucuje guard (I2) — tu len sanity limit proti chybe volajúceho.
      if (items.length > 10) {
        throw new Error(`Dávka má ${items.length} položiek — maximum je 10 (I2).`);
      }
      const tuples = items.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const values: unknown[] = [];
      for (const item of items) {
        values.push(
          campaignId,
          item.productId,
          item.position,
          item.priceAtPreview,
          item.hasAttributes ? 1 : 0,
        );
      }
      await run(conn, SQL_INSERT_PREFIX + tuples, values);
    },

    async listByCampaign(campaignId: number, conn?: Queryable): Promise<CampaignItemRecord[]> {
      if (!isValidId(campaignId)) return [];
      const rows = await run<ItemRow[]>(conn, SQL_LIST, [campaignId]);
      return (Array.isArray(rows) ? rows : []).map(mapRow);
    },

    async update(
      id: number,
      patch: Partial<Omit<CampaignItemRecord, 'id' | 'campaignId' | 'productId'>>,
      conn?: Queryable,
    ): Promise<void> {
      if (!isValidId(id)) return;
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [field, value] of Object.entries(patch)) {
        const spec = PATCH_COLUMNS[field];
        if (!spec) {
          throw new Error(`Neznáme pole patchu campaign_items: ${field}.`);
        }
        if (field === 'status' && !isKnownItemStatus(value)) {
          throw new Error(`Neznámy stav položky: ${String(value)}.`);
        }
        sets.push(`${spec.column} = ?`);
        values.push(toColumnValue(field, value));
      }
      if (sets.length === 0) return;
      values.push(id);
      await run(conn, `UPDATE campaign_items SET ${sets.join(', ')} WHERE id = ?`, values);
    },

    async markRemaining(
      campaignId: number,
      fromPosition: number,
      status: ItemStatus,
      reason: string,
      conn?: Queryable,
    ): Promise<void> {
      if (!isValidId(campaignId)) return;
      if (!isKnownItemStatus(status)) {
        throw new Error(`Neznámy stav položky: ${String(status)}.`);
      }
      await run(conn, SQL_MARK_REMAINING, [
        status,
        reason.slice(0, 500),
        campaignId,
        Math.max(0, Math.trunc(fromPosition)),
      ]);
    },
  };

  return repo;
}

/** Singleton pre engine a route-y. */
export const campaignItemsRepo: CampaignItemsRepo = createCampaignItemsRepo();
