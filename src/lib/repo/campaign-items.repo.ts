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
 *  - **K6** (V4, D116) — čítacie dotazy pripájajú `LEFT JOIN`-om REFERENCIU
 *    zo zrkadla katalógu. Do `campaign_items` sa nekopíruje nič; podrobne pri
 *    `CATALOG_JOIN`. Zápisová sada (`listForWrite()`) pripojenie NEMÁ.
 *  - **K2** — `listForWrite()` je sada pre ZÁPIS: tie isté riadky ako
 *    `listByCampaign()`, ale bez `sent_payload` a `raw_response`. Executor tie
 *    dva stĺpce nikdy nečíta a hash potvrdenia (K4) potrebuje celú sadu, takže
 *    sa šetria STĹPCE, nie riadky.
 *
 * Vlastník: V4.
 */
import type {
  CampaignItemRecord,
  CampaignItemsRepo,
  DateOnly,
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

/**
 * Strop jednej strany histórie zľavy. Tabuľka v UI stránkuje po 100; 1 000 je
 * poistka proti `?perPage=10000`, nie plán — 10 000 riadkov s referenciou a
 * názvom je jedna odpoveď, ktorú prehliadač nemá ako nakresliť.
 */
const MAX_HISTORY_ROWS = 1_000;

/**
 * Strop histórie JEDNÉHO produktu. Zľava smie trvať najviac 3 mesiace (I7),
 * takže 200 zliav na jednom produkte je roky prevádzky — a zoznam, ktorý sa
 * ani nedá prečítať, nie je odpoveď. Že sa strop dosiahol, hovorí route
 * príznakom `truncated`; ticho sa neoreže nič.
 */
const MAX_PRODUCT_HISTORY_ROWS = 200;

/* ─────────────────────────────────── SQL ───────────────────────────────── */

/**
 * Stĺpce položky BEZ dvoch najťažších — `sent_payload` a `raw_response`.
 * Viď `listForWrite()`: kto ich nečíta, nemá si ich čím ťahať.
 */
const ITEM_COLUMNS_FOR_WRITE: readonly string[] = [
  'id',
  'campaign_id',
  'product_id',
  'percent',
  'position',
  'status',
  'attempt_count',
  'name_at_write',
  'price_at_preview',
  'price_at_write',
  'price_mismatch',
  'has_attributes',
  'reduction_unverifiable',
  'request_id',
  'http_status',
  'error_code',
  'error_message',
  'started_at',
  'finished_at',
];

/** Celý riadok. Jeden zdroj pravdy s `ITEM_COLUMNS_FOR_WRITE`, aby sa nerozišli. */
const ITEM_COLUMNS: readonly string[] = [
  ...ITEM_COLUMNS_FOR_WRITE,
  'sent_payload',
  'raw_response',
];

/**
 * `i.id, i.campaign_id, …` — kvalifikácia aliasom nie je kozmetika: po pripojení
 * zrkadla katalógu (nižšie) je `product_id` v dotaze dvakrát a nekvalifikovaný
 * názov by bol dvojznačný.
 */
const qualified = (columns: readonly string[], alias: string): string =>
  columns.map((column) => `${alias}.${column}`).join(', ');

const COLUMNS_FOR_WRITE = ITEM_COLUMNS_FOR_WRITE.join(', ');

/*
 * REFERENCIA SA DOPĹŇA PRI ZOBRAZENÍ (D116 / K6, invariant I11).
 *
 * `campaign_items` nesie `product_id` a `name_at_write`, teda to, čo appka
 * videla v čase zápisu. Referencia je pole zo `getFull` a žije VÝHRADNE
 * v zrkadle katalógu — do položky sa nekopíruje, inak by mala dva zdroje pravdy
 * a po obohatení produktu by tabuľka ukazovala starú hodnotu.
 *
 * `LEFT JOIN` je ZÁMER: položka smie ukazovať na produkt, ktorý v zrkadle nie je
 * (zmizol z katalógu), a taká položka sa z tabuľky NESMIE stratiť — `INNER JOIN`
 * by ju ticho zahodil. Referencia je vtedy `NULL` = „nevieme" (I11), rovnako ako
 * pri produkte, ktorý ešte NIE JE obohatený (D118). Prázdny reťazec sa nevyrába;
 * pomlčku skladá až obrazovka (`productLabel()`).
 *
 * VÝKON: `catalog_cache.product_id` je PRIMARY KEY, takže pripojenie je lookup
 * po kľúči (`eq_ref`) — stránkovanie (`listPage()`) sa tým nemení a 41 348
 * riadkov zrkadla sa neprechádza.
 */
const CATALOG_JOIN = ' LEFT JOIN catalog_cache c ON c.product_id = i.product_id';

/** Doplnené pole. `AS` menuje presne to, čo číta klient (`reference`). */
const CATALOG_COLUMNS = ', c.reference AS reference';

/** Položky + referencia — jediný zdroj pravdy pre ČÍTACIE dotazy. */
const SELECT_ENRICHED =
  `SELECT ${qualified(ITEM_COLUMNS, 'i')}${CATALOG_COLUMNS} ` +
  `FROM campaign_items i${CATALOG_JOIN}`;

const SQL_LIST = `${SELECT_ENRICHED} WHERE i.campaign_id = ? ORDER BY i.position ASC`;

/**
 * K2: celá sada pre zápis, ale bez blobov (`listForWrite()`).
 *
 * Zrkadlo katalógu sa tu ZÁMERNE NEPRIPÁJA: referenciu potrebuje obrazovka, nie
 * executor, a hash potvrdenia (K4, I3) sa počíta nad TOUTO sadou — pridané pole
 * by ho zmenilo bez toho, aby sa o zľave čokoľvek zmenilo.
 */
const SQL_LIST_FOR_WRITE =
  `SELECT ${COLUMNS_FOR_WRITE} FROM campaign_items WHERE campaign_id = ? ` +
  'ORDER BY position ASC';

const SQL_LIST_PAGE =
  `${SELECT_ENRICHED} WHERE i.campaign_id = ? ` + 'ORDER BY i.position ASC LIMIT ? OFFSET ?';

/** K2: ďalších N položiek fronty. `position` je deterministické poradie (I10). */
const SQL_NEXT_PENDING =
  `${SELECT_ENRICHED} WHERE i.campaign_id = ? AND i.status = 'pending' ` +
  'ORDER BY i.position ASC LIMIT ?';

/*
 * HISTÓRIA PRODUKT ↔ ZĽAVA (D127 bod 3) — DVA POHĽADY NAD JEDNOU TABUĽKOU
 *
 * Oba sú ČISTO ČÍTACIE a oba sú JEDEN dotaz. Žijú tu a nie v `insights.repo.ts`
 * preto, že `campaign_items` pozná toto jediné miesto — dva repozitáre nad tou
 * istou tabuľkou by boli dve definície toho, čo je „položka zľavy".
 *
 * Prečo nestačilo, čo už existovalo:
 *   · `listPage()` vracia CELÝ riadok položky vrátane blobov a nevie nič o tom,
 *     ako sa produkt menuje v zrkadle ani čo dnes stojí. Tabuľka „ktoré produkty
 *     boli v tejto zľave" potrebuje referenciu, názov a cenu — a nepotrebuje
 *     `sent_payload`.
 *   · `insightsRepo.productWrites()` (graf G3) zahadzuje `status = 'pending'`,
 *     lebo kreslí DOKONČENÉ pokusy. História „v ktorých zľavách bol tento
 *     produkt" musí ukázať aj to, čo ešte len čaká vo fronte — inak by produkt
 *     naplánovaný na zajtra vyzeral, že v žiadnej zľave nie je.
 */

/**
 * `LEFT JOIN` na zrkadlo katalógu (ten istý zámer ako pri `CATALOG_JOIN`):
 * produkt smie z katalógu zmiznúť a jeho položka sa z histórie NESMIE stratiť.
 * `reference`, `catalog_name` aj `catalog_price` sú vtedy `NULL` = „nevieme"
 * (I11), nikdy nula a nikdy pomlčka — tú skladá až obrazovka.
 *
 * `name_at_write` je iná vec než `c.name`: prvé je to, čo appka o produkte
 * vedela V ČASE ZÁPISU, druhé to, čo o ňom vie DNES. Vracajú sa obe, lebo
 * rozdiel medzi nimi je informácia (produkt sa premenoval), nie duplikát.
 */
const SQL_HISTORY_PAGE =
  'SELECT i.id, i.product_id, i.percent, i.position, i.status, i.attempt_count, ' +
  'i.name_at_write, i.price_at_preview, i.price_at_write, i.price_mismatch, ' +
  'i.reduction_unverifiable, i.error_code, i.finished_at, ' +
  'c.reference AS reference, c.name AS catalog_name, c.price AS catalog_price, ' +
  'c.enriched_at AS enriched_at, ' +
  /*
   * Toto pole rozlišuje DVA rôzne „nevieme", ktoré by inak vyzerali rovnako:
   * produkt, ktorý z katalógu ZMIZOL (riadok zrkadla neexistuje), a produkt,
   * ktorý v zrkadle je, ale NIE JE obohatený (D118) — v oboch prípadoch je
   * `reference` `NULL`. Bez neho by obrazovka nemala z čoho povedať, ktoré
   * z tých dvoch to je, a jedno by vydávala za druhé (I11).
   */
  'CASE WHEN c.product_id IS NULL THEN 0 ELSE 1 END AS in_catalog ' +
  'FROM campaign_items i' +
  CATALOG_JOIN +
  ' WHERE i.campaign_id = ? ORDER BY i.position ASC LIMIT ? OFFSET ?';

/**
 * Opačný smer: v ktorých zľavách bol tento produkt.
 *
 * `JOIN campaigns` je INNER ZÁMERNE — `fk_items_campaign` garantuje, že kampaň
 * položky existuje, takže tu sa stratiť nemá čo. (Zrkadlo katalógu je iný
 * prípad: tam žiadny FK nie je, a preto je tam `LEFT JOIN`.)
 *
 * Poradie je od najnovšieho okna: `date_from DESC`. Zoznam je stropovaný, nie
 * stránkovaný — jeden produkt v stovkách zliav je choroba, nie stránka.
 */
const SQL_PRODUCT_HISTORY =
  'SELECT i.id AS item_id, i.status, i.percent, i.position, i.attempt_count, ' +
  'i.price_at_preview, i.price_at_write, i.price_mismatch, i.error_code, ' +
  'i.started_at, i.finished_at, ' +
  'c.id AS campaign_id, c.name AS campaign_name, c.status AS campaign_status, ' +
  'c.kind AS campaign_kind, c.percent AS campaign_percent, c.date_from, c.date_to ' +
  'FROM campaign_items i JOIN campaigns c ON c.id = i.campaign_id ' +
  'WHERE i.product_id = ? ORDER BY c.date_from DESC, i.id DESC LIMIT ?';

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
  /**
   * D116 / K6 — referencia produktu doplnená zo zrkadla katalógu PRI ČÍTANÍ.
   *
   * `null` = appka ju nepozná (produkt nie je obohatený podľa D118, alebo
   * v zrkadle vôbec nie je). NIKDY neznamená „produkt referenciu nemá" (I11).
   * Nie je to stĺpec `campaign_items` — do položky sa nekopíruje.
   */
  reference: string | null;
}

/**
 * Položka bez dvoch blobov — návrat `listForWrite()`. `sentPayload`
 * a `rawResponse` tu nechýbajú omylom: keby tu boli s hodnotou `null`,
 * volajúci by nevedel, či je stĺpec prázdny, alebo len nenačítaný.
 *
 * Z toho istého dôvodu tu NIE JE ani `reference` (K6): zápisová sada zrkadlo
 * katalógu nepripája, a `null` by tvrdilo „produkt nie je obohatený" namiesto
 * „referenciu sme nečítali" (I11).
 */
export type CampaignItemWriteRow = Omit<
  CampaignItemRecordV3,
  'sentPayload' | 'rawResponse' | 'reference'
>;

/* ─────────────────── typy histórie produkt ↔ zľava (D127/3) ─────────────── */

/**
 * Jeden riadok tabuľky „ktoré produkty boli v tejto zľave".
 *
 * TROJSTAVOVOSŤ (I11) tu platí na KAŽDOM poli, ktoré je `| null`:
 *   · `reference`, `catalogName`, `catalogPrice` — `null` = produkt nie je
 *     v zrkadle, alebo nie je obohatený. NIKDY „produkt to nemá".
 *   · `nameAtWrite`, `priceAtWrite` — `null` = zápis sa ešte nestal (položka je
 *     `pending`), nie „bez názvu" a nie „cena nula".
 *
 * Zľavnená cena tu NIE JE. Počíta ju až route cez `discountedPrice()` a je to
 * ORIENTAČNÉ číslo (D4) — skutočnú zľavnenú cenu určuje shop a cez API sa
 * overiť nedá. Repozitár vracia fakty, nie aritmetiku nad nimi.
 */
export interface CampaignHistoryItem {
  itemId: number;
  productId: number;
  percent: DiscountPercent;
  position: number;
  status: ItemStatus;
  attemptCount: number;
  /** Referencia zo zrkadla (D116). `null` = nevieme. */
  reference: string | null;
  /** Názov v zrkadle DNES. `null` = produkt v zrkadle nie je. */
  catalogName: string | null;
  /** Názov, ktorý appka videla V ČASE ZÁPISU. `null` = ešte sa nezapisovalo. */
  nameAtWrite: string | null;
  /** Cenníková cena v zrkadle DNES. `null` = nevieme. */
  catalogPrice: MoneyString | null;
  priceAtPreview: MoneyString | null;
  priceAtWrite: MoneyString | null;
  priceMismatch: boolean;
  reductionUnverifiable: boolean;
  errorCode: string | null;
  finishedAt: Date | null;
  /** `true` = riadok zrkadla prešiel `getFull` (D118). */
  enriched: boolean;
  /**
   * `false` = produkt v zrkadle katalógu VÔBEC NIE JE (zmizol z katalógu).
   * Rozlišuje sa od `enriched: false`, čo znamená „riadok je, `getFull` nebol".
   */
  inCatalog: boolean;
}

/**
 * Jeden riadok tabuľky „v ktorých zľavách bol tento produkt".
 *
 * `itemStatus` je stav ZÁPISU na tomto produkte, `campaignStatus` stav celej
 * zľavy — nie je to to isté a zliať sa nesmú: zľava môže byť `done`, kým jej
 * položka skončila `failed`.
 */
export interface ProductCampaignHistoryRow {
  itemId: number;
  campaignId: number;
  campaignName: string;
  campaignStatus: string;
  campaignKind: string;
  /** Percento zľavy v hlavičke kampane. */
  campaignPercent: DiscountPercent;
  /** Percento pásma NA POLOŽKE (K3) — rozhodnuté pri potvrdení. */
  percent: DiscountPercent;
  dateFrom: DateOnly;
  dateTo: DateOnly;
  itemStatus: ItemStatus;
  position: number;
  attemptCount: number;
  priceAtPreview: MoneyString | null;
  priceAtWrite: MoneyString | null;
  priceMismatch: boolean;
  errorCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
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

/** Riadok bez blobov — presne to, čo vracia `SQL_LIST_FOR_WRITE`. */
type WriteItemRow = Omit<ItemRow, 'sent_payload' | 'raw_response'>;

/**
 * Riadok s doplnenou referenciou — presne to, čo vracia `SELECT_ENRICHED`.
 * `reference` NIE JE stĺpec `campaign_items`, preto je mimo `ItemRow`.
 */
type EnrichedItemRow = ItemRow & { reference: string | null };

/** Riadok `SQL_HISTORY_PAGE` — položka + tri polia zo zrkadla. */
type HistoryItemRow = Omit<ItemRow, 'sent_payload' | 'raw_response'> & {
  reference: string | null;
  catalog_name: string | null;
  catalog_price: string | number | null;
  enriched_at: Date | string | null;
  in_catalog: number | boolean;
};

/** Riadok `SQL_PRODUCT_HISTORY` — položka + hlavička jej kampane. */
interface ProductHistoryRow {
  item_id: number;
  status: ItemStatus;
  percent: number;
  position: number;
  attempt_count: number;
  price_at_preview: string | number | null;
  price_at_write: string | number | null;
  price_mismatch: number | boolean;
  error_code: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  campaign_id: number;
  campaign_name: string | null;
  campaign_status: string | null;
  campaign_kind: string | null;
  campaign_percent: number;
  date_from: Date | string;
  date_to: Date | string;
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

function mapWriteRow(row: WriteItemRow): CampaignItemWriteRow {
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
    startedAt: toDateOrNull(row.started_at),
    finishedAt: toDateOrNull(row.finished_at),
  };
}

function mapRow(row: EnrichedItemRow): CampaignItemRecordV3 {
  return {
    ...mapWriteRow(row),
    sentPayload: parseJsonColumn(row.sent_payload),
    rawResponse: parseJsonColumn(row.raw_response),
    /* Prázdny reťazec ani pomlčka sa tu NEVYRÁBAJÚ — `null` je „nevieme" (I11)
       a vetu z neho skladá až obrazovka. */
    reference: nonEmptyOrNull(row.reference),
  };
}

/**
 * `DATE` stĺpec chodí z drivera ako `Date` (pool má `timezone: 'Z'`) aj ako
 * string. Von ide vždy `YYYY-MM-DD` — deň zľavy je kalendárny fakt, nie okamih.
 */
function toDateOnly(value: Date | string): DateOnly {
  if (value instanceof Date) return value.toISOString().slice(0, 10) as DateOnly;
  return String(value).slice(0, 10) as DateOnly;
}

function mapHistoryRow(row: HistoryItemRow): CampaignHistoryItem {
  return {
    itemId: Number(row.id),
    productId: Number(row.product_id),
    percent: Number(row.percent) as DiscountPercent,
    position: Number(row.position),
    status: row.status,
    attemptCount: Number(row.attempt_count),
    /* Prázdny reťazec sa nevyrába — `null` je „nevieme" (I11). */
    reference: nonEmptyOrNull(row.reference),
    catalogName: nonEmptyOrNull(row.catalog_name),
    nameAtWrite: nonEmptyOrNull(row.name_at_write),
    catalogPrice: toMoney(row.catalog_price),
    priceAtPreview: toMoney(row.price_at_preview),
    priceAtWrite: toMoney(row.price_at_write),
    priceMismatch: Boolean(row.price_mismatch),
    reductionUnverifiable: Boolean(row.reduction_unverifiable),
    errorCode: row.error_code,
    finishedAt: toDateOrNull(row.finished_at),
    /* Turbopack tu už raz zahodil `if (!x)` — porovnávame explicitne. */
    enriched: row.enriched_at !== null && row.enriched_at !== undefined,
    inCatalog: Boolean(row.in_catalog),
  };
}

function mapProductHistoryRow(row: ProductHistoryRow): ProductCampaignHistoryRow {
  return {
    itemId: Number(row.item_id),
    campaignId: Number(row.campaign_id),
    campaignName: row.campaign_name === null ? '' : String(row.campaign_name),
    campaignStatus: row.campaign_status === null ? '' : String(row.campaign_status),
    campaignKind: row.campaign_kind === null ? '' : String(row.campaign_kind),
    campaignPercent: Number(row.campaign_percent) as DiscountPercent,
    percent: Number(row.percent) as DiscountPercent,
    dateFrom: toDateOnly(row.date_from),
    dateTo: toDateOnly(row.date_to),
    itemStatus: row.status,
    position: Number(row.position),
    attemptCount: Number(row.attempt_count),
    priceAtPreview: toMoney(row.price_at_preview),
    priceAtWrite: toMoney(row.price_at_write),
    priceMismatch: Boolean(row.price_mismatch),
    errorCode: row.error_code,
    startedAt: toDateOrNull(row.started_at),
    finishedAt: toDateOrNull(row.finished_at),
  };
}

/** `null`, `undefined` aj `'   '` znamenajú to isté: nevieme (I11). */
function nonEmptyOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
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
  /**
   * K2: celá sada položiek pre ZÁPIS — tie isté riadky a to isté poradie ako
   * `listByCampaign()`, ale bez `sent_payload` a `raw_response`.
   *
   * Executor tie dva stĺpce nikdy nečíta (píše ich cez `update()`), zato na
   * 30. deň 10 000-položkovej fronty je to pri KAŽDOM prechode celá história
   * odpovedí shopu v pamäti — aby sa zapísalo 200 položiek. Riadky sa
   * neubrali, lebo hash potvrdenia (K4, I3) sa prepočítava nad VŠETKÝMI;
   * na frontu po častiach (`nextPending()`) by musel byť po častiach aj hash.
   */
  listForWrite(campaignId: number, conn?: Queryable): Promise<CampaignItemWriteRow[]>;
  /**
   * K2: ďalších N `pending` položiek podľa `position` — vstup fronty po
   * častiach. Produkčného volajúceho zatiaľ NEMÁ: executor potrebuje celú
   * sadu na hash potvrdenia (K4, I3) a berie ju cez `listForWrite()`.
   */
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
  /**
   * D127 bod 3 — „ktoré produkty boli v tejto zľave", JEDNÝM dotazom.
   *
   * Ľahšia sestra `listPage()`: bez blobov, zato s referenciou, názvom a cenou
   * zo zrkadla. Položka produktu, ktorý z katalógu zmizol, v zozname ZOSTANE
   * (`LEFT JOIN`) s `reference === null`.
   */
  historyPage(
    campaignId: number,
    limit: number,
    offset: number,
    conn?: Queryable,
  ): Promise<CampaignHistoryItem[]>;
  /**
   * D127 bod 3, opačný smer — „v ktorých zľavách bol tento produkt".
   *
   * Vracia aj `pending` položky (na rozdiel od `insightsRepo.productWrites()`,
   * ktorý kreslí graf dokončených pokusov): zľava naplánovaná na zajtra je
   * odpoveď na otázku „bol/bude tento produkt v zľave", nie medzera.
   */
  historyForProduct(
    productId: number,
    limit?: number,
    conn?: Queryable,
  ): Promise<ProductCampaignHistoryRow[]>;
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
    const rows = await run<EnrichedItemRow[]>(conn, sql, values);
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

    async listForWrite(campaignId: number, conn?: Queryable): Promise<CampaignItemWriteRow[]> {
      if (!isValidId(campaignId)) return [];
      const rows = await run<WriteItemRow[]>(conn, SQL_LIST_FOR_WRITE, [campaignId]);
      return (Array.isArray(rows) ? rows : []).map(mapWriteRow);
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

    async historyPage(
      campaignId: number,
      limit: number,
      offset: number,
      conn?: Queryable,
    ): Promise<CampaignHistoryItem[]> {
      if (!isValidId(campaignId)) return [];
      const cappedLimit = Math.min(MAX_HISTORY_ROWS, Math.max(1, Math.trunc(limit)));
      const cappedOffset = Math.max(0, Math.trunc(offset));
      const rows = await run<HistoryItemRow[]>(conn, SQL_HISTORY_PAGE, [
        campaignId,
        cappedLimit,
        cappedOffset,
      ]);
      return (Array.isArray(rows) ? rows : []).map(mapHistoryRow);
    },

    async historyForProduct(
      productId: number,
      limit = MAX_PRODUCT_HISTORY_ROWS,
      conn?: Queryable,
    ): Promise<ProductCampaignHistoryRow[]> {
      if (!isValidId(productId)) return [];
      const capped = Math.min(MAX_PRODUCT_HISTORY_ROWS, Math.max(1, Math.trunc(limit)));
      const rows = await run<ProductHistoryRow[]>(conn, SQL_PRODUCT_HISTORY, [productId, capped]);
      return (Array.isArray(rows) ? rows : []).map(mapProductHistoryRow);
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
