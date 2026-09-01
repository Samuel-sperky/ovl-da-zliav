/**
 * Aura Zľavy — spúšťač OBOHACOVANIA katalógu
 * (KONTRAKT-V4-2026-08-28 §2b: D118 bod 2, D119, D120; I11).
 *
 * `runEnrichBatch()` v `lib/engine/catalog-enrich.ts` vie obohatiť dávku
 * produktov, ale sám sa nikdy nespustí. Tento modul je to, čo mu chýbalo:
 * rozhoduje „je čas?", drží odstup medzi dávkami a stará sa o súbežnosť —
 * presne v tom istom členení, aké má katalógový prechod (`catalog-runner.ts`)
 * a synchronizácia predajov (`lib/sales/sync-runner.ts`).
 *
 * PREČO SAMOSTATNÝ MODUL A NIE VOLANIE V `tick.ts`
 * -----------------------------------------------
 * Rozhodovanie o čase je stav (kedy najskôr znova, beží už niekto, dokedy stojí
 * pauza) a stav sa v tick-u nedrží. Rovnako ako pri katalógu: `tick.ts` vidí
 * jednu funkciu, ktorá vráti report, a nič o dávke nevie.
 *
 * DVE VRSTVY SÚBEŽNOSTI, A DRUHÁ NIE JE NAVYŠE
 * --------------------------------------------
 * `running` v tomto module chráni JEDEN module graf. Next.js kompiluje
 * `instrumentation` do vlastného grafu, takže scheduler a route majú každý
 * vlastnú kópiu tejto premennej — pasca z CLAUDE.md. Druhá vrstva je preto DB
 * advisory lock (`ENRICH_LOCK_NAME`), ktorý je jeden na databázu a vidia ho oba
 * grafy aj omylom spustená druhá inštancia procesu. Bez neho by dávka schedulera
 * a čokoľvek, čo by ju v budúcnosti spustilo z route, čítali z tej istej fronty
 * naraz a obe by si účtovali kvótu, ktorú druhá strana už minula.
 *
 * Trvalá pamäť behu (koľko sa dnes obohatilo, dokedy stojí pauza) je v DB
 * (`catalog_enrich_state`), nie tu — appka beží na pracovnom počítači, ktorý sa
 * vypína, a pamäťová značka by po štarte tvrdila „dnes nič", takže by kvótu
 * prekročila. `nextAllowedMs` je iba tlmič ticku.
 *
 * KĽÚČ (I8' bod 4)
 * ----------------
 * `getFull` chce scope `product:read` a ten má ZÁPISOVÝ kľúč shopu — teda ten
 * istý, ktorým sa zapisujú zľavy. Obohacovanie preto berie kľúč z `apiKeyRepo`
 * (drôtuje ho `scheduler/boot.ts`) a objednávkový repozitár sa tu nesmie
 * objaviť ani v komentári; test skenom zdrojov to vynucuje. Práve preto existuje
 * `lib/sales/sync-runner.ts` — predaje potrebujú DRUHÝ kľúč a scheduler o ňom
 * nesmie vedieť. Obohacovanie druhý kľúč nepotrebuje, takže žiadnu takú clonu
 * nemá a mať nemá.
 *
 * Modul NIKDY nehádže: obohatenie je podklad pre obrazovky, nie zápis, a jeho
 * výpadok nesmie zhodiť tick ani zdržať zľavy.
 *
 * Vlastník: V4 (obohacovanie).
 */
import type { UtcDate } from '@/contracts';

import {
  runEnrichBatch,
  type EnrichBatchDeps,
  type EnrichBatchOutcome,
  type EnrichBatchResult,
  MIN_ENRICH_READ_PAUSE_MS,
} from '@/lib/engine/catalog-enrich';

/* ═══════════════════════════ konštanty ════════════════════════════════════ */

/**
 * Koľko produktov najviac obohatí JEDNA dávka v tick-u.
 *
 * Denný cieľ je ~150 (`catalog_enrich_state.daily_target`, D118) a strop jedného
 * behu engine je 150; toto je zrnitosť, nie strop kvóty. Prečo tak nízko: tick
 * na dávku ČAKÁ (`tick.ts` ju `await`-uje) a engine drží medzi dvoma `getFull`
 * pauzu `MIN_ENRICH_READ_PAUSE_MS` (minútový strop kľúča). Dávka má preto držať
 * ~30 sekúnd, teda polovicu tick-u pri predvolenom `SCHEDULER_TICK_MS` (60 s);
 * dlhšia by tick natiahla a zdržala zľavy, ktoré majú prednosť.
 *
 * ODVODENÉ z pauzy (1. 9. 2026), nie napísané ručne. Dovtedy tu stála osmička,
 * ktorá zodpovedala pauze 3 750 ms pri kvóte 20/min. Po zdvihnutí kvóty na
 * 150/min pauza padla na 500 ms, takže osem produktov by bolo 4 sekundy —
 * dávka by stála a denný cieľ by sa nedosiahol. Pri 500 ms je to 60 produktov.
 *
 * Denný cieľ (`DEFAULT_ENRICH_DAILY_TARGET`) zostáva skutočným regulátorom:
 * dávka sa zastaví na ňom, nie na tomto čísle.
 */
/** Ako dlho má jedna dávka držať — polovica predvoleného tick-u. */
export const ENRICH_BATCH_TARGET_MS = 30_000;

export const ENRICH_PRODUCTS_PER_BATCH = Math.max(
  1,
  Math.floor(ENRICH_BATCH_TARGET_MS / MIN_ENRICH_READ_PAUSE_MS),
);

/** Odstup medzi dvoma dávkami toho istého dňa. */
export const ENRICH_RESUME_MS = 60 * 1000;

/**
 * Odstup po behu, ktorý sa o niečo zastavil (pauza, chýbajúci kľúč, rozpočet,
 * chyba). Je to len tlmič — skutočný dôvod aj čas obnovy si engine ukladá do
 * `catalog_enrich_state` a pri ďalšom pokuse ich vyhodnotí sám, bez requestu.
 */
export const ENRICH_RECHECK_MS = 15 * 60 * 1000;

/**
 * Odstup po behu, ktorému sa nedalo čo robiť: fronta je prázdna alebo je dnešný
 * cieľ naplnený. Hodina, nie minúta — nový deň aj nové produkty prídu tak či tak
 * neskôr a dotazovať sa na to každú minútu je len práca pre DB.
 */
export const ENRICH_IDLE_MS = 60 * 60 * 1000;

/**
 * Meno DB advisory locku, ktorý drží JEDNU dávku obohacovania.
 *
 * Vlastné meno, nie to katalógové: prechod katalógu a obohacovanie sa navzájom
 * neblokujú (sú to dve rôzne kvóty a dve rôzne tabuľky stavu) a jedno meno by
 * z nich urobilo jednu frontu.
 */
export const ENRICH_LOCK_NAME = 'ovl_zliav_catalog_enrich';

/* ═══════════════════════════ typy ═════════════════════════════════════════ */

export type EnrichRunOutcome =
  /** Dávka už beží (in-process alebo podľa DB locku). */
  | 'already_running'
  /** Odstup od predchádzajúceho behu ešte neuplynul. */
  | 'too_soon'
  /** V tomto tick-u sa zapisovalo — zápisy majú prednosť pred čítaním. */
  | 'writes_first'
  /** V tomto tick-u čítal katalóg; dva čítacie behy za sebou by tick natiahli. */
  | 'catalog_first'
  /** Dávka prebehla; ako dopadla, hovorí `batch.outcome`. */
  | 'ran'
  /** Nepodarilo sa ani zistiť, či sa smie začať (DB lock). */
  | 'failed';

export interface EnrichRunReport {
  outcome: EnrichRunOutcome;
  /** Report dávky; `null` = dávka sa v tomto behu vôbec nespustila. */
  batch: EnrichBatchResult | null;
  /** Kedy sa oplatí skúsiť znova. `null` = nevieme / hneď pri ďalšom tick-u. */
  resumeAt?: UtcDate | null;
}

export interface EnrichRunnerDeps extends EnrichBatchDeps {
  /**
   * DRUHÁ VRSTVA SÚBEŽNOSTI — DB advisory lock (viď `ENRICH_LOCK_NAME`).
   *
   * Vracia handle, alebo `null`, keď lock drží niekto iný; vtedy je výsledok
   * `already_running`. Výnimka (nedostupná DB) beh NESPUSTÍ — fail-closed.
   *
   * Zapája sa v produkčnom drôtovaní (`scheduler/boot.ts`), nie tu: modul tak
   * zostáva bez závislosti na poole a unit testy bežia bez DB. Keď chýba, platí
   * len in-process `running` — a to je záruka na JEDEN module graf.
   */
  readonly lock?: (() => Promise<{ release(): Promise<void> } | null>) | undefined;
}

export interface EnrichRunOptions {
  now?: UtcDate;
  /** `true` = v tomto tick-u sa zapisovalo (fire alebo fronta). */
  queueBusy?: boolean;
  /** `true` = v tomto tick-u naozaj čítal katalóg (`CatalogRunOutcome === 'ran'`). */
  catalogBusy?: boolean;
}

/* ═══════════════════════════ in-process stav ══════════════════════════════ */

let running = false;
let nextAllowedMs = 0;
let lastReport: EnrichRunReport | null = null;

/**
 * Posledný výsledok — BEST-EFFORT, a je to vedomé: je to posledná dávka, ktorú
 * videl TENTO module graf. Trvalý stav (kedy sa naposledy čítalo, dokedy stojí
 * pauza, koľko sa dnes obohatilo) je v `catalog_enrich_state` a UI si ho má
 * pýtať odtiaľ; `null` tu NEZNAMENÁ „dávka nebežala".
 */
export function lastEnrichRun(): EnrichRunReport | null {
  return lastReport === null ? null : { ...lastReport };
}

/** Výhradne pre testy. */
export function resetEnrichRunnerState(): void {
  running = false;
  nextAllowedMs = 0;
  lastReport = null;
}

/* ═══════════════════════════ DB lock ══════════════════════════════════════ */

/**
 * Tri stavy, nie dva: „obsadený" znamená, že beží niekto iný, kdežto
 * „nedostupný" znamená, že sa to nedalo ani zistiť — a to je fail-closed chyba,
 * nie pokoj.
 */
type LockAttempt =
  | { kind: 'held'; release(): Promise<void> }
  | { kind: 'busy' }
  | { kind: 'unavailable' };

const NO_LOCK: LockAttempt = { kind: 'held', release: async () => undefined };

async function acquireLock(deps: EnrichRunnerDeps): Promise<LockAttempt> {
  if (deps.lock === undefined) return NO_LOCK;
  try {
    const held = await deps.lock();
    if (held === null) return { kind: 'busy' };
    return { kind: 'held', release: () => held.release() };
  } catch (error) {
    deps.logger?.error('catalog_enrich_lock_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return { kind: 'unavailable' };
  }
}

/* ═══════════════════════════ odstup po behu ═══════════════════════════════ */

/**
 * Ako dlho počkať podľa toho, ČÍM sa dávka skončila. Nad tým ešte platí
 * `resumeAt` z reportu (napr. polnoc UTC pri minutom rozpočte) — berie sa
 * neskorší z oboch časov.
 */
function delayAfter(outcome: EnrichBatchOutcome): number {
  switch (outcome) {
    // Dávka dobehla svoj plán — v ďalšej minúte pokračuje ďalšou.
    case 'done':
      return ENRICH_RESUME_MS;
    // Minútový strop je na hrane; o chvíľu to pôjde.
    case 'budget_minute':
      return ENRICH_RESUME_MS;
    // Niet čo robiť: fronta prázdna alebo dnešný cieľ naplnený.
    case 'no_ids':
    case 'target_reached':
      return ENRICH_IDLE_MS;
    // Zvyšok (pauza, `ip_banned`, 429, rozpočet, chýbajúci kľúč či oprávnenie,
    // chyba) — dôvod aj čas obnovy sú v DB, tu stačí nehamerať.
    default:
      return ENRICH_RECHECK_MS;
  }
}

/* ═══════════════════════════ spustenie ════════════════════════════════════ */

/**
 * Spustí dávku obohacovania, ak je na čase. Vracia dôvod rozhodnutia, aby sa
 * dalo testovať a logovať, čo sa naozaj stalo — nie len „prebehlo/neprebehlo".
 *
 * NIKDY nehádže.
 */
export async function runEnrichBatchIfDue(
  deps: EnrichRunnerDeps,
  opts: EnrichRunOptions = {},
): Promise<EnrichRunReport> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  if (running) return { outcome: 'already_running', batch: null };
  if (nowMs < nextAllowedMs) return { outcome: 'too_soon', batch: null };

  // Zápisy majú prednosť pred čítaním; katalógový prechod má prednosť pred
  // obohacovaním (bez zrkadla katalógu nie je čo obohacovať). Odstup je krátky
  // — je to preskočenie jedného tick-u, nie pauza.
  if (opts.queueBusy === true) {
    nextAllowedMs = nowMs + ENRICH_RESUME_MS;
    return { outcome: 'writes_first', batch: null };
  }
  if (opts.catalogBusy === true) {
    nextAllowedMs = nowMs + ENRICH_RESUME_MS;
    return { outcome: 'catalog_first', batch: null };
  }

  running = true;
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    const lock = await acquireLock(deps);
    if (lock.kind === 'busy') return { outcome: 'already_running', batch: null };
    if (lock.kind === 'unavailable') {
      nextAllowedMs = nowMs + ENRICH_RECHECK_MS;
      return { outcome: 'failed', batch: null };
    }
    releaseLock = () => lock.release();

    const batch = await runEnrichBatch({
      ...deps,
      maxProducts: Math.max(1, Math.trunc(deps.maxProducts ?? ENRICH_PRODUCTS_PER_BATCH)),
    });

    const resumeMs = batch.resumeAt === null ? null : batch.resumeAt.getTime();
    const base = nowMs + delayAfter(batch.outcome);
    nextAllowedMs = resumeMs === null ? base : Math.max(base, resumeMs);

    deps.logger?.info('catalog_enrich_run', {
      outcome: batch.outcome,
      planned: batch.planned,
      attempted: batch.attempted,
      enriched: batch.enriched,
      readsUsed: batch.readsUsed,
      pauseReason: batch.pauseReason,
    });

    const report: EnrichRunReport = { outcome: 'ran', batch, resumeAt: batch.resumeAt };
    lastReport = report;
    return { ...report };
  } catch (error) {
    // `runEnrichBatch` výnimky neprepúšťa, takže sem by sa nemalo dať dostať —
    // a keď áno, nesmie to nič zhodiť.
    nextAllowedMs = nowMs + ENRICH_RECHECK_MS;
    deps.logger?.error('catalog_enrich_fatal_caught', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { outcome: 'failed', batch: null };
  } finally {
    // Lock sa uvoľní VŽDY — držaný lock by inak zablokoval obohacovanie do
    // reštartu procesu (`GET_LOCK` žije na spojení, nie na transakcii).
    if (releaseLock !== null) await releaseLock();
    running = false;
  }
}
