/**
 * Aura Zľavy — repozitár tabuľky `campaigns` (BUILD-SPEC §3, §4; KONTRAKT O1, D84;
 * KONTRAKT V3: K2, K5).
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
 * Čo pribudlo s KONTRAKTOM V3:
 *  - **K2** — stav `queued`. Zápis je fronta, ktorá beží týždne, takže kampaň
 *    sa medzi dňami vracia do `queued` a `findQueued()` je jej vstupný bod.
 *  - **K5** — príznak `late`. Keď fronta nestihne dobehnúť do `date_from`,
 *    zvyšok sa aj tak zapíše s PÔVODNÝM oknom; `late` je fakt o čase, nie
 *    chyba. Okno (`date_to`) sa kvôli meškaniu NIKDY neskracuje (I7), preto
 *    tu neexistuje žiadna cesta, ktorá by `date_to` menila.
 *  - **K2** — `syncCountersFromItems()` prepočíta počítadlá z `campaign_items`.
 *    Počítadlá sú odvodenina, nie druhý zdroj pravdy: pri behu cez desiatky dní
 *    by inkrementovaný stĺpec nevyhnutne odišiel od skutočnosti.
 *
 * Vlastník: V4.
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

/* ───────────────── stav `queued` mimo `src/contracts.ts` (K2) ──────────── */

/**
 * `CampaignStatus` v `src/contracts.ts` (vlastník A0) ešte `queued` nepozná a
 * kontrakty needituje nikto iný (hlavička contracts.ts). Do doplnenia tam žije
 * rozšírenie tu — je to ROZŠÍRENIE, nie druhý zoznam stavov: hodnoty sa
 * naďalej berú z DB enumu v `0010_fronta_a_pasma.sql`.
 */
export type CampaignStatusV3 = CampaignStatus | 'queued';

/** Kampaň s príznakom meškania fronty (K5). */
export interface CampaignRecordV3 extends Omit<CampaignRecord, 'status'> {
  status: CampaignStatusV3;
  /** `true` = fronta nedobehla do `date_from`. Fakt o čase, nie chyba (K5). */
  late: boolean;
}

/* ─────────────────────── whitelist stavov (obrana SQL) ─────────────────── */

/**
 * Kópia enumu z DB — placeholdery sú vždy `?`, toto je len sanity filter.
 * `queued` je na konci rovnako ako v migrácii `0010_fronta_a_pasma.sql` (K2).
 */
const KNOWN_STATUSES: readonly CampaignStatusV3[] = [
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
  'queued',
];

const isKnownStatus = (value: unknown): value is CampaignStatusV3 =>
  KNOWN_STATUSES.includes(value as CampaignStatusV3);

/**
 * Stavy, v ktorých kampaň ešte má čo zapisovať. `queued` je medzi nimi —
 * fronta, ktorá čaká na zajtrajší rozpočet, je živá kampaň, nie ukončená.
 */
const OPEN_STATUSES: readonly CampaignStatusV3[] = [
  'scheduled',
  'needs_key',
  'running',
  'missed',
  'queued',
];

const OPEN_STATUS_PLACEHOLDERS = OPEN_STATUSES.map(() => '?').join(', ');

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS =
  'id, operation_id, name, kind, parent_campaign_id, percent, date_from, date_to, ' +
  'date_from_original, mode, status, status_reason, late, fire_at, scheduled_at, ' +
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

/**
 * D26: VŠETKY `scheduled` kampane bez dátumovej podmienky — pre výpočet
 * reminderov. Sentinel dátum (napr. `new Date(8.64e15)`) v `fire_at <= ?`
 * MariaDB skráti s warningom na neplatnú hodnotu a porovnanie je vždy false,
 * preto tu podmienka na dátum ÚMYSELNE nie je.
 */
const SQL_FIND_SCHEDULED =
  `SELECT ${COLUMNS} FROM campaigns WHERE status = 'scheduled' ` +
  'ORDER BY fire_at ASC, id ASC';

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
  `WHERE i.product_id = ? AND c.status IN (${OPEN_STATUS_PLACEHOLDERS}) ` +
  'ORDER BY c.id ASC';

/**
 * D28: prekryv okna s inou NEterminálnou/aktívnou kampaňou na tých produktoch.
 * `queued` je v zozname (K2) — kampaň čakajúca na rozpočet má okno rovnako
 * záväzné ako tá, ktorá práve zapisuje.
 */
const SQL_FUTURE_OVERLAPS_PREFIX =
  `SELECT DISTINCT ${COLUMNS.replace(/(^|, )/g, '$1c.')} FROM campaigns c ` +
  'JOIN campaign_items i ON i.campaign_id = c.id WHERE i.product_id IN ';
const SQL_FUTURE_OVERLAPS_SUFFIX =
  " AND c.status IN ('scheduled','needs_key','running','missed','queued','done','partial') " +
  'AND c.date_from <= ? AND c.date_to >= ? ORDER BY c.date_from ASC, c.id ASC';

/* ────────────────────────── fronta (K2) a meškanie (K5) ────────────────── */

/**
 * K2: vstup do fronty. Poradie je `date_from` vzostupne — kampaň, ktorá má
 * začať skôr, má prednosť pred tou, ktorá má čas. `id` je tie-break, aby bolo
 * poradie deterministické aj pri zhodnom dni (I10 v duchu).
 */
const SQL_FIND_QUEUED =
  `SELECT ${COLUMNS} FROM campaigns WHERE status = 'queued' ` +
  'ORDER BY date_from ASC, id ASC LIMIT ?';

/**
 * K5: kampane, ktorým už nabehlo okno, ale fronta ešte nedobehla. `EXISTS` na
 * `pending` položku je tam preto, aby sa `late` nenastavil kampani, ktorá je
 * hotová a len čaká na uzavretie.
 */
const SQL_FIND_LATE_CANDIDATES =
  `SELECT ${COLUMNS} FROM campaigns c WHERE c.late = 0 AND c.date_from <= ? ` +
  `AND c.status IN (${OPEN_STATUS_PLACEHOLDERS}) ` +
  "AND EXISTS (SELECT 1 FROM campaign_items i WHERE i.campaign_id = c.id AND i.status = 'pending') " +
  'ORDER BY c.date_from ASC, c.id ASC';

/**
 * K5: príznak sa nastavuje raz (`late = 0` v podmienke), aby opakovaný tick
 * nevyrábal ďalšie audit eventy. Okno sa NEMENÍ — žiadny `date_to` v SET (I7).
 */
const SQL_MARK_LATE = 'UPDATE campaigns SET late = 1 WHERE id = ? AND late = 0';

/**
 * K2: `missed` → `queued` po odstávke počítača. Podmienka `status = 'missed'`
 * v tom istom `UPDATE` je celá atomicita — dva kliky ani súbeh so schedulerom
 * nevrátia do fronty nič dvakrát.
 */
const SQL_REQUEUE_MISSED =
  "UPDATE campaigns SET status = 'queued', status_reason = ?, claimed_at = NULL " +
  "WHERE id = ? AND status = 'missed'";

/**
 * K2: počítadlá sú ODVODENINA z `campaign_items`, nie druhý zdroj pravdy.
 * Pri fronte bežiacej 40 dní by inkrementovaný stĺpec nevyhnutne odišiel od
 * skutočnosti; jeden `UPDATE … SET x = (SELECT …)` odísť nevie.
 */
const SQL_SYNC_COUNTERS =
  'UPDATE campaigns c SET ' +
  'c.items_total = (SELECT COUNT(*) FROM campaign_items i WHERE i.campaign_id = c.id), ' +
  "c.items_ok = (SELECT COUNT(*) FROM campaign_items i WHERE i.campaign_id = c.id AND i.status = 'ok'), " +
  "c.items_failed = (SELECT COUNT(*) FROM campaign_items i WHERE i.campaign_id = c.id AND i.status IN ('failed','not_found','blocked')), " +
  "c.items_uncertain = (SELECT COUNT(*) FROM campaign_items i WHERE i.campaign_id = c.id AND i.status = 'uncertain') " +
  'WHERE c.id = ?';

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
  status: CampaignStatusV3;
  status_reason: string | null;
  late: number | boolean;
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

/**
 * `DATE` stĺpec → holé `YYYY-MM-DD` (D13, §2).
 *
 * POZOR — tu bola chyba o CELÝ DEŇ. Pôvodné `toISOString().slice(0, 10)`
 * funguje len na stroji v UTC. `DATE` je kalendárny deň bez zóny a driver ho
 * skladá ako LOKÁLNU polnoc, takže v `Europe/Bratislava` (teda na počítači,
 * kde appka naozaj beží) dá `toISOString()` predchádzajúci deň:
 * `2026-09-01` sa prečíta ako `2026-08-31`. Posunulo by to `date_from`,
 * `date_to` aj „posledný vlastný zápis" o deň dozadu — teda okno zľavy.
 *
 * Preto sa čítajú lokálne zložky, rovnako ako v `sales.repo.ts`.
 * Regresiu drží test, ktorý beží s `TZ=Europe/Bratislava`.
 */
const toDateOnly = (value: Date | string): DateOnly => {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

function mapRow(row: CampaignRow): CampaignRecordV3 {
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
    late: Boolean(row.late),
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

/** `DateOnly` sanity — do SQL ide vždy `?`, toto je obrana proti nezmyslu. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * MariaDB kódy „o riadok sa práve bije niekto iný": 1213 = deadlock (obeť je
 * kompletne rollbacknutá), 1205 = vypršané čakanie na zámok.
 */
const LOCK_CONTENTION_ERRNOS = new Set([1213, 1205]);

/**
 * Rozpozná súboj o zámok. Dva paralelné `claim()` na ten istý riadok vedia
 * v InnoDB (kvôli aktualizácii sekundárnych indexov `ix_campaigns_status_fire`
 * a `ix_campaigns_queue`) skončiť deadlockom namiesto čistého čakania —
 * meranie na testovacej DB to dá raz za niekoľko desiatok pokusov.
 */
function isLockContention(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const errno = (error as { errno?: unknown }).errno;
  return typeof errno === 'number' && LOCK_CONTENTION_ERRNOS.has(errno);
}

/**
 * Mapovanie patch polí `setStatus()` na stĺpce — nič mimo tohto zoznamu.
 *
 * `date_to` tu ZÁMERNE NIE JE a nikdy nebude: skrátenie okna je tvar rušenia
 * zľavy a to I7 (a K5 výslovne) zakazuje. Kto potrebuje dlhšie okno, zakladá
 * predĺženie (D27), nie patch.
 */
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
  // K3: hlavička kampane nesie NAJVYŠŠIE percento pásiem. Keď sa pásma zmenia
  // pred potvrdením, hlavička sa musí dať dorovnať.
  percent: 'percent',
  // K5: meškanie fronty (bežne cez `markLate()`, tu kvôli úplnosti patchu).
  late: 'late',
};

/** Polia, ktoré sa do DB posielajú ako `TINYINT(1)`, nie ako boolean. */
const BOOLEAN_PATCH_FIELDS = new Set(['late']);

/* ──────────────────────────────── factory ──────────────────────────────── */

/** Patch `setStatus()` — nadmnožina kontraktu o polia V3 (`percent`, `late`). */
export type CampaignPatchV3 = Partial<
  Pick<
    CampaignRecordV3,
    | 'statusReason'
    | 'needsKeySince'
    | 'startedAt'
    | 'finishedAt'
    | 'itemsTotal'
    | 'itemsOk'
    | 'itemsFailed'
    | 'itemsUncertain'
    | 'resultAckAt'
    | 'dateFrom'
    | 'dateFromOriginal'
    | 'confirmedAt'
    | 'confirmPayloadHash'
    | 'sudoAt'
    | 'percent'
    | 'late'
  >
>;

/**
 * Rozhranie repozitára po KONTRAKTE V3.
 *
 * ZÁMERNE `extends CampaignsRepo` **nie je**: `CampaignStatusV3` je NADMNOŽINA
 * `CampaignStatus` (o `queued`), takže `CampaignRecordV3` nie je podtypom
 * `CampaignRecord` a rozšírenie by TypeScript odmietol. Kým `src/contracts.ts`
 * (vlastník A0) `queued` a `late` nepozná, žije úplný zoznam metód tu — a
 * hlavička contracts.ts presne toto predpisuje („kto potrebuje typ, doplní si
 * ho lokálne a nahlási to"). Tvar metód je inak zhodný s `CampaignsRepo`,
 * takže doplnenie `'queued'` do kontraktu je jediná potrebná zmena.
 *
 * Navyše oproti kontraktu: `findScheduled()` (D26 — reminder pásma potrebujú
 * všetky `scheduled` kampane bez dátumovej podmienky) a fronta V3.
 */
export interface CampaignsRepoExt {
  create(input: CreateCampaignInput, conn?: Queryable): Promise<CampaignRecordV3>;
  getById(id: number, conn?: Queryable): Promise<CampaignRecordV3 | null>;
  list(filter: CampaignListFilter, conn?: Queryable): Promise<Paged<CampaignRecordV3>>;
  claim(id: number, allowedFrom: CampaignStatusV3[], conn?: Queryable): Promise<boolean>;
  setStatus(
    id: number,
    status: CampaignStatusV3,
    patch?: CampaignPatchV3,
    conn?: Queryable,
  ): Promise<void>;
  findDue(now: UtcDate, conn?: Queryable): Promise<CampaignRecordV3[]>;
  findMissedCandidates(threshold: UtcDate, conn?: Queryable): Promise<CampaignRecordV3[]>;
  findNeedsKey(conn?: Queryable): Promise<CampaignRecordV3[]>;
  findRunningUnfinished(conn?: Queryable): Promise<CampaignRecordV3[]>;
  findUnacked(conn?: Queryable): Promise<CampaignRecordV3[]>;
  ack(id: number, conn?: Queryable): Promise<void>;
  findPlannedForProduct(productId: number, conn?: Queryable): Promise<CampaignRecordV3[]>;
  findFutureOverlaps(
    productIds: number[],
    from: DateOnly,
    to: DateOnly,
    conn?: Queryable,
  ): Promise<CampaignRecordV3[]>;
  lastOwnWrite(productId: number, conn?: Queryable): Promise<LastOwnWrite | null>;
  findScheduled(conn?: Queryable): Promise<CampaignRecordV3[]>;
  /** K2: kampane čakajúce na denný rozpočet, najskorší `date_from` prvý. */
  findQueued(limit?: number, conn?: Queryable): Promise<CampaignRecordV3[]>;
  /** K5: kampane, ktorým už nabehlo okno a fronta ešte má `pending` položky. */
  findLateCandidates(today: DateOnly, conn?: Queryable): Promise<CampaignRecordV3[]>;
  /** K5: nastaví príznak meškania. `true` = práve teraz sa zmenil z 0 na 1. */
  markLate(id: number, conn?: Queryable): Promise<boolean>;
  /** K2: prepočíta počítadlá z `campaign_items` (jediný zdroj pravdy). */
  syncCountersFromItems(id: number, conn?: Queryable): Promise<void>;
  /**
   * K2 / odpoveď 43: prepadnutá kampaň späť do fronty po odstávke počítača.
   *
   * JEDEN atomický `UPDATE … WHERE status = 'missed'`, nie `claim()` +
   * `setStatus()`. `claim()` totiž prepína na `running`, čo by tu klamalo —
   * kampaň sa nezapisuje, len čaká na rad — a pád medzi tými dvoma krokmi by
   * ju nechal visieť v `running` bez executora.
   *
   * `true` = práve teraz sa vrátila do fronty. `false` = medzitým ju zmenil
   * niekto iný (druhá karta, scheduler), a to je v poriadku.
   */
  requeueMissed(id: number, conn?: Queryable): Promise<boolean>;
}

export interface CampaignsRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createCampaignsRepo(deps: CampaignsRepoDeps = {}): CampaignsRepoExt {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const selectMany = async (
    conn: Queryable | undefined,
    sql: string,
    values: unknown[],
  ): Promise<CampaignRecordV3[]> => {
    const rows = await run<CampaignRow[]>(conn, sql, values);
    return (Array.isArray(rows) ? rows : []).map(mapRow);
  };

  const repo: CampaignsRepoExt = {
    async create(input: CreateCampaignInput, conn?: Queryable): Promise<CampaignRecordV3> {
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
      if (row === undefined) throw new Error(`Kampaň ${id} sa po zápise nedá načítať.`);
      return mapRow(row);
    },

    async getById(id: number, conn?: Queryable): Promise<CampaignRecordV3 | null> {
      if (!isValidId(id)) return null;
      const rows = await run<CampaignRow[]>(conn, SQL_BY_ID, [id]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      // Turbopack tu už raz vyhodnotil `if (!row)` ako compile-time falsy
      // a GET padal na 500 — porovnávame preto explicitne (CLAUDE.md).
      return row === undefined ? null : mapRow(row);
    },

    async list(filter: CampaignListFilter, conn?: Queryable): Promise<Paged<CampaignRecordV3>> {
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
     *
     * Deadlock (1213) a vypršaný zámok (1205) sa prekladajú na `false`, nie na
     * výnimku. Nie je to schovávanie chyby, je to tá istá odpoveď, akú dá
     * `affectedRows = 0`: „kampaň som NEZABRAL". Obeť deadlocku je v InnoDB
     * kompletne rollbacknutá, takže sa nemôže stať, že by claim čiastočne
     * prešel. Keby sa výnimka pustila von, tick by na súboji o zámok padol a
     * kampaň by podľa toho, ako to volajúci ošetrí, mohla skončiť `failed` —
     * pritom sa reálne nič zlé nestalo. Fail-closed smer je nezabrať.
     */
    async claim(id: number, allowedFrom: CampaignStatusV3[], conn?: Queryable): Promise<boolean> {
      if (!isValidId(id)) return false;
      const statuses = allowedFrom.filter(isKnownStatus);
      if (statuses.length === 0) return false;
      const sql =
        "UPDATE campaigns SET status = 'running', claimed_at = UTC_TIMESTAMP(3) " +
        `WHERE id = ? AND status IN (${statuses.map(() => '?').join(', ')})`;
      try {
        const result = (await run<{ affectedRows?: number }>(conn, sql, [id, ...statuses])) ?? {};
        return typeof result.affectedRows === 'number' ? result.affectedRows === 1 : false;
      } catch (error) {
        if (isLockContention(error)) return false;
        throw error;
      }
    },

    async setStatus(
      id: number,
      status: CampaignStatusV3,
      patch: CampaignPatchV3 = {},
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
          const raw = (patch as Record<string, unknown>)[field];
          sets.push(`${column} = ?`);
          values.push(BOOLEAN_PATCH_FIELDS.has(field) ? (raw === true ? 1 : 0) : (raw ?? null));
        }
      }
      values.push(id);
      await run(conn, `UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`, values);
    },

    async findDue(now: UtcDate, conn?: Queryable): Promise<CampaignRecordV3[]> {
      return selectMany(conn, SQL_FIND_DUE, [now]);
    },

    async findScheduled(conn?: Queryable): Promise<CampaignRecordV3[]> {
      return selectMany(conn, SQL_FIND_SCHEDULED, []);
    },

    /**
     * K2: vstup do fronty. `limit` je poistka proti tomu, aby sa do pamäte
     * natiahlo všetko, čo v DB kedy uviazlo — tick spracúva jednu kampaň.
     */
    async findQueued(limit = 50, conn?: Queryable): Promise<CampaignRecordV3[]> {
      const capped = Math.min(500, Math.max(1, Math.trunc(limit)));
      return selectMany(conn, SQL_FIND_QUEUED, [capped]);
    },

    async findLateCandidates(today: DateOnly, conn?: Queryable): Promise<CampaignRecordV3[]> {
      if (!DATE_ONLY_RE.test(today)) return [];
      return selectMany(conn, SQL_FIND_LATE_CANDIDATES, [today, ...OPEN_STATUSES]);
    },

    async markLate(id: number, conn?: Queryable): Promise<boolean> {
      if (!isValidId(id)) return false;
      const result = (await run<{ affectedRows?: number }>(conn, SQL_MARK_LATE, [id])) ?? {};
      return typeof result.affectedRows === 'number' ? result.affectedRows === 1 : false;
    },

    async requeueMissed(id: number, conn?: Queryable): Promise<boolean> {
      if (!isValidId(id)) return false;
      const result =
        (await run<{ affectedRows?: number }>(conn, SQL_REQUEUE_MISSED, [
          'Fronta znovu spustená po odstávke.',
          id,
        ])) ?? {};
      return typeof result.affectedRows === 'number' ? result.affectedRows === 1 : false;
    },

    async syncCountersFromItems(id: number, conn?: Queryable): Promise<void> {
      if (!isValidId(id)) return;
      await run(conn, SQL_SYNC_COUNTERS, [id]);
    },

    async findMissedCandidates(threshold: UtcDate, conn?: Queryable): Promise<CampaignRecordV3[]> {
      return selectMany(conn, SQL_FIND_MISSED, [threshold]);
    },

    async findNeedsKey(conn?: Queryable): Promise<CampaignRecordV3[]> {
      return selectMany(conn, SQL_FIND_NEEDS_KEY, []);
    },

    async findRunningUnfinished(conn?: Queryable): Promise<CampaignRecordV3[]> {
      return selectMany(conn, SQL_FIND_RUNNING_UNFINISHED, []);
    },

    async findUnacked(conn?: Queryable): Promise<CampaignRecordV3[]> {
      return selectMany(conn, SQL_FIND_UNACKED, []);
    },

    async ack(id: number, conn?: Queryable): Promise<void> {
      if (!isValidId(id)) return;
      await run(conn, SQL_ACK, [id]);
    },

    async findPlannedForProduct(productId: number, conn?: Queryable): Promise<CampaignRecordV3[]> {
      if (!isValidId(productId)) return [];
      return selectMany(conn, SQL_PLANNED_FOR_PRODUCT, [productId, ...OPEN_STATUSES]);
    },

    async findFutureOverlaps(
      productIds: number[],
      from: DateOnly,
      to: DateOnly,
      conn?: Queryable,
    ): Promise<CampaignRecordV3[]> {
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
      if (row === undefined) return null;
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

/* ─────────────── singleton + dočasný most na starý kontrakt ─────────────── */

const singleton = createCampaignsRepo();

/**
 * Pohľad V3 — jediný, ktorý pozná `queued` a `late`. Nový kód (fronta,
 * rozpočet, API zliav, obrazovky) importuje TENTO export.
 */
export const campaignsRepoV3: CampaignsRepoExt = singleton;

/**
 * Starý tvar podľa `src/contracts.ts` + `findScheduled()` (D26).
 *
 * `CampaignStatus` v kontraktoch `queued` nepozná, takže `CampaignRecordV3`
 * nie je jeho podtypom. Kým `contracts.ts` (vlastník A0) nedostane `'queued'`
 * a `late`, existuje presne JEDEN most — tento typ — namiesto toho, aby každý
 * volajúci castoval po svojom.
 *
 * POZOR: cez tento pohľad môže v `status` prísť aj runtime hodnota `'queued'`,
 * ktorú typ nevie pomenovať. Kto potrebuje frontu, berie `campaignsRepoV3`.
 */
export type CampaignsRepoLegacy = CampaignsRepo & {
  findScheduled(conn?: Queryable): Promise<CampaignRecord[]>;
  /** K2 — `missed` → `queued` po odstávke. Singleton ju má, typ ju len priznáva. */
  requeueMissed(id: number, conn?: Queryable): Promise<boolean>;
};

/** Singleton pre route-y, engine a scheduler (starý tvar). */
export const campaignsRepo = singleton as unknown as CampaignsRepoLegacy;
