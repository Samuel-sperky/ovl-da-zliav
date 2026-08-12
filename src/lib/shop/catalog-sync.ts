/**
 * Aura Zľavy — PLNÁ SYNCHRONIZÁCIA KATALÓGU (KONTRAKT V3: K7;
 * KONTRAKT-DOKONCENIE-2026-08-12: A2, A3, A4).
 *
 * `catalog_cache` prestala byť cache desiatich produktov a stala sa zrkadlom
 * katalógu — 41 082 riadkov. Tento modul ho stránkovane prečíta cez zoznamový
 * endpoint shopu a po dávkach zapíše do vlastnej DB.
 *
 * PREČO JE TO DVOJDŇOVÝ BEH A NIE FUNKCIA
 * ---------------------------------------
 * 41 082 produktov po 100 na stránku je 411 čítaní. Anonymný strop shopu je
 * **30/min a 300 za UTC deň** (`docs/api/sperky-api-v4.md`, čísla v
 * `@/lib/shop/rate-limits`), z čoho si appka berie 80 % — teda 240 čítaní denne.
 * Celý katalóg sa do jedného UTC dňa NEZMESTÍ; je to aritmetika stropu, nie
 * chyba implementácie. Z toho plynú tri veci, ktoré tento modul musí vedieť:
 *
 *  1. **Pokračovať tam, kde skončil** (A2). Pokrok žije v `catalog_sync_state`
 *     (migrácia 0013), nie v pamäti procesu — beh musí prežiť polnoc, reštart
 *     appky aj vypnutý počítač. Dovtedy platilo, že po prerušení sa začínalo
 *     znova od stránky 1, takže sa chvost katalógu neprečítal NIKDY.
 *  2. **Zastaviť sa PRED prekročením denného stropu** (A4). Rozpočet je
 *     zdieľaný (`@/lib/shop/read-budget`) a rezervuje sa PRED requestom:
 *     request, ktorý skončil na 429, sa do stropu shopu počíta rovnako ako
 *     úspešný. Minutý rozpočet NIE JE chyba — je to „pokračujem po polnoci UTC".
 *  3. **Pri 429 pozastaviť CELÝ beh** (A3), nie opakovať jednu stránku trikrát.
 *     Trojnásobné opakovanie tej istej stránky spáli tri čítania na to isté
 *     miesto v katalógu a ban tým len predĺži. `Retry-After` sa preto ukladá do
 *     pokroku ako `paused_until` a beh sa k stránke vráti až po ňom.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *  - **Synchronizácia je ČÍTANIE a NESMIE konzumovať zápisový rozpočet (K7).**
 *    Modul volá výhradne `listProducts()` a v celom súbore sa nevyskytuje
 *    `setReduction` ani audit event `write_attempt` — a je na to test, ktorý
 *    skenuje zdroj. Denný strop 200 zápisov (K2) sa počíta z auditu, takže keby
 *    sem `write_attempt` niekedy pribudol, ticho by ukradol rozpočet fronte,
 *    ktorá beží týždne.
 *  - **Kľúč sa nikdy nedotkne.** Čítacie volania shop klienta nemajú parameter
 *    pre `SecretRef` (D48), takže `X-Api-Key` sa pri synchronizácii vôbec
 *    nezostaví (I1). Sync teda funguje aj vtedy, keď kľúč nie je vložený.
 *  - **Stránky idú SEKVENČNE** s pauzou medzi nimi. Nie kvôli I10 (to je
 *    o zápisoch), ale kvôli minútovému čítaciemu stropu: 60 000 / 24 = 2 500 ms.
 *  - **Pokrok sa ukladá po KAŽDEJ zapísanej stránke.** Nie na konci behu —
 *    beh, ktorý sa ukladá až na konci, po páde procesu nezachráni nič.
 *  - **`fetched_at` na riadok** je meraný fakt, nie odhad (K7, P7) — každá
 *    stránka nesie čas, kedy sa naozaj prečítala.
 *  - **Modul NIKDY nehádže.** Zlyhanie na stránke N zastaví beh, ale riadky
 *    zapísané dovtedy zostávajú platné a výsledok je `partial`. Katalóg je
 *    podklad pre výber produktov; jeho výpadok nesmie zhodiť tick ani frontu.
 *
 * Čo tu ZÁMERNE nie je: mazanie riadkov, ktoré shop už nevracia. Produkt, čo
 * zmizol zo zoznamu, môže byť len skrytý; zmazať ho z katalógu by znamenalo
 * tvrdiť o shope niečo, čo nevieme (I11). Na to slúži `markShopStatus()` po
 * konkrétnom `not found` (D49).
 *
 * Vlastník: V7.
 */
import type { AuditWriter, Logger, ProductListItem, ShopClient, ShopCtx, Ulid, UtcDate } from '@/contracts';

import type { CatalogSyncProgress, CatalogUpsertInput } from '@/lib/repo/catalog.repo';
import { newOperationId } from '@/lib/shop/correlation';
import { isShopRequestError } from '@/lib/shop/errors';
import { MIN_ANON_READ_PAUSE_MS } from '@/lib/shop/rate-limits';
import {
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadReservation,
} from '@/lib/shop/read-budget';

/* ═══════════════════════════ konštanty (K7) ═══════════════════════════════ */

/** Shop stránkuje `per_page` s tvrdým stropom 100 (`docs/api/sperky-api-v4.md`). */
export const CATALOG_PAGE_SIZE = 100;

/**
 * Pauza medzi stránkami — odvodená z anonymného minútového stropu, nie zvolená.
 * Pri 24 povolených čítaniach za minútu to je 2 500 ms.
 *
 * Denný strop 300 volaní znamená, že 411 stránok sa do jedného UTC dňa
 * nezmestí; celý katalóg je dvojdňový beh a musí vedieť pokračovať.
 */
export const CATALOG_PAGE_PAUSE_MS = MIN_ANON_READ_PAUSE_MS;

/**
 * Poistka proti nekonečnému stránkovaniu. 41 082 produktov po 100 je 411
 * stránok; 1 000 je viac než dvojnásobná rezerva na rast katalógu a zároveň
 * strop, pri ktorom sa beh zastaví aj vtedy, keby shop stránkovanie pokazil.
 */
export const CATALOG_MAX_PAGES = 1_000;

/**
 * Ako dlho stáť po 429, keď shop `Retry-After` NEPOŠLE. Minúta je celé okno
 * minútového stropu — kratšie čakanie by narazilo do toho istého limitu, dlhšie
 * by zbytočne stálo, keď je limit minútový.
 */
export const CATALOG_RATE_LIMIT_PAUSE_MS = 60_000;

/** Strop čakania podľa `Retry-After` — hlavička sa berie vážne, ale nie slepo. */
export const CATALOG_MAX_PAUSE_MS = 15 * 60 * 1000;

/* ═══════════════════════════════ typy ═════════════════════════════════════ */

/**
 * Zápisová strana synchronizácie. Zámerne najmenší možný tvar — produkčne to je
 * `catalogRepo` (V4), v testoch in-memory zberač.
 */
export interface CatalogSyncSink {
  /** Dávkový upsert stránky. Vracia počet zapísaných riadkov. */
  upsertMany(records: CatalogUpsertInput[]): Promise<number>;
}

/** PAMÄŤ BEHU (A2) — kde sa skončilo. Produkčne `catalog_sync_state`. */
export interface CatalogProgressStore {
  loadSyncProgress(): Promise<CatalogSyncProgress>;
  /** Volá sa po KAŽDEJ zapísanej stránke, nie na konci behu. */
  saveSyncProgress(progress: CatalogSyncProgress): Promise<void>;
}

/** ZDIEĽANÝ denný rozpočet čítaní (A4). Rezervuje sa PRED requestom. */
export interface CatalogReadBudgetGate {
  reserveShopReads(count?: number): Promise<ReadReservation>;
}

export interface CatalogSyncDeps {
  /** VÝHRADNE čítacia časť klienta — zápis sa sem nedá podstrčiť. */
  shopClient: Pick<ShopClient, 'listProducts'>;
  catalog: CatalogSyncSink;
  /**
   * Trvalá pamäť behu (A2). Keď chýba, beh si pokrok drží len v pamäti a po
   * prerušení sa vráti na stránku 1 — to je presne tá chyba, ktorá nechala
   * chvost katalógu neprečítaný, takže produkčné zapojenie ju MUSÍ dodať
   * (`CatalogRunnerDeps` ju preto vyžaduje typom). Bez nej sa zapíše varovanie.
   */
  progress?: CatalogProgressStore;
  /**
   * Denný rozpočet čítaní (A4). Keď chýba, počíta sa len v pamäti procesu —
   * použiteľné pre testy a jednorazové čítania, nie pre dvojdňový beh.
   */
  budget?: CatalogReadBudgetGate;
  audit?: AuditWriter;
  logger?: Logger;
  now?: () => UtcDate;
  sleepFn?: (ms: number) => Promise<void>;
  perPage?: number;
  pausePerPageMs?: number;
  /** Strop stránok NA JEDEN BEH (nie na celý katalóg). */
  maxPages?: number;
  /** Korelačné ID celého behu (D58). Default: nové. */
  operationId?: Ulid;
  /** `true` = zahodí pokrok a začne od stránky 1 (ručné „načítať odznova"). */
  restart?: boolean;
}

/**
 * Ako beh dopadol.
 *
 *  - `ok`      — prechod dočítal katalóg po koniec,
 *  - `partial` — beh sa zastavil skôr, ale niečo zapísal (chyba aj čakanie),
 *  - `paused`  — beh sa zastavil skôr a nezapísal nič, a NIE JE to chyba
 *                (minutý denný rozpočet, `Retry-After` ešte beží),
 *  - `failed`  — chyba a nezapísal sa ani jeden riadok,
 *  - `empty`   — shop nevrátil ani jeden produkt.
 */
export type CatalogSyncOutcome = 'ok' | 'partial' | 'paused' | 'failed' | 'empty';

/** Čo beh zastavilo. `done` = dočítal katalóg. */
export type CatalogStopReason =
  | 'done'
  | 'daily_budget'
  | 'rate_limited'
  | 'error'
  | 'page_limit';

export interface CatalogSyncResult {
  outcome: CatalogSyncOutcome;
  /** Koľko stránok sa naozaj prečítalo V TOMTO BEHU. */
  pages: number;
  /** Koľko riadkov sa zapísalo do `catalog_cache` V TOMTO BEHU. */
  products: number;
  /** Koľko produktov hlási shop celkovo. `null` = nedozvedeli sme sa to. */
  total: number | null;
  /** Od ktorej stránky tento beh začal (pokračovanie, A2). */
  startPage: number;
  /** Posledná úspešne zapísaná stránka po tomto behu. */
  lastPage: number;
  /** `true` = katalóg je dočítaný po koniec. */
  completed: boolean;
  /** Čo beh zastavilo — pre UI a pre rozhodovanie runnera. */
  stoppedBy: CatalogStopReason;
  /** Kedy sa smie pokračovať. `null` = hneď. */
  resumeAt: UtcDate | null;
  /** Koľko čítaní tento beh minul zo zdieľaného denného rozpočtu. */
  readsUsed: number;
  startedAt: UtcDate;
  finishedAt: UtcDate;
  durationMs: number;
  /** KÓD chyby, ktorá beh zastavila (I1). `null` = beh nespadol. */
  error: string | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** `ProductListItem` → riadok `catalog_cache`. Cena je DECIMAL, nikdy float (§2). */
export function toCatalogRow(
  product: ProductListItem,
  fetchedAt: UtcDate,
): CatalogUpsertInput {
  return {
    productId: product.id,
    name: typeof product.name === 'string' ? product.name : null,
    // `DECIMAL(10,2)` sa do DB posiela ako string — číslo by prešlo cez float.
    price: Number.isFinite(product.price) ? product.price.toFixed(2) : null,
    hasAttributes: product.has_attributes === true,
    // Produkt, ktorý zoznam práve vrátil, v shope existuje (K1 bod 2).
    shopStatus: 'ok',
    source: 'list',
    fetchedAt,
    // I1 — `raw` musí byť redigované; zoznam nesie len id/name/price/atribúty,
    // takže sa ukladá presne to, čo sme dostali, a nič citlivé v ňom nie je.
    raw: product,
  };
}

/* ═══════════════════════ pomocníci (chyby a čakanie) ══════════════════════ */

/**
 * Pokrok v pamäti procesu — núdzová náhrada, keď volajúci trvalé úložisko
 * nedodal. Po reštarte je prázdny, takže beh začne od stránky 1; produkčné
 * zapojenie ho preto NIKDY nepoužije (viď `CatalogSyncDeps.progress`).
 */
export function createMemoryCatalogProgress(
  initial?: Partial<CatalogSyncProgress>,
): CatalogProgressStore {
  let stored: CatalogSyncProgress = {
    perPage: CATALOG_PAGE_SIZE,
    lastPage: 0,
    shopTotal: null,
    rowsWritten: 0,
    completed: false,
    startedAt: null,
    lastReadAt: null,
    finishedAt: null,
    pausedUntil: null,
    pauseReason: null,
    lastError: null,
    updatedAt: null,
    ...initial,
  };
  return {
    async loadSyncProgress() {
      return { ...stored };
    },
    async saveSyncProgress(progress) {
      stored = { ...progress };
    },
  };
}

/** Rozpočet v pamäti procesu — rovnaké stropy, ale bez prežitia reštartu. */
function createMemoryBudgetGate(): CatalogReadBudgetGate {
  const budget = createReadBudget({ store: createMemoryReadBudgetStore(), lane: 'anon' });
  return { reserveShopReads: (count = 1) => budget.reserve(count) };
}

/**
 * Chyba → KÓD (I1). Nikdy text odpovede shopu, nikdy hláška z knižnice — len
 * zaradenie, ktoré si appka vyrobila sama. Rovnaké pravidlo ako v `sales-sync`.
 */
function errorCode(error: unknown): string {
  if (isShopRequestError(error)) return error.shopError.code ?? error.shopError.kind;
  if (error instanceof Error && error.name.length > 0) return `${error.name}: ${error.message}`;
  return 'local_unknown';
}

/** `true` len pre 429 — jediná chyba, po ktorej sa pozastavuje CELÝ beh (A3). */
function isRateLimited(error: unknown): boolean {
  return isShopRequestError(error) && error.shopError.kind === 'rate_limited';
}

/**
 * Ako dlho stáť po 429. `Retry-After` má prednosť (klient ho už zastropoval
 * podľa D42), ale zastropuje sa aj tu — hlavička je cudzí vstup a beh, ktorý by
 * podľa nej stál hodiny, by sa v UI tváril ako zaseknutý.
 */
function rateLimitPauseMs(error: unknown): number {
  const seconds = isShopRequestError(error) ? error.shopError.retryAfterSeconds : undefined;
  const fromHeader =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? Math.ceil(seconds * 1000)
      : CATALOG_RATE_LIMIT_PAUSE_MS;
  return Math.min(CATALOG_MAX_PAUSE_MS, Math.max(1_000, fromHeader));
}

/* ═══════════════════════════ synchronizácia ═══════════════════════════════ */

/**
 * Prečíta ďalšiu časť katalógu a zrkadlí ju do `catalog_cache`.
 *
 * Beh nie je „celý katalóg naraz": je to dávka, ktorá sa zmestí do dnešného
 * rozpočtu čítaní, a pokrok, z ktorého sa dá pokračovať zajtra.
 *
 * @returns report behu; NIKDY nehádže.
 */
export async function syncCatalog(deps: CatalogSyncDeps): Promise<CatalogSyncResult> {
  const now = deps.now ?? ((): UtcDate => new Date());
  const log = deps.logger;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const perPage = Math.min(CATALOG_PAGE_SIZE, Math.max(1, Math.trunc(deps.perPage ?? CATALOG_PAGE_SIZE)));
  // Podlaha, nie predvoľba: pauza sa nedá podliezť ani konfiguráciou, rovnako
  // ako `MIN_WRITE_PAUSE_MS` na zápisovej strane. Rýchlosť testov to nebrzdí —
  // tie si podsúvajú vlastné `sleepFn`.
  const pauseMs = Math.max(
    MIN_ANON_READ_PAUSE_MS,
    Math.trunc(deps.pausePerPageMs ?? CATALOG_PAGE_PAUSE_MS),
  );
  const maxPages = Math.max(1, Math.trunc(deps.maxPages ?? CATALOG_MAX_PAGES));
  const ctx: ShopCtx = { operationId: deps.operationId ?? newOperationId() };

  // Chýbajúca trvalá pamäť behu nie je dôvod nečítať, ale je to dôvod povedať
  // to nahlas: taký beh po prerušení začne odznova (A2).
  if (deps.progress === undefined) {
    log?.warn('catalog_progress_store_missing', { detail: 'pokrok behu žije len v pamäti procesu' });
  }
  const progressStore = deps.progress ?? createMemoryCatalogProgress();
  const budgetGate = deps.budget ?? createMemoryBudgetGate();

  const startedAt = now();
  let pages = 0;
  let products = 0;
  let readsUsed = 0;
  let error: string | null = null;
  let stoppedBy: CatalogStopReason = 'done';
  let resumeAt: UtcDate | null = null;
  /** Prvé ID predchádzajúcej stránky — obrana proti shopu, čo ignoruje `page`. */
  let previousFirstId: number | null = null;

  /* ── 1. Odkiaľ pokračujeme (A2) ─────────────────────────────────────────── */

  let progress: CatalogSyncProgress;
  try {
    progress = await progressStore.loadSyncProgress();
  } catch (cause) {
    // Bez pokroku sa nesmie začať od stránky 1 — zopakovalo by sa presne to, čo
    // tento modul rieši. Fail-closed: tento beh sa nekoná, ďalší to skúsi znova.
    const code = errorCode(cause);
    log?.error('catalog_progress_unreadable', { error: code });
    const finishedAt = now();
    return {
      outcome: 'failed',
      pages: 0,
      products: 0,
      total: null,
      startPage: 0,
      lastPage: 0,
      completed: false,
      stoppedBy: 'error',
      resumeAt: null,
      readsUsed: 0,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      error: code,
    };
  }

  /* ── 2. Stojí beh ešte na `Retry-After` alebo na rozpočte? (A3, A4) ─────── */

  // Táto otázka je PRED rozhodovaním o novom prechode zámerne: keď shop práve
  // povedal „dosť", nesmie ho appka osloviť ani vtedy, keď si používateľ pýta
  // načítanie odznova. Pauza chráni shop, nie pokrok.
  if (progress.pausedUntil !== null && progress.pausedUntil.getTime() > startedAt.getTime()) {
    const finishedAt = now();
    log?.info('catalog_sync_still_paused', {
      until: progress.pausedUntil.toISOString(),
      reason: progress.pauseReason ?? 'rate_limited',
    });
    return {
      outcome: 'paused',
      pages: 0,
      products: 0,
      total: progress.shopTotal,
      startPage: progress.lastPage + 1,
      lastPage: progress.lastPage,
      completed: false,
      stoppedBy: progress.pauseReason === 'daily_budget' ? 'daily_budget' : 'rate_limited',
      resumeAt: progress.pausedUntil,
      readsUsed: 0,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      error: null,
    };
  }

  /* ── 3. Nový prechod, alebo pokračovanie? (A2) ──────────────────────────── */

  // Nový prechod začína od stránky 1: po dočítaní katalógu, na výslovné želanie
  // (`restart`), alebo keď sa zmenila veľkosť stránky — číslo stránky má význam
  // len voči `per_page` a s inou stránkou by beh kus katalógu preskočil.
  const previousPerPage = progress.perPage;
  const pageSizeChanged = progress.lastPage > 0 && previousPerPage !== perPage;
  const startFresh = deps.restart === true || progress.completed || pageSizeChanged;

  if (startFresh) {
    progress = {
      perPage,
      lastPage: 0,
      // `shopTotal` si necháme: je to posledný známy fakt o shope a UI by inak
      // na začiatku každého prechodu prestalo vedieť, „z koľkých" sa číta.
      shopTotal: progress.shopTotal,
      rowsWritten: 0,
      completed: false,
      startedAt: startedAt,
      lastReadAt: progress.lastReadAt,
      finishedAt: null,
      pausedUntil: null,
      pauseReason: null,
      lastError: null,
      updatedAt: progress.updatedAt,
    };
    if (pageSizeChanged) {
      log?.info('catalog_sync_page_size_changed', { from: previousPerPage, to: perPage });
    }
  } else {
    progress = { ...progress, perPage, startedAt: progress.startedAt ?? startedAt };
  }

  let total: number | null = progress.shopTotal;
  const startPage = progress.lastPage + 1;

  const save = async (): Promise<void> => {
    try {
      await progressStore.saveSyncProgress(progress);
    } catch (cause) {
      // Neuložený pokrok neznehodnotí zapísané riadky — len sa nabudúce
      // zopakuje kus katalógu. Zhodiť kvôli tomu beh by bolo horšie.
      log?.warn('catalog_progress_save_failed', { error: errorCode(cause) });
    }
  };

  // Pauza vypršala — beh ide ďalej a značka sa zahodí, aby v UI nestrašila.
  if (progress.pausedUntil !== null) {
    progress = { ...progress, pausedUntil: null, pauseReason: null };
  }

  /* ── 4. Stránkovanie ────────────────────────────────────────────────────── */

  for (let page = startPage; page < startPage + maxPages; page += 1) {
    // 4.1 Rozpočet PRED requestom (A4). Neúspešné volanie sa do stropu shopu
    // počíta rovnako ako úspešné, takže sa účtuje pokus, nie výsledok.
    let reservation: ReadReservation;
    try {
      reservation = await budgetGate.reserveShopReads(1);
    } catch (cause) {
      // Nečitateľný rozpočet = nečítame (fail-closed). Nie je to chyba behu,
      // je to „radšej nie" — a nabudúce sa to skúsi znova.
      error = errorCode(cause);
      stoppedBy = 'error';
      log?.error('catalog_budget_unreadable', { page, error });
      break;
    }
    if (reservation.granted < 1) {
      stoppedBy = 'daily_budget';
      resumeAt = reservation.status.resetAt;
      progress = {
        ...progress,
        pausedUntil: reservation.status.resetAt,
        pauseReason: 'daily_budget',
      };
      log?.info('catalog_sync_daily_budget_reached', {
        page,
        used: reservation.status.used,
        limit: reservation.status.limit,
        resumeAt: reservation.status.resetAt.toISOString(),
      });
      break;
    }
    readsUsed += reservation.granted;

    // 4.2 Čítanie stránky.
    let batch: Awaited<ReturnType<ShopClient['listProducts']>>;
    try {
      batch = await deps.shopClient.listProducts({ page, perPage }, ctx);
    } catch (cause) {
      if (isRateLimited(cause)) {
        // A3 — 429 zastaví CELÝ beh do uvedeného času. Opakovať tú istú stránku
        // by spálilo ďalšie čítania na to isté miesto a ban len predĺžilo.
        const until = new Date(now().getTime() + rateLimitPauseMs(cause));
        stoppedBy = 'rate_limited';
        resumeAt = until;
        progress = { ...progress, pausedUntil: until, pauseReason: 'rate_limited' };
        log?.warn('catalog_sync_rate_limited', { page, until: until.toISOString() });
        break;
      }
      error = errorCode(cause);
      stoppedBy = 'error';
      log?.error('catalog_sync_page_failed', { page, error });
      break;
    }

    const data = Array.isArray(batch.data) ? batch.data : [];
    if (Number.isFinite(batch.total)) total = batch.total;

    const readAt = now();
    progress = { ...progress, shopTotal: total, lastReadAt: readAt };

    if (data.length === 0) {
      // Prázdna stránka za koncom katalógu = dočítané. Pri prvej stránke to
      // znamená prázdny shop — ani to nie je chyba.
      progress = { ...progress, completed: true, finishedAt: readAt };
      break;
    }

    // Shop, ktorý `page` ignoruje, by nám donekonečna vracal prvú stránku a
    // upsert by to nikdy neodhalil (kľúč je rovnaký). Radšej zastaviť.
    const firstId = data[0]?.id ?? null;
    if (page > startPage && firstId !== null && firstId === previousFirstId) {
      error = 'pagination_stuck';
      stoppedBy = 'error';
      log?.error('catalog_sync_pagination_stuck', { page, firstId });
      break;
    }
    previousFirstId = firstId;

    // 4.3 Zápis stránky a pokroku. Poradie je dôležité: pokrok sa posúva až
    // POTOM, čo sú riadky v DB — inak by pád medzi tým stránku preskočil.
    let written: number;
    try {
      written = await deps.catalog.upsertMany(data.map((item) => toCatalogRow(item, readAt)));
    } catch (cause) {
      error = `upsert_failed: ${errorCode(cause)}`;
      stoppedBy = 'error';
      log?.error('catalog_sync_upsert_failed', { page, error });
      break;
    }
    products += written;
    pages += 1;
    progress = {
      ...progress,
      lastPage: page,
      // Počíta sa, čo sa NAOZAJ zapísalo — nie koľko riadkov shop poslal.
      rowsWritten: progress.rowsWritten + written,
      lastError: null,
    };

    const done = (total !== null && page * perPage >= total) || data.length < perPage;
    if (done) {
      // Pokrok sa uloží až v závere behu (jeden zápis, nie dva za sebou).
      progress = { ...progress, completed: true, finishedAt: readAt };
      break;
    }

    await save();
    if (pauseMs > 0) await sleepFn(pauseMs);
  }

  // Strop stránok na beh sa vyčerpal bez toho, aby sa niečo prerušilo.
  if (stoppedBy === 'done' && !progress.completed && error === null) {
    stoppedBy = 'page_limit';
  }

  /* ── 5. Uloženie pokroku a report ───────────────────────────────────────── */

  progress = { ...progress, lastError: error };
  await save();

  const finishedAt = now();
  const outcome: CatalogSyncOutcome =
    error !== null
      ? products > 0
        ? 'partial'
        : 'failed'
      : progress.completed
        ? products > 0 || progress.lastPage > 0
          ? 'ok'
          : 'empty'
        : products > 0
          ? 'partial'
          : 'paused';

  const result: CatalogSyncResult = {
    outcome,
    pages,
    products,
    total,
    startPage,
    lastPage: progress.lastPage,
    completed: progress.completed,
    stoppedBy,
    resumeAt,
    readsUsed,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    error,
  };

  log?.[error === null ? 'info' : 'warn']('catalog_sync_done', {
    outcome,
    stoppedBy,
    startPage,
    lastPage: result.lastPage,
    pages,
    products,
    readsUsed,
    total: total ?? undefined,
    durationMs: result.durationMs,
    error: error ?? undefined,
  });

  // Audit je append-only (I4) a zapisuje sa cez `appendAudit()`, ktoré samo
  // nikdy nehádže — napriek tomu je tu poistka, aby výpadok auditu nezmenil
  // úspešnú synchronizáciu na výnimku.
  if (deps.audit !== undefined) {
    try {
      await deps.audit.appendAudit({
        actor: 'scheduler',
        eventType: 'catalog_refreshed',
        ok: error === null,
        operationId: ctx.operationId,
        message: auditMessage(result, perPage),
      });
    } catch {
      /* audit nesmie zhodiť synchronizáciu */
    }
  }

  return result;
}

/**
 * Veta do auditu. Hovorí, KDE beh je — nie len koľko riadkov prišlo: pri
 * dvojdňovom behu je „prečítaných 30 stránok" bez kontextu nečitateľné.
 */
function auditMessage(result: CatalogSyncResult, perPage: number): string {
  // Počet stránok sa počíta z veľkosti stránky TOHTO behu, nie z konštanty —
  // inak by veta pri inej `per_page` klamala o tom, koľko ich vlastne je.
  const pagesTotal =
    result.total === null ? null : Math.max(1, Math.ceil(result.total / Math.max(1, perPage)));
  const range =
    result.pages === 0
      ? `bez novej stránky, pokrok stojí na stránke ${result.lastPage}`
      : `stránky ${result.startPage}–${result.lastPage}${pagesTotal === null ? '' : ` z ${pagesTotal}`}`;
  const head = `Synchronizácia katalógu: ${result.products} riadkov, ${range}`;

  switch (result.stoppedBy) {
    case 'done':
      return `${head} — katalóg je dočítaný.`;
    case 'daily_budget':
      return `${head} — denný rozpočet čítaní je minutý, pokračujem po polnoci UTC.`;
    case 'rate_limited':
      return `${head} — shop hlási limit, pokračujem neskôr.`;
    case 'page_limit':
      return `${head} — dávka tohto behu je hotová, pokračujem v ďalšom.`;
    default:
      return `${head} — zastavené na chybe ${result.error ?? 'unknown'}.`;
  }
}
