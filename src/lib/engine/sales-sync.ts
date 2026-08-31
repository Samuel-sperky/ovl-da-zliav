/**
 * Aura Zľavy — SYNCHRONIZÁCIA PREDAJNOSTI (KONTRAKT-PREDAJNOST-2026-08-06).
 *
 * Z objednávok shopu vyrobí denné súčty predaných KUSOV po produkte a uloží ich
 * do `product_sales_daily`. Priebeh dňa žije v `sales_sync_state`.
 *
 * Od 28. 8. 2026 je v tomto module aj DRUHÝ, samostatný beh — `syncShopRevenue()`
 * (sekcia 6, D117): denná tržba za CELÝ ESHOP z `total_paid` zo zoznamu
 * objednávok. Prečo dva behy a nie jeden, a prečo tržba NIKDY nie je per
 * produkt, je v doc-bloku sekcie 6.
 *
 * Tvrdé pravidlá tohto modulu:
 *   - **I8'** — objednávkové endpointy pozná výhradne `lib/shop/orders-client.ts`;
 *     tento modul s ním hovorí cez rozhrania `OrdersClient` / `OrderTotalsClient`
 *     a žiadnu cestu shopu nezostavuje. Do DB neputuje id objednávky ani
 *     krajina. `total_paid` áno, ale VÝHRADNE ako denný súčet za celý eshop
 *     (`shop_revenue_daily`) — nikdy ako číslo pripísané produktu (D117).
 *   - **I10** — requesty idú prísne sekvenčne s pauzou `ORDERS_PAUSE_MS`;
 *     `Promise.all` nad volaniami shopu tu neexistuje a existovať nesmie.
 *     (Tá pauza je dnes pod minútovým stropom shopu — modul to ohlási, ale
 *     neopravuje; viď `MIN_ORDERS_READ_PAUSE_MS` nižšie.)
 *   - **P6 (fail-soft)** — po dosiahnutí stropu `ORDERS_MAX_REQUESTS_PER_RUN`
 *     beh korektne skončí, uloží pokrok a ohlási to. Táto funkcia NIKDY nehodí
 *     výnimku: zľavy ani scheduler nesmie zhodiť to, že sa nepodarilo dopočítať
 *     predajnosť.
 *   - **A4 (denný rozpočet čítaní)** — pred KAŽDÝM volaním shopu sa rezervuje
 *     čítanie zo ZDIEĽANÉHO denného rozpočtu dráhy `orders`
 *     (`lib/shop/read-budget.ts`): 160 zo 200 volaní na kľúč a UTC deň.
 *     Prečo to nestačilo riešiť stropom na beh: `maxRequestsPerRun` žije
 *     v pamäti behu, takže po reštarte appky (alebo v druhom behu toho istého
 *     dňa) sa počíta od nuly a denný strop shopu sa dá prekročiť viacerými
 *     behmi — presne to appka robila a shop na to odpovedal 429. Rozpočet je
 *     preto vrstva NAD per-beh stropom, nie jeho náhrada: oba platia naraz.
 *     Minutý rozpočet NIE JE chyba, je to „pokračujem po polnoci UTC" —
 *     výsledok nesie `stoppedBy: 'daily_budget'` a `resumeAt`, rovnako ako
 *     `lib/shop/catalog-sync.ts`, aby to appka hlásila jedným jazykom.
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
import type {
  DateOnly,
  Logger,
  MoneyString,
  SecretRef,
  ShopCtx,
  Ulid,
  UtcDate,
} from '@/contracts';

import { env } from '@/env';
import { addDays } from '@/lib/domain/dates';
import { logger as defaultLogger } from '@/lib/log/logger';
import { newOperationId, newRequestId } from '@/lib/shop/correlation';
import { isKeyRejectedKind, isShopRequestError } from '@/lib/shop/errors';
import { classifySalesStop } from '@/lib/sales/stop-policy';
// Deň sa počíta cez `Intl.DateTimeFormat` s `timeZone` (D31) — v tomto projekte
// už raz flakoval test, ktorý „dnes" počítal v UTC.
import { todayInTimeZone } from '@/lib/shop/client';
import {
  ORDERS_MAX_ATTEMPTS,
  ORDERS_MAX_PER_PAGE,
  centsToMoneyString,
  type OrderTotalsClient,
  type OrderTotalsPage,
  type OrderUnits,
  type OrdersClient,
  type OrdersPage,
} from '@/lib/shop/orders-client';
import {
  READ_LANE_LIMITS,
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudgetStatus,
  type ReadReservation,
} from '@/lib/shop/read-budget';
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

/**
 * ZDIEĽANÝ denný rozpočet čítaní dráhy `orders` (A4). Rezervuje sa PRED
 * requestom — volanie, ktoré skončilo na 429 alebo timeoute, sa do stropu shopu
 * počíta rovnako ako úspešné.
 *
 * Tvar je zámerne identický s `CatalogReadBudgetGate` (`lib/shop/catalog-sync`),
 * aby obe strany čítania hovorili s rozpočtom rovnako; produkčne obe dostanú
 * inštanciu z `lib/repo/read-budget.repo` (katalóg dráhu `anon`, predajnosť
 * dráhu `orders`).
 */
export interface SalesReadBudgetGate {
  /**
   * Rezervuje `count` čítaní. `count === 0` je NAHLIADNUTIE: vráti stav
   * rozpočtu bez toho, aby čokoľvek minulo — beh sa tak vie spýtať „oplatí sa
   * začať?" skôr, než sa dotkne dát.
   */
  reserveShopReads(count?: number): Promise<ReadReservation>;
}

export interface SalesSyncDeps {
  /** Klient objednávok (jediná cesta k objednávkam, I8'). */
  ordersClient: OrdersClient;
  /**
   * Kľúč `orders:read` ako `SecretRef` (I1). Modul si ho NIKDY nezaobstaráva
   * sám — wiring ho vkladá zvonku, takže tu nie je cesta k DB ani k disku.
   */
  key: SecretRef;
  /**
   * Denný rozpočet čítaní (A4). Keď chýba, počíta sa len v pamäti tohto behu —
   * použiteľné pre testy a jednorazové dopočítanie, NIE pre produkciu: taký
   * rozpočet sa po každom behu vynuluje, teda presne tá diera, ktorú A4 zatvára.
   * Produkčné zapojenie ho preto dodáva (`lib/sales/sync-runner.ts`) a beh bez
   * neho zapíše varovanie.
   */
  budget?: SalesReadBudgetGate;
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

/**
 * Čo beh zastavilo. Zámerne rovnaká myšlienka ako `CatalogStopReason`, aby UI
 * hlásilo čítanie katalógu a čítanie predajnosti tým istým jazykom:
 *
 *  - `done`          — prešlo sa celé okno,
 *  - `daily_budget`  — minutý ZDIEĽANÝ denný rozpočet čítaní (A4); nie je to
 *                      chyba, pokračuje sa po `resumeAt` (polnoc UTC),
 *  - `run_cap`       — minutý strop requestov na JEDEN beh (P6),
 *  - `error`         — beh zastavila chyba, jej KÓD je v `error`,
 *  - `disabled`      — synchronizácia je vypnutá, nič sa neodoslalo.
 *
 * `rate_limited` tu ZÁMERNE nie je: 429 opakuje samotný klient (R-2) a keď sa
 * nedá pokračovať, kód `rate_limited` skončí v `error`. Druhé miesto, kde sa 429
 * rozhoduje, by sa s prvým rozišlo.
 */
export type SalesStopReason = 'done' | 'daily_budget' | 'run_cap' | 'error' | 'disabled';

export interface SalesSyncResult {
  /**
   * `paused` = beh sa pokojne zastavil na dennom rozpočte a NIČ nezapísal
   * (rovnaký význam ako `CatalogSyncOutcome.paused`) — nie je to chyba ani
   * neúspech, len „dnes už nečítam".
   */
  outcome: 'complete' | 'partial' | 'paused' | 'disabled';
  windowFrom: DateOnly;
  windowTo: DateOnly;
  days: SalesSyncDayReport[];
  requestsUsed: number;
  /**
   * Koľko čítaní si beh zarezervoval zo ZDIEĽANÉHO denného rozpočtu (A4).
   * Býva to `requestsUsed`, ale nemusí: keď klient jeden logický request
   * v tichosti zopakoval (R-2), zaúčtujú sa aj tie pokusy — pre shop to boli
   * plnohodnotné volania.
   */
  readsUsed: number;
  /** Beh skončil na strope requestov (P6) — nie je to chyba, len „dokončí sa nabudúce". */
  capReached: boolean;
  /** Beh skončil na minutom dennom rozpočte čítaní (A4). Tiež to nie je chyba. */
  dailyBudgetReached: boolean;
  /** Čo beh zastavilo — pre UI a pre rozhodovanie runnera. */
  stoppedBy: SalesStopReason;
  /** Kedy sa smie pokračovať (polnoc UTC pri `daily_budget`). `null` = hneď. */
  resumeAt: UtcDate | null;
  /** KÓD chyby, ktorá beh ukončila; `null` keď beh dobehol. */
  error: string | null;
}

/* ═══════════════════════════ 4. Pomocníci ═════════════════════════════════ */

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** Strop strán jedného dňa — obrana proti paginátoru, ktorý by nikdy neskončil. */
const MAX_PAGES_PER_DAY = 5_000;

/**
 * Najmenšia pauza medzi dvoma čítaniami objednávok, pri ktorej sa MINÚTOVÝ strop
 * dráhy `orders` (16 z 20 na kľúč) nedá prekročiť: 60 000 / 16 = 3 750 ms.
 *
 * POZOR — toto číslo je dnes len MERADLO, nie podlaha. Pauzu drží
 * `ORDERS_PAUSE_MS` (`src/env.ts`, min aj default 250 ms = 240 volaní/min) a jej
 * komentár sa odvoláva na „300 requestov / 60 s na kľúč" zo starej verzie
 * dokumentácie shopu. Podľa `docs/api/sperky-api-v4.md` je skutočný strop
 * s kľúčom **20/min**, teda dvanásťkrát nižší — a je to tá istá zámena „za deň"
 * za „za minútu", ktorá kedysi rozbila katalóg (viď doc-blok
 * `lib/shop/rate-limits.ts`). Denný rozpočet (A4) tento modul zastaví po 160
 * čítaniach za UTC deň, ale 429 v priebehu tých 160 volaní nezabráni.
 *
 * Preto sa beh, ktorý má pauzu pod týmto číslom, ohlási varovaním
 * `sales_sync_pause_below_minute_limit` — appka má o svojom 429 vedieť aj bez
 * čítania logov shopu. Zmena samotnej hodnoty patrí do `src/env.ts` (cudzí
 * súbor) a jej domovom je `lib/shop/rate-limits.ts`, nie tento modul.
 */
export const MIN_ORDERS_READ_PAUSE_MS = Math.ceil(60_000 / READ_LANE_LIMITS.orders.perMinute);

/**
 * Koľko čítaní sa DOÚČTUJE, keď volanie zlyhalo spôsobom, ktorý klient
 * v tichosti opakuje (`retryable`, R-2).
 *
 * Klient rieši 429/500/sieť sám (`ORDERS_MAX_ATTEMPTS` pokusov na jeden logický
 * request) a von pustí len konečnú chybu. Pre shop to však boli až tri návštevy,
 * takže rezervácia jedného čítania by rozpočet podhodnotila práve v okamihu, keď
 * je appka najbližšie k banu. Presný počet pokusov sa z chyby vyčítať nedá,
 * doúčtuje sa preto HORNÝ odhad — fail-closed, ako všade v rozpočtoch.
 *
 * Do `requestsUsed` (a teda do per-beh stropu) sa tieto pokusy NEPOČÍTAJÚ: ten
 * meria logické requesty a jeho význam sa nemení (P6).
 */
export const ORDERS_RETRY_READS_CHARGE = Math.max(0, ORDERS_MAX_ATTEMPTS - 1);

/**
 * Rozpočet v pamäti procesu — núdzová náhrada, keď volajúci zdieľané počítadlo
 * nedodal. Stropy sú tie správne (dráha `orders`), ale po behu sa zabudne, takže
 * produkčné zapojenie ho nikdy nepoužije (viď `SalesSyncDeps.budget`).
 */
function createMemoryBudgetGate(): SalesReadBudgetGate {
  const budget = createReadBudget({ store: createMemoryReadBudgetStore(), lane: 'orders' });
  return { reserveShopReads: (count = 1) => budget.reserve(count) };
}

/**
 * Chyba → KÓD do `last_error` (I1). Nikdy text odpovede shopu, nikdy hláška
 * z knižnice — len zaradenie, ktoré appka sama vyrobila.
 *
 * ODMIETNUTÝ KĽÚČ SA ZAPISUJE DRUHOM, NIE SUROVÝM KÓDOM
 * -----------------------------------------------------
 * Pri 401/403 ide do `last_error` názov DRUHU (`unauthorized` / `forbidden`)
 * všade tam, kde by surový kód shopu prekážku zatajil. Dôvod je prevádzkový:
 * `sales_sync_state` je JEDINÉ miesto, z ktorého sa po reštarte appky dá
 * zistiť, že sa na rozvrhu nemá skúšať ďalej (`lib/sales/stop-policy.ts`),
 * a keby v ňom stál kód, ktorý appka nepozná, prekážka by sa stratila a
 * opakovanie by sa vrátilo. Kód, ktorý prekážku pomenúva sám (`ip_banned`),
 * sa zachová — nesie viac než druh.
 *
 * Surový kód sa nestráca: ide do logu (`sales_sync_day_done`, `errorCode`).
 */
function errorCode(error: unknown): string {
  if (isShopRequestError(error)) {
    const { kind, code } = error.shopError;
    if (isKeyRejectedKind(kind) && classifySalesStop(code) === null) return kind;
    return code ?? kind;
  }
  if (error instanceof Error && error.name.length > 0) return `local_${error.name}`;
  return 'local_unknown';
}

/** Chyby, po ktorých nemá zmysel pokračovať v behu (kľúč, tvar API, limit). */
function stopsRun(error: unknown): boolean {
  if (!isShopRequestError(error)) return true;
  const { kind } = error.shopError;
  return kind !== 'not_found';
}

/**
 * Zopakoval klient tento request sám? Rozhoduje `retryable` z taxonómie chýb
 * (`lib/shop/errors.ts`) — jediné miesto, kde sa to určuje, aby sa rozhodnutie
 * nerozišlo s tým, čo klient naozaj robí.
 */
function retriedByClient(error: unknown): boolean {
  return isShopRequestError(error) && error.shopError.retryable === true;
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
  let readsUsed = 0;
  let capReached = false;
  let runError: string | null = null;
  /** Stav rozpočtu v okamihu, keď došiel. `null` = rozpočet behu stačil. */
  let budgetStop: ReadBudgetStatus | null = null;

  if (!flags.enabled) {
    return {
      outcome: 'disabled',
      windowFrom,
      windowTo: today,
      days: [],
      requestsUsed: 0,
      readsUsed: 0,
      capReached: false,
      dailyBudgetReached: false,
      stoppedBy: 'disabled',
      resumeAt: null,
      error: null,
    };
  }

  // Chýbajúce zdieľané počítadlo nie je dôvod nečítať, ale je dôvod povedať to
  // nahlas: taký beh po reštarte začne rátať od nuly (A4).
  if (deps.budget === undefined) {
    opLog.warn('sales_read_budget_missing', {
      detail: 'denný rozpočet čítaní žije len v pamäti tohto behu',
    });
  }
  const budgetGate = deps.budget ?? createMemoryBudgetGate();

  // Pauza z konfigurácie je rýchlejšia, než minútový strop dráhy `orders`
  // dovolí — potom sa 429 nedá zabrániť ani denným rozpočtom a appka to má
  // priznať sama (viď `MIN_ORDERS_READ_PAUSE_MS`).
  if (flags.pauseMs < MIN_ORDERS_READ_PAUSE_MS) {
    opLog.warn('sales_sync_pause_below_minute_limit', {
      pauseMs: flags.pauseMs,
      minPauseMs: MIN_ORDERS_READ_PAUSE_MS,
      minuteLimit: READ_LANE_LIMITS.orders.perMinute,
    });
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
    | { ok: false; reason: 'error'; code: string; fatal: boolean }
    | { ok: false; reason: 'daily_budget'; status: ReadBudgetStatus };

  /**
   * Zostáva na dnes ešte aspoň jedno čítanie? Nahliadnutie bez rezervovania —
   * pýta sa PRED tým, než sa deň označí ako „prebieha". Deň, o ktorom sa beh
   * nedozvie vôbec nič, si nezaslúži značku „prepočítané neúplne": minutý
   * rozpočet nie je meranie.
   *
   * `null` = počítadlo sa nedá prečítať; volajúci to rieši ako chybu behu
   * (fail-closed, radšej nečítať než dostať ban).
   */
  async function peekBudget(): Promise<ReadBudgetStatus | null> {
    try {
      const peek = await budgetGate.reserveShopReads(0);
      return peek.status;
    } catch {
      return null;
    }
  }

  /** Doúčtovanie tichých opakovaní klienta (R-2). Účtuje sa, nepýta sa o dovolenie. */
  async function chargeRetries(): Promise<void> {
    if (ORDERS_RETRY_READS_CHARGE <= 0) return;
    try {
      const extra = await budgetGate.reserveShopReads(ORDERS_RETRY_READS_CHARGE);
      readsUsed += extra.granted;
    } catch {
      // Nezaúčtovaný pokus je nepresnosť, nie dôvod zhodiť beh (P6). Ďalšia
      // rezervácia to isté zlyhanie zopakuje a tá už beh pokojne zastaví.
    }
  }

  /**
   * Jeden request voči shopu: denný rozpočet PRED volaním (A4), sekvenčné tempo
   * (I10), zaúčtovanie do per-beh budgetu (P6) a chyba ako HODNOTA, nie výnimka
   * — volajúci sa vždy môže rozhodnúť fail-soft.
   *
   * Poradie krokov je podstatné: rezervuje sa skôr, než sa čaká a než sa volá.
   * Volanie, ktoré skončí na 429 alebo timeoute, minie strop shopu rovnako ako
   * úspešné, takže sa účtuje POKUS, nie výsledok.
   */
  async function spend<T>(call: () => Promise<T>): Promise<Spent<T>> {
    let reservation: ReadReservation;
    try {
      reservation = await budgetGate.reserveShopReads(1);
    } catch (error) {
      // Nečitateľné počítadlo = nečítame (fail-closed). Beh sa skončí pokojne
      // a nabudúce to skúsi znova.
      return { ok: false, reason: 'error', code: errorCode(error), fatal: true };
    }
    if (reservation.granted < 1) {
      return { ok: false, reason: 'daily_budget', status: reservation.status };
    }
    readsUsed += reservation.granted;

    // Pauza pred každým requestom okrem prvého v behu (I10).
    if (requestsUsed > 0) await sleepFn(flags.pauseMs);
    try {
      return { ok: true, value: await call() };
    } catch (error) {
      if (retriedByClient(error)) await chargeRetries();
      return { ok: false, reason: 'error', code: errorCode(error), fatal: stopsRun(error) };
    } finally {
      requestsUsed += 1;
      dayCounter.requests += 1;
    }
  }

  try {
    for (const day of days) {
      if (capReached || budgetStop !== null || runError !== null) break;

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

      // A4 — oplatí sa tento deň vôbec začať? Otázka je tu, a nie až pri prvom
      // requeste, zámerne: o riadok nižšie sa deň označí ako „prebieha" a na
      // konci iterácie by skončil ako `partial`. Deň, na ktorý sa už nedostalo
      // ani jedno čítanie, by tak vyzeral horšie, než v skutočnosti je.
      const before = await peekBudget();
      if (before === null) {
        runError = 'read_budget_unreadable';
        opLog.error('sales_sync_budget_unreadable', { day });
        break;
      }
      if (before.remaining < 1) {
        budgetStop = before;
        break;
      }

      const startedAt = previous?.startedAt ?? now();
      // `ordersSeen` sa pri značke „prebieha" ZÁMERNE nenuluje: je to jediná
      // TRVALÁ miera toho, ako úplný bol posledný prepočet dňa, a chráni deň
      // pred prepísaním horším výsledkom (viď `wouldDowngrade` nižšie). Keby sa
      // vynulovalo, pád procesu uprostred dňa by tú ochranu vypol.
      await repo.saveSyncState(day, {
        ordersSeen: previous?.ordersSeen ?? 0,
        status: 'pending',
        requestsUsed: previous?.requestsUsed ?? 0,
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
          dayComplete = false;
          if (listed.reason === 'daily_budget') {
            // A4 — dnes už nečítame. Nie je to chyba dňa, preto sa do
            // `last_error` nič nezapisuje; dopočíta sa po polnoci UTC.
            budgetStop = listed.status;
            break;
          }
          dayError = listed.code;
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
        // Koniec stránkovania sa počíta podľa `per_page`, ktoré vrátil SHOP, nie
        // podľa toho, o aké sme požiadali. Keď shop stránku zmenší (jeho strop
        // sa môže kedykoľvek zmeniť), počítanie podľa pýtanej hodnoty by čítanie
        // ukončilo po prvej strane a deň by sa uzavrel ako `complete`
        // s chýbajúcimi objednávkami — teda tichá strata dát.
        const effectivePerPage =
          Number.isInteger(listed.value.perPage) && listed.value.perPage > 0
            ? Math.min(listed.value.perPage, perPage)
            : perPage;
        if (page * effectivePerPage >= listed.value.total) break;
      }

      /* 5.2 detail každej objednávky — kusy po produkte */
      if (runError === null && !capReached && budgetStop === null) {
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
            dayComplete = false;
            if (got.reason === 'daily_budget') {
              budgetStop = got.status;
              break;
            }
            dayError = got.code;
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

      // Nikdy nezhoršiť dáta. Zápis je ABSOLÚTNY prepis dňa, takže neúplný
      // prepočet vie deň nielen zneúplniť, ale úplne vymazať — stačí, aby prvý
      // request dňa skončil na `rate_limited` a `units` zostane prázdna.
      // Deň sa preto prepisuje len vtedy, keď nový prepočet NIE JE horší než ten
      // predchádzajúci:
      //   · uzavretý (`complete`) deň neúplný beh neprepíše nikdy,
      //   · ani deň, ktorý bol predtým dopočítaný z VIAC objednávok,
      //   · a ani deň, o ktorom tento beh NIČ nezistil. Neúplný beh, ktorý
      //     neprečítal ani jednu objednávku, nemá čo zapísať — prázdny prepis by
      //     z NEZNÁMA spravil nulu (I11). S denným rozpočtom (A4) je taký beh
      //     úplne bežný: strop môže padnúť hneď na prvej strane zoznamu.
      // Pokrok sa vo všetkých prípadoch uloží len do stavu a deň sa dopočíta
      // v ďalšom behu (P6) — nikdy sa nezobrazí vymyslená nula (I11).
      const wouldDowngrade =
        status === 'partial' &&
        (previous?.status === 'complete' ||
          ordersSeen < (previous?.ordersSeen ?? 0) ||
          ordersSeen === 0);
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

  const dailyBudgetReached = budgetStop !== null;

  // Poradie je poradie závažnosti: chyba prebije všetko, minutý denný rozpočet
  // prebije per-beh strop (je to tvrdší a dlhší dôvod), zvyšok je „prešlo sa
  // celé okno".
  const stoppedBy: SalesStopReason =
    runError !== null
      ? 'error'
      : dailyBudgetReached
        ? 'daily_budget'
        : capReached
          ? 'run_cap'
          : 'done';

  const outcome: SalesSyncResult['outcome'] =
    runError === null &&
    !capReached &&
    !dailyBudgetReached &&
    reports.every((r) => r.status !== 'partial')
      ? 'complete'
      : // Zastavil ho rozpočet a nič sa nezapísalo? Potom sa NIČ nepokazilo, len
        // sa dnes už nečíta — rovnaký význam ako `paused` pri katalógu.
        runError === null && dailyBudgetReached && !reports.some((r) => r.written)
        ? 'paused'
        : 'partial';

  if (capReached) {
    opLog.warn('sales_sync_request_cap_reached', { requestsUsed, maxRequests });
  }

  // Trvalá prekážka (401/403, zablokovaná IP). Hlási sa NAHLAS a s vlastným
  // menom udalosti — do 24. 8. 2026 sa strácala medzi bežnými chybami behu
  // a runner sa podľa nej nevedel zariadiť.
  const blockKind = classifySalesStop(runError);
  if (blockKind !== null) {
    opLog.warn('sales_sync_blocked', { block: blockKind, errorCode: runError, requestsUsed });
  }

  if (budgetStop !== null) {
    // `info`, nie `warn`: minutý denný rozpočet je plánovaný stav dvojdňového
    // čítania, nie porucha (A4).
    opLog.info('sales_sync_daily_budget_reached', {
      requestsUsed,
      readsUsed,
      used: budgetStop.used,
      limit: budgetStop.limit,
      known: budgetStop.known,
      resumeAt: budgetStop.resetAt.toISOString(),
    });
  }

  return {
    outcome,
    windowFrom,
    windowTo: today,
    days: reports,
    requestsUsed,
    readsUsed,
    capReached,
    dailyBudgetReached,
    stoppedBy,
    resumeAt: budgetStop === null ? null : budgetStop.resetAt,
    error: runError,
  };
}

/* ═══════════════ 6. DENNÁ TRŽBA ESHOPU (D117, 28. 8. 2026) ════════════════ */

/**
 * PREČO JE TRŽBA SAMOSTATNÝ BEH A NIE ĎALŠÍ KROK `syncSales()`
 * ------------------------------------------------------------
 * Sonda 28. 8. 2026 zmerala, že API **ceny položiek objednávky nevracia**
 * (`GET /api/order/get` → `products: [{id, qty}]`). Tržba v eurách preto
 * existuje VÝHRADNE na úrovni celého eshopu (D117): denný súčet `total_paid`
 * zo ZOZNAMU objednávok (`GET /api/order`, 100 na stranu). Per produkt zostávajú
 * KUSY a nič iné.
 *
 * **Rozdeliť `total_paid` medzi položky je ZAKÁZANÉ.** V sume je poštovné, zľavy
 * a kupóny, takže akékoľvek rozdelenie by bolo vymyslené číslo vydávané za obrat
 * produktu (I11). Preto tento beh nepozná `productId`, nevolá `order/get` ani
 * raz a jeho jediný zápis ide do `shop_revenue_daily`, ktorá `product_id`
 * zámerne nemá (migrácia 0014 §3).
 *
 * Dva behy, a nie jeden, z troch dôvodov:
 *   1. **Iná cena.** Tento beh stojí ~1 request na 100 objednávok dňa, kým
 *      `syncSales()` stojí 1 request na KAŽDÚ objednávku. Miešať ich do jedného
 *      stropu by znamenalo, že drahšia časť vždy zožerie tú lacnú.
 *   2. **Iné okno.** Tržba kreslí graf 30/90 dní (`SHOP_REVENUE_WINDOW_DAYS`),
 *      kusy majú okno `SALES_WINDOW_DAYS` (default 3 dni).
 *   3. **Iný fakt o úplnosti.** `shop_revenue_daily.day_complete` hovorí, či sa
 *      dočítal ZOZNAM; `sales_sync_state.status` hovorí, či sa dočítali POLOŽKY.
 *      Zoznam môže byť celý a položky nie, aj naopak — preto tento beh do
 *      `sales_sync_state` NEZAPISUJE ani raz (migrácia 0014 §3, „dva fakty, dva
 *      stĺpce").
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  - **Neúplný deň MUSÍ byť označený ako neúplný.** Bez toho posledný (dnešný)
 *    deň vždy vyzerá ako prudký pokles tržieb a graf kreslí pád, ktorý sa
 *    nestal — to je klamanie trendom, teda I11.
 *  - **Meny sa NESČÍTAVAJÚ.** Každá mena má vlastný riadok; súčet dvoch mien do
 *    jedného čísla by bol nezmysel vydávaný za tržbu.
 *  - **Deň, o ktorom beh nič nezistil, sa NEZAPISUJE.** Riadok v
 *    `shop_revenue_daily` znamená „tento deň sme naozaj čítali", takže prázdny
 *    zápis by z NEZNÁMA urobil nulu (I11).
 *  - **Zápis NIKDY nezhorší, čo už v DB je.** Neúplné čítanie neprepíše deň,
 *    ktorý bol predtým dočítaný, ani deň s vyšším počtom objednávok.
 *
 * MEDZERA „PREČÍTANÉ, NIČ SA NEPREDALO" — ZATVORENÁ 31. 8. 2026 (migrácia 0016)
 * ----------------------------------------------------------------------------
 * Mena je časť primárneho kľúča `shop_revenue_daily`, ale deň BEZ JEDINEJ
 * objednávky žiadnu menu neprináša — taký deň teda nemal ako dostať riadok a
 * čítacia strana ho videla ako „nevieme", hoci sme ho dočítali. Bola to
 * asymetria v BEZPEČNOM smere (I11 zakazuje vydávať neznámo za nulu, nie
 * naopak), ale znamenala, že appka NIKDY nepovie „v tento deň sa nepredalo nič".
 *
 * Zatvára to `shop_revenue_read_state` (0016): PRÍZNAK PREČÍTANOSTI DŇA oddelený
 * od sumy, jeden riadok na deň, BEZ meny. Tento beh ho zapisuje presne tam, kde
 * predtým nezapisoval nič — pri dni, z ktorého sa strana zoznamu prečítala, ale
 * objednávka v ňom nebola. Dve veci sa tým NEZMENILI:
 *
 *   · **Vymyslieť si menu pre prázdny deň sa naďalej NESMIE.** Nulový riadok
 *     v `shop_revenue_daily` s menou z nastavení by tvrdil viac, než sme videli
 *     — a nulu by dostal aj deň, ktorý sa nikdy nesťahoval (I11).
 *   · **Riadok stavu vznikne LEN pre deň, z ktorého sa naozaj prečítala aspoň
 *     jedna strana.** Predvyplnenie okna dopredu je tá istá lož ako nula.
 */

/**
 * Okno dennej tržby v dňoch. Nie je to `SALES_WINDOW_DAYS` (default 3): to je
 * okno pre KUSY, ktoré stojí 1 request na objednávku, kým tu ide o zoznam po
 * 100. Tridsať dní je predvolené okno Prehľadu (kontrakt §2) a dočítaný deň sa
 * v ďalších behoch preskakuje, takže v ustálenom stave beh platí len za dnešok
 * a včerajšok.
 */
export const SHOP_REVENUE_WINDOW_DAYS = 30;

/** Súčet jednej meny za jeden deň. Nikdy sa nesčítava s inou menou (D117). */
export interface ShopRevenueCurrencyTotal {
  currency: string;
  /** Súčet `total_paid` ako string pre `DECIMAL(12,2)` — nikdy float. */
  totalPaidSum: MoneyString;
  /** POČET objednávok v súčte, nie odkaz na objednávku (I8' bod 3). */
  ordersCount: number;
}

export interface ShopRevenueDayReport {
  day: DateOnly;
  /** Prečítali sa VŠETKY strany zoznamu za tento deň? */
  complete: boolean;
  /** Deň sa nečítal, pretože už bol dočítaný (P7). */
  skipped: boolean;
  /** Súčty po menách tak, ako ich beh naozaj videl. */
  currencies: ShopRevenueCurrencyTotal[];
  pagesRead: number;
  requestsUsed: number;
  /** KÓD chyby, nikdy obsah odpovede (I1). */
  lastError: string | null;
  /** Zapísal sa deň do DB, alebo sa nechala predchádzajúca hodnota? */
  written: boolean;
  /**
   * Zapísal sa príznak prečítanosti dňa (`shop_revenue_read_state`, 0016)?
   * Pri prázdnom dni je to JEDINÝ zápis, ktorý o dni vôbec vznikne — bez neho
   * by dočítaný deň bez objednávok zostal „nevieme".
   */
  stateWritten: boolean;
  /**
   * `true` = deň sa DOČÍTAL a objednávka v ňom NEBOLA. Meraný fakt, nie
   * nevedomosť — presne to, čo migrácia 0016 pridala.
   */
  emptyDay: boolean;
}

export interface ShopRevenueSyncResult {
  outcome: 'complete' | 'partial' | 'paused' | 'disabled';
  windowFrom: DateOnly;
  windowTo: DateOnly;
  days: ShopRevenueDayReport[];
  requestsUsed: number;
  readsUsed: number;
  capReached: boolean;
  dailyBudgetReached: boolean;
  stoppedBy: SalesStopReason;
  resumeAt: UtcDate | null;
  /** KÓD chyby, ktorá beh ukončila; `null` keď beh dobehol. */
  error: string | null;
}

export interface ShopRevenueSyncDeps {
  /**
   * ZÁMERNE `OrderTotalsClient`, nie `OrdersClient`: tento beh sa k položkám
   * objednávky nemá ako dostať ani omylom (viď rozhranie v `orders-client.ts`).
   */
  ordersClient: OrderTotalsClient;
  /** Kľúč `orders:read` ako `SecretRef` (I1) — vkladá ho wiring, nikdy modul. */
  key: SecretRef;
  /** Zdieľaný denný rozpočet dráhy `orders` (A4). Bez neho len pamäť behu. */
  budget?: SalesReadBudgetGate;
  salesRepo?: Pick<
    SalesRepoContract,
    'upsertRevenueDay' | 'listRevenue' | 'upsertRevenueReadState' | 'listRevenueReadStates'
  >;
  logger?: Logger;
  flags?: SalesSyncFlags | (() => SalesSyncFlags);
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => Date;
  timeZone?: string;
}

export interface SyncShopRevenueOptions {
  /** Prepíše „dnes" (testy, ručné dopočítanie). Inak sa počíta v zóne D31. */
  today?: DateOnly;
  /** Koľko dní dozadu vrátane dneška; default `SHOP_REVENUE_WINDOW_DAYS`. */
  windowDays?: number;
  /** Prečíta znova aj dni, ktoré sú už dočítané (ručná korekcia). */
  force?: boolean;
  /** Korelácia celého behu; inak vznikne nové. */
  operationId?: Ulid;
}

/** Výsledok jedného čítania: hodnota, chyba alebo minutý denný rozpočet. */
type SpentRead<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'error'; code: string; fatal: boolean }
  | { ok: false; reason: 'daily_budget'; status: ReadBudgetStatus };

/**
 * Denná tržba ESHOPU za okno. Rovnako ako `syncSales()` táto funkcia **NIKDY
 * nehádže** (P6): tržba je analytika a nesmie zhodiť ani zdržať zľavy.
 */
export async function syncShopRevenue(
  deps: ShopRevenueSyncDeps,
  options: SyncShopRevenueOptions = {},
): Promise<ShopRevenueSyncResult> {
  const log = deps.logger ?? defaultLogger;
  const repo = deps.salesRepo ?? defaultSalesRepo;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const now = deps.now ?? ((): Date => new Date());
  const timeZone = deps.timeZone ?? env.LOGIC_TIMEZONE;
  const flags =
    typeof deps.flags === 'function' ? deps.flags() : (deps.flags ?? salesSyncFlagsFromEnv());

  const operationId = options.operationId ?? newOperationId();
  const opLog = log.child({ operationId, part: 'shop_revenue' });

  // D31 — „dnes" sa počíta cez `Intl.DateTimeFormat` s `timeZone`, NIKDY v UTC.
  // Medzi 22:00 a 24:00 UTC je v `Europe/Bratislava` už zajtra a beh, ktorý by
  // deň počítal v UTC, by celý ten čas dopisoval tržbu do včerajška.
  const today = options.today ?? todayInTimeZone(timeZone, now().getTime());
  const windowDays = Math.max(1, Math.trunc(options.windowDays ?? SHOP_REVENUE_WINDOW_DAYS));
  const windowFrom = addDays(today, -(windowDays - 1));
  const yesterday = addDays(today, -1);
  const perPage = Math.min(Math.max(1, Math.trunc(flags.perPage)), ORDERS_MAX_PER_PAGE);
  const maxRequests = Math.max(1, Math.trunc(flags.maxRequestsPerRun));

  const days: DateOnly[] = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) days.push(addDays(today, -i));

  const reports: ShopRevenueDayReport[] = [];
  let requestsUsed = 0;
  let readsUsed = 0;
  let capReached = false;
  let runError: string | null = null;
  let budgetStop: ReadBudgetStatus | null = null;

  if (!flags.enabled) {
    return {
      outcome: 'disabled',
      windowFrom,
      windowTo: today,
      days: [],
      requestsUsed: 0,
      readsUsed: 0,
      capReached: false,
      dailyBudgetReached: false,
      stoppedBy: 'disabled',
      resumeAt: null,
      error: null,
    };
  }

  if (deps.budget === undefined) {
    opLog.warn('shop_revenue_read_budget_missing', {
      detail: 'denný rozpočet čítaní žije len v pamäti tohto behu',
    });
  }
  const budgetGate = deps.budget ?? createMemoryBudgetGate();

  const budgetLeft = (): number => maxRequests - requestsUsed;
  const ctxFor = (): ShopCtx => ({ operationId, requestId: newRequestId() });
  const dayCounter = { requests: 0 };

  async function peekBudget(): Promise<ReadBudgetStatus | null> {
    try {
      const peek = await budgetGate.reserveShopReads(0);
      return peek.status;
    } catch {
      return null;
    }
  }

  async function chargeRetries(): Promise<void> {
    if (ORDERS_RETRY_READS_CHARGE <= 0) return;
    try {
      const extra = await budgetGate.reserveShopReads(ORDERS_RETRY_READS_CHARGE);
      readsUsed += extra.granted;
    } catch {
      // Nezaúčtovaný pokus je nepresnosť, nie dôvod zhodiť beh (P6).
    }
  }

  /**
   * Jedno čítanie zoznamu: rozpočet PRED volaním (A4), sekvenčné tempo (I10)
   * a chyba ako HODNOTA, nie výnimka.
   *
   * Plumbing je vedome rovnaký ako v `syncSales()` a NIE je z nej zdieľaný:
   * rozhodovanie o stropoch žije v `lib/shop/read-budget.ts` a doúčtovanie
   * tichých opakovaní v `ORDERS_RETRY_READS_CHARGE`, čiže to, na čom záleží, je
   * na jednom mieste pre oba behy. Prepísať kvôli tomuto pridanému kroku
   * sedemsto riadkov odskúšanej cesty na kusy by bolo väčšie riziko než
   * tridsať riadkov rovnakého tvaru.
   */
  async function spend<T>(call: () => Promise<T>): Promise<SpentRead<T>> {
    let reservation: ReadReservation;
    try {
      reservation = await budgetGate.reserveShopReads(1);
    } catch (error) {
      return { ok: false, reason: 'error', code: errorCode(error), fatal: true };
    }
    if (reservation.granted < 1) {
      return { ok: false, reason: 'daily_budget', status: reservation.status };
    }
    readsUsed += reservation.granted;

    if (requestsUsed > 0) await sleepFn(flags.pauseMs);
    try {
      return { ok: true, value: await call() };
    } catch (error) {
      if (retriedByClient(error)) await chargeRetries();
      return { ok: false, reason: 'error', code: errorCode(error), fatal: stopsRun(error) };
    } finally {
      requestsUsed += 1;
      dayCounter.requests += 1;
    }
  }

  try {
    for (const day of days) {
      if (capReached || budgetStop !== null || runError !== null) break;

      // Čo o dni už v DB je. Slúži na dve veci: preskočiť dočítaný deň (P7) a
      // nikdy ho neprepísať horším výsledkom (nižšie).
      const before = await repo.listRevenue(day, day);
      /*
       * Stav prečítanosti dňa (0016). Je to JEDINÝ zdroj, ktorý o dočítanom dni
       * BEZ objednávok vie — ten v `shop_revenue_daily` riadok nemá. Bez neho by
       * sa prázdny deň čítal každú noc nanovo a zbytočne platil z rozpočtu (A4).
       *
       * Turbopack tu už raz zahodil guard cez `!row` — porovnávaj `=== null`.
       */
      const beforeStates = await repo.listRevenueReadStates(day, day);
      const beforeState = beforeStates.length > 0 ? (beforeStates[0] ?? null) : null;
      const knownComplete =
        beforeState === null
          ? before.length > 0 && before.every((row) => row.dayComplete)
          : beforeState.dayComplete;
      const alwaysRecompute = day === today || day === yesterday;

      // P7 — dočítaný deň v minulosti sa znova nečíta. Dnešok a včerajšok áno:
      // objednávky do nich stále pribúdajú.
      if (!alwaysRecompute && knownComplete && options.force !== true) {
        reports.push({
          day,
          complete: true,
          skipped: true,
          currencies: [],
          pagesRead: 0,
          requestsUsed: 0,
          lastError: null,
          written: false,
          stateWritten: false,
          // Preskočený deň sa nemeral TERAZ; „prázdny" o ňom hovorí DB, nie
          // tento beh, a tvrdiť to z nulového počtu mien tohto behu by bola lož.
          emptyDay: false,
        });
        continue;
      }

      // Oplatí sa deň vôbec začať? Nahliadnutie bez rezervovania — deň, na ktorý
      // sa nedostalo ani jedno čítanie, si nezaslúži značku „neúplný".
      const peek = await peekBudget();
      if (peek === null) {
        runError = 'read_budget_unreadable';
        opLog.error('shop_revenue_budget_unreadable', { day });
        break;
      }
      if (peek.remaining < 1) {
        budgetStop = peek;
        break;
      }

      /** `mena → centy` a `mena → počet objednávok`. Meny sa NIKDY nesčítajú. */
      const centsByCurrency = new Map<string, number>();
      const countByCurrency = new Map<string, number>();
      const seenOrderIds = new Set<number>();
      dayCounter.requests = 0;
      let pagesRead = 0;
      let dayError: string | null = null;
      let allPagesRead = true;

      for (let page = 1; page <= MAX_PAGES_PER_DAY; page += 1) {
        if (budgetLeft() <= 0) {
          capReached = true;
          allPagesRead = false;
          break;
        }
        const listed = await spend<OrderTotalsPage>(() =>
          deps.ordersClient.listOrderTotals(
            { dateFrom: day, dateTo: day, page, perPage },
            deps.key,
            ctxFor(),
          ),
        );
        if (!listed.ok) {
          allPagesRead = false;
          if (listed.reason === 'daily_budget') {
            // A4 — dnes už nečítame. Nie je to chyba dňa; dopočíta sa po
            // polnoci UTC, deň zostane označený ako NEÚPLNÝ.
            budgetStop = listed.status;
            break;
          }
          dayError = listed.code;
          if (listed.fatal) runError = listed.code;
          break;
        }
        pagesRead += 1;

        for (const item of listed.value.data) {
          // Objednávka, ktorá podľa `date_add` patrí inému dňu, do súčtu TOHTO
          // dňa nevstúpi — zapíše ju iterácia jej vlastného dňa.
          if (item.day !== day) continue;
          // Dedup podľa id: keď medzi dvoma stranami pribudne objednávka,
          // paginátor tú istú vráti dvakrát a súčet by tržbu NADHODNOTIL.
          if (seenOrderIds.has(item.id)) continue;
          seenOrderIds.add(item.id);
          centsByCurrency.set(
            item.currency,
            (centsByCurrency.get(item.currency) ?? 0) + item.totalPaidCents,
          );
          countByCurrency.set(item.currency, (countByCurrency.get(item.currency) ?? 0) + 1);
        }

        if (listed.value.data.length === 0) break;
        // Koniec stránkovania sa počíta podľa `per_page`, ktoré vrátil SHOP —
        // keď stránku zmenší, počítanie podľa PÝTANEJ hodnoty by deň uzavrelo
        // po prvej strane a tržba by tichom stratila zvyšok (rovnaká pasca ako
        // v `syncSales()`).
        const effectivePerPage =
          Number.isInteger(listed.value.perPage) && listed.value.perPage > 0
            ? Math.min(listed.value.perPage, perPage)
            : perPage;
        if (page * effectivePerPage >= listed.value.total) break;
      }

      const dayRequests = dayCounter.requests;
      const dayComplete = allPagesRead && dayError === null && runError === null;
      const measuredOrders = [...countByCurrency.values()].reduce((sum, n) => sum + n, 0);

      const currencies: ShopRevenueCurrencyTotal[] = [...centsByCurrency.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([currency, cents]) => ({
          currency,
          totalPaidSum: centsToMoneyString(cents),
          ordersCount: countByCurrency.get(currency) ?? 0,
        }));

      /*
       * ZÁPIS — tri pravidlá, každé proti jednej konkrétnej lži:
       *
       *  1. Deň, z ktorého sa neprečítala ani jedna strana, sa NEZAPISUJE:
       *     riadok v `shop_revenue_daily` znamená „tento deň sme čítali" a
       *     prázdny zápis by z neznáma urobil nulu (I11).
       *  2. Neúplné čítanie NEPREPÍŠE deň, ktorý bol predtým dočítaný, ani deň
       *     s vyšším počtom objednávok — inak by prvý `rate_limited` deň nielen
       *     zneúplnil, ale aj zmazal.
       *  3. Mena, ktorú sme predtým poznali a v ÚPLNOM čítaní už nie je, sa
       *     zapíše ako nula. To nie je výmysel, ale meraný fakt „prečítali sme
       *     celý deň a v tejto mene nič nebolo" — a je to jediná cesta, ako sa
       *     opraví riadok, ktorý tam zostal po chybnom behu.
       */
      let written = false;
      if (pagesRead > 0 && (dayComplete || measuredOrders > 0)) {
        const previous = new Map(before.map((row) => [row.currency, row]));
        for (const total of currencies) {
          const prior = previous.get(total.currency);
          const wouldDowngrade =
            !dayComplete &&
            prior !== undefined &&
            (prior.dayComplete || total.ordersCount < prior.ordersCount);
          if (wouldDowngrade) continue;
          await repo.upsertRevenueDay(day, total.currency, {
            totalPaidSum: total.totalPaidSum,
            ordersCount: total.ordersCount,
            dayComplete,
            pagesRead,
          });
          written = true;
        }
        if (dayComplete) {
          for (const row of before) {
            if (centsByCurrency.has(row.currency)) continue;
            await repo.upsertRevenueDay(day, row.currency, {
              totalPaidSum: '0.00',
              ordersCount: 0,
              dayComplete: true,
              pagesRead,
            });
            written = true;
          }
        }
      }

      /*
       * PRÍZNAK PREČÍTANOSTI DŇA (0016) — jediný zápis, ktorý vznikne aj pre deň
       * BEZ objednávok. Podmienka je preto `pagesRead > 0` a NIČ VIAC: keby sem
       * pribudlo `measuredOrders > 0` ako pri menových riadkoch, prázdny deň by
       * zostal presne tam, kde bol — v „nevieme".
       *
       * Dve pravidlá, obe rovnaké ako pri menových riadkoch, aby oba zápisy
       * jedného dňa hovorili to isté:
       *  1. Deň, z ktorého neprišla ani jedna strana, sa NEZAPISUJE — riadok tu
       *     znamená „tento deň sme čítali" (I11).
       *  2. Neúplné čítanie NEPREPÍŠE stav, ktorý už bol dočítaný. Inak by prvý
       *     `rate_limited` deň zmenil meranú nulu späť na nevedomosť.
       */
      let stateWritten = false;
      if (pagesRead > 0) {
        const downgradesState = !dayComplete && beforeState !== null && beforeState.dayComplete;
        if (!downgradesState) {
          await repo.upsertRevenueReadState(day, {
            dayComplete,
            ordersSeen: measuredOrders,
            pagesRead,
            lastError: dayError,
          });
          stateWritten = true;
        }
      }

      reports.push({
        day,
        complete: dayComplete,
        skipped: false,
        currencies,
        pagesRead,
        requestsUsed: dayRequests,
        lastError: dayError,
        written,
        stateWritten,
        // Meraný fakt: dočítali sme celý zoznam a objednávka v ňom nebola.
        emptyDay: dayComplete && pagesRead > 0 && measuredOrders === 0,
      });

      opLog.info('shop_revenue_day_done', {
        day,
        complete: dayComplete,
        pagesRead,
        requestsUsed: dayRequests,
        ordersCount: measuredOrders,
        // 0016 — „prečítané, nič sa nepredalo" musí byť vidieť aj v logu, inak
        // sa prázdny deň nedá odlíšiť od dňa, ktorý sa vôbec nečítal.
        emptyDay: dayComplete && pagesRead > 0 && measuredOrders === 0,
        stateWritten,
        // Mena je kód, nie údaj o zákazníkovi — do logu smie.
        currencies: currencies.map((c) => c.currency).join(','),
        ...(dayError !== null ? { errorCode: dayError } : {}),
      });
    }
  } catch (error) {
    // P6 — táto funkcia nesmie hodiť. Čokoľvek nečakané sa premení na kód.
    runError = errorCode(error);
    opLog.error('shop_revenue_aborted', { errorCode: runError, requestsUsed });
  }

  const dailyBudgetReached = budgetStop !== null;
  const stoppedBy: SalesStopReason =
    runError !== null
      ? 'error'
      : dailyBudgetReached
        ? 'daily_budget'
        : capReached
          ? 'run_cap'
          : 'done';

  const outcome: ShopRevenueSyncResult['outcome'] =
    runError === null &&
    !capReached &&
    !dailyBudgetReached &&
    reports.every((report) => report.complete)
      ? 'complete'
      : runError === null && dailyBudgetReached && !reports.some((report) => report.written)
        ? 'paused'
        : 'partial';

  if (capReached) {
    opLog.warn('shop_revenue_request_cap_reached', { requestsUsed, maxRequests });
  }

  // Trvalá prekážka (401/403, zablokovaná IP) sa hlási NAHLAS a s dôvodom.
  // Dni, ktoré sa nestihli, zostávajú BEZ riadku — appka o nich nič netvrdí.
  const blockKind = classifySalesStop(runError);
  if (blockKind !== null) {
    opLog.warn('shop_revenue_blocked', { block: blockKind, errorCode: runError, requestsUsed });
  }

  if (budgetStop !== null) {
    opLog.info('shop_revenue_daily_budget_reached', {
      requestsUsed,
      readsUsed,
      used: budgetStop.used,
      limit: budgetStop.limit,
      known: budgetStop.known,
      resumeAt: budgetStop.resetAt.toISOString(),
    });
  }

  return {
    outcome,
    windowFrom,
    windowTo: today,
    days: reports,
    requestsUsed,
    readsUsed,
    capReached,
    dailyBudgetReached,
    stoppedBy,
    resumeAt: budgetStop === null ? null : budgetStop.resetAt,
    error: runError,
  };
}
