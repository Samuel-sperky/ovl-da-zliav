/**
 * Aura Zľavy — start in-process schedulera (D82, §9). Vlastník: A10, prestavba
 * fronty V7.
 *
 * Spúšťa sa z `src/instrumentation.ts` po úspešných boot assertions.
 * Kontrakt:
 *  - `startScheduler()` je idempotentný — druhé zavolanie nespustí druhý cyklus,
 *  - `SCHEDULER_ENABLED=false` scheduler úplne vypne (testy, dev),
 *  - výnimka v ticku NEZHODÍ proces — `tick.ts` ju zapisuje do
 *    `scheduler_state.last_error` (D87),
 *  - poradie krokov ticku je normatívne (§9) a implementuje ho `tick.ts`.
 *
 * **Ako je zapojený engine (nález E1).** Executor (`engine/executor.ts`) je
 * pripojený STATICKY. Dynamický import s `webpackIgnore` na `@/` alias v
 * standalone Node builde nikdy nefungoval (vracal `null` → každý fire skončil
 * fail-closed v `needs_key` a NIKDY sa nič nezapísalo) a pretypovanie na
 * nekompatibilnú signatúru by zápis rozbilo aj po ňom. Preto tu nie je ani
 * jeden `as`: adaptéry majú presne tie typy, ktoré vracia `executeCampaign()`,
 * takže nezhoda podpisu je chyba kompilácie, nie tichá diera v produkcii.
 *
 * Rovnaké pravidlo platí pre repozitár kampaní: do ticku ide `campaignsRepoV3`
 * (pozná `queued` aj `late`), nie legacy pohľad cez `as unknown as`.
 */
import { env, writesAllowedByEnv } from '@/env';

import { tryAcquireLock } from '@/db/advisory-lock';
import { auditWriter } from '@/lib/audit/write';
import { createBudget } from '@/lib/engine/budget';
import { executeCampaign, isGracefulStopRequested, type ExecutorDeps } from '@/lib/engine/executor';
import { logger } from '@/lib/log/logger';
import { apiKeyRepo } from '@/lib/repo/api-key.repo';
import { runSalesSyncIfDue } from '@/lib/sales/sync-runner';
import { auditRepo } from '@/lib/repo/audit.repo';
import { campaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepoV3 } from '@/lib/repo/campaigns.repo';
import { catalogRepo } from '@/lib/repo/catalog.repo';
import { productReadBudget } from '@/lib/repo/read-budget.repo';
import { schedulerStateRepo } from '@/lib/repo/scheduler-state.repo';
import { settingsRepo } from '@/lib/repo/settings.repo';
import { createShopClientFromSettings } from '@/lib/shop/client';

import {
  runCatalogSyncIfDue,
  runCatalogSyncNow,
  CATALOG_READ_RETRY_POLICY,
  CATALOG_SYNC_LOCK_NAME,
  type CatalogRunnerDeps,
  type CatalogRunReport,
} from './catalog-runner';
import type { ExecuteCampaignFn } from './due';
import {
  runEnrichBatchIfDue,
  ENRICH_LOCK_NAME,
  type EnrichRunnerDeps,
  type EnrichRunReport,
} from './enrich-runner';
import type { ExecuteQueuedCampaignFn } from './queue';
import { createTicker, type Ticker, type TickDeps } from './tick';

const log = logger.child({ module: 'scheduler' });

let timer: ReturnType<typeof setInterval> | null = null;
let ticker: Ticker | null = null;

/**
 * Adaptér scheduler → engine pre FIRE naplánovanej kampane (A10 → A9).
 * Scheduler volá executor podpisom `(campaign, key, ctx)`; engine má
 * `executeCampaign(campaignId, deps, opts)`. Kľúč z parametra sa NEPOUŽÍVA —
 * executor si ho načíta sám cez `apiKeyRepo.loadForUse()` (D21, D63), aby medzi
 * guardom a zápisom nikdy nežila kópia mimo repozitára. `overrides` sú výhradne
 * pre testy (mock shop, in-memory repozitáre); produkčný boot volá funkciu bez
 * argumentov.
 */
export function createSchedulerExecutor(
  overrides: Partial<ExecutorDeps> = {},
): ExecuteCampaignFn {
  const shopClient = overrides.shopClient ?? createShopClientFromSettings(settingsRepo);
  return (campaign, _key, _ctx) =>
    executeCampaign(campaign.id, { ...overrides, shopClient }, { actor: 'scheduler' });
}

/**
 * K2 — adaptér scheduler → engine pre kampaň z FRONTY. Ten istý engine, iný
 * vstupný bod: kampaň v stave `queued` si executor claimne sám (`queued` je
 * medzi claimovateľnými stavmi, D84) a sám sa aj vráti do `queued`, keď minie
 * denný rozpočet.
 *
 * Podpis je bez `key` a `ctx`: nepoužívané parametre boli v E1 presne to, čo
 * pozvalo pretypovanie. Návratový typ je priamo typ `executeCampaign()`, takže
 * zmena v engine tu spôsobí chybu kompilácie, nie tichý no-op.
 */
export function createSchedulerQueueExecutor(
  overrides: Partial<ExecutorDeps> = {},
): ExecuteQueuedCampaignFn {
  const shopClient = overrides.shopClient ?? createShopClientFromSettings(settingsRepo);
  return (campaign) =>
    executeCampaign(campaign.id, { ...overrides, shopClient }, { actor: 'scheduler' });
}

/**
 * K7 — závislosti synchronizácie katalógu nad produkčným klientom a
 * `catalog_cache`. ENV sa číta VO FUNKCII (na module scope by to lámalo
 * `next build`).
 */
function catalogRunnerDeps(): CatalogRunnerDeps {
  return {
    // Čítacia časť klienta — zápis sa cez tento typ nedá zavolať (K7).
    //
    // Katalóg si NESMIE nechať opakovať 429 tri razy: každý pokus sa počíta do
    // denného stropu 240 čítaní, takže tri pokusy na tú istú stránku spália tri
    // čítania na to isté miesto a ban tým len predĺžia. Opakovanie rieši sám
    // runner — pozastaví CELÝ beh podľa `Retry-After` (A3).
    shopClient: createShopClientFromSettings(settingsRepo, {
      policy: { ...CATALOG_READ_RETRY_POLICY },
    }),
    catalog: catalogRepo,
    // Druhá vrstva súbežnosti. `running` v runneri chráni len TENTO module graf;
    // tick beží v `instrumentation`, manuálne načítanie v route, takže bez DB
    // locku sa dva behy môžu prekryť a prepísať si pokrok (A2) aj rozpočet (A4).
    lock: () => tryAcquireLock(CATALOG_SYNC_LOCK_NAME, 0),
    audit: auditWriter,
    logger: log,
    timeZone: env.LOGIC_TIMEZONE,
  };
}

function catalogSyncStep(opts: { now: Date; queueBusy: boolean }): Promise<CatalogRunReport> {
  return runCatalogSyncIfDue(catalogRunnerDeps(), { now: opts.now, queueBusy: opts.queueBusy });
}

/**
 * K7 — manuálne „Načítať katalóg" z UI. Existuje tu, aby route (V8) nemusela
 * skladať shop klienta ani repozitár sama: jeden zdroj wiringu je aj jedno
 * miesto, kde sa dá pokaziť.
 */
export function syncCatalogNow(): Promise<CatalogRunReport> {
  return runCatalogSyncNow(catalogRunnerDeps());
}

/**
 * D118 bod 2 — závislosti DÁVKY OBOHACOVANIA nad produkčným klientom,
 * `catalog_cache` a ZÁPISOVÝM kľúčom shopu.
 *
 * Prečo je to tu a nie v `enrich-runner.ts`: to isté pravidlo ako pri katalógu —
 * runner nesmie závisieť na poole, aby jeho unit testy bežali bez DB, a jedno
 * miesto wiringu je aj jedno miesto, kde sa dá pokaziť.
 *
 * Kľúč je `apiKeyRepo`, teda ten istý zápisový kľúč shopu, ktorým sa píšu zľavy:
 * `getFull` chce scope `product:read` a ten má práve on. Objednávkový kľúč sa do
 * tejto cesty nesmie dostať (I8' bod 4) a nedostane — táto funkcia oň nikdy
 * nežiada a scan zdrojov to vynucuje.
 *
 * Rozpočet je `productReadBudget` (dráha `product_read`), nie `anon`: `getFull`
 * je čítanie S KĽÚČOM a shop ho účtuje na kľúč. Je to to isté počítadlo, aké
 * používa `POST /api/catalog/enrich`, takže dávka a obohatenie na dopyt sa
 * navzájom vidia — inak by rezerva `ENRICH_QUOTA_RESERVE` nič nechránila.
 *
 * ENV sa čítajú VO FUNKCII (na module scope by to lámalo `next build`).
 */
function enrichRunnerDeps(overrides: Partial<EnrichRunnerDeps> = {}): EnrichRunnerDeps {
  return {
    // Čítacia časť klienta — zápis zľavy sa cez tento typ nedá zavolať.
    shop: createShopClientFromSettings(settingsRepo),
    apiKey: apiKeyRepo,
    catalog: catalogRepo,
    reads: productReadBudget,
    // Druhá vrstva súbežnosti; `running` v runneri chráni len TENTO module graf.
    lock: () => tryAcquireLock(ENRICH_LOCK_NAME, 0),
    logger: log,
    ...overrides,
  };
}

/**
 * Krok ticku pre obohacovanie. Je to factory, nie funkcia, len preto, aby si
 * test mohol podsunúť LISTY dávky (kľúč, spánok) bez toho, aby prepisoval sám
 * krok — ten musí zostať produkčný, inak by test dokazoval fake.
 */
function createEnrichStep(
  overrides: Partial<EnrichRunnerDeps> = {},
): (opts: { now: Date; queueBusy: boolean; catalogBusy: boolean }) => Promise<EnrichRunReport> {
  return (opts) => runEnrichBatchIfDue(enrichRunnerDeps(overrides), opts);
}

/**
 * Čo si testy smú podsunúť namiesto produkčného zapojenia.
 *
 * Zámerne dve oddelené polia, nie jedno `Partial<TickDeps>`: krok obohacovania
 * musí ostať PRODUKČNÝ aj v teste, ktorý ho spúšťa (inak by test dokazoval
 * vlastný fake — presne nález E1). Test preto prepisuje len LISTY vnútri dávky
 * (`enrich`), nikdy samotný krok.
 */
export interface SchedulerWiringOverrides {
  /** Susedia ticku (kampane, fronta, katalóg) — pre testy zapojenia. */
  readonly tick?: Partial<TickDeps>;
  /**
   * Listy dávky obohacovania. Dve veci sa v testoch z produkcie vziať NEDAJÚ:
   * kľúč (bez master key sa nedá dešifrovať) a skutočná pauza 3 750 ms medzi
   * čítaniami. Oboje má engine ako vstup práve preto.
   */
  readonly enrich?: Partial<EnrichRunnerDeps>;
}

/**
 * Závislosti ticku PRESNE TAK, ako ich zapája produkcia. `buildTicker()` z nich
 * skladá ticker a nič k nim nepridáva, takže test, ktorý si ich vyžiada, testuje
 * ten istý objekt, aký beží v `instrumentation` — nie svoju rekonštrukciu.
 */
export function schedulerTickDeps(overrides: SchedulerWiringOverrides = {}): TickDeps {
  const shop = createShopClientFromSettings(settingsRepo);
  const enrichOverrides = overrides.enrich ?? {};
  return {
    campaigns: campaignsRepoV3,
    items: campaignItemsRepo,
    apiKey: apiKeyRepo,
    settings: settingsRepo,
    schedulerState: schedulerStateRepo,
    audit: auditWriter,
    auditReader: auditRepo,
    canary: (ctx) => shop.canary(ctx),
    executor: createSchedulerExecutor(),
    queueExecutor: createSchedulerQueueExecutor(),
    // K2 — výška rozpočtu zo `settings`, spotreba z auditu za UTC deň.
    budget: createBudget({ settingsRepo }),
    catalogSync: catalogSyncStep,
    /*
     * D118 bod 2 — dávka obohacovania. Bez tohto riadku by `runEnrichBatch()`
     * mala nula volajúcich a celé obohacovanie by existovalo len ako kód, ktorý
     * prejde testami a v produkcii sa nikdy nespustí (nález E1 v inej podobe).
     * `enrichOverrides` sú výhradne listy dávky (kľúč, spánok) — samotný krok
     * je vždy tento produkčný.
     */
    enrich: createEnrichStep(enrichOverrides),
    isStopping: isGracefulStopRequested,
    log,
    config: {
      writesEnabledByEnv: writesAllowedByEnv(),
      timeZone: env.LOGIC_TIMEZONE,
      midnightFreezeSeconds: env.MIDNIGHT_FREEZE_SECONDS,
    },
    ...overrides.tick,
  };
}

function buildTicker(): Ticker {
  return createTicker(schedulerTickDeps());
}

export function startScheduler(): void {
  if (timer) return; // idempotencia — druhý cyklus sa nikdy nespustí
  if (!env.SCHEDULER_ENABLED) {
    log.info('scheduler_disabled', { detail: 'SCHEDULER_ENABLED=false' });
    return;
  }

  timer = setInterval(() => {
    void runOneTick();
  }, env.SCHEDULER_TICK_MS);
  // Interval nesmie držať proces pri shutdowne.
  timer.unref?.();

  log.info('scheduler_started', { tickMs: env.SCHEDULER_TICK_MS });
  // Prvý tick hneď po štarte — kvôli reconcile (D86), TTL wipe (D63) a
  // vyhodnoteniu odstávky počítača (odpoveď 43).
  void runOneTick();
}

async function runOneTick(): Promise<void> {
  try {
    if (!ticker) ticker = buildTicker();
    await ticker.runTick(); // runTick nikdy nehodí výnimku (D87)
    // Predaje AŽ PO kampaniach — zľavy majú vždy prednosť pred analytikou.
    // Objednávkový kľúč je zámerne skrytý za `runSalesSyncIfDue()`: zápisová
    // cesta sa o ňom nesmie dozvedieť (I8' bod 4, vynucuje to test skenom).
    await runSalesSyncIfDue();
  } catch (error) {
    // Poistka poslednej inštancie — proces sa NESMIE zhodiť (D87).
    log.error('scheduler_tick_fatal_caught', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  ticker = null;
}

export function isSchedulerRunning(): boolean {
  return timer !== null;
}
