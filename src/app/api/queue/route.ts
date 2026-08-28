/**
 * Aura Zľavy — `GET /api/queue` (KONTRAKT V3: K2, K5, K6; kontrakt dokončenia B5, B6, B7).
 *
 * JEDNA ODPOVEĎ NA OTÁZKU „ČO SA PRÁVE DEJE".
 *
 * Zľava na 150 produktov pri 200 zápisoch na UTC deň zaberie takmer celý deň;
 * väčšia beží dni a prežije aj 48-hodinovú platnosť kľúča. Používateľ preto
 * musí z jednej obrazovky vidieť štyri veci a nesmie kvôli nim otvárať log ani
 * databázu:
 *
 *   1. **kde je fronta** — koľko položiek je hotových, koľko čaká, koľko
 *      zlyhalo a koľko je NEISTÝCH (to nie je to isté, viď `attention`),
 *   2. **koľko rozpočtu ostáva** a kedy sa obnoví (`writes`, `budget`, `limits`),
 *   3. **čo sa stane zajtra** — odhad dobehnutia (`estimate`),
 *   4. **prečo to práve teraz stojí**, ak stojí (`standing`).
 *
 * Route je ČISTO ČÍTACIA: na shop neodíde ani jeden request a do DB sa nezapíše
 * ani jeden riadok. Neriadi frontu, len ju popisuje.
 *
 * ODKIAĽ SA ČÍSLA BERÚ
 * --------------------
 *  - **`budget` / `writes`** — spotreba VÝHRADNE z auditu (`write_attempt` za
 *    UTC deň, K2). `null` = rozpočet sa nepodarilo prečítať; vtedy sa NESMIE
 *    dopočítať odhad (P7 — vymyslené číslo je horšie než priznaná medzera).
 *  - **`limits`** — DVA rôzne stropy vedľa seba (`engine/budget.ts`): strop
 *    SHOPU (200/UTC deň na kľúč, zdvihne ho len shop) a NÁŠ rozpočet
 *    (`settings.daily_write_budget`, dá sa posunúť len nadol). Zliať ich do
 *    jedného čísla znamená, že používateľ prestane vedieť, čo si môže zmeniť sám.
 *  - **`queue` / `items`** — z `campaign_items`, nie z paralelného počítadla (K2).
 *  - **`standing.blockers`** — `lib/status/blockers.ts`, jediný zdroj pravdy
 *    o tom, čo blokuje čo. Tu sa ŽIADNA jeho veta neskladá znova.
 *
 * PREČO SA PREKÁŽKY OBLASTI `katalog` ODFILTRUJÚ
 * ---------------------------------------------
 * `collectOperationBlockers()` je fail-closed: v plnom režime bez overeného
 * zoznamu chýbajúcich produktov vráti `catalog_unknown` so závažnosťou
 * `blokuje`. Táto route ale katalóg NEČÍTA — overiť 10 000 riadkov pri každom
 * 60-sekundovom dotaze by z prístrojovej dosky spravilo záťaž a z odpovede
 * trvalé „blokuje", ktoré by po týždni nikto nečítal. Príslušnosť produktu ku
 * katalógu sa overuje tam, kde na nej záleží: pri náhľade a znova v
 * `engine/guards.checkScope()` tesne pred zápisom.
 *
 * Preto o katalógu táto odpoveď NETVRDÍ NIC — ani „je to v poriadku", ani
 * „blokuje to". Mlčanie o neoverenom je poctivejšie než fail-closed veta, ktorá
 * by tu bola vždy. (Požiadavka na vlastníka `status/blockers.ts`: spraviť sekciu
 * `catalog` opt-in rovnako ako `catalogReads`, aby sa filter dal zahodiť.)
 *
 * POCTIVÁ POZNÁMKA K `gate` A `lastRun`
 * -------------------------------------
 * Brána po odstávke počítača (`lib/scheduler/pause.ts`) aj posledný výsledok
 * kroku fronty (`lib/scheduler/queue.ts`) sú IN-PROCESS stav. Next.js kompiluje
 * `instrumentation` do vlastného module grafu, takže objekt, ktorý vidí tento
 * handler, NEMUSÍ byť ten istý, aký vidí tick schedulera. Preto:
 *   - `gate` nesie `bestEffort: true` a UI ju nesmie brať ako dôkaz,
 *   - `heartbeat.stale` je oproti tomu FAKT z DB: keď posledný tick chýba dlhšie
 *     než `DOWNTIME_GRACE_MS`, fronta určite nezapisuje, lebo scheduler nežije,
 *   - `standing` sa preto rozhoduje najprv podľa faktov z DB a až potom podľa
 *     in-process brány.
 *
 * Vlastník: V8.
 */
import type {
  ApiKeyMeta,
  CampaignStatus,
  SchedulerStateRepo,
  SettingsRepo,
} from '@/contracts';

import { writesAllowedByEnv } from '@/env';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  createBudget,
  describeWriteBudgetLimits,
  estimateFinish,
  type BudgetSource,
  type BudgetStatus,
  type FinishEstimate,
} from '@/lib/engine/budget';
import { campaignItemsRepo as defaultItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepoV3 as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { schedulerStateRepo as defaultSchedulerState } from '@/lib/repo/scheduler-state.repo';
import { DOWNTIME_GRACE_MS, getQueueGate, type QueueGate } from '@/lib/scheduler/pause';
import { lastQueueReport, type QueueOutcome, type QueueSkipReason } from '@/lib/scheduler/queue';
import {
  collectOperationBlockers,
  summarizeBlockers,
  type Blocker,
  type StatusSnapshot,
} from '@/lib/status/blockers';
import { itemSentence } from '@/lib/ui/vocabulary';

import type { ApiKeyRepository } from '@/lib/repo/api-key.repo';
import type { CampaignsRepoExt, CampaignRecordV3 } from '@/lib/repo/campaigns.repo';
import type {
  CampaignItemsRepoExt,
  ItemStatusCounts,
} from '@/lib/repo/campaign-items.repo';
import type { ScopeSettings, SettingsRepoExt } from '@/lib/repo/settings.repo';

/* ═══════════════════════════ 1. Konštanty ═════════════════════════════════ */

/**
 * Stavy, v ktorých je kampaň VO FRONTE.
 *
 * Zoznam je zámerne zhodný so `SQL_QUEUE_TOTALS` v `repo/campaign-items.repo.ts`.
 * Keby sa rozišli, `queue.total` a `items.total` by hovorili o dvoch rôznych
 * množinách kampaní a rozdiel by na obrazovke nikto nevedel vysvetliť.
 *
 * `queued` (K2) je v DB enume od migrácie `0010_fronta_a_pasma.sql`, ale
 * `CampaignStatus` v `src/contracts.ts` (vlastník A0) ho zatiaľ nepozná. Most je
 * jednoriadkový a je to ten istý most ako `QUEUED` v `app/api/campaigns/_shared.ts` —
 * nie druhý zoznam stavov. Požiadavka na doplnenie do kontraktu je vo výstupe V8.
 */
const LIVE_QUEUE_STATUSES: CampaignStatus[] = [
  'scheduled',
  'needs_key',
  'running',
  'missed',
  'queued' as CampaignStatus,
];

/** Koľko kampaní sa najviac vymenuje v `attention`. Zvyšok je len v číslach. */
const ATTENTION_MAX_CAMPAIGNS = 20;

/** Koľko živých kampaní sa najviac načíta na rozpad položiek. */
const LIVE_CAMPAIGNS_PAGE = 100;

/* ═══════════════════════════ 2. Typy odpovede ═════════════════════════════ */

/**
 * Prečo fronta stojí. Kód, NIE text — vetu skladá slovník (K10).
 *
 * Typ je zámerne NADMNOŽINA `QueueSkipReason` z `lib/scheduler/queue.ts`: keby
 * sa tam zoznam zmenil, tento súbor prestane kompilovať a nedozvieme sa to až
 * z obrazovky. Navyše sú tu tri dôvody, ktoré tick pomenovať nevie:
 *
 *  - `scheduler_down`  — heartbeat chýba dlhšie než `DOWNTIME_GRACE_MS`, takže
 *    tick vôbec nebeží a žiadny `QueueSkipReason` by ani nevznikol,
 *  - `key_expired`     — kľúč JE vložený, ale doba jeho platnosti uplynula.
 *    Tick to hlási ako `key_missing`; pre používateľa je to ale iná veta
 *    („vložte nový" vs. „vložte prvý"),
 *  - `state_unknown`   — nastavenia sa nedali prečítať. „Neviem" nikdy
 *    neznamená „beží to" (fail-closed).
 */
export type QueueStandReason =
  | QueueSkipReason
  | 'scheduler_down'
  | 'key_expired'
  | 'state_unknown';

/** Zľava, ktorá dáva číslam vo fronte meno (K10 — na povrchu je to „zľava"). */
export interface QueueCampaignView {
  campaignId: number;
  name: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  itemsUncertain: number;
  itemsPending: number;
  /** K5 — okno už nabehlo a fronta ešte nedobehla. Fakt o čase, nie chyba. */
  late: boolean;
  /**
   * PRESNÝ rozpad po stavoch priamo z `campaign_items` (`countByStatus()`).
   * `null` = nepodarilo sa prečítať. Počítadlá na kampani sú odvodenina, ktorá
   * sa dorovnáva až `syncCountersFromItems()`; toto je zdroj pravdy.
   */
  itemCounts: ItemStatusCounts | null;
}

/** Rozpad položiek celej fronty — „hotové / čaká / zlyhalo / neisté". */
export interface QueueItemsView {
  /** Koľko položiek majú živé zľavy spolu. */
  total: number;
  /** Presne `status = 'pending'` — položky, na ktoré fronta ešte nedošla. */
  pending: number;
  /** `total − pending`: čokoľvek, čo už fronta vybavila (nie „úspešne"). */
  done: number;
  /** Zapísané a potvrdené shopom. */
  ok: number;
  /** Nezapísalo sa (vrátane `nenájdené` a `appka nepustila`) — viď `attention`. */
  failed: number;
  /** NEVIEME, či sa zapísalo (D45). NIE JE to to isté ako `failed`. */
  uncertain: number;
  /** Preskočené (rovnaká zľava tam už bola) a prerušené uprostred behu. */
  otherResolved: number;
  /** Koľko zliav sa na tom podieľa. */
  campaigns: number;
}

/** Jedna zľava, ktorá si žiada pozornosť (neisté alebo zlyhané položky). */
export interface AttentionCampaignView {
  campaignId: number;
  name: string;
  status: string;
  /** Koľko položiek tejto zľavy spadá do danej skupiny. */
  items: number;
}

/** Skupina „neisté" alebo „zlyhané" aj s tým, čo sa s ňou dá robiť. */
export interface AttentionGroupView {
  items: number;
  campaigns: AttentionCampaignView[];
  /** `true` = zliav je viac, než sa vymenovalo (`ATTENTION_MAX_CAMPAIGNS`). */
  truncated: boolean;
  /** ČO sa stalo — slovenská veta zo slovníka (K10). */
  what: string;
  /** ČO S TÝM — konkrétny ďalší krok, slovensky. */
  nextStep: string;
}

/** Prekážka pripravená na JSON (`clearsAt` ako ISO reťazec). */
export interface BlockerView extends Omit<Blocker, 'clearsAt' | 'productIds'> {
  productIds: number[];
  clearsAt: string | null;
}

/* ═══════════════════════════ 3. Závislosti ════════════════════════════════ */

export interface QueueRouteDeps {
  campaigns?: Pick<
    CampaignsRepoExt,
    'findRunningUnfinished' | 'findQueued' | 'list' | 'findUnacked'
  >;
  items?: Pick<CampaignItemsRepoExt, 'queueTotals' | 'countByStatus'>;
  schedulerState?: Pick<SchedulerStateRepo, 'get'>;
  /**
   * Zámerne sa pýta MENEJ, než produkčný repozitár vie: z nastavení potrebuje
   * táto route iba `writesLocked` (teda základný tvar `SettingsRecord`) a
   * fail-closed rozsah. Užší typ znamená, že fake v teste nemusí predstierať
   * polia, o ktoré tu nikto nestojí.
   */
  settings?: Pick<SettingsRepo, 'get'> & Pick<SettingsRepoExt, 'readScope'>;
  apiKey?: Pick<ApiKeyRepository, 'getMeta'>;
  budget?: BudgetSource;
  /** I13 — `NODE_ENV=production && WRITES_ENABLED=true`. `null` = nevieme. */
  writesEnabled?: () => boolean | null;
  /** Best-effort brána — viď poznámku v hlavičke súboru. */
  gate?: () => QueueGate;
  /** Best-effort posledný krok fronty — rovnaká výhrada ako pri `gate`. */
  lastRun?: () => QueueOutcome | null;
  now?: () => Date;
  routeDeps?: RouteDeps;
}

/* ══════════════════════ 4. Čisté kúsky (testovateľné) ═════════════════════ */

/** Fakty, z ktorých sa rozhoduje, či fronta beží alebo stojí. */
export interface StandingFacts {
  /** Koľko položiek ešte čaká na zápis. */
  pending: number;
  /** Heartbeat schedulera chýba dlhšie než `DOWNTIME_GRACE_MS` (FAKT z DB). */
  schedulerDown: boolean;
  /** Brána po odstávke (in-process, best-effort). */
  gatePaused: boolean;
  /** `null` = env poistku sa nepodarilo vyhodnotiť. */
  writesEnabled: boolean | null;
  /** `null` = nastavenia sa nedali prečítať. */
  writesLocked: boolean | null;
  /** Kľúč je vložený, overený a ešte platí (rovnaká definícia ako v ticku). */
  keyUsable: boolean;
  /** Kľúč JE vložený, ale platnosť uplynula. */
  keyExpired: boolean;
  budget: BudgetStatus | null;
}

/**
 * PREČO FRONTA STOJÍ — alebo `null`, keď nestojí.
 *
 * Poradie je zámerne to isté, v akom prekážky rieši `processQueue()`
 * (`lib/scheduler/queue.ts`), plus dva kroky navyše na začiatku: mŕtvy scheduler
 * a zavretá brána. Keby sa poradie rozišlo, obrazovka by hlásila iný dôvod, než
 * aký fronta naozaj má — a to je horšie než mlčať.
 *
 * Fail-closed: každé „neviem" vedie k dôvodu, nikdy k `null`. Odpoveď `null`
 * znamená „nič mi nebráni zapisovať" a to sa nesmie tvrdiť z neznalosti.
 */
export function resolveStandReason(facts: StandingFacts): QueueStandReason | null {
  if (facts.schedulerDown) return 'scheduler_down';
  if (facts.gatePaused) return 'queue_paused';
  if (facts.pending <= 0) return 'queue_empty';
  if (facts.writesLocked === null) return 'state_unknown';
  if (facts.writesLocked) return 'writes_locked';
  if (facts.writesEnabled !== true) return 'writes_disabled';
  if (!facts.keyUsable) return facts.keyExpired ? 'key_expired' : 'key_missing';
  if (facts.budget === null) return 'budget_unknown';
  if (facts.budget.exhausted) return 'budget_exhausted';
  return null;
}

/**
 * Kľúč použiteľný na zápis. Definícia je ZÁMERNE tá istá ako v `processQueue()`
 * kroku 4 — vložený, overený sondou a v platnosti. Kľúč, o ktorom nevieme, či
 * je overený, sa nepoužije (D51/D52 by ho aj tak wipli až po odmietnutí shopom).
 */
export function keyFactsOf(
  meta: ApiKeyMeta | null,
  now: Date,
): { usable: boolean; expired: boolean } {
  if (meta === null || !meta.present) return { usable: false, expired: false };
  const expiresAt = meta.expiresAt;
  const expired = expiresAt !== null && expiresAt.getTime() <= now.getTime();
  const usable =
    meta.verifyStatus === 'valid' && expiresAt !== null && expiresAt.getTime() > now.getTime();
  return { usable, expired };
}

/** `Blocker` → JSON tvar (`Date` sa nikdy neposiela ako objekt). */
export function blockerView(blocker: Blocker): BlockerView {
  const { clearsAt, productIds, ...rest } = blocker;
  return {
    ...rest,
    productIds: [...productIds],
    clearsAt: clearsAt === null ? null : clearsAt.toISOString(),
  };
}

/**
 * D45 — NEISTÉ vs. ZLYHANÉ. Sú to dve rôzne veci a používateľ musí vidieť obe
 * oddelene, lebo si žiadajú iný ďalší krok:
 *
 *  - **zlyhané** = shop zápis odmietol alebo neodpovedal. Produkt určite NIE JE
 *    zlacnený. Rieši sa zopakovaním, ktoré si vypýta nový náhľad (I3, D16).
 *  - **neisté** = zápis odišiel, ale odpoveď nedorazila alebo mala iný tvar.
 *    Nevieme, či je produkt zlacnený. Najprv sa treba pozrieť do eshopu; až
 *    potom má zmysel zápis zopakovať (D45 — identický `setReduction` ešte raz,
 *    a keď tam zľava už je, executor ho preskočí, D36).
 *
 * Vety sa berú zo slovníka (`ui/vocabulary.ts`), aby existovala jedna formulácia
 * pre tabuľku položiek aj pre túto odpoveď.
 */
export function attentionTextsFor(kind: 'uncertain' | 'failed'): {
  what: string;
  nextStep: string;
} {
  if (kind === 'uncertain') {
    return {
      what: itemSentence('uncertain').reason,
      nextStep:
        'Pozrite sa na tieto produkty priamo v eshope, či zľava platí. Ak neplatí, ' +
        'spustite pri danej zľave „Zopakovať zlyhané" — appka pošle ten istý zápis ' +
        'ešte raz a ak tam zľava už je, druhýkrát ju nepíše. Zľavu appka nikdy ' +
        'sama neruší.',
    };
  }
  return {
    what: itemSentence('failed').reason,
    nextStep:
      'Spustite pri danej zľave „Zopakovať zlyhané". Appka založí opravnú zľavu len ' +
      's produktmi, ktoré neprešli, a najprv si vypýta nový náhľad a potvrdenie — ' +
      'bez neho nezapíše nič.',
  };
}

/* ═══════════════════════════ 5. Route ═════════════════════════════════════ */

/** Zlyhanie jedného čítania nesmie zhodiť celú prístrojovú dosku. */
async function safeRead<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export function createQueueRoute(deps: QueueRouteDeps = {}): NextRouteHandler {
  const campaigns = deps.campaigns ?? defaultCampaignsRepo;
  const items = deps.items ?? defaultItemsRepo;
  const schedulerState = deps.schedulerState ?? defaultSchedulerState;
  const settings = deps.settings ?? defaultSettingsRepo;
  const apiKey = deps.apiKey ?? defaultApiKeyRepo;
  const now = deps.now ?? ((): Date => new Date());
  const budget = deps.budget ?? createBudget({ settingsRepo: defaultSettingsRepo, now });
  const gate = deps.gate ?? getQueueGate;
  const lastRun = deps.lastRun ?? lastQueueReport;
  const writesEnabled =
    deps.writesEnabled ??
    ((): boolean | null => {
      // ENV sa vyhodnocuje LAZY až pri requeste (A19) a zlyhanie validácie je
      // „neviem", nie 500: prístrojová doska má povedať pravdu aj o sebe.
      try {
        return writesAllowedByEnv();
      } catch {
        return null;
      }
    });

  return defineRoute(
    {
      method: 'GET',
      handler: async () => {
        const at = now();

        /* 1. Rozpočet (K2). Zlyhanie nie je chyba requestu — hlavička vie
         * povedať „neviem", ale nesmie si číslo vymyslieť (P7). */
        const budgetStatus: BudgetStatus | null = await safeRead(() => budget.remainingToday());

        /* 2. Fronta z `campaign_items` — jediný zdroj pravdy o tom, koľko
         * položiek ešte čaká (K2: žiadne paralelné počítadlo). */
        const totals = await items.queueTotals();

        /* 3. Ktorá zľava dáva číslam meno: najprv tá, ktorá práve zapisuje,
         * inak prvá čakajúca vo fronte (najskorší `date_from`). */
        const running = (await safeRead(() => campaigns.findRunningUnfinished())) ?? [];
        const queued = running.length > 0 ? [] : ((await safeRead(() => campaigns.findQueued(1))) ?? []);
        const head = running[0] ?? queued[0] ?? null;

        const headCounts =
          head === null ? null : await safeRead(() => items.countByStatus(head.id));

        const current: QueueCampaignView | null =
          head === null
            ? null
            : {
                campaignId: head.id,
                name: head.name,
                status: head.status,
                dateFrom: head.dateFrom,
                dateTo: head.dateTo,
                itemsTotal: head.itemsTotal,
                itemsOk: head.itemsOk,
                itemsFailed: head.itemsFailed,
                itemsUncertain: head.itemsUncertain,
                // Presný počet má prednosť pred odvodeninou z počítadiel: tá
                // do „čaká" pripočíta aj preskočené a prerušené položky.
                itemsPending:
                  headCounts?.pending ??
                  Math.max(
                    0,
                    head.itemsTotal - head.itemsOk - head.itemsFailed - head.itemsUncertain,
                  ),
                late: head.late,
                itemCounts: headCounts,
              };

        /* 4. Odhad dobehnutia CELEJ fronty (K5). Bez rozpočtu žiadny odhad. */
        const estimate: FinishEstimate | null =
          budgetStatus === null || totals.pending === 0
            ? null
            : estimateFinish(totals.pending, budgetStatus.budget, {
                remainingToday: budgetStatus.remaining,
                now: at,
              });

        /* 5. Heartbeat — FAKT z DB. Keď tick dlho nebežal, fronta nezapisuje
         * bez ohľadu na to, čo si o bráne myslí tento module graph. */
        const state = await safeRead(() => schedulerState.get());
        const lastTickAt = state?.lastTickAt ?? null;
        const staleMs = lastTickAt === null ? null : at.getTime() - lastTickAt.getTime();
        const schedulerDown = staleMs === null || staleMs > DOWNTIME_GRACE_MS;

        /* 6. Poistky a kľúč — fakty pre `standing` aj pre prekážky. */
        const settingsRecord = await safeRead(() => settings.get());
        const scope: ScopeSettings | null = await safeRead(() => settings.readScope());
        const keyMeta: ApiKeyMeta | null = await safeRead(() => apiKey.getMeta());
        const keyFacts = keyFactsOf(keyMeta, at);
        const envWrites = writesEnabled();

        /* 7. Rozpad položiek celej fronty. `pending` a `total` sú presné z
         * `campaign_items`; `ok`/`failed`/`uncertain` sa sčítajú z počítadiel
         * živých kampaní. Rozdiel (preskočené + prerušené) sa nezahadzuje, ale
         * priznáva ako `otherResolved` — inak by čísla nesedeli a nikto by
         * nevedel prečo. */
        const live =
          (await safeRead(() =>
            campaigns.list({ status: LIVE_QUEUE_STATUSES, page: 1, perPage: LIVE_CAMPAIGNS_PAGE }),
          ))?.data ?? [];
        const sum = (pick: (c: CampaignRecordV3) => number): number =>
          live.reduce((acc, c) => acc + Math.max(0, pick(c)), 0);
        const okItems = sum((c) => c.itemsOk);
        const failedItems = sum((c) => c.itemsFailed);
        const uncertainItems = sum((c) => c.itemsUncertain);

        const itemsView: QueueItemsView = {
          total: totals.total,
          pending: totals.pending,
          done: Math.max(0, totals.total - totals.pending),
          ok: okItems,
          failed: failedItems,
          uncertain: uncertainItems,
          otherResolved: Math.max(
            0,
            totals.total - totals.pending - okItems - failedItems - uncertainItems,
          ),
          campaigns: totals.campaigns,
        };

        /* 8. Čo si žiada pozornosť: živé zľavy + dobehnuté výsledky, ktoré ešte
         * nikto neodklikol (`result_ack_at IS NULL`, D17). Práve tie sú tie,
         * o ktorých používateľ ešte nevie. */
        const unacked = (await safeRead(() => campaigns.findUnacked())) ?? [];
        const attention = buildAttention([...live, ...unacked]);

        /* 9. PREČO to stojí — prekážky z jediného zdroja pravdy (blockers.ts).
         * Katalógové prekážky sa filtrujú, viď hlavičku súboru. */
        const snapshot: StatusSnapshot = {
          now: at,
          writes: { enabled: envWrites },
          apiKey:
            keyMeta === null
              ? {}
              : { present: keyMeta.present, expiresAt: keyMeta.expiresAt },
          writeBudget:
            budgetStatus === null
              ? {}
              : { budget: budgetStatus.budget, spent: budgetStatus.spent, day: budgetStatus.day },
          scope:
            scope === null
              ? {}
              : {
                  mode: scope.mode,
                  maxProducts: scope.maxProductsPerCampaign,
                  failClosed: scope.failClosed,
                },
          // Strop rozsahu sa pred KAŽDOU dávkou kontroluje znova
          // (`guards.checkScope()`), takže kampaň s 150 produktmi v pilotnom
          // režime naozaj stojí — a musí to byť vidieť skôr než z logu.
          selection: head === null ? {} : { selectedCount: head.itemsTotal },
        };
        const blockers = collectOperationBlockers(snapshot).filter(
          (blocker) => blocker.area !== 'katalog',
        );
        const summary = summarizeBlockers(blockers);

        const standReason = resolveStandReason({
          pending: totals.pending,
          schedulerDown,
          gatePaused: gate().paused,
          writesEnabled: envWrites,
          writesLocked: settingsRecord === null ? null : settingsRecord.writesLocked,
          keyUsable: keyFacts.usable,
          keyExpired: keyFacts.expired,
          budget: budgetStatus,
        });

        /* 10. Dva stropy vedľa seba — strop shopu a náš rozpočet (K2). */
        const limits = describeWriteBudgetLimits(
          budgetStatus?.budget ?? scope?.dailyWriteBudget ?? null,
          at,
        );

        return {
          budget: budgetStatus,
          /**
           * Hlavička appky (`components/layout/queue.ts`) číta rozpočet práve
           * z tohto tvaru. Bez neho v odpovedi kreslila natrvalo pomlčku, hoci
           * rozpočet sa čítať dal — číslo bolo len o poschodie vedľa.
           */
          writes:
            budgetStatus === null
              ? null
              : {
                  spentToday: budgetStatus.spent,
                  budget: budgetStatus.budget,
                  resumeAt: limits.nextResetAt.toISOString(),
                },
          queue: {
            pending: totals.pending,
            total: totals.total,
            /** Koľko položiek už fronta spracovala (pruh `3 420 / 8 000`). */
            done: itemsView.done,
            campaigns: totals.campaigns,
          },
          items: itemsView,
          current,
          estimate,
          limits: {
            shopPerUtcDay: limits.shopPerUtcDay,
            shopPerMinute: limits.shopPerMinute,
            configuredPerDay: limits.configuredPerDay,
            belowShopCap: limits.belowShopCap,
            nextResetAt: limits.nextResetAt.toISOString(),
            secondsToReset: limits.secondsToReset,
          },
          /**
           * Stav kľúča na zápis. Pole sa NESMIE volať `key` ani nič končiace na
           * „key" — centrálny redaktor (I1) by celú hodnotu nahradil maskou a UI
           * by tvrdilo, že kľúč chýba. Sú tu výhradne časy a príznaky, nikdy
           * ani kúsok samotného kľúča (D65).
           */
          keyStatus:
            keyMeta === null
              ? null
              : {
                  present: keyMeta.present,
                  verifyStatus: keyMeta.verifyStatus,
                  expiresAt: keyMeta.expiresAt === null ? null : keyMeta.expiresAt.toISOString(),
                  secondsLeft: keyMeta.secondsLeft,
                  usable: keyFacts.usable,
                  expired: keyFacts.expired,
                },
          standing: {
            /** `true` = fronte teraz nič nebráni zapisovať. */
            writing: standReason === null,
            /** Kód dôvodu; vetu k nemu skladá slovník (K10). */
            reason: standReason,
            /** Prekážky zoradené podľa závažnosti (`blockers.ts`). */
            blockers: summary.blockers.map(blockerView),
            /** `true` = aspoň jedna prekážka zastavuje všetko. */
            blocked: summary.blocked,
            /** Najbližší čas, keď sa niečo pohne samo. */
            waitUntil: summary.waitUntil === null ? null : summary.waitUntil.toISOString(),
            /** `true` = zápisy zamkla runaway poistka (D79); `null` = nevieme. */
            writesLocked: settingsRecord === null ? null : settingsRecord.writesLocked,
            writesLockedReason: settingsRecord?.writesLockedReason ?? null,
          },
          attention,
          heartbeat: {
            lastTickAt: lastTickAt === null ? null : lastTickAt.toISOString(),
            staleMs,
            /** `true` = scheduler nedáva o sebe vedieť, takže fronta stojí. */
            stale: schedulerDown,
          },
          /** Best-effort (viď hlavička súboru) — nikdy jediný dôkaz o stave. */
          gate: { ...gate(), bestEffort: true as const },
          lastRun: lastRun(),
        };
      },
    },
    deps.routeDeps,
  );
}

/* ══════════════════ 6. Neisté vs. zlyhané naprieč zľavami ═════════════════ */

/**
 * Zostaví obe skupiny pozornosti z jedného zoznamu kampaní. Duplicity (kampaň,
 * ktorá je aj živá, aj neodkliknutá) sa zlučujú podľa `id` — inak by sa počty
 * zdvojili a používateľ by hľadal produkty, ktoré neexistujú.
 */
export function buildAttention(records: readonly CampaignRecordV3[]): {
  uncertain: AttentionGroupView;
  failed: AttentionGroupView;
} {
  const unique = new Map<number, CampaignRecordV3>();
  for (const record of records) {
    if (!unique.has(record.id)) unique.set(record.id, record);
  }

  const group = (
    kind: 'uncertain' | 'failed',
    pick: (c: CampaignRecordV3) => number,
  ): AttentionGroupView => {
    const rows: AttentionCampaignView[] = [];
    let itemsTotal = 0;
    for (const record of unique.values()) {
      const count = Math.max(0, pick(record));
      if (count === 0) continue;
      itemsTotal += count;
      rows.push({
        campaignId: record.id,
        name: record.name,
        status: record.status,
        items: count,
      });
    }
    rows.sort((a, b) => b.items - a.items || a.campaignId - b.campaignId);
    const texts = attentionTextsFor(kind);
    return {
      items: itemsTotal,
      campaigns: rows.slice(0, ATTENTION_MAX_CAMPAIGNS),
      truncated: rows.length > ATTENTION_MAX_CAMPAIGNS,
      what: texts.what,
      nextStep: texts.nextStep,
    };
  };

  return {
    uncertain: group('uncertain', (c) => c.itemsUncertain),
    failed: group('failed', (c) => c.itemsFailed),
  };
}

export const GET = createQueueRoute();
