/**
 * Aura Zľavy — FRONTA ZÁPISOV V TICKU (KONTRAKT V3: K2, K5; §9 krok 5b).
 *
 * Zápis prestal byť akcia a stal sa frontou, ktorá beží týždne. Tento modul je
 * jej motor v scheduleri: vezme kampane v stave `queued` (najskorší `date_from`
 * prvý) a dobehne denný rozpočet cez `executeCampaign()`.
 *
 * Poradie krokov je NORMATÍVNE:
 *   0. K5 — príznak `late` kampaniam, ktorým už nabehlo okno a stále majú
 *      `pending` položky. Robí sa VŽDY, aj keď sa v tomto ticku nezapisuje:
 *      meškanie je fakt o čase, nie dôsledok zápisu. Okno sa NIKDY nemení (I7).
 *   1. brána po odstávke počítača (odpoveď 43) — zatvorená = nič sa nezapíše,
 *      fronta čaká na „Pokračovať".
 *   2. prázdna fronta → hotovo.
 *   3. I13 + I12 — env poistka a `writes_locked` (fail-closed).
 *   4. K6 — kľúč na zápis. Bez použiteľného kľúča sa fronta PRESKOČÍ a kampane
 *      zostanú `queued` (viď nižšie, prečo nie `needs_key`).
 *   5. K2 — denný rozpočet. Vyčerpaný rozpočet je INFORMÁCIA, nie chyba
 *      (odpoveď 59): fronta sa preskočí a pokračuje zajtra.
 *   6. per kampaň SEKVENČNE (I10, žiadny `Promise.all`): prepadnuté okno →
 *      `lapsed` (D25), inak `executeCampaign()`. Po každej kampani sa rozpočet
 *      prepočíta z auditu.
 *
 *      Kampaň, ktorej executor hodí výnimku, dostane odstup a najviac
 *      `QUEUE_MAX_ATTEMPTS` pokusov; potom ju fronta vzdá (L5).
 *
 * Štyri rozhodnutia, ktoré sa ľahko prehliadnu:
 *
 *  - **Kampaň si claimne EXECUTOR, nie scheduler.** `executeCampaign()` má
 *    `queued` medzi claimovateľnými stavmi a claim je atomický (D84). Keby si ju
 *    scheduler claimol sám, executor by ju našiel v stave `running`, druhý claim
 *    by neprešel a fronta by sa zasekla — alebo by vznikol falošný audit
 *    `campaign_claimed` pre kampaň, ktorá nič nezapíše.
 *
 *  - **Chýbajúci kľúč NEROBÍ z `queued` stav `needs_key`.** D21 hovorí o kľúči
 *    „v čase spustenia", teda o fire naplánovanej kampane (`due.ts` to tak aj
 *    robí). Kampaň vo fronte ale nemá žiadny „čas spustenia" — čaká na rozpočet.
 *    Keby ju každý tick bez kľúča prehodil do `needs_key`, appka by pri TTL 48 h
 *    a fronte na 40 dní (K6) preklápala stavy sem a tam a vyrábala audit event
 *    na každý tick. Keď kľúč vyprší UPROSTRED dávky, `needs_key` nastaví executor
 *    (D51/D52, K6) — a to je správne miesto, lebo tam sa naozaj prestalo
 *    zapisovať. Dôvod preskočenia sa priznáva v `lastQueueReport()`, takže UI
 *    nemusí nič hádať.
 *
 *  - **Rozpočet sa NEDELÍ medzi súbežné kampane.** Odpoveď 46 by ho deliť
 *    chcela, ale executor dnes nemá strop „zapíš najviac N položiek" a jeho
 *    signatúru vlastní V5. Do tej doby platí priorita podľa `date_from`
 *    (najskorší štart vyhráva) — je to deterministické a nikdy to neprekročí
 *    denný strop. Požiadavka na V5 je v odovzdávke.
 *
 *  - **Zlyhávajúca kampaň sa NESKÚŠA naveky.** Výnimka z executora je stále
 *    lokálna (ostatné kampane bežia ďalej), ale už sa počíta: po odstupoch
 *    5/20/60 minút a `QUEUE_MAX_ATTEMPTS` pokusoch kampaň prejde do
 *    `partial`/`failed` s dôvodom a fronta ju opustí. Bez toho sa
 *    deterministická chyba opakovala každých 60 sekúnd, presne ako 403 na
 *    čítacej strane dvanásť dní (`lib/sales/stop-policy.ts`).
 *
 * Zápis do shopu tento modul NEVOLÁ NIKDY — deleguje ho výhradne
 * `engine/executor.ts` (K11 bod 2).
 *
 * Vlastník: V7.
 */
import { ulid } from 'ulid';

import type { ApiKeyRepo, AuditWriter, Logger, SettingsRepo, Ulid, UtcDate } from '@/contracts';

import type { BudgetSource, BudgetStatus } from '@/lib/engine/budget';
import type { ExecutorResultV3 } from '@/lib/engine/executor';
import { isBefore, todayInZone } from '@/lib/domain/dates';

import { isQueuePaused } from './pause';
import type { SchedulerCampaign, SchedulerCampaignsRepo } from './types';

/**
 * Podpis, ktorým scheduler spúšťa dávku. Návratový typ je ZÁMERNE
 * `ExecutorResultV3` z `engine/executor.ts`, nie vlastná kópia: keby sa
 * signatúra executora zmenila, toto prestane kompilovať. Presne to sa v náleze
 * E1 nestalo — tam bol medzi schedulerom a engine `as` a chyba prežila do
 * produkcie ako „scheduler nikdy nezapisoval".
 */
export type ExecuteQueuedCampaignFn = (
  campaign: SchedulerCampaign,
) => Promise<ExecutorResultV3>;

/** Prečo sa v tomto ticku nezapisovalo. Kódy zdieľané so slovníkom (K10). */
export type QueueSkipReason =
  | 'queue_paused'
  | 'queue_empty'
  | 'writes_disabled'
  | 'writes_locked'
  | 'key_missing'
  | 'budget_exhausted'
  | 'budget_unknown'
  | 'executor_unavailable';

export interface QueueDeps {
  campaigns: Pick<
    SchedulerCampaignsRepo,
    'findQueued' | 'findLateCandidates' | 'markLate' | 'setStatus'
  >;
  apiKey: Pick<ApiKeyRepo, 'getMeta'>;
  settings: Pick<SettingsRepo, 'get'>;
  /** K2 — spotreba VÝHRADNE z auditu (`write_attempt` za UTC deň). */
  budget: BudgetSource;
  audit: AuditWriter;
  /** `null` = executor nie je zapojený → fail-closed, žiadny zápis. */
  executor: ExecuteQueuedCampaignFn | null;
  log: Logger;
  /** D85 — SIGTERM: medzi kampaňami sa fronta zastaví. */
  isStopping?: () => boolean;
}

export interface QueueConfig {
  /** `writesAllowedByEnv()` — `NODE_ENV=production && WRITES_ENABLED=true` (I13). */
  writesEnabledByEnv: boolean;
  /** Zóna logického dňa (D31) — nikdy UTC. */
  timeZone: string;
  /** Koľko kampaní najviac sa v jednom ticku vôbec zvažuje. */
  maxCampaignsPerTick: number;
}

export interface QueueOutcome {
  /** Brána po odstávke je zatvorená (odpoveď 43). */
  paused: boolean;
  /** Koľko kampaní naozaj prešlo executorom. */
  processed: number;
  /** Koľko z nich skončilo/zostalo v `needs_key`. */
  needsKey: number;
  /** Koľko kampaní malo prepadnuté okno (D25). */
  lapsed: number;
  /** Koľko kampaní práve dostalo príznak `late` (K5). */
  markedLate: number;
  /** Koľko kampaní čaká vo fronte (po tomto ticku známy stav zo vstupu). */
  queuedCampaigns: number;
  /**
   * Prečo sa (ďalej) nezapisuje. `null` = fronta bežala bez prekážky.
   *
   * Môže byť vyplnené AJ keď `processed > 0` — typicky `budget_exhausted`,
   * keď rozpočet došiel počas behu. Práve to má UI ukázať: nie „nič sa
   * nestalo", ale „dnes sme zapísali, čo sa zmestilo, a pokračujeme zajtra".
   */
  skipped: QueueSkipReason | null;
  /** Stav rozpočtu, keď sa ho podarilo prečítať (K2). */
  budget: BudgetStatus | null;
}

const emptyOutcome = (): QueueOutcome => ({
  paused: false,
  processed: 0,
  needsKey: 0,
  lapsed: 0,
  markedLate: 0,
  queuedCampaigns: 0,
  skipped: null,
  budget: null,
});

/* ─────────── posledný známy stav fronty pre `/api/queue` a Prehľad ───────── */

let lastReport: QueueOutcome | null = null;

/**
 * Posledný výsledok kroku fronty. Číta ho `/api/queue` (V8) a Prehľad (V9),
 * aby UI vedelo POVEDAŤ, prečo sa nezapisuje — „dnešný rozpočet je vyčerpaný"
 * je iná veta než „chýba kľúč na zápis" a používateľ musí vidieť ktorá.
 */
export function lastQueueReport(): QueueOutcome | null {
  return lastReport === null ? null : { ...lastReport };
}

/** Výhradne pre testy. */
export function resetQueueReport(): void {
  lastReport = null;
}

/* ═════════════════════════════ K5 — meškanie ══════════════════════════════ */

/**
 * K5 — kampani, ktorej už nabehlo okno a stále má `pending` položky, sa nastaví
 * príznak `late`. Zvyšné produkty sa aj tak zapíšu s PÔVODNÝM oknom; appka
 * `date_to` kvôli meškaniu NIKDY nemení (I7) a `date_from` tiež nie — posun
 * `date_from` (D25) patrí k fire naplánovanej kampane, nie k bežiacej fronte.
 *
 * Zlyhanie tohto kroku NESMIE zastaviť frontu: je to príznak do UI, nie brzda.
 */
async function markLateCampaigns(deps: QueueDeps, today: string): Promise<number> {
  try {
    const candidates = await deps.campaigns.findLateCandidates(today);
    let marked = 0;
    for (const campaign of candidates) {
      const changed = await deps.campaigns.markLate(campaign.id);
      if (!changed) continue;
      marked += 1;
      deps.log.warn('queue_campaign_late', {
        campaignId: campaign.id,
        dateFrom: campaign.dateFrom,
        today,
      });
    }
    return marked;
  } catch (error) {
    deps.log.error('queue_mark_late_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/* ══════════════ kampaň, ktorá padá pri každom pokuse (L5) ═════════════════ */

/**
 * Koľko pokusov dostane kampaň, ktorej executor hodí výnimku, kým ju fronta
 * vzdá.
 *
 * Do 26. 8. 2026 tu žiadne číslo nebolo: `catch` zapísal log a `continue`,
 * takže kampaň s deterministickou chybou (nesúlad potvrdenia, `percent` NULL,
 * neplatný token náhľadu) sa skúšala každý tik, teda každých 60 sekúnd, kým
 * niekto appku nevypol. Je to tá istá rodina ako 403 opakované dvanásť dní na
 * čítacej strane: `lib/sales/stop-policy.ts` na ňu má napísané pravidlo
 * „trvalá prekážka nesmie dostať rozvrh", zápisová fronta ho nemala.
 */
export const QUEUE_MAX_ATTEMPTS = 4;

/**
 * Odstup po 1., 2. a 3. zlyhaní.
 *
 * Prečo odstup a nie len počítadlo: výnimka NEMUSÍ byť deterministická —
 * spadnuté spojenie do DB vyzerá v `catch` presne ako nesúlad potvrdenia.
 * Štyri pokusy nahusto po 60 sekundách by z dvojminútového výpadku DB urobili
 * „trvalú prekážku" a vzdali by kampaň, ktorej nič nie je. Rozložené na hodinu
 * a pol je to rozhodnutie o stave, nie o chvíľke.
 */
const QUEUE_RETRY_BACKOFF_MS: readonly number[] = [5 * 60_000, 20 * 60_000, 60 * 60_000];

interface QueueFailure {
  /** Koľko pokusov už skončilo výnimkou. */
  attempts: number;
  /** Skôr sa kampaň do executora v tomto ticku ani nepodá. */
  retryAfter: UtcDate;
}

/**
 * Počítadlo žije v pamäti procesu, nie v DB: stĺpec by bol zmena schémy a tá
 * je nevratná. Dôsledok treba pomenovať — reštart appky pokusy vynuluje, takže
 * kampaň dostane ďalšiu štvoricu. Nie je to však návrat do pôvodného stavu:
 * ROZHODNUTIE „už to neskúšam" sa zapisuje do `campaigns.status`, teda do DB,
 * a reštart ho neodvolá. Reštart teda pridá pokusy len kampani, ktorá sa
 * dovtedy vzdať nestihla — nie tým, ktoré fronta už opustili.
 */
const queueFailures = new Map<number, QueueFailure>();

/** Výhradne pre testy. */
export function resetQueueFailures(): void {
  queueFailures.clear();
}

/** Odstup po `attempts`-tom zlyhaní. Posledná hodnota platí aj ďalej. */
function backoffFor(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), QUEUE_RETRY_BACKOFF_MS.length) - 1;
  return QUEUE_RETRY_BACKOFF_MS[index] ?? 0;
}

/**
 * Fronta kampaň vzdáva: presunie ju do KONCOVÉHO stavu, z ktorého ju vie
 * človek poslať znova („Zopakovať zlyhané" pracuje s `partial` aj `failed`).
 *
 * Žiadna položka sa nezahadzuje a nič sa neprepisuje na `blocked`: `pending`
 * položky zostávajú presne tam, kde boli, takže zápis sa nestratí (K6) — len
 * prestáva byť naplánovaný. Okno sa nemení (I7).
 *
 * Stav sa vyberá podľa počítadla, ktoré naposledy zapísal executor: `partial`,
 * keď kampaň už niečo zapísala, `failed`, keď nie — zhodne s
 * `resolveFinalStatus()`. „Failed" pri 5 000 zapísaných položkách by bola
 * nepravda.
 *
 * Text dôvodu NEOBSAHUJE hlášku výnimky: chodila by na obrazovku a tá má
 * hovoriť slovníkom (K10). Hláška zostáva v `queue_campaign_error` v logu.
 *
 * Vracia `true`, keď sa stav naozaj zapísal.
 */
async function giveUpOnCampaign(
  deps: QueueDeps,
  campaign: SchedulerCampaign,
  operationId: Ulid,
  attempts: number,
  now: UtcDate,
): Promise<boolean> {
  const status = campaign.itemsOk > 0 ? 'partial' : 'failed';
  const reason =
    `Zápis skončil chybou ${attempts}× po sebe — fronta túto zľavu ďalej neskúša. ` +
    'Nezapísané produkty zostávajú nedotknuté; po náprave spustite „Zopakovať zlyhané".';
  try {
    await deps.campaigns.setStatus(campaign.id, status, {
      statusReason: reason,
      finishedAt: now,
      resultAckAt: null,
    });
    await deps.audit.appendAudit({
      actor: 'scheduler',
      eventType: 'campaign_finished',
      ok: false,
      campaignId: campaign.id,
      operationId,
      message: `Fronta kampaň vzdala po ${attempts} výnimkách, stav „${status}".`,
    });
    deps.log.error('queue_campaign_given_up', {
      campaignId: campaign.id,
      operationId,
      attempts,
      status,
    });
    return true;
  } catch (error) {
    // Zlyhanie zápisu stavu nesmie zhodiť tik. Kampaň zostane `queued`
    // s počítadlom na strope, takže sa vzdanie zopakuje po ďalšom odstupe.
    deps.log.error('queue_give_up_failed', {
      campaignId: campaign.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/* ═══════════════════════════════ fronta ═══════════════════════════════════ */

function finish(outcome: QueueOutcome): QueueOutcome {
  lastReport = { ...outcome };
  return outcome;
}

/**
 * Jeden prechod frontou. NIKDY nehádže — výnimku jednej kampane zapíše do logu
 * a pokračuje ďalšou; tick sa kvôli fronte nesmie zložiť (D87).
 */
export async function processQueue(
  deps: QueueDeps,
  config: QueueConfig,
  now: UtcDate,
): Promise<QueueOutcome> {
  const outcome = emptyOutcome();
  const today = todayInZone(now, config.timeZone);

  /* 0. K5 — meškanie sa značí vždy, aj keď sa dnes nezapíše ani jeden produkt. */
  outcome.markedLate = await markLateCampaigns(deps, today);

  /* 1. Brána po odstávke počítača (odpoveď 43) — fronta sa nerozbehne sama. */
  if (isQueuePaused()) {
    outcome.paused = true;
    outcome.skipped = 'queue_paused';
    return finish(outcome);
  }

  /* 2. Prázdna fronta — nič na zapisovanie. */
  const queued = await deps.campaigns.findQueued(config.maxCampaignsPerTick);
  outcome.queuedCampaigns = queued.length;
  if (queued.length === 0) {
    outcome.skipped = 'queue_empty';
    return finish(outcome);
  }

  /* 3. I13 + I12 — dve env poistky a runaway zámok. Fail-closed, bez zmeny stavu:
   *    kampaň nie je pokazená, len sa teraz nesmie zapisovať. */
  const settings = await deps.settings.get();
  if (settings.writesLocked) {
    outcome.skipped = 'writes_locked';
    deps.log.warn('queue_skipped', {
      reason: 'writes_locked',
      detail: settings.writesLockedReason ?? undefined,
      count: queued.length,
    });
    return finish(outcome);
  }
  if (!config.writesEnabledByEnv) {
    outcome.skipped = 'writes_disabled';
    deps.log.info('queue_skipped', { reason: 'writes_disabled', count: queued.length });
    return finish(outcome);
  }

  /* 4. K6 — kľúč na zápis. Kampane zostávajú `queued` (viď hlavička modulu). */
  const meta = await deps.apiKey.getMeta();
  const keyUsable =
    meta.present &&
    meta.verifyStatus === 'valid' &&
    meta.expiresAt !== null &&
    meta.expiresAt.getTime() > now.getTime();
  if (!keyUsable) {
    outcome.skipped = 'key_missing';
    deps.log.warn('queue_skipped', { reason: 'key_missing', count: queued.length });
    return finish(outcome);
  }

  /* 5. K2 — denný rozpočet. Vyčerpaný = informácia, nie chyba (odpoveď 59). */
  let budget: BudgetStatus;
  try {
    budget = await deps.budget.remainingToday();
  } catch (error) {
    outcome.skipped = 'budget_unknown';
    deps.log.error('queue_budget_read_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return finish(outcome);
  }
  outcome.budget = budget;
  if (budget.exhausted) {
    outcome.skipped = 'budget_exhausted';
    deps.log.info('queue_budget_exhausted', {
      day: budget.day,
      budget: budget.budget,
      spent: budget.spent,
      count: queued.length,
    });
    return finish(outcome);
  }

  if (deps.executor === null) {
    outcome.skipped = 'executor_unavailable';
    deps.log.error('queue_skipped', { reason: 'executor_unavailable', count: queued.length });
    return finish(outcome);
  }
  const executor = deps.executor;
  const isStopping = deps.isStopping ?? ((): boolean => false);

  /* 6. Kampane SEKVENČNE — žiadny `Promise.all` nad zápismi (I10, K11 bod 3). */
  for (const campaign of queued) {
    if (isStopping()) {
      deps.log.warn('queue_stopping', { campaignId: campaign.id });
      break;
    }
    // Stav sa mohol medzitým zmeniť (manuálne dopálenie, zrušenie) — do
    // executora ide len to, čo je stále vo fronte.
    if (campaign.status !== 'queued') continue;

    const operationId: Ulid = campaign.operationId || (ulid() as Ulid);

    /* D25 — okno skončilo: kampaň je prepadnutá a NIČ sa nezapíše. `date_from`
     * v minulosti sa tu NEPOSÚVA — to je K5 (`late`), nie oprava dátumu. */
    if (isBefore(campaign.dateTo, today)) {
      try {
        const reason =
          `Okno zľavy skončilo ${campaign.dateTo} — fronta ho nedobehla a appka okno ` +
          'nikdy sama neposúva (K5, I7). Nič sa nezapisuje.';
        await deps.campaigns.setStatus(campaign.id, 'lapsed', {
          statusReason: reason,
          finishedAt: now,
        });
        await deps.audit.appendAudit({
          actor: 'scheduler',
          eventType: 'campaign_lapsed',
          ok: false,
          campaignId: campaign.id,
          operationId,
          message: reason,
        });
        outcome.lapsed += 1;
      } catch (error) {
        deps.log.error('queue_lapse_failed', {
          campaignId: campaign.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    /* L5 — kampaň, ktorá pri poslednom pokuse hodila výnimku, má odstup.
     * Skôr sa o ňu ani nepokúsime; ostatné kampane to nezdržuje. */
    const failure = queueFailures.get(campaign.id);
    if (failure !== undefined && failure.retryAfter.getTime() > now.getTime()) {
      deps.log.info('queue_campaign_backoff', {
        campaignId: campaign.id,
        attempts: failure.attempts,
        retryAfter: failure.retryAfter.toISOString(),
      });
      continue;
    }

    try {
      // Claim robí executor (D84) — scheduler ho tu ZÁMERNE nevolá.
      const result = await executor(campaign);
      // Pokus prešiel — predchádzajúce zlyhania už nič nebrzdia.
      queueFailures.delete(campaign.id);
      outcome.processed += 1;
      if (result.status === 'needs_key') outcome.needsKey += 1;
      deps.log.info('queue_campaign_run', {
        campaignId: campaign.id,
        operationId,
        status: result.status,
        itemsOk: result.itemsOk,
        itemsFailed: result.itemsFailed,
      });
    } catch (error) {
      /* Výnimka jednej kampane nesmie zablokovať ostatné ani zhodiť tick —
       * ale ani sa nesmie opakovať naveky (L5). Pokus sa započíta, kampaň
       * dostane odstup, a na strope ju fronta vzdá. */
      const attempts = (queueFailures.get(campaign.id)?.attempts ?? 0) + 1;
      deps.log.error('queue_campaign_error', {
        campaignId: campaign.id,
        operationId,
        attempts,
        error: error instanceof Error ? error.message : String(error),
      });
      queueFailures.set(campaign.id, {
        attempts,
        retryAfter: new Date(now.getTime() + backoffFor(attempts)),
      });
      if (attempts >= QUEUE_MAX_ATTEMPTS) {
        const gaveUp = await giveUpOnCampaign(deps, campaign, operationId, attempts, now);
        if (gaveUp) queueFailures.delete(campaign.id);
      }
      continue;
    }

    /* Rozpočet sa prepočíta z auditu po KAŽDEJ kampani — dva behy v jednom
     * ticku nesmú spolu prekročiť denný strop. */
    try {
      const after = await deps.budget.remainingToday();
      outcome.budget = after;
      if (after.exhausted) {
        outcome.skipped = 'budget_exhausted';
        deps.log.info('queue_budget_exhausted', {
          day: after.day,
          budget: after.budget,
          spent: after.spent,
        });
        break;
      }
    } catch (error) {
      outcome.skipped = 'budget_unknown';
      deps.log.error('queue_budget_read_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  return finish(outcome);
}
