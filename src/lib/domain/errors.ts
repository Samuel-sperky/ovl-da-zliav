/**
 * Aura Zľavy — doménová chyba (A7).
 *
 * Doménové moduly sú **čisté funkcie**: nesmú vedieť nič o HTTP, DB ani logoch.
 * Preto majú vlastný typ chyby s kódom, ktorý si HTTP vrstva (A5 `toAppError`)
 * alebo route mapuje na status. Kód je stabilný identifikátor pre UI,
 * `message` je hotová slovenská veta pre používateľa.
 *
 * Invarianty držané tu:
 *  - **I1** — do `detail` sa nikdy nedáva nič citlivé; doména vidí len ID
 *    produktov, percentá a dátumy, nikdy kľúč ani payload.
 *  - **I9** — každé porušenie lokálnej validácie je chyba PRED volaním API,
 *    nikdy nie „nech to rozhodne shop".
 *
 * Vlastník: A7.
 */

/** Stabilné kódy doménových chýb (I9, D11, D29, D30, D83). */
export const DOMAIN_ERROR_CODES = {
  /** Percento nie je celé číslo 1–30 (D11, I9). */
  percentInvalid: 'percent_invalid',
  /** Dátum nie je platný `YYYY-MM-DD` kalendárny deň (D13). */
  invalidDateFormat: 'invalid_date_format',
  /** `from` je pred dnešným dňom v Europe/Bratislava (D30, I9). */
  fromInPast: 'from_in_past',
  /** `to < from` (I9). */
  toBeforeFrom: 'to_before_from',
  /** Okno je dlhšie než kalendárne 3 mesiace od `from` (D29, I9). */
  rangeTooLong: 'range_too_long',
  /** Jednodňová zľava bez dodatočného potvrdenia (D30). */
  oneDayNotAcknowledged: 'one_day_not_acknowledged',
  /** Na produkte už existuje budúca kampaň (D28). */
  futureOverlap: 'future_overlap',
  /** Prepis existujúcej/plánovanej zľavy musí byť explicitný `kind='overwrite'` (D28). */
  overwriteRequired: 'overwrite_required',
  /** Predĺženie musí posunúť `to` dopredu a nesmie meniť `from`/percento (D27). */
  invalidExtension: 'invalid_extension',
  /** Prechod stavového stroja nie je v tabuľke BUILD-SPEC §4 (D83). */
  invalidTransition: 'invalid_transition',
  /** Prechod do `running` bez `confirmed_at` + `confirm_payload_hash` (I3). */
  confirmationRequired: 'confirmation_required',
  /** `missed → running` bez NOVÉHO potvrdenia (D33b, I3). */
  freshConfirmationRequired: 'fresh_confirmation_required',
  /** Zápisové okno je zamrznuté ±60 s okolo polnoci (D59). */
  midnightFreeze: 'midnight_freeze',
  /** Cena z DB nie je platné desatinné číslo (§2). */
  invalidMoney: 'invalid_money',
} as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[keyof typeof DOMAIN_ERROR_CODES];

/** Chyba doménovej validácie. Nesie kód pre UI a slovenskú vetu. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly detail: Readonly<Record<string, unknown>> | undefined;

  constructor(code: DomainErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.detail = detail === undefined ? undefined : Object.freeze({ ...detail });
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/** Jedno zistenie validácie — používa sa tam, kde chceme VŠETKY chyby naraz. */
export interface DomainIssue {
  code: DomainErrorCode;
  message: string;
  detail?: Record<string, unknown>;
}

export function issue(
  code: DomainErrorCode,
  message: string,
  detail?: Record<string, unknown>,
): DomainIssue {
  return detail === undefined ? { code, message } : { code, message, detail };
}

export function toDomainError(i: DomainIssue): DomainError {
  return new DomainError(i.code, i.message, i.detail);
}
