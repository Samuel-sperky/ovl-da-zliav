/**
 * Aura Zľavy — DENNÝ ROZPOČET ZÁPISOV (KONTRAKT V3: K2).
 *
 * Zápis prestal byť akcia a stal sa frontou, ktorá beží týždne. Shop dovolí
 * **200 zápisov na UTC deň** a 20/min; z toho plynie všetko ostatné:
 *
 *  - **Spotreba ZÁPISOV sa počíta VÝHRADNE z auditu** — počet `write_attempt` za
 *    aktuálny UTC deň. Od 31. 8. 2026 sa od stropu odpočítavajú aj ČÍTANIA na
 *    tom istom kľúči (dráha `product_read`: obohacovanie D118 a
 *    `reduction-check`) — nie sú to zápisy, ale míňajú tú istú kvótu 200/deň,
 *    a bez toho rozpočet povolil dávku, ktorú shop uprostred odmietol (429).
 *    Zdroj čítaní je počítadlo `shop_read_budget`, nie druhá kópia auditu. Žiadny paralelný počítadlový stĺpec, ktorý by sa mohol
 *    rozísť s realitou (K2). `audit_log` je append-only (I4), takže sa
 *    počítadlo nedá ani obísť, ani vynulovať.
 *  - **Čítania sa odpočítavajú LEN NAD REZERVOU** `WRITE_QUOTA_RESERVE`
 *    (31. 8. 2026, ten istý deň, večer). Prvá verzia odpočítania brala čítania
 *    z celého stropu, takže vyčerpaná čítacia dráha znížila rozpočet zápisov
 *    z 200 na 40 — a pri `daily_write_budget` na úrovni rezervy alebo pod ňou
 *    (napr. fail-closed 1) až na NULU. Čítanie tým vedelo appke odobrať
 *    schopnosť zapísať zľavu; `GET /api/catalog/reduction-check` je pritom
 *    cesta bez brány pôvodu (GET), takže to dokázala aj cudzia stránka
 *    otvorená v tom istom prehliadači. Rezerva je slice kvóty, na ktorý sa
 *    čítacia dráha ANI PRI PLNOM VYČERPANÍ nedostane.
 *  - **`write_attempt`, nie `write_ok`.** Rozpočet míňa POKUS, nie úspech —
 *    request odišiel do shopu bez ohľadu na to, čo sa vrátilo. (Runaway strop
 *    naopak počíta `write_ok`/`write_uncertain`, lebo tam ide o to, koľko
 *    zápisov shop naozaj videl. Sú to dve rôzne veci a preto dve rôzne čísla.)
 *  - **Deň je UTC deň**, nie deň v `Europe/Bratislava`. Je to strop SHOPU a
 *    ten sa resetuje o UTC polnoci. Aj tak sa počíta cez `Intl.DateTimeFormat`
 *    s explicitnou zónou (`todayInZone(now, 'UTC')`), nie cez `toISOString()` —
 *    jedna cesta k dátumu, jedna vec, ktorá sa môže pokaziť.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *  1. **Strop shopu a náš rozpočet sú DVE čísla, nie jedno.** 200/deň je hranica
 *     politiky kľúča na strane shopu; `settings.daily_write_budget` je naša
 *     brzda, ktorá sa dá posunúť len NADOL. `describeWriteBudgetLimits()` ich
 *     vracia vždy spolu, aby ich žiadna odpoveď nezliala do jedného.
 *  2. **Čísla limitov sa neopisujú, importujú sa** z `shop/rate-limits.ts`.
 *     Jedna ručne prepísaná kópia limitu už raz zabila synchronizáciu katalógu.
 *  3. **Nečitateľné počítadlo NIE JE nula.** `0` znamená „dnes sa nič neminulo",
 *     teda „zapisuj" — a to je povoľujúca odpoveď na neistotu. Keď počítadlo
 *     neodpovie číslom, hodí sa `BudgetUnavailableError`; volajúci z toho robí
 *     `budget_unknown` a fronta pokračuje zajtra. Žiadne `?? 0`.
 *
 * Čo tu ZÁMERNE nie je:
 *  - žiadny zápis (I4 — do `audit_log` sa píše jedine cez `lib/audit/write.ts`),
 *  - žiadne rozhodnutie o stave kampane. Tento modul odpovie „koľko sa dnes
 *    ešte zmestí"; či z toho plynie `queued`, rozhoduje `executor.ts`.
 *
 * Vlastník: V5.
 */
import type { DateOnly, Queryable, UtcDate } from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { addDays, todayInZone } from '@/lib/domain/dates';
import { productReadBudget } from '@/lib/repo/read-budget.repo';
import { SHOP_KEYED_LIMIT, nextUtcDayReset } from '@/lib/shop/rate-limits';
import { READ_LANE_LIMITS } from '@/lib/shop/read-budget';

/* ═══════════════════════════ konštanty (K2) ═══════════════════════════════ */

/**
 * Rozpočtový deň je UTC deň — je to strop shopu, nie náš (K2).
 * Logický deň zliav zostáva `Europe/Bratislava` (`LOGIC_TIME_ZONE`); tieto dva
 * dni sa NESMÚ zamieňať a preto tu má rozpočtová zóna vlastné meno.
 */
export const BUDGET_TIME_ZONE = 'UTC';

/**
 * Strop SHOPU na UTC deň (`ck_settings_daily_budget`, migrácia 0010).
 *
 * Číslo sa sem NEOPISUJE — berie sa z `shop/rate-limits.ts`, ktorý je jediný
 * zdroj pravdy o limitoch shopu. Raz už jedna ručne prepísaná kópia („300 za
 * deň" vs. „300 za minútu") stála celý katalóg; druhá kópia by to zopakovala
 * na zápisovej strane, kde je cena chyby ban kľúča na 10 minút.
 */
export const MAX_DAILY_WRITE_BUDGET = SHOP_KEYED_LIMIT.perUtcDay;

/** Predvolený rozpočet, keď nastavenia hodnotu neponúkajú (K2). */
export const DEFAULT_DAILY_WRITE_BUDGET = SHOP_KEYED_LIMIT.perUtcDay;

/**
 * Fail-closed rozpočet: „neviem" znamená 1 zápis na deň. Fronta sa tým
 * SPOMALÍ na 1 zápis za UTC deň, nezastaví sa — a to platí aj vtedy, keď je
 * čítacia dráha `product_read` úplne vyčerpaná: čítania sa odpočítavajú len
 * nad `WRITE_QUOTA_RESERVE`, a pri rozpočte 1 je rezerva celá tá jednotka.
 * (K1 bod 1, zhodné s `FAIL_CLOSED_SCOPE` vo V4.)
 *
 * Do 31. 8. 2026 to bola NEPRAVDA: odpočítanie čítaní z celého stropu spravilo
 * z fail-closed spomalenia fail-closed ZASTAVENIE (`remaining = max(0, 1 - 0 -
 * 160) = 0`, `checkDailyBudget()` odmietol celú frontu). Stráži to test
 * `test/unit/rozpocet-rezerva-zapisov.spec.ts`.
 */
export const FAIL_CLOSED_DAILY_BUDGET = 1;

/**
 * REZERVA ZÁPISOV — slice dennej kvóty kľúča, na ktorý čítania NEDOSAHUJÚ.
 *
 * Číslo je ODVODENÉ, nie zvolené: je to presne tá časť kvóty kľúča, ktorú
 * čítacia dráha `product_read` nedokáže minúť ani pri plnom vyčerpaní
 * (200 − 160 = 40). Preto sa ním nič nepreplní — `spent + čítania + zvyšok`
 * nikdy neprekročí strop shopu (dôkaz je v teste rezervy).
 *
 * Čo z toho plynie:
 *  - vyčerpaná čítacia dráha zníži rozpočet zápisov najviac na rezervu,
 *    NIKDY na nulu — cudzí GET teda appke nevie odobrať schopnosť zapísať,
 *  - pri rozpočte nastavenom NA alebo POD rezervu (vrátane fail-closed 1)
 *    čítania neodpočítavajú vôbec: celý taký rozpočet je rezerva.
 *
 * Rezerva na strane ČÍTANÍ (`ENRICH_QUOTA_RESERVE`) je iná vec a chráni sondy
 * vnútri čítacej dráhy; táto chráni zápisy pred čítaniami.
 */
export const WRITE_QUOTA_RESERVE = Math.max(
  0,
  MAX_DAILY_WRITE_BUDGET - READ_LANE_LIMITS.product_read.perUtcDay,
);

/**
 * K2 — runaway strop je `daily_write_budget` + 20 %. Pri 200/deň by pôvodných
 * 60/h zamklo zápisy počas úplne normálnej prevádzky.
 */
export const RUNAWAY_HEADROOM_RATIO = 1.2;

/**
 * Podlaha runaway stropu. Rozpočet sa dá nastaviť nadol až na 1/deň a runaway
 * strop je poistka proti SPLAŠENIU, nie nástroj na spomalenie — nesmie klesnúť
 * pod pôvodných 60/h (D79), inak by ho zamkol jeden rýchly manuálny retry.
 */
export const MIN_RUNAWAY_LIMIT_PER_HOUR = 60;

/** Audit event, ktorý míňa rozpočet. Jediný (K2). */
const BUDGET_COUNTED_EVENT = 'write_attempt';

/* ═════════════════════════════ pomocníci ══════════════════════════════════ */

/** Aktuálny **UTC** deň rozpočtu (`YYYY-MM-DD`). */
export function budgetDay(now: UtcDate = new Date()): DateOnly {
  return todayInZone(now, BUDGET_TIME_ZONE);
}

/** Celé číslo v rozsahu, inak `fallback`. Nikdy `NaN`, nikdy mimo CHECKu. */
function clampBudget(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const truncated = Math.trunc(parsed);
  if (truncated < 1 || truncated > MAX_DAILY_WRITE_BUDGET) return fallback;
  return truncated;
}

/**
 * K2 — runaway strop odvodený od denného rozpočtu (+20 %), nikdy pod
 * `MIN_RUNAWAY_LIMIT_PER_HOUR`.
 */
export function runawayLimitFor(
  dailyBudget: number,
  floor = MIN_RUNAWAY_LIMIT_PER_HOUR,
): number {
  const budget = clampBudget(dailyBudget, DEFAULT_DAILY_WRITE_BUDGET);
  return Math.max(floor, Math.ceil(budget * RUNAWAY_HEADROOM_RATIO));
}

/* ══════════════ rezerva zápisov: čítania nesmú vyhladovať zápisy ══════════ */

/**
 * Koľko z rozpočtu `dailyBudget` je vyhradené VÝHRADNE zápisom.
 *
 * Pri rozpočte nižšom než `WRITE_QUOTA_RESERVE` je rezervou celý rozpočet —
 * inak by malý ručne nastavený rozpočet (1…39) mohli čítania stlačiť na nulu,
 * teda presne tá chyba, pred ktorou rezerva stojí.
 */
export function writeReserveFor(dailyBudget: number): number {
  const budget = clampBudget(dailyBudget, DEFAULT_DAILY_WRITE_BUDGET);
  return Math.min(budget, WRITE_QUOTA_RESERVE);
}

/**
 * Koľko z dnešných ČÍTANÍ na tom istom kľúči sa smie odpočítať od rozpočtu
 * zápisov. Odpočítava sa len tá časť, ktorá sa zmestí NAD rezervu:
 *
 *   `charged = min(čítania, rozpočet − rezerva)`
 *
 * Zvyšok čítaní sa nezahodí ako nepravda — shop ho naozaj videl — ale zápisom
 * ho účtovať nemôžeme, lebo by z rezervy nezostalo nič. Presnosť tu prehráva
 * s tým, že cudzie čítanie nesmie appke odobrať schopnosť zapísať zľavu; strop
 * shopu sa tým aj tak neprekročí, lebo rezerva je odvodená ako `200 − 160`.
 */
export function chargeableKeyedReads(dailyBudget: number, keyedReads: number): number {
  const budget = clampBudget(dailyBudget, DEFAULT_DAILY_WRITE_BUDGET);
  const reads = Number.isFinite(keyedReads) ? Math.max(0, Math.trunc(keyedReads)) : 0;
  const shared = Math.max(0, budget - writeReserveFor(budget));
  return Math.min(reads, shared);
}

/* ═══════════════════ odkiaľ sa berie výška rozpočtu ═══════════════════════ */

/**
 * Zdroj výšky rozpočtu. Produkčne je to `settings.repo` (V4), ktorý má
 * `readScope()` s fail-closed čítaním.
 *
 * Návratové typy sú ZÁMERNE `unknown`: `src/contracts.ts` (vlastník A0) pole
 * `dailyWriteBudget` ešte nepozná, takže `SettingsRecord` ho nemá. Keby tu
 * stál presný tvar, engine by sa buď nedal skompilovať, alebo by si vynútil
 * zmenu v cudzom súbore. Hodnota sa preto číta obranne — a keď tam nie je,
 * platí kontraktový default, nie `NaN`.
 */
export interface DailyBudgetSource {
  /** K1 bod 1 — fail-closed čítanie rozsahu a rozpočtu (V4). */
  readScope?(conn?: Queryable): Promise<unknown>;
  /** Staršia cesta: celé nastavenia. Chýbajúce pole = kontraktový default. */
  get?(conn?: Queryable): Promise<unknown>;
}

/** Bezpečné vytiahnutie poľa z neznámeho tvaru — nikdy nehodí. */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/**
 * Výška denného rozpočtu.
 *
 * Poradie: explicitný `override` (flags/test) → `readScope()` → `get()` →
 * kontraktový default. Volanie, ktoré HODÍ, je „neviem" a „neviem" znamená
 * `FAIL_CLOSED_DAILY_BUDGET`. Chýbajúce POLE je niečo iné než zlyhané volanie:
 * repozitár odpovedal, len je staršieho tvaru — vtedy platí kontraktový
 * default (200), inak by sa fronta zastavila kvôli tvaru typu, nie kvôli faktu.
 */
export async function resolveDailyBudget(
  source?: DailyBudgetSource,
  override?: number,
): Promise<number> {
  if (override !== undefined) {
    const explicit = clampBudget(override, Number.NaN);
    if (Number.isFinite(explicit)) return explicit;
  }
  if (source === undefined) return DEFAULT_DAILY_WRITE_BUDGET;

  if (typeof source.readScope === 'function') {
    try {
      const scope = await source.readScope();
      // `readScope()` je sám fail-closed (V4): pri nečitateľnej DB vráti 1.
      return clampBudget(fieldOf(scope, 'dailyWriteBudget'), FAIL_CLOSED_DAILY_BUDGET);
    } catch {
      return FAIL_CLOSED_DAILY_BUDGET;
    }
  }
  if (typeof source.get === 'function') {
    try {
      const settings = await source.get();
      return clampBudget(fieldOf(settings, 'dailyWriteBudget'), DEFAULT_DAILY_WRITE_BUDGET);
    } catch {
      return FAIL_CLOSED_DAILY_BUDGET;
    }
  }
  return DEFAULT_DAILY_WRITE_BUDGET;
}

/* ═══════════════════ odkiaľ sa berie spotreba (audit) ═════════════════════ */

/**
 * Počítadlo `write_attempt` za jeden UTC deň. Produkčne to je `SELECT` nad
 * `audit_log`; injektáž existuje kvôli testom engine bez MariaDB.
 */
export interface WriteAttemptCounter {
  countWriteAttemptsOn(day: DateOnly): Promise<number>;
}

/** `YYYY-MM-DD` → `YYYY-MM-DD 00:00:00.000` (hranica UTC dňa, `ts` je v UTC). */
const dayStart = (day: DateOnly): string => `${day} 00:00:00.000`;

/**
 * Jediný SQL tohto modulu a je to `SELECT` (I4). Polootvorený interval
 * `[deň, deň+1)` — žiadne `BETWEEN`, ktoré by na hrane dňa počítalo dvakrát.
 */
const SQL_WRITE_ATTEMPTS_ON_DAY =
  'SELECT COUNT(*) AS total FROM audit_log ' +
  'WHERE event_type = ? AND ts >= ? AND ts < ?';

/**
 * Text pre nečitateľnú spotrebu. Jedna veta, dve miesta (produkčný adaptér
 * a `createBudget()`), aby sa v logoch nedali odlíšiť dva rôzne dôvody toho
 * istého faktu: nevieme, koľko sme dnes minuli.
 */
const SPENT_UNREADABLE =
  'Spotreba rozpočtu (`write_attempt` za UTC deň) sa nepodarilo prečítať — počítadlo neodpovedalo číslom.';

/**
 * Produkčné počítadlo nad `audit_log`.
 *
 * Nečitateľná odpoveď HODÍ `BudgetUnavailableError`. Predtým sa vracala `0`,
 * teda „dnes sa nič neminulo" — a to je povoľujúca odpoveď na neistotu, presne
 * to, čo hlavička tohto modulu zakazuje. Volajúci hodenie už spracovať vie
 * (`executor.ts` z toho robí `budget_unknown`, route-y `null`); ticho vrátenú
 * nulu spracovať nevie nikto, lebo sa nedá odlíšiť od pravdivej nuly.
 */
export const auditWriteAttemptCounter: WriteAttemptCounter = {
  async countWriteAttemptsOn(day: DateOnly): Promise<number> {
    const rows = await poolQuery<Array<{ total: unknown }>>(SQL_WRITE_ATTEMPTS_ON_DAY, [
      BUDGET_COUNTED_EVENT,
      dayStart(day),
      dayStart(addDays(day, 1)),
    ]);
    const row = Array.isArray(rows) ? rows[0] : undefined;
    // Turbopack tu už raz zahodil `if (!row)` ako compile-time falsy.
    if (row === undefined) throw new BudgetUnavailableError(SPENT_UNREADABLE);
    const total = typeof row.total === 'number' ? row.total : Number(row.total);
    if (!Number.isFinite(total)) throw new BudgetUnavailableError(SPENT_UNREADABLE);
    return Math.max(0, Math.trunc(total));
  },
};

/* ═══════════════════════════ stav rozpočtu ════════════════════════════════ */

export interface BudgetStatus {
  /** UTC deň, za ktorý sa počítalo. */
  day: DateOnly;
  /** Denný strop (`settings.daily_write_budget`). */
  budget: number;
  /** Koľko `write_attempt` už dnes odišlo. */
  spent: number;
  /**
   * Koľko ČÍTANÍ s tým istým kľúčom (`product:read`, dráha `product_read`) sa
   * dnes už minulo. Odpočítava sa z rovnakého stropu ako zápisy — je to jedna
   * kvóta jedného kľúča (31. 8. 2026). `undefined` = volajúci čítania nesleduje.
   */
  keyedReadsToday?: number;
  /**
   * Koľko z `keyedReadsToday` sa naozaj odpočítalo od rozpočtu — teda tá časť,
   * ktorá sa zmestila nad rezervu. Rozdiel proti `keyedReadsToday` je presne
   * to, čo rezerva zápisom zachránila; bez tohto čísla by sa nedalo povedať,
   * prečo zvyšok nesedí s odčítaním „strop − zápisy − čítania".
   */
  keyedReadsCharged?: number;
  /**
   * Koľko z `budget` je vyhradené zápisom (`writeReserveFor()`).
   * `undefined` = volajúci si podsúva vlastný `BudgetSource` a rezervu
   * nepočíta (testy engine) — nie „rezerva je nula".
   */
  writeReserve?: number;
  /** Koľko sa dnes ešte zmestí. Nikdy záporné. */
  remaining: number;
  /** `remaining === 0`. Informácia, nie chyba (K2, odpoveď 59). */
  exhausted: boolean;
}

/**
 * Počítadlo ČÍTANÍ na zápisovom kľúči (dráha `product_read`). Tvar je zámerne
 * najmenší možný — `ReadBudget` z `lib/shop/read-budget.ts` ho spĺňa, takže sa
 * dá podsunúť priamo `productReadBudget`, a engine nezávisí na jeho type.
 *
 * `known: false` znamená „počítadlo sa nedalo prečítať"; `used` je vtedy už
 * fail-closed domnienka (celý strop dráhy), takže sa nič nedopočítava tu.
 */
export interface KeyedReadUsage {
  status(): Promise<{ readonly used: number; readonly known: boolean }>;
}

export interface BudgetDeps {
  /** Default: `SELECT` nad `audit_log`. */
  counter?: WriteAttemptCounter;
  /**
   * Počítadlo čítaní na TOM ISTOM kľúči. `null` = zámerne sa neodpočítavajú
   * (testy engine bez DB). Nezadané: produkčne `productReadBudget`, ale len
   * keď si volajúci nepodsúva ani vlastné počítadlo zápisov — kto si podsúva
   * audit, podsúva si aj čítania.
   */
  keyedReads?: KeyedReadUsage | null;
  /** Default: nič — potom platí `DEFAULT_DAILY_WRITE_BUDGET`. */
  settingsRepo?: DailyBudgetSource;
  /** Tvrdý override výšky rozpočtu (flags, testy). */
  dailyBudget?: number;
  now?: () => Date;
}

export interface BudgetSource {
  /** K2 — spotreba za aktuálny UTC deň, počítaná z auditu. */
  spentToday(): Promise<number>;
  /** K2 — koľko sa dnes ešte zmestí. */
  remainingToday(): Promise<BudgetStatus>;
}

/**
 * Strop na čítanie rozpočtu. Zaseknutá DB nevyhodí výnimku, len nikdy
 * neodpovie — a `await` bez stropu by držal executor (aj zápisový mutex)
 * donekonečna. Zaseknutie preto prekladáme na CHYBU, ktorú volajúci už vie
 * spracovať fail-closed: kampaň ide do fronty, nie do zápisu.
 */
const BUDGET_READ_TIMEOUT_MS = 5_000;

/** Zaseknuté alebo nedostupné čítanie rozpočtu. Nikdy neznamená „zapisuj". */
export class BudgetUnavailableError extends Error {
  constructor(message = 'Rozpočet zápisov sa nepodarilo prečítať v limite.') {
    super(message);
    this.name = 'BudgetUnavailableError';
  }
}

/** `promise` s tvrdým stropom — po `ms` odmietne, nech vnútro robí čokoľvek. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BudgetUnavailableError()), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createBudget(deps: BudgetDeps = {}): BudgetSource {
  const counter = deps.counter ?? auditWriteAttemptCounter;
  const now = deps.now ?? ((): Date => new Date());
  /*
   * JEDEN KĽÚČ, JEDNA KVÓTA (31. 8. 2026).
   *
   * `shop_write` má scope `product:read` aj `product:edit` a shop účtuje 200
   * volaní/UTC deň NA KĽÚČ. Od D118 na ňom beží obohacovanie katalógu (dráha
   * `product_read`, strop 160/deň) — takže rozpočet zápisov, ktorý počíta len
   * `write_attempt` z auditu, hlásil „ostáva 200" v deň, keď kľúč mal reálne
   * minutých 160. Fronta sa rozbehla, shop odpovedal 429 a kampaň sa dopísala
   * spolovice. Čítania sa preto z toho istého stropu ODPOČÍTAVAJÚ.
   *
   * PREDNOSŤ ZÁPISOV NIE JE V PORADÍ, JE V REZERVE. Dávka sa pýta výhradne
   * čítacej dráhy a poradie je čisto časové — kto príde skôr, ten číta alebo
   * zapisuje. Jediná prednosť, ktorú zápisy naozaj majú, je
   * `WRITE_QUOTA_RESERVE`: `min(rozpočet, 40)` volaní, ktoré čítania
   * odpočítať NEMÔŽU. Do 31. 8. 2026 tu stála veta „zápisy majú prednosť pred
   * obohacovaním" a v kóde jej neodpovedalo nič; teraz jej odpovedá rezerva
   * a nič viac. Rezerva na strane čítaní (`ENRICH_QUOTA_RESERVE`) je iná vec —
   * tá chráni sondy vnútri čítacej dráhy.
   */
  const keyedReads =
    deps.keyedReads !== undefined
      ? deps.keyedReads
      : deps.counter === undefined
        ? productReadBudget
        : null;

  // Aj injektované počítadlo môže vrátiť nečíslo. „Neviem" sa ani tu neprekladá
  // na nulu — hodí sa rovnaká chyba ako pri zaseknutom čítaní.
  const spent = async (): Promise<number> => {
    const total = await counter.countWriteAttemptsOn(budgetDay(now()));
    if (!Number.isFinite(total)) throw new BudgetUnavailableError(SPENT_UNREADABLE);
    return Math.max(0, Math.trunc(total));
  };

  return {
    spentToday: spent,

    async remainingToday(): Promise<BudgetStatus> {
      const day = budgetDay(now());
      // Obe čítania pod jedným stropom — visieť môže ktorékoľvek z nich.
      const budget = await withDeadline(
        resolveDailyBudget(deps.settingsRepo, deps.dailyBudget),
        BUDGET_READ_TIMEOUT_MS,
      );
      const used = await withDeadline(spent(), BUDGET_READ_TIMEOUT_MS);
      /*
       * `status()` sám nehodí: nečitateľné počítadlo vracia `known: false` a
       * `used = strop dráhy`, teda fail-closed domnienku „čítania sú minuté".
       * Radšej menej zápisov dnes než 429 uprostred dávky v produkcii.
       */
      const reads =
        keyedReads === null
          ? { used: 0, known: true }
          : await withDeadline(keyedReads.status(), BUDGET_READ_TIMEOUT_MS);
      const keyedReadsToday = Math.max(0, Math.trunc(reads.used));
      // Rezerva: čítania sa odpočítavajú LEN nad ňou. Bez toho by vyčerpaná
      // čítacia dráha (aj cudzím GETom) zobrala appke schopnosť zapísať.
      const charged = chargeableKeyedReads(budget, keyedReadsToday);
      const remaining = Math.max(0, budget - used - charged);
      return {
        day,
        budget,
        spent: used,
        keyedReadsToday,
        keyedReadsCharged: charged,
        writeReserve: writeReserveFor(budget),
        remaining,
        exhausted: remaining === 0,
      };
    },
  };
}

/** Skratky nad `createBudget()` — jedno volanie, žiadny stav. */
export async function spentToday(deps: BudgetDeps = {}): Promise<number> {
  return createBudget(deps).spentToday();
}

export async function remainingToday(deps: BudgetDeps = {}): Promise<BudgetStatus> {
  return createBudget(deps).remainingToday();
}

/* ════════════════════════ odhad dobehnutia fronty ═════════════════════════ */

export interface FinishEstimate {
  /** Koľko položiek sa ešte musí zapísať. */
  pending: number;
  /** Rýchlosť, s ktorou sa počítalo (zápisov na deň). */
  perDay: number;
  /** Koľko ĎALŠÍCH UTC dní fronta pobeží. `0` = dobehne ešte dnes. */
  days: number;
  /** UTC deň dobehnutia (`YYYY-MM-DD`). */
  date: DateOnly;
}

export interface FinishEstimateOptions {
  /**
   * Koľko sa DNES ešte zmestí. Default je celý denný rozpočet — odhad pre
   * frontu, ktorá sa ešte len zaraďuje (K5, K6). Pri bežiacej fronte sem patrí
   * `remainingToday().remaining`, inak by odhad tvrdil, že dnešok je celý voľný.
   */
  remainingToday?: number;
  now?: UtcDate;
}

/**
 * K5/K6 — kedy fronta dobehne. Čisté počítanie, žiadna DB.
 *
 * 8 000 položiek pri 200/deň = 40 dní; presne toto číslo drží návrh zľavy
 * s budúcim `date_from` (K5) aj varovanie o kratšej platnosti kľúča (K6).
 * Odhad je zámerne optimistický len o dnešok: nezapočítava zlyhania ani
 * odstávky PC — je to plán, nie sľub.
 */
export function estimateFinish(
  pending: number,
  dailyBudget: number,
  opts: FinishEstimateOptions = {},
): FinishEstimate {
  const perDay = clampBudget(dailyBudget, DEFAULT_DAILY_WRITE_BUDGET);
  const left = Number.isFinite(pending) ? Math.max(0, Math.trunc(pending)) : 0;
  const today = budgetDay(opts.now ?? new Date());

  if (left === 0) {
    return { pending: 0, perDay, days: 0, date: today };
  }

  const todayCapacityRaw =
    opts.remainingToday === undefined ? perDay : Math.trunc(opts.remainingToday);
  const todayCapacity = Number.isFinite(todayCapacityRaw)
    ? Math.min(perDay, Math.max(0, todayCapacityRaw))
    : perDay;

  if (left <= todayCapacity) {
    return { pending: left, perDay, days: 0, date: today };
  }

  const days = Math.ceil((left - todayCapacity) / perDay);
  return { pending: left, perDay, days, date: addDays(today, days) };
}

/* ═════════════ dva rôzne stropy, ktoré sa nesmú zamieňať (K2) ═════════════ */

/**
 * DVA STROPY, NIE JEDEN.
 *
 *  - **Strop shopu** (`shopPerUtcDay`, `shopPerMinute`) je tvrdá hranica
 *    politiky priradenej kľúču. Za ňou shop kľúč zabanuje; appka ju zmeniť
 *    nevie a nikdy ju sama nezdvihne — je to administratívny úkon na strane
 *    shopu (`docs/20-BACKLOG-SHOP-API.md`, bod B7).
 *  - **Náš rozpočet** (`configuredPerDay`, `settings.daily_write_budget`) je
 *    nastavenie tejto appky. Dá sa posunúť len NADOL (1 … strop shopu) — je to
 *    brzda, nie povolenie.
 *
 * Keď sa tieto dve čísla zlejú do jedného, používateľ prestane rozumieť tomu,
 * čo môže zmeniť sám (náš rozpočet) a na čo musí niekoho poprosiť (strop shopu).
 * Preto ich každá odpoveď uvádza OBE vedľa seba a nikdy len jedno.
 */
export interface WriteBudgetLimits {
  /** Strop shopu na kľúč a UTC deň. Appka ho nezdvihne. */
  shopPerUtcDay: number;
  /** Strop shopu na minútu. Drží ho pauza medzi zápismi (I10, D46). */
  shopPerMinute: number;
  /** Náš denný strop z nastavení. `null` = nepodarilo sa prečítať (P7). */
  configuredPerDay: number | null;
  /** `true` = nastavili sme si menej, než shop dovolí (vedomá brzda). */
  belowShopCap: boolean;
  /** Kedy sa strop shopu obnoví — UTC polnoc (`rate-limits.nextUtcDayReset`). */
  nextResetAt: Date;
  /** Koľko sekúnd do obnovy. Nikdy záporné. */
  secondsToReset: number;
}

/**
 * Popis oboch stropov naraz. Čisté počítanie — žiadna DB, žiadny `process.env`,
 * takže to smie volať aj route, aj obrazovka.
 *
 * `configuredPerDay` mimo rozsahu 1…strop shopu sa berie ako „neviem" (`null`),
 * nie ako platná hodnota: rovnako fail-closed ako `clampBudget()` vyššie.
 */
export function describeWriteBudgetLimits(
  configuredPerDay: number | null,
  now: UtcDate = new Date(),
): WriteBudgetLimits {
  const shopPerUtcDay = SHOP_KEYED_LIMIT.perUtcDay;
  const parsed =
    typeof configuredPerDay === 'number' && Number.isFinite(configuredPerDay)
      ? Math.trunc(configuredPerDay)
      : null;
  const configured = parsed !== null && parsed >= 1 && parsed <= shopPerUtcDay ? parsed : null;
  const nextResetAt = nextUtcDayReset(now);
  return {
    shopPerUtcDay,
    shopPerMinute: SHOP_KEYED_LIMIT.perMinute,
    configuredPerDay: configured,
    belowShopCap: configured !== null && configured < shopPerUtcDay,
    nextResetAt,
    secondsToReset: Math.max(0, Math.ceil((nextResetAt.getTime() - now.getTime()) / 1000)),
  };
}
