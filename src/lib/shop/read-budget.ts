/**
 * Aura Zľavy — ZDIEĽANÝ DENNÝ ROZPOČET ČÍTANÍ ZO SHOPU
 * (KONTRAKT-DOKONCENIE-2026-08-12: A4; KONTRAKT V3: K7).
 *
 * ČO TENTO MODUL RIEŠI
 * --------------------
 * Zo shopu číta viac než jedna vec: synchronizácia katalógu (411 stránok, beh
 * na dva dni) a synchronizácia predajnosti (`engine/sales-sync.ts`). Keby si
 * každá viedla vlastné počítadlo, obe by si mysleli, že majú celý denný strop —
 * a shop by ich po prekročení zabanoval (predvolene na 10 minút), pravdepodobne
 * uprostred noci, keď to nikto nevidí. Počítadlo je preto JEDNO a žije tu.
 *
 * TRI DRÁHY, KTORÉ SA NESMÚ ZLIAŤ
 * -------------------------------
 * Shop rozpočtuje inak podľa toho, či volanie nesie kľúč
 * (`docs/api/sperky-api-v4.md`, čísla v `@/lib/shop/rate-limits`):
 *
 *  - `anon`         — čítania BEZ kľúča (katalóg, D48/I1): 30/min a 300/UTC deň,
 *                     rozpočtované na **zdrojovú IP**, teda spoločne so všetkým
 *                     ostatným, čo z tohto počítača na shop chodí,
 *  - `orders`       — čítania S objednávkovým kľúčom (predajnosť): 20/min
 *                     a 200/UTC deň, rozpočtované **na kľúč**,
 *  - `product_read` — čítania `getFull` so zápisovým kľúčom v scope
 *                     `product:read` (obohacovanie katalógu D118, overenie
 *                     zľavy v shope): tiež 20/min a 200/UTC deň **na kľúč**,
 *                     ale na INÝ kľúč než `orders`.
 *
 * Zliať ich do jedného čísla by znamenalo, že jedna dráha vyčerpá strop tej
 * druhej — preto je `lane` súčasťou kľúča počítadla, nie detail. `orders`
 * a `product_read` majú rovnaké ČÍSLO a napriek tomu sú to dve dráhy: shop
 * účtuje na kľúč a sú to dva rôzne kľúče (`orders_read` vs. `shop_write`).
 * Do 31. 8. 2026 sa obohacovanie aj `reduction-check` účtovali do `anon`,
 * takže si brali strop katalógovej synchronizácie, ktorá beží dni.
 *
 * ČO SEM NEPATRÍ
 * --------------
 * **Zápisový rozpočet (K2).** Zápisy do shopu sa počítajú z `audit_log`
 * (`write_attempt`) a majú vlastnú kvótu na zápisový kľúč. Tento modul o nich
 * nevie a vedieť nesmie: keby sa sem začali účtovať, ticho by ukradli rozpočet
 * fronte, ktorá beží týždne (K7 vs. K2).
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *  1. **Rezervuje sa PRED volaním, nie po ňom.** Request, ktorý skončil na 429
 *     alebo timeoute, sa do stropu shopu počíta rovnako ako úspešný. Účtovať až
 *     úspech by znamenalo, že sa strop prekročí presne vtedy, keď shop hlási,
 *     že sme na hrane.
 *  2. **Fail-closed pri nečitateľnom počítadle.** Keď sa stav nedá prečítať
 *     (DB je preč), rezervácia sa NEUDELÍ a `known` je `false`. Radšej
 *     nesynchronizovať než dostať ban.
 *  3. **Deň je UTC deň.** Strop resetuje shop o polnoci UTC, nie appka o polnoci
 *     v Bratislave. Počíta sa cez `todayInZone(now, 'UTC')` (rovnako ako
 *     `engine/budget.ts`), nikdy cez `toISOString().slice(0, 10)`.
 *  4. **Čísla sa neduplikujú, importujú sa** z `@/lib/shop/rate-limits`. Práve
 *     na zámene „300 za deň" a „300 za minútu" sa raz rozbil celý katalóg.
 *  5. **Modul nikdy nehádže.** Volajúci (katalóg, predajnosť) sú fail-soft behy,
 *     ktoré nesmú zhodiť scheduler.
 *
 * Modul je čistý: žiadna DB, žiadny `process.env`. Perzistenciu dodáva
 * `ReadBudgetStore` — produkčne `@/lib/repo/read-budget.repo`, v testoch pamäť.
 *
 * Vlastník: V7 (katalóg).
 */
import type { DateOnly, Logger, UtcDate } from '@/contracts';

import { todayInZone } from '@/lib/domain/dates';
import {
  ANON_READS_PER_MINUTE,
  ANON_READS_PER_UTC_DAY,
  RATE_SAFETY_FACTOR,
  SHOP_KEYED_LIMIT,
  nextUtcDayReset,
} from '@/lib/shop/rate-limits';

/* ═══════════════════════════ 1. Dráhy a stropy ════════════════════════════ */

/** Rozpočtová vetva shopu. Viac o rozdiele v doc-bloku vyššie. */
export type ReadLane = 'anon' | 'orders' | 'product_read';

/** Zóna, v ktorej sa počíta rozpočtový deň — strop resetuje SHOP o polnoci UTC. */
export const READ_BUDGET_TIME_ZONE = 'UTC';

export interface ReadLaneLimits {
  readonly perMinute: number;
  readonly perUtcDay: number;
}

/**
 * Strop vetvy S KĽÚČOM, spočítaný RAZ pre obe kľúčové dráhy (`orders`
 * a `product_read`). Číslo je rovnaké, počítadlá NIE — zdieľaná je aritmetika,
 * nie spotreba (viď doc-blok vyššie).
 */
const KEYED_LANE_LIMITS: ReadLaneLimits = {
  perMinute: Math.floor(SHOP_KEYED_LIMIT.perMinute * RATE_SAFETY_FACTOR),
  perUtcDay: Math.floor(SHOP_KEYED_LIMIT.perUtcDay * RATE_SAFETY_FACTOR),
};

/**
 * Stropy po dráhach — vždy už po odrátaní rezervy `RATE_SAFETY_FACTOR`.
 * Anonymné hodnoty sa NEPREPOČÍTAVAJÚ znova, berú sa hotové z `rate-limits`,
 * aby existovalo jediné miesto, kde sa dá pomýliť.
 */
export const READ_LANE_LIMITS: Readonly<Record<ReadLane, ReadLaneLimits>> = {
  anon: {
    perMinute: ANON_READS_PER_MINUTE,
    perUtcDay: ANON_READS_PER_UTC_DAY,
  },
  orders: KEYED_LANE_LIMITS,
  product_read: KEYED_LANE_LIMITS,
};

/** Okno minútového stropu. Je klzavé a jeho začiatok appka nepozná. */
const MINUTE_MS = 60_000;

/* ═══════════════════════════ 2. Perzistencia ══════════════════════════════ */

/**
 * Úložisko počítadla. Zámerne najmenší možný tvar — produkčne `shop_read_budget`
 * (migrácia 0013), v testoch mapa v pamäti.
 */
export interface ReadBudgetStore {
  /** Koľko čítaní už dráha za daný UTC deň minula. */
  used(lane: ReadLane, day: DateOnly): Promise<number>;
  /** Pripočíta `count` čítaní a vráti NOVÚ hodnotu počítadla. */
  add(lane: ReadLane, day: DateOnly, count: number): Promise<number>;
}

/** Úložisko v pamäti — testy a fallback, ktorý sa po reštarte vynuluje. */
export function createMemoryReadBudgetStore(): ReadBudgetStore {
  const counters = new Map<string, number>();
  const key = (lane: ReadLane, day: DateOnly): string => `${lane}:${day}`;

  return {
    async used(lane, day) {
      return counters.get(key(lane, day)) ?? 0;
    },
    async add(lane, day, count) {
      const next = (counters.get(key(lane, day)) ?? 0) + Math.max(0, Math.trunc(count));
      counters.set(key(lane, day), next);
      return next;
    },
  };
}

/* ═══════════════════════════ 3. Stav a rezervácia ═════════════════════════ */

export interface ReadBudgetStatus {
  readonly lane: ReadLane;
  /** UTC deň, za ktorý sa počítalo (`YYYY-MM-DD`). */
  readonly day: DateOnly;
  /** Denný strop po odrátaní rezervy (anon 240 z 300). */
  readonly limit: number;
  /** Koľko čítaní už dnes odišlo. Pri `known: false` je to fail-closed `limit`. */
  readonly used: number;
  /** Koľko sa ich dnes ešte zmestí. */
  readonly remaining: number;
  /** `true` = dnes už nič neodíde; pokračuje sa po `resetAt`. */
  readonly exhausted: boolean;
  /** Polnoc UTC — kedy sa strop obnoví. */
  readonly resetAt: UtcDate;
  /** Minútový strop dráhy (anon 24 z 30). */
  readonly minuteLimit: number;
  /**
   * Koľko čítaní odišlo za poslednú minútu. Je to počítadlo V PAMÄTI PROCESU:
   * po reštarte je 0 a nič sa tým nekazí, lebo tempo drží pauza medzi
   * stránkami (`MIN_ANON_READ_PAUSE_MS`). Slúži na to, aby UI vedelo povedať,
   * prečo sa práve teraz čaká.
   */
  readonly usedThisMinute: number;
  /** `false` = počítadlo sa nedalo prečítať; hodnoty sú fail-closed domnienka. */
  readonly known: boolean;
}

export interface ReadReservation {
  /** Koľko čítaní si volajúci pýtal. */
  readonly requested: number;
  /** Koľko sa mu ich ušlo. `0` = dnes už nič (viď `status.resetAt`). */
  readonly granted: number;
  readonly status: ReadBudgetStatus;
}

export interface ReadBudget {
  readonly lane: ReadLane;
  /** Stav bez rezervovania — pre UI a pre rozhodovanie „oplatí sa začať?". */
  status(): Promise<ReadBudgetStatus>;
  /**
   * Rezervuje `count` čítaní na dnešný UTC deň. Volá sa PRED requestom
   * (neúspešný request sa do stropu shopu počíta rovnako ako úspešný).
   */
  reserve(count?: number): Promise<ReadReservation>;
}

export interface ReadBudgetDeps {
  store: ReadBudgetStore;
  /** Dráha, na ktorú je počítadlo naviazané. Default `anon` (katalóg). */
  lane?: ReadLane;
  now?: () => UtcDate;
  logger?: Logger;
}

/**
 * Počítadlo naviazané na jednu dráhu.
 *
 * Súbežnosť: rezervácia je `SELECT` + `UPDATE`, teda nie atomická. Vedomé
 * zjednodušenie — čítacie behy sú v tejto appke serializované vlastnými zámkami
 * (`running` v runneroch) a strop má 20 % rezervu presne na to, aby ho jedno
 * preteklé čítanie neprekročilo. Atomické počítadlo by si vyžiadalo zámok nad
 * riadkom, ktorý by držala aj tá strana, čo len číta stav pre UI.
 */
export function createReadBudget(deps: ReadBudgetDeps): ReadBudget {
  const lane: ReadLane = deps.lane ?? 'anon';
  const now = deps.now ?? ((): UtcDate => new Date());
  const limits = READ_LANE_LIMITS[lane];

  /** Časy posledných čítaní (epoch ms) — len na `usedThisMinute`. */
  const recentReads: number[] = [];

  function usedThisMinute(atMs: number): number {
    while (recentReads.length > 0 && atMs - (recentReads[0] as number) >= MINUTE_MS) {
      recentReads.shift();
    }
    return recentReads.length;
  }

  function snapshot(at: UtcDate, used: number, known: boolean): ReadBudgetStatus {
    const capped = Math.max(0, Math.trunc(used));
    return {
      lane,
      day: todayInZone(at, READ_BUDGET_TIME_ZONE),
      limit: limits.perUtcDay,
      used: capped,
      remaining: Math.max(0, limits.perUtcDay - capped),
      exhausted: capped >= limits.perUtcDay,
      resetAt: nextUtcDayReset(at),
      minuteLimit: limits.perMinute,
      usedThisMinute: usedThisMinute(at.getTime()),
      known,
    };
  }

  async function status(): Promise<ReadBudgetStatus> {
    const at = now();
    try {
      const used = await deps.store.used(lane, todayInZone(at, READ_BUDGET_TIME_ZONE));
      return snapshot(at, used, true);
    } catch (error) {
      // Fail-closed: neznámy stav sa hlási ako vyčerpaný rozpočet, nie ako
      // voľná ruka (rovnako ako `budget.resolveDailyBudget()` na zápisoch).
      deps.logger?.warn('read_budget_unreadable', {
        lane,
        error: error instanceof Error ? error.message : String(error),
      });
      return snapshot(at, limits.perUtcDay, false);
    }
  }

  return {
    lane,
    status,

    async reserve(count = 1): Promise<ReadReservation> {
      const requested = Math.max(0, Math.trunc(count));
      const at = now();
      const day = todayInZone(at, READ_BUDGET_TIME_ZONE);

      if (requested === 0) {
        return { requested: 0, granted: 0, status: await status() };
      }

      try {
        const used = await deps.store.used(lane, day);
        const remaining = Math.max(0, limits.perUtcDay - used);
        const granted = Math.min(remaining, requested);
        if (granted === 0) return { requested, granted: 0, status: snapshot(at, used, true) };

        const total = await deps.store.add(lane, day, granted);
        const atMs = at.getTime();
        for (let i = 0; i < granted; i += 1) recentReads.push(atMs);
        return { requested, granted, status: snapshot(at, total, true) };
      } catch (error) {
        deps.logger?.warn('read_budget_reserve_failed', {
          lane,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fail-closed: nevieme počítať ⇒ nečítame.
        return { requested, granted: 0, status: snapshot(at, limits.perUtcDay, false) };
      }
    },
  };
}

/* ═══════════════════════════ 4. Pomôcky na plánovanie ═════════════════════ */

/**
 * Koľko ĎALŠÍCH UTC dní potrvá prečítať `pages` stránok, keď sa dnes zmestí
 * ešte `remainingToday`. `0` = dočíta sa ešte dnes.
 *
 * Zámerne rovnaká aritmetika ako `daysToFinish()` v `status/blockers.ts` na
 * zápisovej strane — aby UI hovorilo o čítaní aj o zápisoch tým istým jazykom.
 */
export function readDaysNeeded(
  pages: number,
  remainingToday: number,
  perDay: number = READ_LANE_LIMITS.anon.perUtcDay,
): number {
  if (pages <= 0) return 0;
  const speed = Math.max(1, Math.trunc(perDay));
  const today = Math.min(speed, Math.max(0, Math.trunc(remainingToday)));
  if (pages <= today) return 0;
  return Math.ceil((pages - today) / speed);
}
