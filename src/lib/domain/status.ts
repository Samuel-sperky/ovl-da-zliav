/**
 * Aura Zľavy — stavový stroj kampaní (A7, D83, O1, BUILD-SPEC §4).
 *
 * Kampaň JE job: jeden `status` nesie celý životný cyklus a UI stavy
 * „aktívna"/„expirovaná" sa z neho **derivujú** (O1). Tabuľka prechodov nižšie
 * je prepis BUILD-SPEC §4 1 : 1 vrátane spúšťačov; čokoľvek, čo v nej nie je,
 * je zakázaný prechod a `assertTransition()` hodí výnimku.
 *
 * Invarianty držané tu:
 *  - **I3** — do `running` sa NEDÁ dostať bez `confirmed_at`
 *    **a** `confirm_payload_hash`. Neexistuje parameter, flag ani skratka,
 *    ktorá by to obišla.
 *  - **D33b** — `missed → running` je možný VÝHRADNE spúšťačom
 *    `manual_execute` s NOVÝM potvrdením. V tomto module ÚMYSELNE neexistuje
 *    žiadna konštanta typu „catch-up okno" a žiadny automatický spúšťač
 *    z `missed` neexistuje.
 *  - Terminálne stavy `done`/`cancelled`/`lapsed` nemajú žiadny odchádzajúci
 *    prechod; `partial`/`failed` sa neopravujú, „Zopakovať zlyhané" vytvára
 *    NOVÚ kampaň `kind='retry'` (D15, D16).
 *
 * Modul je čistý: žiadna DB, žiadny audit, žiadna sieť. Vedľajšie efekty
 * (timestampy, audit eventy) robí volajúci — tabuľka ich len deklaruje.
 *
 * Vlastník: A7.
 */
import { DOMAIN_ERROR_CODES, DomainError } from '@/lib/domain/errors';
import { isAfter, isSameOrBefore } from '@/lib/domain/dates';
import type {
  CampaignKind,
  CampaignMode,
  CampaignStatus,
  DateOnly,
  DerivedCampaignView,
  ItemStatus,
  Sha256Hex,
  UtcDate,
} from '@/contracts';

/* ═════════════════════════ 1. Runtime zoznamy ═════════════════════════════ */

/** Runtime zoznam stavov kampane — zdroj pre zod enumy aj UI (contracts §7). */
export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'needs_key',
  'running',
  'done',
  'partial',
  'failed',
  'missed',
  'cancelled',
  'lapsed',
] as const satisfies readonly CampaignStatus[];

export const ITEM_STATUSES = [
  'pending',
  'skipped',
  'ok',
  'failed',
  'uncertain',
  'interrupted',
  'not_found',
  'blocked',
] as const satisfies readonly ItemStatus[];

export const CAMPAIGN_KINDS = [
  'new',
  'extend',
  'overwrite',
  'retry',
] as const satisfies readonly CampaignKind[];

export const CAMPAIGN_MODES = ['eager', 'scheduled'] as const satisfies readonly CampaignMode[];

/** Stavy, z ktorých už NEEXISTUJE žiadny odchádzajúci prechod (§4). */
export const HARD_TERMINAL_STATUSES = [
  'done',
  'partial',
  'failed',
  'cancelled',
  'lapsed',
] as const satisfies readonly CampaignStatus[];

/** Stavy, v ktorých kampaň čaká na zásah človeka (banner/notifikácia, D17, D26). */
export const WAITING_STATUSES = [
  'needs_key',
  'missed',
] as const satisfies readonly CampaignStatus[];

/** Stavy, v ktorých je kampaň ešte zrušiteľná (§5 `/cancel`). */
export const CANCELLABLE_STATUSES = [
  'draft',
  'scheduled',
  'needs_key',
  'missed',
] as const satisfies readonly CampaignStatus[];

/** Stavy, ktoré `claim()` smie prevziať do `running` (D84). */
export const CLAIMABLE_STATUSES = [
  'scheduled',
  'needs_key',
] as const satisfies readonly CampaignStatus[];

/** Stavy, ktoré vyžadujú `ack` v notifikačnom panely (D17, O6). */
export const ACKNOWLEDGEABLE_STATUSES = [
  'done',
  'partial',
  'failed',
  'missed',
  'lapsed',
] as const satisfies readonly CampaignStatus[];

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === 'string' && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

export function isItemStatus(value: unknown): value is ItemStatus {
  return typeof value === 'string' && (ITEM_STATUSES as readonly string[]).includes(value);
}

export const isHardTerminal = (s: CampaignStatus): boolean =>
  (HARD_TERMINAL_STATUSES as readonly CampaignStatus[]).includes(s);

export const isCancellable = (s: CampaignStatus): boolean =>
  (CANCELLABLE_STATUSES as readonly CampaignStatus[]).includes(s);

export const isClaimable = (s: CampaignStatus): boolean =>
  (CLAIMABLE_STATUSES as readonly CampaignStatus[]).includes(s);

/* ═══════════════════════ 2. Tabuľka prechodov (§4) ════════════════════════ */

/**
 * Spúšťače prechodov. Názov = presne to, čo v tabuľke §4 stojí v stĺpci
 * „Spúšťač prechodu". Žiadny z nich nedokáže dobehnúť zmeškanú kampaň
 * automaticky (D33b).
 */
export type TransitionTrigger =
  /** `POST /api/campaigns` s `mode='scheduled'` + platný `preview_token` + potvrdenie. */
  | 'create_scheduled'
  /** `POST /api/campaigns` s `mode='eager'` — zápis ide okamžite (D22). */
  | 'create_eager'
  /** Tick našiel `fire_at ≤ now`, kľúč platný, canary OK (D32, D84). */
  | 'tick_fire'
  /** Tick našiel `fire_at ≤ now`, ale kľúč chýba/expiroval (D21, D23). */
  | 'tick_no_key'
  /** Tick našiel `fire_at` starší než tolerancia a dôvodom nebola absencia kľúča (D33b). */
  | 'tick_missed'
  /** Uloženie nového platného kľúča → automatické dopálenie (D23, D24). */
  | 'key_saved'
  /** Okno kampane už uplynulo (`date_to < dnes`) → prepadnutá (D25). */
  | 'window_lapsed'
  /** Ručné zrušenie alebo panic button (D67). */
  | 'cancel'
  /** VÝHRADNE `POST /api/campaigns/[id]/execute` s novým dry-run potvrdením (D33b, I3). */
  | 'manual_execute'
  /** Všetky položky `ok`/`skipped` (D36). */
  | 'finish_done'
  /** Aspoň jedna `ok` a aspoň jedna neúspešná (D34). */
  | 'finish_partial'
  /** Žiadna položka `ok`. */
  | 'finish_failed'
  /** Počas dávky prišlo 401/403 → wipe kľúča a zastavenie (D51, D52). */
  | 'key_wiped_during_run'
  /** Reconcile po havárii/`SIGTERM` (D85, D86). */
  | 'reconcile';

export interface TransitionRule {
  from: CampaignStatus;
  to: CampaignStatus;
  trigger: TransitionTrigger;
  /** Povinné vedľajšie efekty podľa §4 — dokumentácia pre volajúceho. */
  effects: readonly string[];
  /** Prechod vyžaduje NOVÉ potvrdenie, nie to pôvodné (D33b bod 3, I3). */
  requiresFreshConfirmation?: true;
}

/** Prepis tabuľky BUILD-SPEC §4, riadok za riadkom. */
export const TRANSITIONS: readonly TransitionRule[] = [
  {
    from: 'draft',
    to: 'scheduled',
    trigger: 'create_scheduled',
    effects: ['confirmed_at', 'confirm_payload_hash', 'fire_at', 'audit:campaign_created'],
  },
  {
    from: 'draft',
    to: 'running',
    trigger: 'create_eager',
    effects: ['sudo_at', 'claim', 'audit:campaign_created', 'audit:campaign_claimed'],
  },
  {
    from: 'draft',
    to: 'cancelled',
    trigger: 'cancel',
    effects: ['status_reason', 'audit:campaign_cancelled'],
  },
  {
    from: 'scheduled',
    to: 'running',
    trigger: 'tick_fire',
    effects: ['claimed_at', 'started_at', 'audit:campaign_claimed'],
  },
  {
    from: 'scheduled',
    to: 'needs_key',
    trigger: 'tick_no_key',
    effects: ['needs_key_since', 'audit:campaign_needs_key'],
  },
  {
    from: 'scheduled',
    to: 'missed',
    trigger: 'tick_missed',
    effects: ['audit:campaign_missed'],
  },
  {
    from: 'scheduled',
    to: 'cancelled',
    trigger: 'cancel',
    effects: ['status_reason', 'audit:campaign_cancelled'],
  },
  {
    from: 'needs_key',
    to: 'running',
    trigger: 'key_saved',
    effects: ['date_from_original', 'audit:campaign_from_shifted', 'claim'],
  },
  {
    from: 'needs_key',
    to: 'running',
    trigger: 'manual_execute',
    effects: ['nový confirm_payload_hash', 'claim'],
    requiresFreshConfirmation: true,
  },
  {
    from: 'needs_key',
    to: 'lapsed',
    trigger: 'window_lapsed',
    effects: ['audit:campaign_lapsed', 'žiadny zápis'],
  },
  {
    from: 'needs_key',
    to: 'cancelled',
    trigger: 'cancel',
    effects: ['status_reason', 'audit:campaign_cancelled'],
  },
  {
    from: 'needs_key',
    to: 'missed',
    trigger: 'tick_missed',
    effects: ['audit:campaign_missed'],
  },
  {
    // D33b: JEDINÁ cesta z `missed` do `running` — ručná, s novým potvrdením.
    from: 'missed',
    to: 'running',
    trigger: 'manual_execute',
    effects: ['nový confirm_payload_hash', 'prípadný posun date_from', 'claim'],
    requiresFreshConfirmation: true,
  },
  {
    from: 'missed',
    to: 'lapsed',
    trigger: 'window_lapsed',
    effects: ['audit:campaign_lapsed'],
  },
  {
    from: 'missed',
    to: 'cancelled',
    trigger: 'cancel',
    effects: ['status_reason', 'audit:campaign_cancelled'],
  },
  {
    from: 'running',
    to: 'done',
    trigger: 'finish_done',
    effects: ['finished_at', 'items_*', 'audit:campaign_finished'],
  },
  {
    from: 'running',
    to: 'partial',
    trigger: 'finish_partial',
    effects: ['finished_at', 'items_*', 'result_ack_at=NULL', 'audit:campaign_finished'],
  },
  {
    from: 'running',
    to: 'failed',
    trigger: 'finish_failed',
    effects: ['finished_at', 'items_*', 'audit:campaign_finished'],
  },
  {
    from: 'running',
    to: 'needs_key',
    trigger: 'key_wiped_during_run',
    effects: ['zvyšné položky interrupted', 'audit:key_wiped'],
  },
  {
    from: 'running',
    to: 'partial',
    trigger: 'reconcile',
    effects: ['nepotvrdené položky uncertain', 'audit:reconcile_uncertain'],
  },
  {
    from: 'running',
    to: 'failed',
    trigger: 'reconcile',
    effects: ['nepotvrdené položky uncertain', 'audit:reconcile_uncertain'],
  },
] as const;

/** Všetky pravidlá pre daný prechod (môže ich byť viac s rôznym spúšťačom). */
export function rulesFor(from: CampaignStatus, to: CampaignStatus): TransitionRule[] {
  return TRANSITIONS.filter((r) => r.from === from && r.to === to);
}

/** `true`, ak prechod existuje v tabuľke §4 (bez ohľadu na potvrdenie). */
export function canTransition(
  from: CampaignStatus,
  to: CampaignStatus,
  trigger?: TransitionTrigger,
): boolean {
  return rulesFor(from, to).some((r) => trigger === undefined || r.trigger === trigger);
}

/** Zoznam cieľových stavov dosiahnuteľných z `from`. */
export function nextStatuses(from: CampaignStatus): CampaignStatus[] {
  return [...new Set(TRANSITIONS.filter((r) => r.from === from).map((r) => r.to))];
}

/* ═════════════════════ 3. `assertTransition()` (I3) ═══════════════════════ */

/** Kontext prechodu — to, čo je v DB v momente rozhodnutia. */
export interface TransitionContext {
  /** Spúšťač. Ak chýba, kontrolujú sa len tvrdé pravidlá a existencia prechodu. */
  trigger?: TransitionTrigger;
  /** `campaigns.confirmed_at` (I3). */
  confirmedAt?: UtcDate | null;
  /** `campaigns.confirm_payload_hash` (I3, O2). */
  confirmPayloadHash?: Sha256Hex | null;
  /**
   * `true` len ak potvrdenie pochádza z NOVÉHO dry-runu pre tento pokus
   * (nie z pôvodného vytvorenia kampane) — podmienka `missed → running` (D33b).
   */
  freshConfirmation?: boolean;
}

const hasConfirmation = (ctx: TransitionContext): boolean =>
  ctx.confirmedAt instanceof Date &&
  typeof ctx.confirmPayloadHash === 'string' &&
  ctx.confirmPayloadHash.length > 0;

/**
 * Overí prechod podľa §4. Hodí `DomainError`, ak:
 *  1. prechod v tabuľke neexistuje (vrátane všetkého z terminálnych stavov),
 *  2. cieľom je `running` bez `confirmed_at` + `confirm_payload_hash` (I3),
 *  3. `missed → running` prichádza inak než spúšťačom `manual_execute`
 *     s novým potvrdením (D33b) — automatické dobehnutie neexistuje.
 *
 * Vracia použité pravidlo, aby volajúci vedel, ktoré vedľajšie efekty má vykonať.
 */
export function assertTransition(
  from: CampaignStatus,
  to: CampaignStatus,
  ctx: TransitionContext = {},
): TransitionRule {
  if (!isCampaignStatus(from) || !isCampaignStatus(to)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.invalidTransition,
      'Neznámy stav kampane — prechod je odmietnutý.',
      { from, to },
    );
  }

  const candidates = rulesFor(from, to).filter(
    (r) => ctx.trigger === undefined || r.trigger === ctx.trigger,
  );

  if (candidates.length === 0) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.invalidTransition,
      isHardTerminal(from)
        ? `Kampaň je v koncovom stave „${from}" — jej stav sa už nemení (zlyhané produkty sa riešia novou kampaňou „Zopakovať zlyhané").`
        : `Prechod „${from}" → „${to}" nie je v stavovom stroji povolený.`,
      { from, to, trigger: ctx.trigger, allowed: nextStatuses(from) },
    );
  }

  // I3 — žiadna cesta do `running` bez doloženého potvrdenia.
  if (to === 'running' && !hasConfirmation(ctx)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.confirmationRequired,
      'Kampaň sa nedá spustiť: chýba potvrdený dry-run (confirmed_at a confirm_payload_hash). Zápis bez potvrdenia je zakázaný.',
      { from, to, trigger: ctx.trigger },
    );
  }

  // D33b — zo `missed` sa dá spustiť len ručne a len s NOVÝM potvrdením.
  if (from === 'missed' && to === 'running') {
    if (ctx.trigger !== undefined && ctx.trigger !== 'manual_execute') {
      throw new DomainError(
        DOMAIN_ERROR_CODES.freshConfirmationRequired,
        'Zmeškaná kampaň sa nikdy nedobehne automaticky. Spustiť ju možno len ručne s novým náhľadom a potvrdením.',
        { from, to, trigger: ctx.trigger },
      );
    }
    if (ctx.freshConfirmation !== true) {
      throw new DomainError(
        DOMAIN_ERROR_CODES.freshConfirmationRequired,
        'Zmeškaná kampaň vyžaduje NOVÝ dry-run a nové potvrdenie — pôvodné potvrdenie z vytvorenia kampane nestačí.',
        { from, to },
      );
    }
  }

  // Ostatné prechody s `requiresFreshConfirmation` (napr. ručné dopálenie
  // z `needs_key`) majú tú istú podmienku.
  const fresh = candidates.filter((r) => r.requiresFreshConfirmation !== true);
  if (fresh.length === 0 && ctx.freshConfirmation !== true) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.freshConfirmationRequired,
      'Tento prechod vyžaduje nový dry-run a nové potvrdenie.',
      { from, to, trigger: ctx.trigger },
    );
  }

  return (fresh.length > 0 && ctx.freshConfirmation !== true ? fresh[0] : candidates[0]) as TransitionRule;
}

/** Nehádzajúca varianta — pre UI (zobraziť/skryť akciu). */
export function checkTransition(
  from: CampaignStatus,
  to: CampaignStatus,
  ctx: TransitionContext = {},
): { ok: true; rule: TransitionRule } | { ok: false; code: string; message: string } {
  try {
    return { ok: true, rule: assertTransition(from, to, ctx) };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
}

/* ═════════════════ 4. Výsledok dávky → koncový stav (§4) ══════════════════ */

export interface ItemStatusTally {
  ok: number;
  failed: number;
  uncertain: number;
  notFound: number;
  interrupted: number;
  skipped: number;
  blocked: number;
  pending: number;
}

export function tallyItemStatuses(statuses: readonly ItemStatus[]): ItemStatusTally {
  const t: ItemStatusTally = {
    ok: 0,
    failed: 0,
    uncertain: 0,
    notFound: 0,
    interrupted: 0,
    skipped: 0,
    blocked: 0,
    pending: 0,
  };
  for (const s of statuses) {
    if (s === 'ok') t.ok += 1;
    else if (s === 'failed') t.failed += 1;
    else if (s === 'uncertain') t.uncertain += 1;
    else if (s === 'not_found') t.notFound += 1;
    else if (s === 'interrupted') t.interrupted += 1;
    else if (s === 'skipped') t.skipped += 1;
    else if (s === 'blocked') t.blocked += 1;
    else t.pending += 1;
  }
  return t;
}

/**
 * Koncový stav bežiacej kampane podľa §4 (D34, D36):
 *  - všetko `ok`/`skipped` → `done`,
 *  - aspoň jedna `ok` a aspoň jedna neúspešná → `partial`,
 *  - žiadna `ok` → `failed`.
 */
export function resolveFinalStatus(
  statuses: readonly ItemStatus[],
): Extract<CampaignStatus, 'done' | 'partial' | 'failed'> {
  const t = tallyItemStatuses(statuses);
  const bad = t.failed + t.uncertain + t.notFound + t.interrupted + t.blocked + t.pending;
  if (bad === 0) return 'done';
  return t.ok > 0 ? 'partial' : 'failed';
}

/** Spúšťač, ktorý k danému koncovému stavu patrí (pre `assertTransition`). */
export function finishTrigger(
  finalStatus: Extract<CampaignStatus, 'done' | 'partial' | 'failed'>,
): TransitionTrigger {
  return finalStatus === 'done'
    ? 'finish_done'
    : finalStatus === 'partial'
      ? 'finish_partial'
      : 'finish_failed';
}

/* ═══════════════════ 5. Derivované UI stavy (O1, §4) ══════════════════════ */

/**
 * „aktívna" = `status='done'` a dnes ≤ `date_to`;
 * „expirovaná" = `status IN ('done','partial')` a dnes > `date_to`.
 * Nikdy sa neukladá do DB (contracts §7) a nikdy netvrdí, čo má shop (I11).
 */
export function deriveCampaignView(
  status: CampaignStatus,
  dateTo: DateOnly,
  today: DateOnly,
): DerivedCampaignView {
  if (status === 'done' && isSameOrBefore(today, dateTo)) return 'aktivna';
  if ((status === 'done' || status === 'partial') && isAfter(today, dateTo)) return 'expirovana';
  return null;
}

/** Kampaň patrí do notifikačného panelu (D17, O6). */
export function needsAcknowledgement(
  status: CampaignStatus,
  resultAckAt: UtcDate | null,
): boolean {
  return (
    (ACKNOWLEDGEABLE_STATUSES as readonly CampaignStatus[]).includes(status) &&
    resultAckAt === null
  );
}

/** Slovenské označenie stavu pre UI a audit (D14, I11). */
export const CAMPAIGN_STATUS_LABELS_SK: Readonly<Record<CampaignStatus, string>> = {
  draft: 'rozpracovaná',
  scheduled: 'naplánovaná',
  needs_key: 'čaká na kľúč',
  running: 'zapisuje sa',
  done: 'zapísaná',
  partial: 'čiastočne zapísaná',
  failed: 'zlyhala',
  missed: 'zmeškaná',
  cancelled: 'zrušená',
  lapsed: 'prepadnutá',
};

export const ITEM_STATUS_LABELS_SK: Readonly<Record<ItemStatus, string>> = {
  pending: 'čaká',
  skipped: 'preskočený',
  ok: 'zapísaný',
  failed: 'zlyhal',
  uncertain: 'neistý výsledok',
  interrupted: 'prerušený',
  not_found: 'produkt nenájdený',
  blocked: 'zablokovaný',
};
