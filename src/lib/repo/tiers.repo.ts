/**
 * Aura Zľavy — repozitár tabuľky `campaign_tiers` (KONTRAKT V3: K3).
 *
 * Pásmo = jedno percento v rámci jednej zľavy („0 predaných za 360 dní → 30 %",
 * „0 predaných za 180 dní → 20 %"). Jedna zľava ich má 1..n.
 *
 * Čo tu platí a prečo:
 *  - **`rule` je LEN na zobrazenie.** Je to JSON s filtrom, ktorým pásmo
 *    vzniklo, aby sa dal používateľovi ukázať a prípadne zopakovať. Pri zápise
 *    sa NEVYHODNOCUJE — executor berie percento z `campaign_items.percent`,
 *    ktoré padlo pri POTVRDENÍ (K3). Keby sa pásmo vyhodnocovalo pri zápise,
 *    produkt by sa medzi potvrdením a zápisom mohol presunúť do iného pásma
 *    a zlacnel by o iné percento, než aké používateľ videl (koniec I3).
 *  - **`items_count` je snímka z času potvrdenia**, nie živý počet. `campaign_items`
 *    na pásmo neodkazuje (v schéme nie je `tier_id`), takže sa dopočítať nedá —
 *    zapisuje ho ten, kto pásma zakladá, a repozitár si nič nevymýšľa.
 *  - **I9 / K3** — percento je celé číslo 1–30. Kontroluje to kód aj DB
 *    (`ck_tiers_percent`); aplikačná validácia sama nikdy nestačila.
 *  - **I4** — žiadny prístup k `audit_log`.
 *
 * Raw parametrizované SQL, žiadne ORM, žiadna interpolácia hodnôt do SQL.
 *
 * Vlastník: V4.
 */
import type { DiscountPercent, Queryable, UtcDate } from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ═══════════════════════════════ 1. Typy ══════════════════════════════════ */

export interface CampaignTierRecord {
  id: number;
  campaignId: number;
  /** Poradie pásma v zľave, 1..n. UNIQUE spolu s `campaign_id`. */
  ord: number;
  /** Ľudský popis pásma, napr. „0 predaných za 360 dní". */
  label: string;
  percent: DiscountPercent;
  /** Filter, ktorým pásmo vzniklo — LEN na zobrazenie, nikdy na zápis (K3). */
  rule: unknown;
  /** Koľko produktov padlo do pásma pri potvrdení. */
  itemsCount: number;
  createdAt: UtcDate;
}

/** Vstup pre založenie pásma. */
export interface NewCampaignTier {
  ord: number;
  label: string;
  percent: DiscountPercent;
  rule?: unknown;
  itemsCount?: number;
}

/** Čo sa dá na pásme zmeniť. `campaignId` medzi zľavami nikdy neputuje. */
export type CampaignTierPatch = Partial<
  Pick<CampaignTierRecord, 'ord' | 'label' | 'percent' | 'rule' | 'itemsCount'>
>;

export interface TiersRepoContract {
  createMany(
    campaignId: number,
    tiers: NewCampaignTier[],
    conn?: Queryable,
  ): Promise<void>;
  listByCampaign(campaignId: number, conn?: Queryable): Promise<CampaignTierRecord[]>;
  getById(id: number, conn?: Queryable): Promise<CampaignTierRecord | null>;
  update(id: number, patch: CampaignTierPatch, conn?: Queryable): Promise<void>;
  setItemsCount(id: number, count: number, conn?: Queryable): Promise<void>;
  /** Zmaže pásma zľavy. Vracia počet zmazaných riadkov. */
  deleteByCampaign(campaignId: number, conn?: Queryable): Promise<number>;
  /**
   * Nahradí pásma zľavy (zmazať + vložiť). Určené VÝHRADNE pre `draft` pred
   * potvrdením — po potvrdení by sa tým prepísalo to, čo používateľ schválil.
   * Kontrolu stavu kampane robí volajúci; repozitár stav nepozná.
   */
  replaceForCampaign(
    campaignId: number,
    tiers: NewCampaignTier[],
    conn?: Queryable,
  ): Promise<void>;
}

/* ═══════════════════════════ 2. Konštanty a SQL ═══════════════════════════ */

/** `ord` je `TINYINT UNSIGNED` — viac než 50 pásiem na jednu zľavu je nezmysel. */
const MAX_TIERS_PER_CAMPAIGN = 50;

const COLUMNS = 'id, campaign_id, ord, label, percent, rule, items_count, created_at';

const SQL_LIST =
  `SELECT ${COLUMNS} FROM campaign_tiers WHERE campaign_id = ? ORDER BY ord ASC, id ASC`;

const SQL_BY_ID = `SELECT ${COLUMNS} FROM campaign_tiers WHERE id = ? LIMIT 1`;

const SQL_INSERT_PREFIX =
  'INSERT INTO campaign_tiers (campaign_id, ord, label, percent, rule, items_count) VALUES ';

const SQL_DELETE_BY_CAMPAIGN = 'DELETE FROM campaign_tiers WHERE campaign_id = ?';

const SQL_SET_ITEMS_COUNT = 'UPDATE campaign_tiers SET items_count = ? WHERE id = ?';

/** Mapovanie patchu na stĺpce — nič mimo tohto zoznamu sa do SQL nedostane. */
const PATCH_COLUMNS: Record<string, { column: string; json?: boolean }> = {
  ord: { column: 'ord' },
  label: { column: 'label' },
  percent: { column: 'percent' },
  rule: { column: 'rule', json: true },
  itemsCount: { column: 'items_count' },
};

/* ═══════════════════════════ 3. Pomocníci ═════════════════════════════════ */

const isValidId = (id: number): boolean => Number.isInteger(id) && id > 0;

/** I9 / K3: percento je celé číslo 1–30. */
const isValidPercent = (value: unknown): value is DiscountPercent =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30;

const isValidOrd = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 255;

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

/** JSON stĺpec môže prísť ako string aj ako už rozparsovaný objekt. */
function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

interface TierRow {
  id: number;
  campaign_id: number;
  ord: number;
  label: string;
  percent: number;
  rule: unknown;
  items_count: number;
  created_at: Date | string;
}

function mapRow(row: TierRow): CampaignTierRecord {
  return {
    id: Number(row.id),
    campaignId: Number(row.campaign_id),
    ord: Number(row.ord),
    label: row.label,
    percent: Number(row.percent),
    rule: parseJsonColumn(row.rule),
    itemsCount: Number(row.items_count),
    createdAt: toDate(row.created_at),
  };
}

/** Overí vstup jedného pásma a vráti zrozumiteľnú chybu, nie SQL hlášku. */
function assertValidTier(tier: NewCampaignTier, index: number): void {
  if (!isValidOrd(tier.ord)) {
    throw new Error(`Pásmo #${index + 1}: poradie musí byť celé číslo 1–255.`);
  }
  if (!isValidPercent(tier.percent)) {
    throw new Error(
      `Pásmo #${index + 1}: percento musí byť celé číslo 1–30 (I9, K3), dostal som ` +
        `${String(tier.percent)}.`,
    );
  }
  if (typeof tier.label !== 'string' || tier.label.trim().length === 0) {
    throw new Error(`Pásmo #${index + 1}: popis pásma nesmie byť prázdny.`);
  }
}

/* ═══════════════════════════ 4. Factory ═══════════════════════════════════ */

export interface TiersRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createTiersRepo(deps: TiersRepoDeps = {}): TiersRepoContract {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  async function createMany(
    campaignId: number,
    tiers: NewCampaignTier[],
    conn?: Queryable,
  ): Promise<void> {
    if (!isValidId(campaignId)) {
      throw new Error(`Neplatné ID zľavy: ${String(campaignId)}.`);
    }
    if (tiers.length === 0) return;
    if (tiers.length > MAX_TIERS_PER_CAMPAIGN) {
      throw new Error(
        `Zľava má ${tiers.length} pásiem — maximum je ${MAX_TIERS_PER_CAMPAIGN}.`,
      );
    }

    const seenOrd = new Set<number>();
    tiers.forEach((tier, index) => {
      assertValidTier(tier, index);
      if (seenOrd.has(tier.ord)) {
        // UNIQUE `uq_tiers_campaign_ord` by to zachytil aj tak — tu je len
        // hláška, z ktorej sa dá zistiť, ktoré pásmo je duplicitné.
        throw new Error(`Pásmo #${index + 1}: poradie ${tier.ord} je v zľave dvakrát.`);
      }
      seenOrd.add(tier.ord);
    });

    const tuples = tiers.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const values: unknown[] = [];
    for (const tier of tiers) {
      values.push(
        campaignId,
        tier.ord,
        tier.label.slice(0, 191),
        tier.percent,
        tier.rule == null ? null : JSON.stringify(tier.rule),
        Math.max(0, Math.trunc(tier.itemsCount ?? 0)),
      );
    }
    await run(conn, SQL_INSERT_PREFIX + tuples, values);
  }

  async function listByCampaign(
    campaignId: number,
    conn?: Queryable,
  ): Promise<CampaignTierRecord[]> {
    if (!isValidId(campaignId)) return [];
    const rows = await run<TierRow[]>(conn, SQL_LIST, [campaignId]);
    return (Array.isArray(rows) ? rows : []).map(mapRow);
  }

  async function getById(id: number, conn?: Queryable): Promise<CampaignTierRecord | null> {
    if (!isValidId(id)) return null;
    const rows = await run<TierRow[]>(conn, SQL_BY_ID, [id]);
    const row = Array.isArray(rows) ? rows[0] : undefined;
    // Turbopack tu už raz vyhodnotil `if (!row)` ako compile-time falsy —
    // porovnávame preto explicitne (CLAUDE.md).
    return row === undefined ? null : mapRow(row);
  }

  async function update(id: number, patch: CampaignTierPatch, conn?: Queryable): Promise<void> {
    if (!isValidId(id)) return;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(patch)) {
      const spec = PATCH_COLUMNS[field];
      if (!spec) {
        throw new Error(`Neznáme pole patchu campaign_tiers: ${field}.`);
      }
      if (field === 'percent' && !isValidPercent(value)) {
        throw new Error(`Percento pásma musí byť celé číslo 1–30 (I9, K3): ${String(value)}.`);
      }
      if (field === 'ord' && !isValidOrd(value)) {
        throw new Error(`Poradie pásma musí byť celé číslo 1–255: ${String(value)}.`);
      }
      sets.push(`${spec.column} = ?`);
      if (spec.json) {
        values.push(value == null ? null : JSON.stringify(value));
      } else if (field === 'label') {
        values.push(String(value ?? '').slice(0, 191));
      } else if (field === 'itemsCount') {
        values.push(Math.max(0, Math.trunc(Number(value) || 0)));
      } else {
        values.push(value);
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    await run(conn, `UPDATE campaign_tiers SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  async function setItemsCount(id: number, count: number, conn?: Queryable): Promise<void> {
    if (!isValidId(id)) return;
    await run(conn, SQL_SET_ITEMS_COUNT, [Math.max(0, Math.trunc(Number(count) || 0)), id]);
  }

  async function deleteByCampaign(campaignId: number, conn?: Queryable): Promise<number> {
    if (!isValidId(campaignId)) return 0;
    const result =
      (await run<{ affectedRows?: number }>(conn, SQL_DELETE_BY_CAMPAIGN, [campaignId])) ?? {};
    return typeof result.affectedRows === 'number' ? result.affectedRows : 0;
  }

  async function replaceForCampaign(
    campaignId: number,
    tiers: NewCampaignTier[],
    conn?: Queryable,
  ): Promise<void> {
    if (!isValidId(campaignId)) {
      throw new Error(`Neplatné ID zľavy: ${String(campaignId)}.`);
    }
    // Bez transakcie by pád medzi DELETE a INSERT nechal zľavu bez pásiem —
    // volajúci má obe volania obaliť `withTransaction()` a poslať `conn`.
    await deleteByCampaign(campaignId, conn);
    await createMany(campaignId, tiers, conn);
  }

  return {
    createMany,
    listByCampaign,
    getById,
    update,
    setItemsCount,
    deleteByCampaign,
    replaceForCampaign,
  };
}

/** Singleton pre route-y a engine. */
export const tiersRepo: TiersRepoContract = createTiersRepo();
