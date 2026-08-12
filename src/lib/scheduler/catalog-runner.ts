/**
 * Aura Zľavy — spúšťač synchronizácie katalógu (KONTRAKT V3: K7;
 * KONTRAKT-DOKONCENIE-2026-08-12: A2, A4, A5).
 *
 * K7 žiada plnú synchronizáciu „manuálne aj raz denne cronom, mimo špičky".
 * Cron ako taký tu byť nemôže — D82 zakazuje host cron aj samostatný worker,
 * plánovač je in-process tick. Rozhodovanie „je čas?" preto žije tu, oddelene
 * od samotnej synchronizácie (`lib/shop/catalog-sync.ts`), presne ako pri
 * predajoch (`lib/sales/sync-runner.ts`).
 *
 * ROZHODUJE POKROK, NIE VEK RIADKOV
 * ---------------------------------
 * Toto je najdôležitejšia zmena oproti pôvodnej verzii. Runner sa kedysi pýtal
 * len `lastFetchedAt()` (= `MAX(fetched_at)` v katalógu) a odstup 20 h. Lenže
 * pri dvojdňovom behu je `fetched_at` čerstvé hneď po prvej zapísanej stránke,
 * takže odpoveď znela „too_soon" a beh sa k zvyšku katalógu vrátil až o 20 h —
 * a tam začal od stránky 1. Chvost katalógu sa tak neprečítal nikdy.
 *
 * Runner sa preto najprv pýta na POKROK (`catalog_sync_state`, A2):
 *
 *  1. **Nedokončený prechod pokračuje čo najskôr** — nečaká sa 20 h ani okno
 *     mimo špičky. Tempo drží čítací rozpočet (24/min, 240/deň), nie hodina na
 *     hodinách; nočné okno by z dvojdňového behu urobilo týždňový.
 *  2. **Pauza sa rešpektuje.** Keď pokrok hlási `paused_until` (429 alebo
 *     minutý denný rozpočet), runner sa ani nepokúsi čítať a povie, dokedy.
 *  3. **Dokončený katalóg sa obnovuje raz denne, mimo špičky** — pôvodné
 *     pravidlo K7 platí ďalej, len sa týka NOVÉHO prechodu, nie pokračovania.
 *     Appka beží na pracovnom počítači, ktorý je v noci vypnutý, takže staré
 *     dáta (`CATALOG_STALE_MS`) sa načítajú aj cez deň.
 *  4. **Zápisy majú prednosť pred syncom.** Keď v tomto ticku pracovala fronta,
 *     sync sa preskočí — čítanie katalógu by fronte kradlo čas v tick-u.
 *
 * Modul NIKDY nehádže: katalóg je podklad, nie zápis, a jeho výpadok nesmie
 * zhodiť tick ani zdržať zľavy.
 *
 * Vlastník: V7.
 */
import type { AuditWriter, Logger, ShopClient, UtcDate } from '@/contracts';

import type { CatalogSyncProgress } from '@/lib/repo/catalog.repo';

import { LOGIC_TIME_ZONE, zonedParts } from '@/lib/domain/dates';
import {
  syncCatalog,
  type CatalogProgressStore,
  type CatalogReadBudgetGate,
  type CatalogSyncResult,
  type CatalogSyncSink,
} from '@/lib/shop/catalog-sync';

/* ═══════════════════════════ konštanty (K7) ═══════════════════════════════ */

/** Najmenší odstup medzi dvoma PRECHODMI katalógu — „raz denne" s rezervou. */
export const CATALOG_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * Kedy sú dáta natoľko staré, že nový prechod beží aj v špičke. 36 h je viac než
 * jeden pracovný deň, takže bežný nočný cyklus (PC vypnutý) sa do okna zmestí, a
 * zároveň sa nikdy nestane, že by „raz denne" znamenalo „raz do týždňa".
 */
export const CATALOG_STALE_MS = 36 * 60 * 60 * 1000;

/** Preferované okno mimo špičky (miestny čas, hranica `from` vrátane). */
export const CATALOG_OFF_PEAK_FROM_HOUR = 21;
export const CATALOG_OFF_PEAK_TO_HOUR = 7;

/** Odstup po ticku, v ktorom sa nesynchronizovalo kvôli špičke alebo fronte. */
export const CATALOG_RECHECK_MS = 15 * 60 * 1000;

/**
 * Odstup medzi dvoma DÁVKAMI toho istého prechodu. Nedokončený katalóg sa
 * dočítava priebežne, ale nie v každom ticku — jedna dávka spotrebuje kus
 * denného rozpočtu a medzi dávkami má zmysel nechať shop na pokoji.
 */
export const CATALOG_RESUME_MS = 60 * 1000;

/**
 * Koľko stránok najviac prečíta JEDNA dávka.
 *
 * Denný rozpočet (240 čítaní) je tvrdý strop nad tým; toto je len zrnitosť.
 * Prečo vôbec: tick na katalóg ČAKÁ (`tick.ts` ho `await`-uje), takže dlhá dávka
 * odkladá ďalší tick — a s ním aj frontu. 30 stránok × 2,5 s ≈ 75 sekúnd, čo je
 * približne jeden tick; pri odstupe `CATALOG_RESUME_MS` sa denný rozpočet aj tak
 * minie skôr, než sa dávky stihnú vyčerpať. Pôvodných 1 000 stránok na beh
 * znamenalo, že jeden tick mohol trvať aj 40 minút.
 */
export const CATALOG_PAGES_PER_BATCH = 30;

/**
 * Retry politika pre shop klienta, ktorý číta KATALÓG (A3, A4).
 *
 * Klient predvolene opakuje 429 až trikrát (D42) — pri katalógu je to presne to,
 * čo sa nesmie stať: tri pokusy sú tri čítania z 240 denných, minuté na tú istú
 * stránku, a shop ich vidí ako ďalšie tri návštevy v okamihu, keď práve povedal
 * „dosť". Opakovanie preto NEPATRÍ dovnútra jednej stránky, ale na úroveň celého
 * behu: `syncCatalog` si pauzu uloží do pokroku a runner sa vráti neskôr.
 *
 * Zapojenie: `createShopClientFromSettings(settingsRepo, { policy: CATALOG_READ_RETRY_POLICY })`.
 */
export const CATALOG_READ_RETRY_POLICY = { maxAttempts: 1 } as const;

export type CatalogRunOutcome =
  | 'already_running'
  | 'too_soon'
  | 'peak_hours'
  | 'writes_first'
  | 'paused'
  | 'budget_exhausted'
  | 'ran'
  | 'failed';

export interface CatalogRunReport {
  outcome: CatalogRunOutcome;
  sync: CatalogSyncResult | null;
  /** Kedy sa oplatí skúsiť znova. `null` = nevieme / hneď pri ďalšom ticku. */
  resumeAt?: UtcDate | null;
}

export interface CatalogRunnerDeps {
  shopClient: Pick<ShopClient, 'listProducts'>;
  /**
   * Katalóg vrátane TRVALEJ pamäte behu a rozpočtu čítaní — tu sú povinné.
   * Produkčne je to `catalogRepo`; runner je jediná cesta, ktorou sa
   * synchronizácia spúšťa opakovane, takže práve tu sa nesmie dať zabudnúť na
   * pokrok (A2) ani na denný strop (A4).
   */
  catalog: CatalogSyncSink &
    CatalogProgressStore &
    CatalogReadBudgetGate & {
      /** K7 — „Dáta k …". `null` = katalóg je prázdny, sync je potrebný hneď. */
      lastFetchedAt(): Promise<UtcDate | null>;
    };
  audit?: AuditWriter;
  logger?: Logger;
  timeZone?: string;
  /** Prepis pre testy — inak by jeden test čakal minúty. */
  sleepFn?: (ms: number) => Promise<void>;
  perPage?: number;
  pausePerPageMs?: number;
  /** Strop stránok na jednu dávku; default `CATALOG_PAGES_PER_BATCH`. */
  maxPagesPerBatch?: number;
}

export interface CatalogRunOptions {
  now?: UtcDate;
  /** `true` = fronta v tomto ticku pracovala; zápisy majú prednosť. */
  queueBusy?: boolean;
}

/* ═════════════════════════ okno mimo špičky ═══════════════════════════════ */

/**
 * Je `now` v okne mimo špičky? Okno prechádza polnocou, preto je podmienka OR,
 * nie AND. Hodina sa berie z `zonedParts()` — deň ani hodinu NIKDY nepočítame
 * v UTC (D31, pasca z CLAUDE.md).
 */
export function isOffPeak(now: UtcDate, timeZone: string = LOGIC_TIME_ZONE): boolean {
  const { hour } = zonedParts(now, timeZone);
  return hour >= CATALOG_OFF_PEAK_FROM_HOUR || hour < CATALOG_OFF_PEAK_TO_HOUR;
}

/* ═════════════════════════ in-process stav behu ═══════════════════════════ */

let running = false;
/**
 * Najbližší čas (epoch ms), kedy sa smie znova skúsiť. Držíme priamo ten čas,
 * nie „naposledy": odstup po dokončenom prechode (20 h), po dávke (1 min) a po
 * preskočení kvôli špičke (15 min) sú rôzne a jedna premenná „naposledy" ich
 * nerozlíši. Je to len tlmič ticku — skutočná pamäť behu je v DB (A2).
 */
let nextAllowedMs = 0;
let lastReport: CatalogRunReport | null = null;

/** Posledný výsledok — číta ho `/api/catalog/*` (V8) a Nastavenia (V12). */
export function lastCatalogRun(): CatalogRunReport | null {
  return lastReport === null ? null : { ...lastReport };
}

/** Výhradne pre testy. */
export function resetCatalogRunnerState(): void {
  running = false;
  nextAllowedMs = 0;
  lastReport = null;
}

/* ═══════════════════════════ spustenie ════════════════════════════════════ */

async function run(
  deps: CatalogRunnerDeps,
  nowMs: number,
  reason: string,
  opts: { restart?: boolean } = {},
): Promise<CatalogRunReport> {
  const sync = await syncCatalog({
    shopClient: deps.shopClient,
    catalog: deps.catalog,
    // Tá istá inštancia v troch rolách: zapisuje riadky, pamätá si pokrok (A2)
    // a účtuje čítania do zdieľaného rozpočtu (A4).
    progress: deps.catalog,
    budget: deps.catalog,
    maxPages: Math.max(1, Math.trunc(deps.maxPagesPerBatch ?? CATALOG_PAGES_PER_BATCH)),
    ...(opts.restart === true ? { restart: true } : {}),
    ...(deps.audit !== undefined ? { audit: deps.audit } : {}),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    ...(deps.sleepFn !== undefined ? { sleepFn: deps.sleepFn } : {}),
    ...(deps.perPage !== undefined ? { perPage: deps.perPage } : {}),
    ...(deps.pausePerPageMs !== undefined ? { pausePerPageMs: deps.pausePerPageMs } : {}),
  });

  // Odstup podľa toho, čo beh zastavilo. Dokončený katalóg počká celý interval;
  // nedokončený sa vráti hneď, ako to rozpočet a prípadná pauza dovolia — inak
  // by sa dvojdňový beh natiahol na týždne.
  const resumeAtMs = sync.resumeAt === null ? null : sync.resumeAt.getTime();
  if (sync.completed) {
    nextAllowedMs = nowMs + CATALOG_MIN_INTERVAL_MS;
  } else if (resumeAtMs !== null) {
    nextAllowedMs = Math.max(nowMs + CATALOG_RESUME_MS, resumeAtMs);
  } else if (sync.outcome === 'failed') {
    // Rozbitý shop alebo DB — skúsiť o 15 minút, nie o minútu.
    nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
  } else {
    nextAllowedMs = nowMs + CATALOG_RESUME_MS;
  }

  const outcome: CatalogRunOutcome =
    sync.outcome === 'failed'
      ? 'failed'
      : sync.stoppedBy === 'daily_budget' && sync.pages === 0
        ? 'budget_exhausted'
        : sync.outcome === 'paused'
          ? 'paused'
          : 'ran';

  const report: CatalogRunReport = { outcome, sync, resumeAt: sync.resumeAt };
  deps.logger?.info('catalog_sync_run', {
    reason,
    outcome: sync.outcome,
    stoppedBy: sync.stoppedBy,
    startPage: sync.startPage,
    lastPage: sync.lastPage,
    pages: sync.pages,
    products: sync.products,
  });
  lastReport = report;
  return { ...report };
}

/**
 * Spustí synchronizáciu, ak je na čase. Vracia dôvod rozhodnutia, aby sa dalo
 * testovať a logovať, čo sa naozaj stalo — nie len „prebehlo/neprebehlo".
 */
export async function runCatalogSyncIfDue(
  deps: CatalogRunnerDeps,
  opts: CatalogRunOptions = {},
): Promise<CatalogRunReport> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  if (running) return { outcome: 'already_running', sync: null };
  if (nowMs < nextAllowedMs) return { outcome: 'too_soon', sync: null };

  running = true;
  try {
    // 1. Pokrok je prvá otázka: nedokončený prechod má prednosť pred všetkými
    //    pravidlami o veku dát a o špičke (A2).
    let progress: CatalogSyncProgress;
    try {
      progress = await deps.catalog.loadSyncProgress();
    } catch (error) {
      // Nečitateľná DB nie je dôvod ťahať stovky requestov zo shopu — skúsime
      // neskôr. Fail-closed smer je nesynchronizovať.
      nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
      deps.logger?.error('catalog_progress_read_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { outcome: 'failed', sync: null };
    }

    // 2. Beh stojí na `Retry-After` alebo na minutom dennom rozpočte (A3, A4).
    //    Nie je to chyba: appka vie, dokedy stojí, a povie to aj UI.
    if (progress.pausedUntil !== null && progress.pausedUntil.getTime() > nowMs) {
      nextAllowedMs = Math.min(progress.pausedUntil.getTime(), nowMs + CATALOG_RECHECK_MS);
      const outcome: CatalogRunOutcome =
        progress.pauseReason === 'daily_budget' ? 'budget_exhausted' : 'paused';
      const report: CatalogRunReport = { outcome, sync: null, resumeAt: progress.pausedUntil };
      lastReport = report;
      return { ...report };
    }

    // 3. Rozbehnutý a nedokončený prechod — pokračuje sa hneď, len zápisom sa
    //    uhne. Rozbehnutý znamená „má za sebou stránku ALEBO sa už začal":
    //    prechod, ktorý sa zastavil na rozpočte ešte pred prvou stránkou, je
    //    tiež rozbehnutý a nesmie čakať 20 hodín na svoje pokračovanie.
    if (!progress.completed && (progress.lastPage > 0 || progress.startedAt !== null)) {
      if (opts.queueBusy === true) {
        nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
        return { outcome: 'writes_first', sync: null };
      }
      return await run(deps, nowMs, 'resume');
    }

    // 4. Nový prechod: rozhoduje vek dát a okno mimo špičky (pôvodné K7).
    let lastFetchedAt: UtcDate | null = null;
    try {
      lastFetchedAt = await deps.catalog.lastFetchedAt();
    } catch (error) {
      nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
      deps.logger?.error('catalog_last_fetched_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { outcome: 'failed', sync: null };
    }

    if (lastFetchedAt === null) {
      // Prázdny katalóg — zápisy aj tak majú prednosť, ale špičku ignorujeme:
      // bez katalógu je karta Produkty prázdna a appka nemá z čoho vyberať.
      if (opts.queueBusy === true) {
        nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
        return { outcome: 'writes_first', sync: null };
      }
      return await run(deps, nowMs, 'catalog_empty');
    }

    const ageMs = Math.max(0, nowMs - lastFetchedAt.getTime());
    if (ageMs < CATALOG_MIN_INTERVAL_MS) {
      // Dáta sú čerstvé (napr. po manuálnom načítaní) — nič netreba.
      nextAllowedMs = nowMs + (CATALOG_MIN_INTERVAL_MS - ageMs);
      return { outcome: 'too_soon', sync: null };
    }

    if (opts.queueBusy === true) {
      nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
      deps.logger?.info('catalog_sync_skipped', { reason: 'writes_first' });
      return { outcome: 'writes_first', sync: null };
    }

    const stale = ageMs >= CATALOG_STALE_MS;
    if (!stale && !isOffPeak(now, deps.timeZone ?? LOGIC_TIME_ZONE)) {
      nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
      return { outcome: 'peak_hours', sync: null };
    }

    return await run(deps, nowMs, stale ? 'stale_data' : 'off_peak');
  } catch (error) {
    // `syncCatalog` výnimky neprepúšťa, takže sem by sa nemalo dať dostať —
    // a keď áno, nesmie to nič zhodiť.
    nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
    deps.logger?.error('catalog_sync_fatal_caught', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { outcome: 'failed', sync: null };
  } finally {
    running = false;
  }
}

/**
 * Manuálne načítanie z UI („Načítať katalóg", K7). Obchádza okno mimo špičky aj
 * odstup 20 h — človek si oň povedal — ale NIE tri veci:
 *
 *  - **súbežnosť**: dva behy naraz by si prepisovali pokrok a zdvojili čítania,
 *  - **denný rozpočet**: strop shopu neobíde ani človek. Keď je rozpočet minutý,
 *    beh sa pokojne skončí s informáciou „pokračujem po polnoci UTC" (A4),
 *  - **pauzu po 429**: shop práve povedal „dosť". Kliknutie na tlačidlo ho
 *    neprehovorí, len predĺži ban — `syncCatalog` preto vráti `paused` aj tu.
 *
 * `restart: true` znamená „začni odznova od stránky 1" — použije sa, keď si
 * používateľ vyžiada celé nové načítanie namiesto pokračovania.
 */
export async function runCatalogSyncNow(
  deps: CatalogRunnerDeps,
  opts: CatalogRunOptions & { restart?: boolean } = {},
): Promise<CatalogRunReport> {
  const nowMs = (opts.now ?? new Date()).getTime();
  if (running) return { outcome: 'already_running', sync: null };
  running = true;
  try {
    return await run(deps, nowMs, 'manual', { ...(opts.restart === true ? { restart: true } : {}) });
  } catch (error) {
    nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
    deps.logger?.error('catalog_sync_fatal_caught', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { outcome: 'failed', sync: null };
  } finally {
    running = false;
  }
}
