/**
 * Aura Zľavy — repozitár tabuľky `campaign_items` (BUILD-SPEC §3, D39c, I10;
 * KONTRAKT V3: K2, K3).
 *
 * Jedna položka = jeden produkt dávky. `position` nesie deterministické
 * sekvenčné poradie zápisu (I10) — `listByCampaign()` vracia VŽDY podľa nej.
 * `price_at_preview`/`price_at_write`/`price_mismatch` sú povinná protiváha
 * D39c — nezhoda sa v tomto repozitári nikdy nezahadzuje ani neagreguje.
 *
 * `sent_payload` a `raw_response` MUSIA prísť už redigované (I1, D50, D66) —
 * repozitár ich len serializuje. I4: žiadny prístup k `audit_log`.
 *
 * Čo sa mení s KONTRAKTOM V3:
 *  - **K3** — `percent` je na POLOŽKE a rozhoduje sa pri potvrdení. Migrácia
 *    `0010` ho urobila `NOT NULL` bez DEFAULT, takže `createMany()` ho musí
 *    vždy uviesť. Do `update()` sa ZÁMERNE nedostal: keby sa dal meniť po
 *    potvrdení, produkt by mohol zlacnieť o iné percento, než aké používateľ
 *    videl a potvrdil (I3 by tým prestalo niečo znamenať).
 *  - **K2** — dávka má 5–10 tisíc položiek, nie 10. Vkladá sa preto po
 *    DÁVKACH (`INSERT … VALUES (…),(…)`, ~500 riadkov na príkaz) SEKVENČNE.
 *    Žiadny `Promise.all` — nie preto, že by to bol zápis do shopu (I10 sa
 *    týka shopu), ale preto, že paralelné dávky do jednej tabuľky si nič
 *    nezrýchlia a rozbijú poradie chýb.
 *  - **K2** — `nextPending()` je vstup fronty: zoberie ďalších N položiek
 *    podľa `position`, nie celú kampaň do pamäte.
 *
 * Vlastník: V4.
 */
import type {
  CampaignItemRecord,
  CampaignItemsRepo,
  DiscountPercent,
  ItemStatus,
  MoneyString,
  Queryable,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ───────────────────────────── konštanty ───────────────────────────────── */

/**
 * Koľko riadkov ide do jedného `INSERT`. 500 × 6 stĺpcov = 3 000 parametrov —
 * pohodlne pod limitmi MariaDB a zároveň o dva rády menej príkazov než
 * 10 000 jednotlivých INSERT-ov.
 */
const INSERT_CHUNK_ROWS = 500;

/**
 * Tvrdý strop položiek jednej zľavy. Zhodný s `ck_campaigns_items_total`
 * z migrácie `0010` (K1 bod 3) — aplikačná kontrola je len rýchlejšia hláška,
 * skutočnú brzdu drží DB.
 */
export const MAX_ITEMS_PER_CAMPAIGN = 10_000;

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS =
  'id, campaign_id, product_id, percent, position, status, attempt_count, name_at_write, ' +
  'price_at_preview, price_at_write, price_mismatch, has_attributes, ' +
  'reduction_unverifiable, request_id, http_status, error_code, error_message, ' +
  'sent_payload, raw_response, started_at, finished_at';

const SQL_LIST =
  `SELECT ${COLUMNS} FROM campaign_items WHERE campaign_id = ? ORDER BY position ASC`;

const SQL_LIST_PAGE =
  `SELECT ${COLUMNS} FROM campaign_items WHERE campaign_id = ? ` +
  'ORDER BY position ASC LIMIT ? OFFSET ?';

/** K2: ďalších N položiek fronty. `position` je deterministické poradie (I10). */
const SQL_NEXT_PENDING =
  `SELECT ${COLUMNS} FROM campaign_items WHERE campaign_id = ? AND status = 'pending' ` +
  'ORDER BY position ASC LIMIT ?';

const SQL_COUNT = 'SELECT COUNT(*) AS total FROM campaign_items WHERE campaign_id = ?';

const SQL_COUNT_BY_STATUS =
  'SELECT status, COUNT(*) AS total FROM campaign_items WHERE campaign_id = ? GROUP BY status';

/**
 * K2: podklad pre „Fronta X/Y" v hlavičke. Počíta sa nad kampaňami, ktoré
 * ešte majú čo zapisovať — hotové a zrušené do fronty nepatria.
 */
const SQL_QUEUE_TOTALS =
  'SELECT COUNT(*) AS total, ' +
  "SUM(CASE WHEN i.status = 'pending' THEN 1 ELSE 0 END) AS pending, " +
  'COUNT(DISTINCT i.campaign_id) AS campaigns ' +
  'FROM campaign_items i JOIN campaigns c ON c.id = i.campaign_id ' +
  "WHERE c.status IN ('scheduled','needs_key','running','missed','queued')";

const SQL_INSERT_PREFIX =
  'INSERT INTO campaign_items ' +
  '(campaign_id, product_id, percent, position, price_at_preview, has_attributes) VALUES ';

/** D85 / D51: zvyšné položky pri SIGTERM alebo 401/403 — len z `pending`. */
const SQL_MARK_REMAINING =
  'UPDATE campaign_items SET status = ?, error_message = ?, finished_at = UTC_TIMESTAMP(3) ' +
  "WHERE campaign_id = ? AND position >= ? AND status = 'pending'";

/* ──────────────────────────── typy V3 (K3, K2) ─────────────────────────── */

/**
 * Položka s percentom pásma (K3). `CampaignItemRecord` v `src/contracts.ts`
 * (vlastník A0) `percent` ešte nemá; keďže je to iba PRIDANÉ pole, typ zostáva
 * podtypom kontraktu a starí volajúci sa nelámu.
 */
export interface CampaignItemRecordV3 extends CampaignItemRecord {
  /** Percento rozhodnuté pri POTVRDENÍ, nie pri zápise (K3, I9: 1–30). */
  percent: DiscountPercent;
}

/** Vstup `createMany()` — `percent` je povinný, DB ho nemá ako doplniť (K3). */
export interface NewCampaignItem {
  productId: number;
  position: number;
  percent: DiscountPercent;
  priceAtPreview: MoneyString | null;
  hasAttributes: boolean;
}

/** Počty položiek podľa stavu — podklad pre pokrok fronty a stav kampane. */
export type ItemStatusCounts = Record<ItemStatus, number>;

/** Súhrn fronty pre hlavičku „Fronta X/Y" (K2). */
export interface QueueTotals {
  /** Koľko položiek ešte čaká na zápis. */
  pending: number;
  /** Koľko položiek majú živé kampane spolu. */
  total: number;
  /** Koľko kampaní sa na tom podieľa. */
  campaigns: number;
}

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
  percent: number;
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

function mapRow(row: ItemRow): CampaignItemRecordV3 {
  return {
    id: Number(row.id),
    campaignId: Number(row.campaign_id),
    productId: Number(row.product_id),
    percent: Number(row.percent),
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

/** I9 / K3: percento je celé číslo 1–30 aj na položke (`ck_items_percent`). */
const isValidPercent = (value: unknown): value is DiscountPercent =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30;

/**
 * Mapovanie patch polí `update()` na stĺpce. JSON polia sa serializujú,
 * všetko mimo zoznamu sa ODMIETNE (žiadny dynamický SQL z názvov polí).
 *
 * `percent` tu ZÁMERNE NIE JE — viď hlavičku súboru (K3, I3).
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

/**
 * Rozhranie po KONTRAKTE V3. Rozširuje `CampaignItemsRepo` — `percent` je iba
 * PRIDANÉ pole, takže starí volajúci sa typovo nelámu (a runtime im povie
 * jasnou hláškou, že percento chýba, viď `createMany()`).
 */
export interface CampaignItemsRepoExt extends CampaignItemsRepo {
  createMany(campaignId: number, items: NewCampaignItem[], conn?: Queryable): Promise<void>;
  listByCampaign(campaignId: number, conn?: Queryable): Promise<CampaignItemRecordV3[]>;
  /** Stránka položiek — 10 000 riadkov sa do jednej odpovede nesype (K2). */
  listPage(
    campaignId: number,
    limit: number,
    offset: number,
    conn?: Queryable,
  ): Promise<CampaignItemRecordV3[]>;
  /** K2: ďalších N `pending` položiek podľa `position` — vstup fronty. */
  nextPending(campaignId: number, limit: number, conn?: Queryable): Promise<CampaignItemRecordV3[]>;
  /**
   * Koľko položiek zľava má. Protipól `listPage()`: bez neho by sa celkový
   * počet dal zistiť len tak, že sa natiahnu VŠETKY riadky a spočíta sa dĺžka
   * poľa — teda presne to, čomu sa stránkovanie vyhýba.
   */
  countByCampaign(campaignId: number, conn?: Queryable): Promise<number>;
  countByStatus(campaignId: number, conn?: Queryable): Promise<ItemStatusCounts>;
  /** K2: súhrn fronty naprieč živými kampaňami (hlavička „Fronta X/Y"). */
  queueTotals(conn?: Queryable): Promise<QueueTotals>;
}

const EMPTY_COUNTS: ItemStatusCounts = {
  pending: 0,
  skipped: 0,
  ok: 0,
  failed: 0,
  uncertain: 0,
  interrupted: 0,
  not_found: 0,
  blocked: 0,
};

export function createCampaignItemsRepo(deps: CampaignItemsRepoDeps = {}): CampaignItemsRepoExt {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const selectMany = async (
    conn: Queryable | undefined,
    sql: string,
    values: unknown[],
  ): Promise<CampaignItemRecordV3[]> => {
    const rows = await run<ItemRow[]>(conn, sql, values);
    return (Array.isArray(rows) ? rows : []).map(mapRow);
  };

  const repo: CampaignItemsRepoExt = {
    /**
     * Vloží položky po dávkach po `INSERT_CHUNK_ROWS` riadkoch (K2).
     *
     * Dávky idú SEKVENČNE — `Promise.all` by tu nič nezrýchlil (jedno spojenie
     * z poolu na dávku), zato by pri chybe v strede nechal nedeterministický
     * počet vložených riadkov. Volajúci by mal celý `createMany()` obaliť
     * transakciou (`withTransaction`), inak po páde uprostred zostane kampaň
     * s časťou položiek.
     */
    async createMany(
      campaignId: number,
      items: NewCampaignItem[],
      conn?: Queryable,
    ): Promise<void> {
      if (!isValidId(campaignId)) {
        throw new Error(`Neplatné ID kampane: ${String(campaignId)}.`);
      }
      if (items.length === 0) return;
      // K1 bod 3: rovnaký strop ako `ck_campaigns_items_total` v DB.
      if (items.length > MAX_ITEMS_PER_CAMPAIGN) {
        throw new Error(
          `Zľava má ${items.length} položiek — maximum je ${MAX_ITEMS_PER_CAMPAIGN} (K1 bod 3).`,
        );
      }
      // K3: percento sa rozhoduje pri potvrdení. Bez neho sa nezapisuje nič —
      // radšej zrozumiteľná hláška než `Field 'percent' doesn't have a default value`.
      for (const item of items) {
        if (!isValidPercent(item.percent)) {
          throw new Error(
            `Položka produktu ${String(item.productId)} nemá platné percento (1–30): ` +
              `${String(item.percent)}. Percento sa rozhoduje pri potvrdení (K3).`,
          );
        }
      }

      for (let start = 0; start < items.length; start += INSERT_CHUNK_ROWS) {
        const chunk = items.slice(start, start + INSERT_CHUNK_ROWS);
        const tuples = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
        const values: unknown[] = [];
        for (const item of chunk) {
          values.push(
            campaignId,
            item.productId,
            item.percent,
            item.position,
            item.priceAtPreview,
            item.hasAttributes ? 1 : 0,
          );
        }
        await run(conn, SQL_INSERT_PREFIX + tuples, values);
      }
    },

    async listByCampaign(campaignId: number, conn?: Queryable): Promise<CampaignItemRecordV3[]> {
      if (!isValidId(campaignId)) return [];
      return selectMany(conn, SQL_LIST, [campaignId]);
    },

    async listPage(
      campaignId: number,
      limit: number,
      offset: number,
      conn?: Queryable,
    ): Promise<CampaignItemRecordV3[]> {
      if (!isValidId(campaignId)) return [];
      const cappedLimit = Math.min(1000, Math.max(1, Math.trunc(limit)));
      const cappedOffset = Math.max(0, Math.trunc(offset));
      return selectMany(conn, SQL_LIST_PAGE, [campaignId, cappedLimit, cappedOffset]);
    },

    async nextPending(
      campaignId: number,
      limit: number,
      conn?: Queryable,
    ): Promise<CampaignItemRecordV3[]> {
      if (!isValidId(campaignId)) return [];
      const capped = Math.min(1000, Math.max(1, Math.trunc(limit)));
      return selectMany(conn, SQL_NEXT_PENDING, [campaignId, capped]);
    },

    async countByCampaign(campaignId: number, conn?: Queryable): Promise<number> {
      if (!isValidId(campaignId)) return 0;
      const rows = await run<Array<{ total: number | bigint }>>(conn, SQL_COUNT, [campaignId]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      return row === undefined ? 0 : Number(row.total);
    },

    async countByStatus(campaignId: number, conn?: Queryable): Promise<ItemStatusCounts> {
      const counts: ItemStatusCounts = { ...EMPTY_COUNTS };
      if (!isValidId(campaignId)) return counts;
      const rows = await run<Array<{ status: string; total: number | bigint }>>(
        conn,
        SQL_COUNT_BY_STATUS,
        [campaignId],
      );
      for (const row of Array.isArray(rows) ? rows : []) {
        if (isKnownItemStatus(row.status)) counts[row.status] = Number(row.total ?? 0);
      }
      return counts;
    },

    async queueTotals(conn?: Queryable): Promise<QueueTotals> {
      const rows = await run<
        Array<{ total: number | bigint | null; pending: number | bigint | null; campaigns: number | bigint | null }>
      >(conn, SQL_QUEUE_TOTALS, []);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      // Turbopack tu už raz zahodil `if (!row)` — porovnávame explicitne.
      if (row === undefined) return { pending: 0, total: 0, campaigns: 0 };
      return {
        pending: Number(row.pending ?? 0),
        total: Number(row.total ?? 0),
        campaigns: Number(row.campaigns ?? 0),
      };
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
export const campaignItemsRepo: CampaignItemsRepoExt = createCampaignItemsRepo();
