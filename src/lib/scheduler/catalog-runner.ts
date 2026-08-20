/**
 * Aura Zľavy — spúšťač synchronizácie katalógu (KONTRAKT V3: K7).
 *
 * K7 žiada plnú synchronizáciu „manuálne aj raz denne cronom, mimo špičky".
 * Cron ako taký tu byť nemôže — D82 zakazuje host cron aj samostatný worker,
 * plánovač je in-process tick. Rozhodovanie „je čas?" preto žije tu, oddelene
 * od samotnej synchronizácie (`lib/shop/catalog-sync.ts`), presne ako pri
 * predajoch (`lib/sales/sync-runner.ts`).
 *
 * Tri pravidlá, ktoré určujú, kedy sa sync spustí:
 *
 *  1. **Mimo špičky.** Preferované okno je 21:00–07:00 miestneho času
 *     (`Europe/Bratislava`, nikdy UTC — inak by sa okno v lete posunulo o dve
 *     hodiny). Hodina sa počíta cez `zonedParts()`, nie cez `getHours()`.
 *  2. **Ale raz denne to musí naozaj prebehnúť.** Appka beží na pracovnom
 *     počítači, ktorý je v noci VYPNUTÝ — striktné nočné okno by znamenalo, že
 *     sync neprebehne nikdy. Presne túto pascu už raz vyriešil sales runner.
 *     Preto: keď sú dáta starší než `CATALOG_STALE_MS`, sync sa spustí aj cez
 *     deň, a keď je katalóg PRÁZDNY, spustí sa hneď (bez neho je karta Produkty
 *     prázdna a appka nemá z čoho vyberať).
 *  3. **Zápisy majú prednosť pred syncom** (odpoveď „Rozpočet: zápisy majú
 *     prednosť"). Keď v tomto ticku pracovala fronta, sync sa preskočí — čítanie
 *     katalógu 400 requestami by fronte kradlo čas v jednom tick-u.
 *
 * Modul NIKDY nehádže: katalóg je podklad, nie zápis, a jeho výpadok nesmie
 * zhodiť tick ani zdržať zľavy.
 *
 * Vlastník: V7.
 */
import type { AuditWriter, Logger, ShopClient, UtcDate } from '@/contracts';

import { LOGIC_TIME_ZONE, zonedParts } from '@/lib/domain/dates';
import {
  syncCatalog,
  type CatalogSyncResult,
  type CatalogSyncSink,
} from '@/lib/shop/catalog-sync';

/* ═══════════════════════════ konštanty (K7) ═══════════════════════════════ */

/** Najmenší odstup medzi dvoma synchronizáciami — „raz denne" s rezervou. */
export const CATALOG_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * Kedy sú dáta natoľko staré, že sync beží aj v špičke. 36 h je viac než jeden
 * pracovný deň, takže bežný nočný cyklus (PC vypnutý) sa do okna zmestí, a
 * zároveň sa nikdy nestane, že by „raz denne" znamenalo „raz do týždňa".
 */
export const CATALOG_STALE_MS = 36 * 60 * 60 * 1000;

/** Preferované okno mimo špičky (miestny čas, hranica `from` vrátane). */
export const CATALOG_OFF_PEAK_FROM_HOUR = 21;
export const CATALOG_OFF_PEAK_TO_HOUR = 7;

/** Odstup po ticku, v ktorom sa nesynchronizovalo kvôli špičke alebo fronte. */
export const CATALOG_RECHECK_MS = 15 * 60 * 1000;

export type CatalogRunOutcome =
  | 'already_running'
  | 'too_soon'
  | 'peak_hours'
  | 'writes_first'
  | 'ran'
  | 'failed';

export interface CatalogRunReport {
  outcome: CatalogRunOutcome;
  sync: CatalogSyncResult | null;
}

export interface CatalogRunnerDeps {
  shopClient: Pick<ShopClient, 'listProducts'>;
  catalog: CatalogSyncSink & {
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
 * nie „naposledy": odstup po úspechu (20 h) a po preskočení kvôli špičke
 * (15 min) sú rôzne a jedna premenná „naposledy" ich nerozlíši.
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
): Promise<CatalogRunReport> {
  const sync = await syncCatalog({
    shopClient: deps.shopClient,
    catalog: deps.catalog,
    ...(deps.audit !== undefined ? { audit: deps.audit } : {}),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    ...(deps.sleepFn !== undefined ? { sleepFn: deps.sleepFn } : {}),
    ...(deps.perPage !== undefined ? { perPage: deps.perPage } : {}),
    ...(deps.pausePerPageMs !== undefined ? { pausePerPageMs: deps.pausePerPageMs } : {}),
  });

  // Aj neúspešný beh posúva odstup — inak by rozbitý shop znamenal 400
  // requestov každú minútu. `partial` je úspech: riadky, ktoré prišli, platia.
  nextAllowedMs = nowMs + CATALOG_MIN_INTERVAL_MS;
  const report: CatalogRunReport = {
    outcome: sync.outcome === 'failed' ? 'failed' : 'ran',
    sync,
  };
  deps.logger?.info('catalog_sync_run', {
    reason,
    outcome: sync.outcome,
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
    // Katalóg bez jediného riadku je iná situácia než starý katalóg: appka nemá
    // z čoho vyberať produkty, takže sa načítava HNEĎ, bez ohľadu na špičku.
    let lastFetchedAt: UtcDate | null = null;
    try {
      lastFetchedAt = await deps.catalog.lastFetchedAt();
    } catch (error) {
      // Nečitateľná DB nie je dôvod ťahať 400 requestov zo shopu — skúsime
      // neskôr. Fail-closed smer je nesynchronizovať.
      nextAllowedMs = nowMs + CATALOG_RECHECK_MS;
      deps.logger?.error('catalog_last_fetched_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { outcome: 'failed', sync: null };
    }

    if (lastFetchedAt === null) {
      // Prázdny katalóg — zápisy aj tak majú prednosť, ale špičku ignorujeme.
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
 * odstup — človek si oň povedal — ale NIE súbežnosť: dva behy naraz by z jedného
 * katalógu urobili dva a zbytočne zdvojili 400 requestov.
 */
export async function runCatalogSyncNow(
  deps: CatalogRunnerDeps,
  opts: CatalogRunOptions = {},
): Promise<CatalogRunReport> {
  const nowMs = (opts.now ?? new Date()).getTime();
  if (running) return { outcome: 'already_running', sync: null };
  running = true;
  try {
    return await run(deps, nowMs, 'manual');
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
