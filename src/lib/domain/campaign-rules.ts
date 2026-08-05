/**
 * Aura Zľavy — pravidlá kampaní (A7, D25, D27–D30, I9).
 *
 * Čisté funkcie nad kalendárnymi dňami a zoznamami kampaní, ktoré doniesol
 * volajúci (repozitáre = A8). Žiadna DB, žiadna sieť, žiadne `process.env`.
 *
 * Invarianty držané tu:
 *  - **I9** — percento, `to ≥ from`, `from ≥ dnes` a okno ≤ 3 kalendárne
 *    mesiace sa validujú LOKÁLNE pred akýmkoľvek volaním shop API.
 *  - **D28** — prekryv dvoch BUDÚCICH kampaní na tom istom produkte je
 *    blokovaný pri vytváraní; prepis bežiacej/naplánovanej zľavy je povolený
 *    len explicitne (`kind='overwrite'`).
 *  - **D27** — predĺženie drží pôvodné `from` aj percento, mení len `to`
 *    dopredu; nad strop 3 mesiacov od pôvodného `from` sa dá ísť len vedomým
 *    prepisom (nová kampaň `kind='overwrite'` s novým `from`).
 *  - **D25** — pri dopálení: `to` v minulosti = prepadnutá bez zápisu;
 *    `from` v minulosti = posun na dnes (a posun ide do auditu — robí volajúci).
 *
 * Vlastník: A7.
 */
import { DOMAIN_ERROR_CODES, DomainError, type DomainIssue, issue, toDomainError } from '@/lib/domain/errors';
import {
  formatDateOnlySk,
  isAfter,
  isBefore,
  isSameOrBefore,
  isWithinMaxWindow,
  maxAllowedTo,
  parseDateOnly,
} from '@/lib/domain/dates';
import { isValidPercent, PERCENT_INVALID_MESSAGE } from '@/lib/domain/percent';
import type { CampaignKind, CampaignStatus, DateOnly, DiscountPercent } from '@/contracts';

/* ═══════════════════ 1. Validácia okna kampane (I9, D29, D30) ═════════════ */

export interface CampaignWindowInput {
  /** `YYYY-MM-DD` — začiatok okna. */
  from: DateOnly;
  /** `YYYY-MM-DD` — koniec okna (vrátane, D13). */
  to: DateOnly;
  /** Percento zľavy — celé číslo 1–30 (D11). */
  percent: DiscountPercent;
  /** Dnešný deň v Europe/Bratislava — dodáva volajúci (`todayInZone`). */
  today: DateOnly;
  /** `true`, keď používateľ potvrdil „naozaj 1 deň?" (D30). */
  oneDayAcknowledged?: boolean;
}

/**
 * Zozbiera VŠETKY porušenia lokálnej validácie (I9): percento 1–30,
 * `from ≥ dnes` (D30), `to ≥ from`, okno ≤ 3 kalendárne mesiace (D29)
 * a jednodňová zľava bez potvrdenia (D30). Prázdne pole = OK.
 */
export function validateCampaignWindow(input: CampaignWindowInput): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const { from, to, percent, today } = input;

  if (!isValidPercent(percent)) {
    issues.push(issue(DOMAIN_ERROR_CODES.percentInvalid, PERCENT_INVALID_MESSAGE, { percent }));
  }

  // Neplatný formát dátumu zastaví ostatné dátumové kontroly.
  try {
    parseDateOnly(from, 'dátum od');
    parseDateOnly(to, 'dátum do');
    parseDateOnly(today, 'dnešný deň');
  } catch (err) {
    if (err instanceof DomainError) {
      issues.push(issue(err.code, err.message, err.detail ? { ...err.detail } : undefined));
      return issues;
    }
    throw err;
  }

  if (isBefore(from, today)) {
    issues.push(
      issue(
        DOMAIN_ERROR_CODES.fromInPast,
        `Začiatok zľavy ${formatDateOnlySk(from)} je v minulosti — najskorší povolený začiatok je dnes (${formatDateOnlySk(today)}).`,
        { from, today },
      ),
    );
  }

  if (isBefore(to, from)) {
    issues.push(
      issue(
        DOMAIN_ERROR_CODES.toBeforeFrom,
        `Koniec zľavy ${formatDateOnlySk(to)} je pred jej začiatkom ${formatDateOnlySk(from)}.`,
        { from, to },
      ),
    );
  } else if (!isWithinMaxWindow(from, to)) {
    issues.push(
      issue(
        DOMAIN_ERROR_CODES.rangeTooLong,
        `Okno zľavy je dlhšie než 3 kalendárne mesiace — pre začiatok ${formatDateOnlySk(from)} je najneskorší povolený koniec ${formatDateOnlySk(maxAllowedTo(from))}.`,
        { from, to, maxTo: maxAllowedTo(from) },
      ),
    );
  } else if (from === to && input.oneDayAcknowledged !== true) {
    issues.push(
      issue(
        DOMAIN_ERROR_CODES.oneDayNotAcknowledged,
        `Zľava platí len jediný deň (${formatDateOnlySk(from)}). Potvrď „naozaj 1 deň?", ak je to zámer.`,
        { from, to },
      ),
    );
  }

  return issues;
}

/** Hádzajúca varianta — prvé porušenie letí ako `DomainError` (I9, fail-closed). */
export function assertCampaignWindow(input: CampaignWindowInput): void {
  const issues = validateCampaignWindow(input);
  if (issues.length > 0) throw toDomainError(issues[0] as DomainIssue);
}

/* ═══════════════ 2. Prekryv budúcich kampaní a prepis (D28) ═══════════════ */

/** Stavy, v ktorých kampaň „drží" produkt do budúcnosti (D28, D40). */
export const PLANNED_STATUSES = [
  'scheduled',
  'needs_key',
  'missed',
] as const satisfies readonly CampaignStatus[];

/** Minimálny výrez kampane potrebný na kontrolu prekryvu. */
export interface ExistingCampaignWindow {
  campaignId: number;
  productId: number;
  dateFrom: DateOnly;
  dateTo: DateOnly;
  status: CampaignStatus;
}

/** Dve UZAVRETÉ okná `[from, to]` sa prekrývajú (aj dotyk hrán je prekryv). */
export function windowsOverlap(
  aFrom: DateOnly,
  aTo: DateOnly,
  bFrom: DateOnly,
  bTo: DateOnly,
): boolean {
  return isSameOrBefore(aFrom, bTo) && isSameOrBefore(bFrom, aTo);
}

/** Kampaň je „budúca": plánovaný stav a jej okno ešte neskončilo. */
export function isFutureCampaign(c: ExistingCampaignWindow, today: DateOnly): boolean {
  return (
    (PLANNED_STATUSES as readonly CampaignStatus[]).includes(c.status) &&
    !isBefore(c.dateTo, today)
  );
}

/**
 * Nájde budúce kampane, ktorých okno sa prekrýva s novým oknom na tých istých
 * produktoch (D28). Neprázdny výsledok = blokátor pri vytváraní.
 */
export function findFutureOverlaps(
  productIds: readonly number[],
  from: DateOnly,
  to: DateOnly,
  existing: readonly ExistingCampaignWindow[],
  today: DateOnly,
): ExistingCampaignWindow[] {
  const ids = new Set(productIds);
  return existing.filter(
    (c) =>
      ids.has(c.productId) &&
      isFutureCampaign(c, today) &&
      windowsOverlap(from, to, c.dateFrom, c.dateTo),
  );
}

/** Hádzajúca varianta pre vytváranie kampane (D28 — blokované, nie warning). */
export function assertNoFutureOverlap(
  productIds: readonly number[],
  from: DateOnly,
  to: DateOnly,
  existing: readonly ExistingCampaignWindow[],
  today: DateOnly,
): void {
  const overlaps = findFutureOverlaps(productIds, from, to, existing, today);
  if (overlaps.length > 0) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.futureOverlap,
      'Na niektorých produktoch už existuje naplánovaná kampaň, ktorej okno sa s novým oknom prekrýva. Zruš pôvodnú kampaň alebo zmeň dátumy.',
      {
        overlaps: overlaps.map((c) => ({
          campaignId: c.campaignId,
          productId: c.productId,
          from: c.dateFrom,
          to: c.dateTo,
          status: c.status,
        })),
      },
    );
  }
}

/** Posledný vlastný zápis, podľa ktorého zľava „beží alebo je naplánovaná" (D28, I11). */
export interface OwnWriteWindow {
  productId: number;
  from: DateOnly;
  to: DateOnly;
}

/**
 * Produkty, kde podľa VLASTNEJ DB (nikdy nie podľa shopu, I11) zľava dnes beží
 * alebo ešte len začne — nová kampaň na ne musí byť explicitný prepis (D28).
 */
export function productsRequiringOverwrite(
  productIds: readonly number[],
  ownWrites: readonly OwnWriteWindow[],
  today: DateOnly,
): number[] {
  const ids = new Set(productIds);
  return [
    ...new Set(
      ownWrites
        .filter((w) => ids.has(w.productId) && !isBefore(w.to, today))
        .map((w) => w.productId),
    ),
  ];
}

/**
 * Nová zľava na produkt s bežiacou/naplánovanou zľavou je povolená VÝHRADNE
 * ako `kind='overwrite'` s diffom starý → nový v potvrdení (D28).
 */
export function assertOverwriteExplicit(
  kind: CampaignKind,
  productIds: readonly number[],
  ownWrites: readonly OwnWriteWindow[],
  today: DateOnly,
): void {
  if (kind === 'overwrite') return;
  const conflicted = productsRequiringOverwrite(productIds, ownWrites, today);
  if (conflicted.length > 0) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.overwriteRequired,
      'Na niektorých produktoch podľa vlastnej evidencie zľava beží alebo je naplánovaná. Nová zľava je možná len ako explicitné „prepísanie" s diffom starý → nový.',
      { productIds: conflicted },
    );
  }
}

/* ══════════════════════ 3. Sémantika predĺženia (D27) ═════════════════════ */

export interface ExtensionInput {
  /** Pôvodné `from` kampane — predĺženie ho NESMIE zmeniť. */
  originalFrom: DateOnly;
  /** Pôvodné percento — predĺženie ho NESMIE zmeniť (zmena = prepis). */
  originalPercent: DiscountPercent;
  /** Doterajšie `to`. */
  currentTo: DateOnly;
  /** Nové `to` — jediná vec, ktorú predĺženie mení. */
  newTo: DateOnly;
}

export type ExtensionCheck =
  | { ok: true; from: DateOnly; percent: DiscountPercent; to: DateOnly }
  | {
      ok: false;
      code: string;
      message: string;
      /** `true` = UI má ponúknuť PREPIS s novým `from` ako vedomú alternatívu (D27). */
      offerOverwrite: boolean;
    };

/**
 * Predĺženie = jeden `setReduction` s rovnakým `from`, rovnakým percentom
 * a novým `to` (D27). Nové `to` musí byť za doterajším a v strope 3 mesiacov
 * od PÔVODNÉHO `from`; nad strop sa dá ísť len vedomým prepisom.
 */
export function checkExtension(input: ExtensionInput): ExtensionCheck {
  const { originalFrom, currentTo, newTo } = input;
  parseDateOnly(originalFrom, 'pôvodný dátum od');
  parseDateOnly(currentTo, 'doterajší dátum do');
  parseDateOnly(newTo, 'nový dátum do');

  if (!isAfter(newTo, currentTo)) {
    return {
      ok: false,
      code: DOMAIN_ERROR_CODES.invalidExtension,
      message: `Predĺženie musí posunúť koniec dopredu — nové „do" ${formatDateOnlySk(newTo)} nie je za doterajším ${formatDateOnlySk(currentTo)}.`,
      offerOverwrite: false,
    };
  }

  if (!isWithinMaxWindow(originalFrom, newTo)) {
    return {
      ok: false,
      code: DOMAIN_ERROR_CODES.rangeTooLong,
      message: `Predĺžením by okno prekročilo 3 kalendárne mesiace od pôvodného začiatku ${formatDateOnlySk(originalFrom)} (strop je ${formatDateOnlySk(maxAllowedTo(originalFrom))}). Ak zľava má trvať dlhšie, použi vedomý prepis s novým začiatkom.`,
      offerOverwrite: true,
    };
  }

  return { ok: true, from: originalFrom, percent: input.originalPercent, to: newTo };
}

/** Hádzajúca varianta — pre route `/extend` (D27). */
export function assertExtension(input: ExtensionInput): {
  from: DateOnly;
  percent: DiscountPercent;
  to: DateOnly;
} {
  const res = checkExtension(input);
  if (!res.ok) {
    throw new DomainError(DOMAIN_ERROR_CODES.invalidExtension, res.message, {
      offerOverwrite: res.offerOverwrite,
      reason: res.code,
    });
  }
  return { from: res.from, percent: res.percent, to: res.to };
}

/* ═══════════════════ 4. Prepočet okna pri dopálení (D25) ══════════════════ */

export type FireWindowResolution =
  /** Okno je celé v minulosti (`to < dnes`) → `lapsed`, ŽIADNY zápis (D25). */
  | { action: 'lapse'; reason: string }
  /** `from` je v minulosti → posun na dnes; posun MUSÍ ísť do auditu (D25). */
  | { action: 'shift_from'; from: DateOnly; originalFrom: DateOnly; to: DateOnly }
  /** Okno je v poriadku — zapisuje sa s pôvodnými dátumami. */
  | { action: 'proceed'; from: DateOnly; to: DateOnly };

/**
 * Prepočet dátumov v momente fire/dopálenia (D25, D59). Volajúci (scheduler,
 * `/execute`) MUSÍ výsledok rešpektovať: `lapse` = žiadny zápis, `shift_from`
 * = zapísať posun do auditu (`campaign_from_shifted`) a `date_from_original`.
 */
export function resolveFireWindow(
  from: DateOnly,
  to: DateOnly,
  today: DateOnly,
): FireWindowResolution {
  parseDateOnly(from, 'dátum od');
  parseDateOnly(to, 'dátum do');
  parseDateOnly(today, 'dnešný deň');

  if (isBefore(to, today)) {
    return {
      action: 'lapse',
      reason: `Okno zľavy skončilo ${formatDateOnlySk(to)} — kampaň je prepadnutá a nič sa nezapíše.`,
    };
  }
  if (isBefore(from, today)) {
    return { action: 'shift_from', from: today, originalFrom: from, to };
  }
  return { action: 'proceed', from, to };
}
