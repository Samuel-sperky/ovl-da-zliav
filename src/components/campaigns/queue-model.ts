/**
 * Aura Zľavy — ŽIVÝ STAV FRONTY PRE TAB ZĽAVY (čistý model; kontrakt dokončenia
 * B3, B5, B7, C1, C2; kontrakt V3 K2, K5, K6, K10).
 *
 * Používateľ povedal, že nevidí, čo appka robí a prečo sa niečo NEstalo. Fakty
 * na to už na serveri existujú — `GET /api/queue` (kde je fronta, koľko
 * rozpočtu ostáva, prečo stojí) a `GET /api/status` (celý obraz + prekážky
 * z `lib/status/blockers.ts`). Chýbal medzičlánok: niečo, čo tie odpovede
 * bezpečne prečíta a preloží do tvaru, ktorý obrazovka len vykreslí.
 *
 * Tento modul je ten medzičlánok a je ZÁMERNE ČISTÝ: žiadny React, žiadny
 * `fetch`, žiadna DB. Volania žijú v `zlavy-api.ts`, značkovanie v `.tsx`.
 * Dôvod je prozaický — `vitest.config.ts` zbiera `test/**\/*.spec.ts` a beží
 * v prostredí bez prehliadača, takže presne tie veci, ktoré sa pri prepisovaní
 * obrazoviek ticho pokazia (aritmetika dní, zmierenie dvoch zdrojov toho istého
 * čísla, farba prekážky), musia byť testovateľné bez JSX.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *
 *  1. **Vzhľad prekážky sa tu UŽ NEROZHODUJE.** Do 19. 8. 2026 tu stála
 *     vlastná tabuľka `RESOLUTION_TONE/ICON/WORD`, kým
 *     `dashboard/live-status-model.ts` mal vedľa nej svoju s tónmi
 *     `warn / lock / idle`. Tá istá prekážka (`writes_disabled`) tak bola na
 *     Prehľade jantárová „rieši sa mimo appky" a tu červená „mimo appky" —
 *     jeden krok používateľa a to isté sa zmenilo z „pozor" na „chyba".
 *     Slovník je odvtedy JEDEN a žije v `ui/blocker-look.ts`; tri mapy nižšie
 *     zostali len ako kompatibilné okná a sú z neho ODVODENÉ, nie napísané.
 *     Pravidlo, ktoré držali — farba podľa `resolution`, nie podľa `severity`,
 *     lebo vyčerpaný rozpočet je `blokuje`, a pritom sa nič nepokazilo (K2) —
 *     drží odteraz on.
 *
 *  2. **Dve miesta nesmú hovoriť dve rôzne čísla.** Koľko položiek je vo fronte
 *     PRED novou zľavou vieme z dvoch zdrojov: presne z `campaign_items`
 *     (`/api/queue` → `queue.pending`) a odhadom z počítadiel kampaní
 *     (`queueAhead()` nad `/api/campaigns`). Počítadlá sú odvodenina, ktorá sa
 *     dorovnáva až po behu, takže sa vedia rozísť. `resolveAhead()` je jediné
 *     miesto, kde sa vyberá, ktoré číslo platí — a priznáva, či je presné.
 *
 *  3. **Neznáme sa nedopočítava.** Keď sa nedá prečítať, koľko je vo fronte
 *     pred nami, `resolveAhead()` vráti `known: false` a obrazovka NESMIE
 *     dopočítať dátum dobehnutia. Vymyslený dátum je horší než priznaná
 *     medzera — plánuje sa podľa neho produkcia (P7).
 *
 *  4. **Neisté nie je zlyhané.** `uncertain` znamená, že zápis odišiel a
 *     odpoveď nedorazila — produkt MOŽNO zlacnený je. `failed` znamená, že
 *     určite nie je. Sú to dva rôzne ďalšie kroky a model ich nikdy nesčíta do
 *     jedného čísla; `ATTENTION_KINDS` ich drží oddelene.
 *
 *  5. **Žiadna veta sa tu neskladá dvakrát.** Čo vie povedať `blockers.ts`
 *     alebo `ui/vocabulary.ts`, sa odtiaľ berie. `QUEUE_STAND_SENTENCES` má len
 *     tie dôvody, ktoré ani jeden z nich poznať nemôže: mŕtvy plánovač, zavretá
 *     brána po odstávke a nezapojený zapisovač sú stavy PROCESU, nie stavy
 *     dát.
 *
 * Vlastník: V11.
 */
import type { IconName } from '@/components/ui/Icon';
import type { StatusTone } from '@/components/ui/ToneBadge';
import type { Blocker, BlockerResolution, BlockerSeverity } from '@/lib/status/blockers';
import type { BlockerWire } from '@/lib/status/snapshot';

import { lookChannel } from '@/components/ui/blocker-look';
import { diffDays, isDateOnly } from '@/lib/domain/dates';
import { GUARD_CODES_KNOWN, formatCountSk, guardSentence, pluralSk } from '@/lib/ui/vocabulary';

/* ══════════════════ 1. Prekážka na povrchu (farba, glyf, slovo) ═══════════ */

/**
 * Prekážka zredukovaná na to, čo obrazovka kreslí. Existuje preto, že tie isté
 * prekážky prichádzajú DVOMA cestami: hotové z `/api/queue` a `/api/status`
 * (JSON, `clearsAt` je reťazec) a lokálne prepočítané nad vlastným výberom
 * (`collectOperationBlockers()`, `clearsAt` je `Date`). Jeden tvar znamená
 * jeden vykresľovač namiesto dvoch, ktoré sa časom rozídu.
 */
export interface BlockerCard {
  readonly id: string;
  readonly severity: BlockerSeverity;
  readonly resolution: BlockerResolution;
  /** ČO sa deje — slovenská veta s číslami. Skladá ju `blockers.ts`. */
  readonly what: string;
  /** ČO S TÝM — konkrétny ďalší krok. */
  readonly nextStep: string;
  /** Kam v appke to vedie; `null` = v appke sa to vyriešiť nedá. */
  readonly path: string | null;
  /** `true` = veta stojí na domnienke, lebo údaj chýbal. Priznáva sa. */
  readonly assumed: boolean;
  /** Kedy sa prekážka uvoľní sama; ISO reťazec alebo `null`. */
  readonly clearsAt: string | null;
}

/*
 * Tri kanály stavu prekážky — ODVODENÉ z jediného slovníka appky
 * (`ui/blocker-look.ts`), nie napísané tu.
 *
 * Mapy zostali kvôli miestam, ktoré ich už roky importujú po jednom kanáli.
 * Nové miesta majú siahať rovno po `resolutionLook()`: vráti tón, ikonu, slovo
 * aj `locked` naraz, takže sa tri kanály nemôžu rozísť ani teoreticky.
 *
 *  - `cakanie`    → pokojná sivá. Nič sa nepokazilo, appka čaká na polnoc (K2).
 *  - `sam`, `sudo` → jantárová. Používateľ s tým vie pohnúť, len ešte nepohol;
 *    zámok pri `sudo` nesie ikona a slovo, nie farba.
 *  - `mimo_appky` → červená. Zápis je zastavený a z obrazovky sa s tým nedá
 *    urobiť nič; červená je v tejto appke vyhradená pre stratu dát a zastavený
 *    zápis a toto je presne ten druhý prípad.
 */

/** Farba podľa toho, ČO S TÝM — nie podľa toho, ako veľmi to blokuje. */
export const RESOLUTION_TONE: Readonly<Record<BlockerResolution, StatusTone>> =
  lookChannel('tone');

/** Ikona — druhý kanál popri farbe. `sudo` má zámok, lebo si pýta heslo. */
export const RESOLUTION_ICON: Readonly<Record<BlockerResolution, IconName>> =
  lookChannel('icon');


/** Slovo — tretí kanál. Bez neho je farba aj glyf len obrázok. */
export const RESOLUTION_WORD: Readonly<Record<BlockerResolution, string>> =
  lookChannel('word');

/** Prekážka z lokálneho prepočtu → karta. */
export function cardOfBlocker(blocker: Blocker): BlockerCard {
  return {
    id: blocker.id,
    severity: blocker.severity,
    resolution: blocker.resolution,
    what: blocker.what,
    nextStep: blocker.nextStep,
    path: blocker.path,
    assumed: blocker.assumed,
    clearsAt: blocker.clearsAt === null ? null : blocker.clearsAt.toISOString(),
  };
}

/** Prekážka z odpovede servera → karta. */
export function cardOfWire(wire: BlockerWire): BlockerCard {
  return {
    id: wire.id,
    severity: wire.severity,
    resolution: wire.resolution,
    what: wire.what,
    nextStep: wire.nextStep,
    path: wire.path,
    assumed: wire.assumed,
    clearsAt: wire.clearsAt,
  };
}

/**
 * Prekážky, ktoré niečo naozaj zastavujú alebo obmedzujú. Informatívne riadky
 * (trvalý strop, ktorý výber neprekročil) sem NEPATRIA — patria do tichého
 * zoznamu „čo teraz platí", inak by sa hlásenie o probléme utopilo v šume.
 */
export function alarmingCards(cards: readonly BlockerCard[]): readonly BlockerCard[] {
  return cards.filter((card) => card.severity !== 'informuje');
}

/** Opak `alarmingCards()` — trvalé pravidlá, ktoré je dobré vidieť, nie riešiť. */
export function quietCards(cards: readonly BlockerCard[]): readonly BlockerCard[] {
  return cards.filter((card) => card.severity === 'informuje');
}

/** Prvá prekážka daného druhu; `null` = v zozname nie je. */
export function findCard(
  cards: readonly BlockerCard[],
  id: string,
): BlockerCard | null {
  return cards.find((card) => card.id === id) ?? null;
}

/* ═══════════════════ 2. Prečo fronta stojí (dôvody procesu) ═══════════════ */

/**
 * Kód dôvodu, prečo fronta nezapisuje. Zoznam je zhodný s `QueueStandReason`
 * v `app/api/queue/route.ts`; neznámy kód sa NIKDY nezobrazí surový.
 */
export type QueueStandCode =
  | 'queue_paused'
  | 'queue_empty'
  | 'writes_disabled'
  | 'writes_locked'
  | 'key_missing'
  | 'key_expired'
  | 'budget_exhausted'
  | 'budget_unknown'
  | 'executor_unavailable'
  | 'scheduler_down'
  | 'state_unknown';

/** Dôvod ako dve vety: čo sa deje a čo s tým. */
export interface StandSentence {
  readonly what: string;
  readonly nextStep: string;
  readonly tone: StatusTone;
  /** Kam v appke to vedie; `null` = nikam. */
  readonly path: string | null;
}

/**
 * Dôvody, ktoré `blockers.ts` ani `ui/vocabulary.ts` poznať nemôžu — sú to
 * stavy BEHU appky (mŕtvy plánovač, zavretá brána po odstávke, nezapojený
 * zapisovač), nie stavy dát. Všetko ostatné sa nižšie berie zo slovníka.
 */
const QUEUE_STAND_SENTENCES: Readonly<Record<string, StandSentence>> = {
  queue_empty: {
    what: 'Vo fronte nie je ani jedna položka na zápis.',
    nextStep: 'Netreba robiť nič — keď založíte zľavu, fronta sa rozbehne sama.',
    tone: 'idle',
    path: null,
  },
  queue_paused: {
    // P2 hovorí max 90 znakov na povrchu. Táto veta mala 111 a niesla naraz
    // FAKT (fronta stojí) aj DÔVOD (aby po výpadku nezapísala naslepo).
    // Dôvod patrí k ďalšiemu kroku, ktorý sa aj tak číta hneď za ňou.
    what: 'Fronta je pozastavená po odstávke počítača a sama sa nerozbehne.',
    nextStep:
      'Pokračovanie sa potvrdzuje v Prehľade — po dlhom výpadku appka dávku nezapíše naslepo.',
    tone: 'attention',
    path: '/',
  },
  scheduler_down: {
    what: 'Appka sa dlho neozvala — časť, ktorá zapisuje, práve nebeží, takže fronta stojí.',
    nextStep:
      'Skontrolujte, či beží počítač s appkou. Po jej naštartovaní fronta pokračuje sama, nič sa nestratilo.',
    tone: 'critical',
    path: null,
  },
  executor_unavailable: {
    what: 'Zapisovacia časť appky nie je zapojená, takže sa nezapíše ani jeden produkt.',
    nextStep: 'Reštartujte appku; ak to nepomôže, rieši to správca počítača.',
    tone: 'critical',
    path: null,
  },
  state_unknown: {
    what: 'Nastavenia sa nepodarilo prečítať — kým to tak je, appka radšej nezapisuje nič.',
    nextStep: 'Skúste obrazovku o chvíľu obnoviť. Ak to potrvá, pozrite sa do Nastavení.',
    tone: 'attention',
    path: '/nastavenia',
  },
  key_expired: {
    what: 'Kľúč na zápis do shopu expiroval — appka ho už nepoužije.',
    nextStep: 'Vložte nový kľúč v Nastaveniach; fronta potom pokračuje presne tam, kde stojí.',
    tone: 'attention',
    path: '/nastavenia',
  },
  budget_unknown: {
    what: 'Nevieme, koľko zápisov dnes už odišlo — kým to nevieme, appka ďalej nezapisuje.',
    nextStep: 'Netreba robiť nič — rozpočet sa obnoví o polnoci a fronta pokračuje sama.',
    tone: 'idle',
    path: null,
  },
};

/** Dôvody, na ktoré vetu už má slovník (`guardSentence`) — a kam vedú. */
const GUARD_BACKED: Readonly<Record<string, { tone: StatusTone; path: string | null }>> = {
  writes_disabled: { tone: 'critical', path: null },
  writes_locked: { tone: 'critical', path: '/nastavenia' },
  key_missing: { tone: 'attention', path: '/nastavenia' },
  budget_exhausted: { tone: 'idle', path: null },
};

/**
 * PREČO FRONTA STOJÍ — jedna veta a jeden ďalší krok.
 *
 * `null` znamená „nestojí" (server poslal `reason: null`). Neznámy kód dostane
 * neutrálnu vetu; surový kód sa na povrch nedostane nikdy.
 */
export function queueStandSentence(reason: string | null): StandSentence | null {
  if (reason === null || reason === '') return null;

  const own = Object.prototype.hasOwnProperty.call(QUEUE_STAND_SENTENCES, reason)
    ? QUEUE_STAND_SENTENCES[reason]
    : undefined;
  if (own !== undefined) return own;

  const backed = Object.prototype.hasOwnProperty.call(GUARD_BACKED, reason)
    ? GUARD_BACKED[reason]
    : undefined;
  if (backed !== undefined) {
    const sentence = guardSentence(reason);
    return {
      what: sentence.text,
      nextStep: sentence.hint ?? 'Netreba robiť nič.',
      tone: backed.tone,
      path: backed.path,
    };
  }

  return {
    what: 'Fronta teraz nezapisuje a appka nevie povedať prečo.',
    nextStep: 'Skúste obrazovku obnoviť; podrobnosti sú v Technickom detaile.',
    tone: 'attention',
    path: null,
  };
}

/**
 * Blokátor zo skúšky naprázdno na povrch (K10). Známy kód dostane vetu zo
 * slovníka aj s ďalším krokom; neznámy si nechá správu servera, ale kód sa
 * na obrazovku nedostane nikdy.
 */
export function previewBlockerText(code: string, message: string): string {
  if ((GUARD_CODES_KNOWN as readonly string[]).includes(code)) {
    const sentence = guardSentence(code);
    return sentence.hint === null ? sentence.text : `${sentence.text} ${sentence.hint}`;
  }
  return message;
}

/* ═════════════════ 3. Bezpečné čítanie odpovede `/api/queue` ══════════════ */

/*
 * Turbopack tu už raz vyhodnotil `if (!row)` ako compile-time falsy (pasca
 * z CLAUDE.md), preto sa všade porovnáva explicitne.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Celé nezáporné číslo, inak `null`. Záporný počet položiek je nezmysel. */
function count(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function text(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function flag(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

const BLOCKER_RESOLUTIONS: readonly BlockerResolution[] = ['sam', 'sudo', 'cakanie', 'mimo_appky'];
const BLOCKER_SEVERITIES: readonly BlockerSeverity[] = ['blokuje', 'obmedzuje', 'informuje'];

/**
 * Prekážka z JSON. Neznámu závažnosť aj neznámy spôsob riešenia berie
 * fail-closed: prísnejšie (`blokuje`) a bez sľubu, že sa to dá vyriešiť samo
 * (`mimo_appky`) — appka radšej povie „s tým ti neporadím" než „to bude dobré".
 */
function parseBlockerCard(raw: unknown): BlockerCard | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = text(record, 'id');
  const what = text(record, 'what');
  if (id === null || what === null) return null;

  const severityRaw = record['severity'];
  const resolutionRaw = record['resolution'];
  const severity = BLOCKER_SEVERITIES.find((value) => value === severityRaw) ?? 'blokuje';
  const resolution = BLOCKER_RESOLUTIONS.find((value) => value === resolutionRaw) ?? 'mimo_appky';

  return {
    id,
    severity,
    resolution,
    what,
    nextStep: text(record, 'nextStep') ?? '',
    path: text(record, 'path'),
    assumed: flag(record, 'assumed'),
    clearsAt: text(record, 'clearsAt'),
  };
}

export interface QueueBudgetView {
  readonly day: string;
  readonly budget: number;
  readonly spent: number;
  readonly remaining: number;
  readonly exhausted: boolean;
}

export interface QueueTotalsView {
  readonly pending: number;
  readonly total: number;
  readonly done: number;
  readonly campaigns: number;
}

/**
 * Rozpad položiek celej fronty. `uncertain` je ZÁMERNE vlastné číslo — zápis
 * odišiel a odpoveď nedorazila, takže produkt zlacnený byť môže. Zliať ho
 * k `failed` by znamenalo poslať používateľa opravovať niečo, čo je možno
 * v poriadku.
 */
export interface QueueItemsView {
  readonly total: number;
  readonly pending: number;
  readonly done: number;
  readonly ok: number;
  readonly failed: number;
  readonly uncertain: number;
  readonly otherResolved: number;
  readonly campaigns: number;
}

export interface QueueEstimateView {
  readonly pending: number;
  readonly perDay: number;
  readonly days: number;
  readonly date: string;
}

export interface QueueLimitsView {
  /** Strop shopu na UTC deň — zdvihne ho len shop, nie appka. */
  readonly shopPerUtcDay: number | null;
  /** Náš rozpočet z nastavení; dá sa posunúť len nadol. */
  readonly configuredPerDay: number | null;
  readonly belowShopCap: boolean;
  readonly nextResetAt: string | null;
  readonly secondsToReset: number | null;
}

export interface QueueKeyStatusView {
  readonly present: boolean;
  readonly expiresAt: string | null;
  readonly secondsLeft: number | null;
  readonly usable: boolean;
  readonly expired: boolean;
}

/** Zľava, ktorá práve dáva číslam vo fronte meno. */
export interface QueueCurrentView {
  readonly campaignId: number;
  readonly name: string;
  readonly itemsTotal: number;
  readonly itemsOk: number;
  readonly itemsFailed: number;
  readonly itemsUncertain: number;
  readonly itemsPending: number;
  readonly late: boolean;
}

export interface QueueAttentionCampaign {
  readonly campaignId: number;
  readonly name: string;
  readonly items: number;
}

export interface QueueAttentionGroup {
  readonly items: number;
  readonly campaigns: readonly QueueAttentionCampaign[];
  readonly truncated: boolean;
  readonly what: string;
  readonly nextStep: string;
}

export interface QueueStandingView {
  /** `true` = fronte teraz nič nebráni zapisovať. */
  readonly writing: boolean;
  readonly reason: string | null;
  readonly blockers: readonly BlockerCard[];
  readonly blocked: boolean;
  readonly waitUntil: string | null;
  readonly writesLocked: boolean | null;
  readonly writesLockedReason: string | null;
}

export interface QueueSnapshotView {
  readonly budget: QueueBudgetView | null;
  readonly queue: QueueTotalsView;
  readonly items: QueueItemsView;
  readonly current: QueueCurrentView | null;
  readonly estimate: QueueEstimateView | null;
  readonly limits: QueueLimitsView;
  readonly keyStatus: QueueKeyStatusView | null;
  readonly standing: QueueStandingView;
  readonly attention: {
    readonly uncertain: QueueAttentionGroup | null;
    readonly failed: QueueAttentionGroup | null;
  };
  readonly heartbeat: { readonly lastTickAt: string | null; readonly stale: boolean };
}

function parseAttentionGroup(raw: unknown): QueueAttentionGroup | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const items = count(record, 'items');
  if (items === null) return null;

  const listRaw = record['campaigns'];
  const campaigns: QueueAttentionCampaign[] = [];
  if (Array.isArray(listRaw)) {
    for (const entry of listRaw) {
      const row = asRecord(entry);
      if (row === null) continue;
      const campaignId = count(row, 'campaignId');
      const name = text(row, 'name');
      const rowItems = count(row, 'items');
      if (campaignId === null || name === null || rowItems === null) continue;
      campaigns.push({ campaignId, name, items: rowItems });
    }
  }

  return {
    items,
    campaigns,
    truncated: flag(record, 'truncated'),
    what: text(record, 'what') ?? '',
    nextStep: text(record, 'nextStep') ?? '',
  };
}

/**
 * Odpoveď `/api/queue` → tvar pre obrazovku. `null` znamená, že sa odpoveď
 * nedala prečítať — obrazovka to prizná, nekreslí nuly.
 */
export function parseQueueSnapshot(raw: unknown): QueueSnapshotView | null {
  const root = asRecord(raw);
  if (root === null) return null;

  const totalsRaw = asRecord(root['queue']);
  if (totalsRaw === null) return null;
  const pending = count(totalsRaw, 'pending');
  const total = count(totalsRaw, 'total');
  if (pending === null || total === null) return null;

  let budget: QueueBudgetView | null = null;
  const budgetRaw = asRecord(root['budget']);
  if (budgetRaw !== null) {
    const limit = count(budgetRaw, 'budget');
    const spent = count(budgetRaw, 'spent');
    if (limit !== null && limit > 0 && spent !== null) {
      const remaining = count(budgetRaw, 'remaining') ?? Math.max(0, limit - spent);
      budget = {
        day: text(budgetRaw, 'day') ?? '',
        budget: limit,
        spent,
        remaining,
        exhausted: remaining <= 0,
      };
    }
  }

  const itemsRaw = asRecord(root['items']);
  const done = count(totalsRaw, 'done') ?? Math.max(0, total - pending);
  const items: QueueItemsView =
    itemsRaw === null
      ? {
          total,
          pending,
          done,
          ok: 0,
          failed: 0,
          uncertain: 0,
          otherResolved: 0,
          campaigns: count(totalsRaw, 'campaigns') ?? 0,
        }
      : {
          total: count(itemsRaw, 'total') ?? total,
          pending: count(itemsRaw, 'pending') ?? pending,
          done: count(itemsRaw, 'done') ?? done,
          ok: count(itemsRaw, 'ok') ?? 0,
          failed: count(itemsRaw, 'failed') ?? 0,
          uncertain: count(itemsRaw, 'uncertain') ?? 0,
          otherResolved: count(itemsRaw, 'otherResolved') ?? 0,
          campaigns: count(itemsRaw, 'campaigns') ?? count(totalsRaw, 'campaigns') ?? 0,
        };

  let current: QueueCurrentView | null = null;
  const currentRaw = asRecord(root['current']);
  if (currentRaw !== null) {
    const campaignId = count(currentRaw, 'campaignId');
    const name = text(currentRaw, 'name');
    if (campaignId !== null && name !== null) {
      current = {
        campaignId,
        name,
        itemsTotal: count(currentRaw, 'itemsTotal') ?? 0,
        itemsOk: count(currentRaw, 'itemsOk') ?? 0,
        itemsFailed: count(currentRaw, 'itemsFailed') ?? 0,
        itemsUncertain: count(currentRaw, 'itemsUncertain') ?? 0,
        itemsPending: count(currentRaw, 'itemsPending') ?? 0,
        late: flag(currentRaw, 'late'),
      };
    }
  }

  let estimate: QueueEstimateView | null = null;
  const estimateRaw = asRecord(root['estimate']);
  if (estimateRaw !== null) {
    const date = text(estimateRaw, 'date');
    if (date !== null) {
      estimate = {
        date,
        days: count(estimateRaw, 'days') ?? 0,
        perDay: count(estimateRaw, 'perDay') ?? 0,
        pending: count(estimateRaw, 'pending') ?? pending,
      };
    }
  }

  const limitsRaw = asRecord(root['limits']);
  const limits: QueueLimitsView = {
    shopPerUtcDay: limitsRaw === null ? null : count(limitsRaw, 'shopPerUtcDay'),
    configuredPerDay: limitsRaw === null ? null : count(limitsRaw, 'configuredPerDay'),
    belowShopCap: limitsRaw !== null && flag(limitsRaw, 'belowShopCap'),
    nextResetAt: limitsRaw === null ? null : text(limitsRaw, 'nextResetAt'),
    secondsToReset: limitsRaw === null ? null : count(limitsRaw, 'secondsToReset'),
  };

  let keyStatus: QueueKeyStatusView | null = null;
  const keyRaw = asRecord(root['keyStatus']);
  if (keyRaw !== null) {
    keyStatus = {
      present: flag(keyRaw, 'present'),
      expiresAt: text(keyRaw, 'expiresAt'),
      secondsLeft: count(keyRaw, 'secondsLeft'),
      usable: flag(keyRaw, 'usable'),
      expired: flag(keyRaw, 'expired'),
    };
  }

  const standingRaw = asRecord(root['standing']);
  const blockersRaw = standingRaw === null ? null : standingRaw['blockers'];
  const blockers: BlockerCard[] = [];
  if (Array.isArray(blockersRaw)) {
    for (const entry of blockersRaw) {
      const card = parseBlockerCard(entry);
      if (card !== null) blockers.push(card);
    }
  }

  const lockedRaw = standingRaw === null ? undefined : standingRaw['writesLocked'];
  const standing: QueueStandingView = {
    // Fail-closed: keď sa `standing` nedá prečítať, netvrdíme, že sa zapisuje.
    writing: standingRaw !== null && flag(standingRaw, 'writing'),
    reason: standingRaw === null ? 'state_unknown' : text(standingRaw, 'reason'),
    blockers,
    blocked: standingRaw === null ? true : flag(standingRaw, 'blocked'),
    waitUntil: standingRaw === null ? null : text(standingRaw, 'waitUntil'),
    writesLocked: typeof lockedRaw === 'boolean' ? lockedRaw : null,
    writesLockedReason: standingRaw === null ? null : text(standingRaw, 'writesLockedReason'),
  };

  const attentionRaw = asRecord(root['attention']);
  const heartbeatRaw = asRecord(root['heartbeat']);

  return {
    budget,
    queue: {
      pending,
      total,
      done,
      campaigns: count(totalsRaw, 'campaigns') ?? 0,
    },
    items,
    current,
    estimate,
    limits,
    keyStatus,
    standing,
    attention: {
      uncertain: attentionRaw === null ? null : parseAttentionGroup(attentionRaw['uncertain']),
      failed: attentionRaw === null ? null : parseAttentionGroup(attentionRaw['failed']),
    },
    heartbeat: {
      lastTickAt: heartbeatRaw === null ? null : text(heartbeatRaw, 'lastTickAt'),
      // Fail-closed: nečitateľný tep znamená „fronta stojí", nie „všetko beží".
      stale: heartbeatRaw === null ? true : heartbeatRaw['stale'] !== false,
    },
  };
}

/* ═════════════ 4. Zmierenie dvoch zdrojov toho istého čísla (K5) ══════════ */

/** Odkiaľ číslo pochádza — obrazovka to má povedať, nie zamlčať. */
export type AheadSource = 'fronta' | 'zoznam' | 'nevieme';

export interface AheadView {
  /** Koľko položiek stojí vo fronte pred novou zľavou. */
  readonly pending: number;
  /** `true` = presný počet z fronty, nie odhad z počítadiel zliav. */
  readonly exact: boolean;
  /** `false` = nedá sa to prečítať a odhad dobehnutia sa NESMIE dopočítať. */
  readonly known: boolean;
  readonly source: AheadSource;
}

/**
 * Koľko je vo fronte PRED nami — jedno číslo z dvoch zdrojov.
 *
 * Presný počet z `campaign_items` (`/api/queue`) má prednosť pred súčtom
 * počítadiel zo zoznamu zliav: počítadlá sú odvodenina, ktorá sa dorovnáva až
 * po behu fronty, takže sa vedia rozísť. Keď nie je ani jedno, výsledok je
 * `known: false` — a vtedy sa dátum dobehnutia nedopočítava (P7).
 */
export function resolveAhead(facts: {
  readonly queuePending: number | null;
  readonly listPending: number | null;
}): AheadView {
  const fromQueue = facts.queuePending;
  if (fromQueue !== null && Number.isFinite(fromQueue) && fromQueue >= 0) {
    return { pending: Math.trunc(fromQueue), exact: true, known: true, source: 'fronta' };
  }
  const fromList = facts.listPending;
  if (fromList !== null && Number.isFinite(fromList) && fromList >= 0) {
    return { pending: Math.trunc(fromList), exact: false, known: true, source: 'zoznam' };
  }
  return { pending: 0, exact: false, known: false, source: 'nevieme' };
}

/* ═══════════════ 5. Kedy zľava nabehne oproti dobehnutiu (K5) ═════════════ */

/** Ako sedí zvolený štart zľavy na odhad dobehnutia fronty. */
export type StartVerdictCode = 'unknown' | 'reserve' | 'tight' | 'late';

export interface StartVerdict {
  readonly code: StartVerdictCode;
  /** Koľko dní rezervy medzi dobehnutím a štartom; `null` = nevieme. */
  readonly reserveDays: number | null;
  readonly what: string;
  readonly nextStep: string | null;
  readonly tone: StatusTone;
}

/**
 * Zľava nabehne v deň `from`, fronta dobehne v deň `finishDay`. Keď zľava
 * nabehne SKÔR, produkty zlacnejú postupne, nie naraz — a to je vec, ktorú
 * treba povedať PRED potvrdením, nie až z detailu bežiacej fronty (K5).
 */
export function judgeStart(from: string, finishDay: string | null): StartVerdict {
  if (finishDay === null || !isDateOnly(finishDay) || !isDateOnly(from)) {
    return {
      code: 'unknown',
      reserveDays: null,
      what: 'Kedy fronta dobehne, zatiaľ nevieme — bez denného rozpočtu sa to nedá spočítať.',
      nextStep: null,
      tone: 'idle',
    };
  }

  const reserve = diffDays(finishDay, from);

  if (reserve < 0) {
    const late = Math.abs(reserve);
    return {
      code: 'late',
      reserveDays: reserve,
      what: `Zľava nabehne ${dayCount(late)} pred dobehnutím fronty — časť produktov zlacnie až po štarte, nie naraz s ostatnými.`,
      nextStep:
        'Posuňte štart na neskôr, alebo zúžte výber. Zľava, ktorá nabehne skôr, než sa všetko zapíše, je na eshope vidieť po častiach.',
      tone: 'attention',
    };
  }

  if (reserve === 0) {
    return {
      code: 'tight',
      reserveDays: 0,
      what: 'Zľava nabehne presne v deň, keď má fronta dobehnúť — bez jediného dňa rezervy.',
      nextStep:
        'Stačí jeden pomalší deň a časť produktov zlacnie neskoro. Odporúčam posunúť štart aspoň o dva dni.',
      tone: 'attention',
    };
  }

  return {
    code: 'reserve',
    reserveDays: reserve,
    what: `Fronta má ${dayCount(reserve)} rezervy — všetko by malo byť zapísané skôr, než zľava nabehne.`,
    nextStep: null,
    tone: 'good',
  };
}

/** `1` → „1 deň", `3` → „3 dni", `12` → „12 dní". */
export function dayCount(days: number): string {
  const value = Number.isFinite(days) ? Math.max(0, Math.trunc(days)) : 0;
  return `${formatCountSk(value)} ${pluralSk(value, 'deň', 'dni', 'dní')}`;
}

/** `1` → „1 produkt", `150` → „150 produktov". */
export function productCount(items: number): string {
  const value = Number.isFinite(items) ? Math.max(0, Math.trunc(items)) : 0;
  return `${formatCountSk(value)} ${pluralSk(value, 'produkt', 'produkty', 'produktov')}`;
}

/**
 * Kedy sa rozpočet obnoví, ako HOTOVÁ fráza aj s predložkou — `BudgetMeter`
 * presne takú čaká („o 02:00", „zajtra o 02:00").
 *
 * Hodina sa počíta v `Europe/Bratislava`, nikdy v UTC: rozpočet síce beží na
 * UTC deň, ale používateľ žije v miestnom čase a rozdiel by sa prejavil len
 * večer, keď to nikto netestuje. `null` = čas obnovy nepoznáme a veta sa
 * nekreslí; vymyslená hodina by bola sľub, ktorý appka nedrží.
 */
export function resetPhrase(nextResetAt: string | null, now: Date = new Date()): string | null {
  if (nextResetAt === null || nextResetAt === '') return null;
  const at = new Date(nextResetAt);
  if (!Number.isFinite(at.getTime())) return null;

  const zone = 'Europe/Bratislava';
  const time = new Intl.DateTimeFormat('sk-SK', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  const dayOf = (value: Date): string =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(value);

  return dayOf(at) === dayOf(now) ? `o ${time}` : `zajtra o ${time}`;
}

/* ══════════════════ 6. Zopakovanie toho, čo sa nepodarilo ═════════════════ */

/**
 * Rozpad položiek zľavy na skupiny, ktoré majú RÔZNY ďalší krok. `notWritten`
 * a `uncertain` sa nikdy nesčítajú do jedného čísla — pri prvom sa vie, že
 * produkt zlacnený nie je, pri druhom to nevie nikto.
 */
export interface RetryItemsView {
  readonly total: number;
  readonly retryable: number;
  readonly notWritten: number;
  readonly uncertain: number;
  readonly pending: number;
  readonly ok: number;
  readonly skipped: number;
}

export interface RetryPlanView {
  readonly campaignId: number;
  readonly name: string;
  readonly percent: number;
  /** `true` = ostáva už len skúška naprázdno a jej potvrdenie. */
  readonly possible: boolean;
  /** Kód prekážky; vetu k nemu nesie `what` / `nextStep`. */
  readonly blockedBy: string | null;
  readonly what: string;
  readonly nextStep: string;
  readonly productIds: readonly number[];
  readonly items: RetryItemsView;
  readonly window: { readonly from: string; readonly to: string; readonly today: string };
  /** Zaradenie opravnej zľavy si vypýta heslo. */
  readonly requiresSudo: boolean;
}

/**
 * Odpoveď `GET /api/campaigns/[id]/retry-failed` → tvar pre obrazovku.
 *
 * Ten popis existuje presne preto, aby zopakovanie nebolo tlačidlo, ktoré
 * vráti odmietnutie bez vysvetlenia: server tu povie, ČO by sa zopakovalo,
 * prečo si to vyžiada čerstvé potvrdenie a čo má používateľ urobiť.
 */
export function parseRetryPlan(raw: unknown): RetryPlanView | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const campaignId = count(root, 'campaignId');
  const what = text(root, 'what');
  if (campaignId === null || what === null) return null;

  const idsRaw = root['productIds'];
  const productIds: number[] = Array.isArray(idsRaw)
    ? idsRaw.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0)
    : [];

  const itemsRaw = asRecord(root['items']);
  const items: RetryItemsView = {
    total: itemsRaw === null ? 0 : (count(itemsRaw, 'total') ?? 0),
    retryable: itemsRaw === null ? productIds.length : (count(itemsRaw, 'retryable') ?? productIds.length),
    notWritten: itemsRaw === null ? 0 : (count(itemsRaw, 'notWritten') ?? 0),
    uncertain: itemsRaw === null ? 0 : (count(itemsRaw, 'uncertain') ?? 0),
    pending: itemsRaw === null ? 0 : (count(itemsRaw, 'pending') ?? 0),
    ok: itemsRaw === null ? 0 : (count(itemsRaw, 'ok') ?? 0),
    skipped: itemsRaw === null ? 0 : (count(itemsRaw, 'skipped') ?? 0),
  };

  const windowRaw = asRecord(root['window']);
  const requiresRaw = asRecord(root['requires']);

  return {
    campaignId,
    name: text(root, 'name') ?? '',
    percent: count(root, 'percent') ?? 0,
    // Fail-closed: bez výslovného `true` sa opakovanie neponúka.
    possible: flag(root, 'possible') && productIds.length > 0,
    blockedBy: text(root, 'blockedBy'),
    what,
    nextStep: text(root, 'nextStep') ?? '',
    productIds,
    items,
    window: {
      from: windowRaw === null ? '' : (text(windowRaw, 'from') ?? ''),
      to: windowRaw === null ? '' : (text(windowRaw, 'to') ?? ''),
      today: windowRaw === null ? '' : (text(windowRaw, 'today') ?? ''),
    },
    // Fail-closed aj tu: keď server nepovie inak, počítame s heslom.
    requiresSudo: requiresRaw === null ? true : requiresRaw['sudo'] !== false,
  };
}

/**
 * PREČO SI ZOPAKOVANIE PÝTA ČERSTVÉ POTVRDENIE.
 *
 * Toto je odpoveď na otázku, ktorú dnes používateľ dostane ako holé odmietnutie
 * zo servera. Je to jediné pravidlo appky, ktoré nemá výnimku: nič sa nezapíše
 * do eshopu bez toho, aby to človek pred chvíľou videl a potvrdil. Opravná
 * zľava má inú sadu produktov než pôvodná, takže staré potvrdenie na ňu neplatí
 * ani vtedy, keď je z pred minúty.
 */
export const RETRY_WHY_FRESH =
  'Appka nezapíše do eshopu nič, čo ste pred chvíľou nevideli a nepotvrdili. ' +
  'Oprava má inú sadu produktov než pôvodná zľava, takže staré potvrdenie na ňu neplatí — ' +
  'preto sa najprv spustí skúška naprázdno nad zúženou sadou a až tá otvorí cestu k zápisu.';
