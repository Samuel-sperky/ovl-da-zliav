/**
 * Aura Zľavy — repozitár tabuľky `discount_presets` (KONTRAKT-V4-2026-08-28:
 * D112, K7; migrácia 0015).
 *
 * Preset = pomenovaná kombinácia filtra katalógu, pásiem s percentami a dĺžky
 * okna v dňoch. Slúži na PREDPLNENIE formulára novej zľavy, nič viac.
 *
 * Čo tu platí a prečo:
 *  - **I3 sa tým neoslabuje.** Repozitár nevie o `previewToken`, o shope ani
 *    o executorovi a nemá jedinú funkciu, ktorá by čokoľvek zapisovala do
 *    eshopu. Spustenie presetu ide tou istou cestou ako každá zľava: dry-run
 *    → potvrdenie → `POST /api/campaigns` (K7). `markUsed()` len zapíše, že
 *    preset bol použitý — nie je to povolenie na zápis.
 *  - **„Použitý" znamená „predplnil formulár".** `markUsed()` volá jediná
 *    cesta: `POST /api/presets/:id/mark-used`, ktorú si vyžiada klik na
 *    „Predplniť formulár". NEznamená to, že z presetu vznikla zľava — tú appka
 *    k presetu priradiť ani nedokáže, pretože preset do zápisovej cesty
 *    NEVSTUPUJE (I3) a kampaň vzniká z dry-runu nad dnešným katalógom. Poradie
 *    v {@link SQL_LIST} preto sľubuje presne toto a nič viac: zhora ten, po
 *    ktorom človek naposledy siahol.
 *  - **`update()` tu NIE JE** a nie je to opomenutie: preset sa needituje.
 *    Uloženie pod obsadeným menom sa ODMIETNE a obrazovka ponúka uložiť,
 *    predplniť a zmazať. Metóda bez volajúceho by bola druhá zápisová cesta do
 *    `discount_presets`, ktorú neprechádza ani jeden preklik.
 *  - **Percentá sú vstup, nie pravda.** Executor berie percento z
 *    `campaign_items.percent`, ktoré padlo pri potvrdení (K3). `tiers` v
 *    presete majú rovnakú úlohu ako `rule` v `campaign_tiers`: zopakovať to,
 *    čo si používateľ nakliknul.
 *  - **I9** — percento je celé číslo 1–30. Kontroluje to tento repozitár
 *    (v JSON stĺpci to DB skontrolovať nedokáže), dĺžku okna navyše CHECK
 *    v schéme.
 *  - **Duplicitné meno sa ODMIETNE**, neprepíše — dôvod je v hlavičke 0015
 *    a v komentári pri `create()`.
 *  - **Strop {@link MAX_PRESETS} presetov.** Zdôvodnenie pri konštante.
 *  - **I4** — žiadny prístup k `audit_log`.
 *  - **I11** — `lastUsedAt === null` znamená „ešte nepoužitý"; nedopĺňa sa
 *    z `createdAt` ani na nulu.
 *
 * Raw parametrizované SQL, žiadne ORM, žiadna interpolácia hodnôt do SQL.
 *
 * Vlastník: V4 (presety).
 */
import type {
  DiscountPercent,
  DiscountPreset,
  DiscountPresetTier,
  NewDiscountPreset,
  Queryable,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ═══════════════════════════ 1. Konštanty ═════════════════════════════════ */

/**
 * Strop počtu presetov.
 *
 * Dvadsať nie je technický limit — tabuľka by uniesla milión riadkov. Je to
 * limit ČITATEĽNOSTI: appku používa jeden človek, presety sa vyberajú zo
 * zoznamu v jednej obrazovke a nad dvadsiatkou sa z pomôcky stáva archív, v
 * ktorom sa hľadá dlhšie, než trvá filter naklikať znova. Číslo je zámerne
 * dvojnásobok stropu uložených filtrov v prehliadači (`MAX_SAVED = 10`
 * v `saved-filters.ts`), pretože preset nesie viac práce (pásma + okno), takže
 * sa oplatí držať aj varianty toho istého filtra s iným percentom.
 *
 * Strop vynucuje TENTO repozitár, nie schéma: počet riadkov sa v MariaDB dá
 * zastropovať len triggerom a trigger by bol druhá cesta k pravidlu, ktorú by
 * nikto nečítal. Súbeh dvoch vkladaní tu nehrozí — appka má jedného lokálneho
 * actora (D102) a jedno okno.
 */
export const MAX_PRESETS = 20;

/** Rovnaký strop ako `tiers.repo.ts` — viac pásiem na jednu zľavu je nezmysel. */
const MAX_TIERS_PER_PRESET = 50;

/** `VARCHAR(60)` v 0015; dlhšie meno sa do zoznamu ani nezmestí. */
const MAX_NAME_LENGTH = 60;

/** `VARCHAR(1000)` v 0015 — s rezervou nad tým, čo `catalogFilterKey()` vyrobí. */
const MAX_QUERY_LENGTH = 1000;

/**
 * Inkluzívna dĺžka okna v dňoch. Strop 90 je odvodený z I9/D29 (okno najviac
 * +3 kalendárne mesiace, najkratšie také okno má 89 dní) — rozbor je v
 * hlavičke migrácie 0015. Kalendárnu kontrolu robí `isWithinMaxWindow()`
 * pred zápisom; toto je hrubá brzda, aby sa nezmysel nedal uložiť.
 */
const MAX_DURATION_DAYS = 90;

const COLUMNS = 'id, name, filter_query, tiers, duration_days, created_at, last_used_at';

/**
 * Poradie zoznamu: hore ten, ktorým si človek NAPOSLEDY predplnil formulár,
 * pod nimi ešte nepoužité od najnovšieho.
 *
 * `last_used_at` plní VÝHRADNE {@link PresetsRepoContract.markUsed}, ktorú volá
 * `POST /api/presets/:id/mark-used` pri klikoch na „Predplniť formulár". Sľub
 * tejto vety a dáta v stĺpci sa teda kryjú — do 31. 8. 2026 nekryli:
 * `markUsed()` nemala v `src/` ani jedného volajúceho, takže `last_used_at`
 * zostávalo NULL a SQL radilo podľa stĺpca, ktorý nikto nezapisoval (D112).
 */
const SQL_LIST =
  `SELECT ${COLUMNS} FROM discount_presets ORDER BY last_used_at IS NULL ASC, ` +
  'last_used_at DESC, created_at DESC, id DESC';

const SQL_BY_ID = `SELECT ${COLUMNS} FROM discount_presets WHERE id = ? LIMIT 1`;

const SQL_BY_NAME = `SELECT ${COLUMNS} FROM discount_presets WHERE name = ? LIMIT 1`;

const SQL_COUNT = 'SELECT COUNT(*) AS total FROM discount_presets';

const SQL_INSERT =
  'INSERT INTO discount_presets (name, filter_query, tiers, duration_days) VALUES (?, ?, ?, ?)';

const SQL_DELETE = 'DELETE FROM discount_presets WHERE id = ?';

const SQL_MARK_USED = 'UPDATE discount_presets SET last_used_at = ? WHERE id = ?';

/* ═══════════════════════════ 2. Chyby ═════════════════════════════════════ */

/**
 * Preset s daným ID neexistuje.
 *
 * Vlastná trieda, aby route vedela odpovedať 404 a nie 500 — a hlavne aby
 * mazanie a `markUsed()` boli FAIL-CLOSED: „zmazal som nič" sa nikdy nesmie
 * volajúcemu javiť ako „zmazal som to, čo si chcel". Tiché `affectedRows = 0`
 * je presne ten druh úspechu, po ktorom obrazovka ukáže „hotovo" a preset
 * zostane na disku.
 */
export class PresetNotFoundError extends Error {
  readonly code = 'preset_not_found';

  constructor(readonly presetId: number) {
    super(`Preset #${presetId} neexistuje.`);
    this.name = 'PresetNotFoundError';
  }
}

/** Meno je už obsadené. Preset sa ODMIETNE, nikdy sa nepremaže. */
export class PresetNameTakenError extends Error {
  readonly code = 'preset_name_taken';

  constructor(readonly presetName: string) {
    super(
      `Preset s menom „${presetName}" už existuje. Presety sa neprepisujú — ` +
        'zmaž ten existujúci alebo zvoľ iné meno.',
    );
    this.name = 'PresetNameTakenError';
  }
}

/** Zoznam je plný. */
export class PresetLimitError extends Error {
  readonly code = 'preset_limit';

  constructor(readonly limit: number) {
    super(`Presetov je maximum ${limit}. Zmaž niektorý a skús znova.`);
    this.name = 'PresetLimitError';
  }
}

/* ═══════════════════════════ 3. Kontrakt ══════════════════════════════════ */

export interface PresetsRepoContract {
  /**
   * Vytvorí preset. Hádže {@link PresetNameTakenError} pri obsadenom mene
   * a {@link PresetLimitError} pri dosiahnutom strope.
   */
  create(input: NewDiscountPreset, conn?: Queryable): Promise<DiscountPreset>;
  /**
   * Najskôr naposledy POUŽITÉ (= naposledy predplnili formulár), potom
   * nepoužité podľa vzniku (zhora najnovšie). Viď {@link SQL_LIST}.
   */
  list(conn?: Queryable): Promise<DiscountPreset[]>;
  getById(id: number, conn?: Queryable): Promise<DiscountPreset | null>;
  getByName(name: string, conn?: Queryable): Promise<DiscountPreset | null>;
  count(conn?: Queryable): Promise<number>;
  /**
   * Zapíše čas použitia, teda okamih, kedy preset PREDPLNIL formulár novej
   * zľavy — nie okamih, kedy z neho vznikla zľava (to appka nevie, I3/I11).
   * Hádže {@link PresetNotFoundError} — fail-closed.
   */
  markUsed(id: number, at: Date, conn?: Queryable): Promise<void>;
  /** Zmaže preset. Hádže {@link PresetNotFoundError} — fail-closed. */
  remove(id: number, conn?: Queryable): Promise<void>;
}

/* ═══════════════════════════ 4. Pomocníci ════════════════════════════════ */

const isValidId = (id: number): boolean => Number.isInteger(id) && id > 0;

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

/** I9 / K3: percento je celé číslo 1–30. */
const isValidPercent = (value: unknown): value is DiscountPercent =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30;

const isValidOrd = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 255;

/** JSON stĺpec môže prísť ako string aj ako už rozparsovaný objekt. */
function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Očistí meno a overí, že po očistení niečo zostalo. Rovnaká podmienka je aj
 * v schéme (`ck_presets_name_not_blank`) — validácia v kóde dáva zrozumiteľnú
 * hlášku, DB drží pravidlo aj pre zápis mimo tohto repozitára.
 */
function normalizeName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().slice(0, MAX_NAME_LENGTH) : '';
  if (text === '') throw new Error('Meno presetu nesmie byť prázdne.');
  return text;
}

function normalizeQuery(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Filter presetu musí byť query string z `catalogFilterKey()`.');
  }
  if (value.length > MAX_QUERY_LENGTH) {
    throw new Error(
      `Filter presetu má ${value.length} znakov — maximum je ${MAX_QUERY_LENGTH}.`,
    );
  }
  // Prázdny filter je legitímny: znamená „celý katalóg bez filtra" a taký
  // preset má zmysel (napr. „všetko −10 % na týždeň"). Rozsah tým neuvoľňujeme
  // — o tom, čo sa naozaj zapíše, rozhoduje dry-run a režim rozsahu (K1).
  return value;
}

function normalizeDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Dĺžka okna musí byť celé číslo dní, dostal som ${String(value)}.`);
  }
  if (value < 1 || value > MAX_DURATION_DAYS) {
    throw new Error(
      `Dĺžka okna musí byť 1–${MAX_DURATION_DAYS} dní (I9, D29), dostal som ${value}.`,
    );
  }
  return value;
}

/**
 * Overí pásma presetu a vráti ich v normalizovanom tvare. Zámerne NEDOPLŇUJE
 * `itemsCount` — koľko produktov padne do pásma sa vie až pri dry-rune a
 * uložené číslo by bolo výmysel (I11).
 */
function normalizeTiers(value: unknown): DiscountPresetTier[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Preset musí mať aspoň jedno pásmo.');
  }
  if (value.length > MAX_TIERS_PER_PRESET) {
    throw new Error(
      `Preset má ${value.length} pásiem — maximum je ${MAX_TIERS_PER_PRESET}.`,
    );
  }

  const seenOrd = new Set<number>();
  return value.map((raw, index) => {
    if (raw === null || typeof raw !== 'object') {
      throw new Error(`Pásmo #${index + 1}: čakal som objekt s poradím a percentom.`);
    }
    const row = raw as Record<string, unknown>;
    if (!isValidOrd(row.ord)) {
      throw new Error(`Pásmo #${index + 1}: poradie musí byť celé číslo 1–255.`);
    }
    if (!isValidPercent(row.percent)) {
      throw new Error(
        `Pásmo #${index + 1}: percento musí byť celé číslo 1–30 (I9, K3), dostal som ` +
          `${String(row.percent)}.`,
      );
    }
    if (typeof row.label !== 'string' || row.label.trim() === '') {
      throw new Error(`Pásmo #${index + 1}: popis pásma nesmie byť prázdny.`);
    }
    const ord = row.ord as number;
    if (seenOrd.has(ord)) {
      throw new Error(`Pásmo #${index + 1}: poradie ${ord} je v presete dvakrát.`);
    }
    seenOrd.add(ord);

    const tier: DiscountPresetTier = {
      ord,
      label: row.label.trim().slice(0, 191),
      percent: row.percent as DiscountPercent,
    };
    return row.rule === undefined || row.rule === null ? tier : { ...tier, rule: row.rule };
  });
}

interface PresetRow {
  id: number;
  name: string;
  filter_query: string;
  tiers: unknown;
  duration_days: number;
  created_at: Date | string;
  last_used_at: Date | string | null;
}

function mapRow(row: PresetRow): DiscountPreset {
  const tiers = parseJsonColumn(row.tiers);
  return {
    id: Number(row.id),
    name: row.name,
    filterQuery: row.filter_query,
    // Čítanie NEVALIDUJE: riadok v DB už raz cez validáciu prešiel a rozbitý
    // JSON nesmie zhodiť zoznam presetov. Prázdne pole je viditeľná porucha,
    // vymyslené pásmo by nebolo.
    tiers: Array.isArray(tiers) ? (tiers as DiscountPresetTier[]) : [],
    durationDays: Number(row.duration_days),
    createdAt: toDate(row.created_at),
    // I11: `null` je „ešte nepoužitý", nie „použitý v epoche".
    lastUsedAt: row.last_used_at === null ? null : toDate(row.last_used_at),
  };
}

/** MariaDB errno 1062 = porušenie UNIQUE (`uq_presets_name`). */
function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { errno?: number }).errno === 1062
  );
}

/* ═══════════════════════════ 5. Factory ══════════════════════════════════ */

export interface PresetsRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createPresetsRepo(deps: PresetsRepoDeps = {}): PresetsRepoContract {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  async function count(conn?: Queryable): Promise<number> {
    const rows = await run<Array<{ total: number | bigint }>>(conn, SQL_COUNT, []);
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return row === undefined ? 0 : Number(row.total);
  }

  async function getById(id: number, conn?: Queryable): Promise<DiscountPreset | null> {
    if (!isValidId(id)) return null;
    const rows = await run<PresetRow[]>(conn, SQL_BY_ID, [id]);
    const row = Array.isArray(rows) ? rows[0] : undefined;
    // Turbopack tu už raz vyhodnotil `if (!row)` ako compile-time falsy —
    // porovnávame preto explicitne (CLAUDE.md).
    return row === undefined ? null : mapRow(row);
  }

  async function getByName(name: string, conn?: Queryable): Promise<DiscountPreset | null> {
    if (typeof name !== 'string' || name.trim() === '') return null;
    const rows = await run<PresetRow[]>(conn, SQL_BY_NAME, [
      name.trim().slice(0, MAX_NAME_LENGTH),
    ]);
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return row === undefined ? null : mapRow(row);
  }

  async function list(conn?: Queryable): Promise<DiscountPreset[]> {
    const rows = await run<PresetRow[]>(conn, SQL_LIST, []);
    return (Array.isArray(rows) ? rows : []).map(mapRow);
  }

  async function create(input: NewDiscountPreset, conn?: Queryable): Promise<DiscountPreset> {
    const name = normalizeName(input.name);
    const filterQuery = normalizeQuery(input.filterQuery);
    const tiers = normalizeTiers(input.tiers);
    const durationDays = normalizeDuration(input.durationDays);

    // Strop sa kontroluje PRED vložením a hláškou, nie pádom na UNIQUE — nič
    // iné ho nedrží (rozbor pri `MAX_PRESETS`).
    if ((await count(conn)) >= MAX_PRESETS) throw new PresetLimitError(MAX_PRESETS);

    let insertedId: number;
    try {
      const result = await run<{ insertId?: number | bigint }>(conn, SQL_INSERT, [
        name,
        filterQuery,
        JSON.stringify(tiers),
        durationDays,
      ]);
      insertedId = Number(result?.insertId ?? 0);
    } catch (error) {
      // Meno drží UNIQUE v schéme, nie kontrola pred vložením: tá by bola len
      // rada, ktorá sa dá pretiecť. Duplicitu prekladáme na vlastnú chybu.
      if (isDuplicateKey(error)) throw new PresetNameTakenError(name);
      throw error;
    }

    const created = await getById(insertedId, conn);
    if (created === null) {
      throw new Error(`Preset „${name}" sa vložil, ale nedá sa prečítať (id ${insertedId}).`);
    }
    return created;
  }

  /*
   * `update()` tu bola do 31. 8. 2026 a je zmazaná, nie zakomentovaná: nemala
   * v `src/` ani jedného volajúceho a preset sa needituje (rozbor v hlavičke).
   * Kryl ju len test nad DB, takže to bola metóda, ktorú appka nikdy nespustí —
   * a mŕtva zápisová cesta do `discount_presets` je zavádzajúca práve preto, že
   * vyzerá ako podporovaná. Zmena presetu = zmazať a uložiť znova.
   */

  async function markUsed(id: number, at: Date, conn?: Queryable): Promise<void> {
    if (!isValidId(id)) throw new PresetNotFoundError(id);
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
      throw new Error('Čas použitia presetu musí byť platný Date.');
    }
    // Existencia sa overuje ČÍTANÍM, nie z `affectedRows`: MariaDB pri UPDATE
    // vracia počet SKUTOČNE zmenených riadkov, takže „nastav ten istý čas
    // znova" dá nulu — a z nuly by sa stalo falošné „preset neexistuje".
    if ((await getById(id, conn)) === null) throw new PresetNotFoundError(id);
    await run(conn, SQL_MARK_USED, [at, id]);
  }

  async function remove(id: number, conn?: Queryable): Promise<void> {
    if (!isValidId(id)) throw new PresetNotFoundError(id);
    const result = (await run<{ affectedRows?: number }>(conn, SQL_DELETE, [id])) ?? {};
    // FAIL-CLOSED: nula zmazaných riadkov je chyba, nie ticho úspešné mazanie.
    if (Number(result.affectedRows ?? 0) === 0) throw new PresetNotFoundError(id);
  }

  return { create, list, getById, getByName, count, markUsed, remove };
}

/** Singleton pre route-y a UI. */
export const presetsRepo: PresetsRepoContract = createPresetsRepo();
