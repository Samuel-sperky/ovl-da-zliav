/**
 * Aura Zľavy — SYNCHRONIZÁCIA PREDAJNOSTI (KONTRAKT-PREDAJNOST-2026-08-06).
 *
 * Z objednávok shopu vyrobí denné súčty predaných KUSOV po produkte a uloží ich
 * do `product_sales_daily`. Priebeh dňa žije v `sales_sync_state`.
 *
 * Tvrdé pravidlá tohto modulu:
 *   - **I8'** — objednávkové endpointy pozná výhradne `lib/shop/orders-client.ts`;
 *     tento modul s ním hovorí cez rozhranie `OrdersClient` a žiadnu cestu shopu
 *     nezostavuje. Do DB neputuje id objednávky, krajina ani `total_paid`.
 *   - **I10** — requesty idú prísne sekvenčne s pauzou `ORDERS_PAUSE_MS`;
 *     `Promise.all` nad volaniami shopu tu neexistuje a existovať nesmie.
 *   - **P6 (fail-soft)** — po dosiahnutí stropu `ORDERS_MAX_REQUESTS_PER_RUN`
 *     beh korektne skončí, uloží pokrok a ohlási to. Táto funkcia NIKDY nehodí
 *     výnimku: zľavy ani scheduler nesmie zhodiť to, že sa nepodarilo dopočítať
 *     predajnosť.
 *   - **P7 (idempotencia)** — deň v minulosti sa po `complete` znova nesťahuje;
 *     dnešný a včerajší deň sa prepočítavajú vždy (objednávky pribúdajú).
 *     Zápis je absolútny upsert, takže opakovaný beh čísla nezdvojnásobí.
 *   - **I1** — kľúč je injektovaný `SecretRef`, do logu ide výhradne KÓD chyby.
 *   - **I11** — nedopočítava sa nič, čo shop nedal: chýbajúci deň je chýbajúci
 *     deň, nie nula vydávaná za meranie (`status` to priznáva).
 *
 * Zápisy do shopu sa tohto modulu NETÝKAJÚ — číta a len číta.
 *
 * Vlastník: sales-sync.
 */
import type { DateOnly, Logger, SecretRef, ShopCtx, Ulid } from '@/contracts';

import { env } from '@/env';
import { addDays } from '@/lib/domain/dates';
import { logger as defaultLogger } from '@/lib/log/logger';
import { newOperationId, newRequestId } from '@/lib/shop/correlation';
import { isShopRequestError } from '@/lib/shop/errors';
// Deň sa počíta cez `Intl.DateTimeFormat` s `timeZone` (D31) — v tomto projekte
// už raz flakoval test, ktorý „dnes" počítal v UTC.
import { todayInTimeZone } from '@/lib/shop/client';
import {
  ORDERS_MAX_PER_PAGE,
  type OrderUnits,
  type OrdersClient,
  type OrdersPage,
} from '@/lib/shop/orders-client';
import { salesRepo as defaultSalesRepo } from '@/lib/repo/sales.repo';
import type {
  DailyUnitsRow,
  SalesRepoContract,
  SalesSyncStatus,
} from '@/lib/repo/sales.repo';

/* ═══════════════════════════ 1. Nastavenia behu ═══════════════════════════ */

export interface SalesSyncFlags {
  /** Zapnutá synchronizácia? Vypnutá vráti `disabled` a neodošle nič. */
  enabled: boolean;
  /** Koľko dní dozadu (vrátane dneška) sa pozerá — `SALES_WINDOW_DAYS`. */
  windowDays: number;
  /** Strop requestov na JEDEN beh — `ORDERS_MAX_REQUESTS_PER_RUN` (P6). */
  maxRequestsPerRun: number;
  /** Pauza medzi requestami — `ORDERS_PAUSE_MS` (I10). */
  pauseMs: number;
  /** `per_page` zoznamu; zastropované na 100 (paginátor shopu). */
  perPage: number;
}

export function salesSyncFlagsFromEnv(): SalesSyncFlags {
  return {
    enabled: env.SALES_SYNC_ENABLED,
    windowDays: env.SALES_WINDOW_DAYS,
    maxRequestsPerRun: env.ORDERS_MAX_REQUESTS_PER_RUN,
    pauseMs: env.ORDERS_PAUSE_MS,
    perPage: ORDERS_MAX_PER_PAGE,
  };
}

/* ═══════════════════════════ 2. Závislosti ════════════════════════════════ */

export interface SalesSyncDeps {
  /** Klient objednávok (jediná cesta k objednávkam, I8'). */
  ordersClient: OrdersClient;
  /**
   * Kľúč `orders:read` ako `SecretRef` (I1). Modul si ho NIKDY nezaobstaráva
   * sám — wiring ho vkladá zvonku, takže tu nie je cesta k DB ani k disku.
   */
  key: SecretRef;
  salesRepo?: Pick<SalesRepoContract, 'replaceDayUnits' | 'getSyncState' | 'saveSyncState'>;
  logger?: Logger;
  flags?: SalesSyncFlags | (() => SalesSyncFlags);
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => Date;
  timeZone?: string;
}

export interface SyncSalesOptions {
  /** Prepíše „dnes" (testy, ručné dopočítanie). Inak sa počíta v zóne D31. */
  today?: DateOnly;
  /** Prepočíta aj dni, ktoré sú už `complete` (ručná korekcia). */
  force?: boolean;
  /** Korelácia celého behu; inak vznikne nové. */
  operationId?: Ulid;
}

/* ═══════════════════════════ 3. Výsledok ══════════════════════════════════ */

export type SalesSyncDayStatus = SalesSyncStatus | 'skipped';

export interface SalesSyncDayReport {
  day: DateOnly;
  status: SalesSyncDayStatus;
  /** Počet objednávok, ktorých detail sa v tomto behu prečítal (nie ich id). */
  ordersSeen: number;
  requestsUsed: number;
  /** Súčet kusov za deň; `null` keď sa deň preskočil. */
  unitsTotal: number | null;
  /** Koľko produktov má za deň nenulový súčet. */
  productsTouched: number;
  /** KÓD chyby, nikdy obsah odpovede (I1). */
  lastError: string | null;
  /** Uložili sa súčty tohto dňa, alebo sa nechala predchádzajúca hodnota? */
  written: boolean;
}

export interface SalesSyncResult {
  outcome: 'complete' | 'partial' | 'disabled';
  windowFrom: DateOnly;
  windowTo: DateOnly;
  days: SalesSyncDayReport[];
  requestsUsed: number;
  /** Beh skončil na strope requestov (P6) — nie je to chyba, len „dokončí sa nabudúce". */
  capReached: boolean;
  /** KÓD chyby, ktorá beh ukončila; `null` keď beh dobehol. */
  error: string | null;
}

/* ═══════════════════════════ 4. Pomocníci ═════════════════════════════════ */

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** Strop strán jedného dňa — obrana proti paginátoru, ktorý by nikdy neskončil. */
const MAX_PAGES_PER_DAY = 5_000;

/**
 * Chyba → KÓD do `last_error` (I1). Nikdy text odpovede shopu, nikdy hláška
 * z knižnice — len zaradenie, ktoré appka sama vyrobila.
 */
function errorCode(error: unknown): string {
  if (isShopRequestError(error)) return error.shopError.code ?? error.shopError.kind;
  if (error instanceof Error && error.name.length > 0) return `local_${error.name}`;
  return 'local_unknown';
}

/** Chyby, po ktorých nemá zmysel pokračovať v behu (kľúč, tvar API, limit). */
function stopsRun(error: unknown): boolean {
  if (!isShopRequestError(error)) return true;
  const { kind } = error.shopError;
  return kind !== 'not_found';
}

/* ═══════════════════════════ 5. Synchronizácia ════════════════════════════ */

export async function syncSales(
  deps: SalesSyncDeps,
  options: SyncSalesOptions = {},
): Promise<SalesSyncResult> {
  const log = deps.logger ?? defaultLogger;
  const repo = deps.salesRepo ?? defaultSalesRepo;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const now = deps.now ?? ((): Date => new Date());
  const timeZone = deps.timeZone ?? env.LOGIC_TIMEZONE;
  const flags =
    typeof deps.flags === 'function'
      ? deps.flags()
      : (deps.flags ?? salesSyncFlagsFromEnv());

  const operationId = options.operationId ?? newOperationId();
  const opLog = log.child({ operationId });

  const today = options.today ?? todayInTimeZone(timeZone, now().getTime());
  const windowDays = Math.max(1, Math.trunc(flags.windowDays));
  const windowFrom = addDays(today, -(windowDays - 1));
  const perPage = Math.min(Math.max(1, Math.trunc(flags.perPage)), ORDERS_MAX_PER_PAGE);
  const maxRequests = Math.max(1, Math.trunc(flags.maxRequestsPerRun));
  const yesterday = addDays(today, -1);

  const days: DateOnly[] = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) days.push(addDays(today, -i));

  const reports: SalesSyncDayReport[] = [];
  let requestsUsed = 0;
  let capReached = false;
  let runError: string | null = null;

  if (!flags.enabled) {
    return {
      outcome: 'disabled',
      windowFrom,
      windowTo: today,
      days: [],
      requestsUsed: 0,
      capReached: false,
      error: null,
    };
  }

  /** Jeden request „stojí" jedno miesto v budgete (P6). */
  const budgetLeft = (): number => maxRequests - requestsUsed;

  function ctxFor(): ShopCtx {
    return { operationId, requestId: newRequestId() };
  }

  /** Requesty spotrebované práve spracovávaným dňom. */
  const dayCounter = { requests: 0 };

  type Spent<T> =
    | { ok: true; value: T }
    | { ok: false; code: string; fatal: boolean };

  /**
   * Jeden request voči shopu: sekvenčné tempo (I10), zaúčtovanie do budgetu (P6)
   * a chyba ako HODNOTA, nie výnimka — volajúci sa vždy môže rozhodnúť fail-soft.
   */
  async function spend<T>(call: () => Promise<T>): Promise<Spent<T>> {
    // Pauza pred každým requestom okrem prvého v behu (I10).
    if (requestsUsed > 0) await sleepFn(flags.pauseMs);
    try {
      return { ok: true, value: await call() };
    } catch (error) {
      return { ok: false, code: errorCode(error), fatal: stopsRun(error) };
    } finally {
      requestsUsed += 1;
      dayCounter.requests += 1;
    }
  }

  try {
    for (const day of days) {
      if (capReached || runError !== null) break;

      const previous = await repo.getSyncState(day);
      const alwaysRecompute = day === today || day === yesterday;

      // P7 — uzavretý deň v minulosti sa znova nesťahuje. `date_add` je čas
      // vzniku objednávky, do minulosti sa nič nedopĺňa.
      if (!alwaysRecompute && previous?.status === 'complete' && options.force !== true) {
        reports.push({
          day,
          status: 'skipped',
          ordersSeen: 0,
          requestsUsed: 0,
          unitsTotal: null,
          productsTouched: 0,
          lastError: null,
          written: false,
        });
        continue;
      }

      const startedAt = previous?.startedAt ?? now();
      await repo.saveSyncState(day, {
        ordersSeen: 0,
        status: 'pending',
        requestsUsed: 0,
        lastError: null,
        startedAt: now(),
        finishedAt: null,
      });

      const units = new Map<number, number>();
      const orderIds: number[] = [];
      const seenIds = new Set<number>();
      dayCounter.requests = 0;
      let ordersSeen = 0;
      let dayError: string | null = null;
      let dayComplete = true;

      /* 5.1 zoznam objednávok po stranách */
      for (let page = 1; page <= MAX_PAGES_PER_DAY; page += 1) {
        if (budgetLeft() <= 0) {
          capReached = true;
          dayComplete = false;
          break;
        }
        const listed = await spend<OrdersPage>(() =>
          deps.ordersClient.listOrders({ dateFrom: day, dateTo: day, page, perPage }, deps.key, ctxFor()),
        );
        if (!listed.ok) {
          dayError = listed.code;
          dayComplete = false;
          if (listed.fatal) runError = listed.code;
          break;
        }

        for (const ref of listed.value.data) {
          // Objednávka, ktorá podľa `date_add` patrí inému dňu, sa do súčtu
          // TOHTO dňa nepridá — inak by absolútny prepis pokazil cudzí deň.
          if (ref.day !== day) continue;
          if (seenIds.has(ref.id)) continue;
          seenIds.add(ref.id);
          orderIds.push(ref.id);
        }

        if (listed.value.data.length === 0) break;
        if (page * perPage >= listed.value.total) break;
      }

      /* 5.2 detail každej objednávky — kusy po produkte */
      if (runError === null && !capReached) {
        for (const orderId of orderIds) {
          if (budgetLeft() <= 0) {
            capReached = true;
            dayComplete = false;
            break;
          }
          const got = await spend<OrderUnits>(() =>
            deps.ordersClient.getOrderUnits(orderId, deps.key, ctxFor()),
          );
          if (!got.ok) {
            dayError = got.code;
            dayComplete = false;
            // Objednávka, ktorá medzitým zmizla, deň nekončí — len ho zneúplní.
            if (!got.fatal) continue;
            runError = got.code;
            break;
          }

          if (got.value.day !== day) continue;
          ordersSeen += 1;
          for (const line of got.value.lines) {
            units.set(line.productId, (units.get(line.productId) ?? 0) + line.qty);
          }
        }
      }
      const dayRequests = dayCounter.requests;

      /* 5.3 zápis súčtov */
      const status: SalesSyncStatus = dayComplete && dayError === null ? 'complete' : 'partial';

      // Nikdy nezhoršiť dáta: neúplný prepočet už uzavretého dňa by absolútnym
      // prepisom zmazal to, čo predtým vyšlo správne. Pokrok sa v takom prípade
      // uloží len do stavu a deň sa dopočíta v ďalšom behu.
      const wouldDowngrade = status === 'partial' && previous?.status === 'complete';
      let productsTouched = 0;
      let written = false;
      if (!wouldDowngrade) {
        const rows: DailyUnitsRow[] = [...units.entries()]
          .filter(([, value]) => value > 0)
          .map(([productId, value]) => ({ productId, day, units: value }));
        productsTouched = await repo.replaceDayUnits(day, rows);
        written = true;
      }

      await repo.saveSyncState(day, {
        ordersSeen,
        status,
        requestsUsed: dayRequests,
        lastError: dayError,
        startedAt,
        finishedAt: status === 'complete' ? now() : null,
      });

      const unitsTotal = [...units.values()].reduce((sum, value) => sum + value, 0);
      reports.push({
        day,
        status,
        ordersSeen,
        requestsUsed: dayRequests,
        unitsTotal,
        productsTouched,
        lastError: dayError,
        written,
      });

      opLog.info('sales_sync_day_done', {
        day,
        status,
        ordersSeen,
        requestsUsed: dayRequests,
        unitsTotal,
        ...(dayError !== null ? { errorCode: dayError } : {}),
      });
    }
  } catch (error) {
    // P6 — táto funkcia nesmie hodiť. Čokoľvek nečakané (chyba DB, expirovaný
    // kľúč z `SecretRef`, programátorská chyba) sa premení na kód a report.
    runError = errorCode(error);
    opLog.error('sales_sync_aborted', { errorCode: runError, requestsUsed });
  }

  const outcome: SalesSyncResult['outcome'] =
    runError === null && !capReached && reports.every((r) => r.status !== 'partial')
      ? 'complete'
      : 'partial';

  if (capReached) {
    opLog.warn('sales_sync_request_cap_reached', { requestsUsed, maxRequests });
  }

  return {
    outcome,
    windowFrom,
    windowTo: today,
    days: reports,
    requestsUsed,
    capReached,
    error: runError,
  };
}
