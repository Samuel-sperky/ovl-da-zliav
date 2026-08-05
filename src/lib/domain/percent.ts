/**
 * Aura Zľavy — percento zľavy (A7, D11, I9).
 *
 * Percento je **celé číslo 1–30**. Desatinné hodnoty, stringy, `0`, `31`,
 * `NaN` aj `Infinity` sa odmietajú LOKÁLNE, pred akýmkoľvek volaním shop API
 * (I9) — spoliehať sa na 400 zo shopu je porušenie invariantu.
 *
 * `0` je v celej appke vyhradená VÝHRADNE pre sondu `probeKey` (D53) a nikdy
 * neprejde touto validáciou; sonda ju nesmie brať odtiaľto.
 *
 * Vlastník: A7.
 */
import { z } from 'zod';

import { DOMAIN_ERROR_CODES, DomainError } from '@/lib/domain/errors';
import type { DiscountPercent } from '@/contracts';

/** Dolná hranica percenta (D11). */
export const PERCENT_MIN = 1;
/** Horná hranica percenta (D11). */
export const PERCENT_MAX = 30;

/** Čipy pre rýchly výber v UI (D11). */
export const PERCENT_CHIPS: readonly number[] = [5, 10, 15, 20, 25, 30];

export const PERCENT_INVALID_MESSAGE =
  'Percento zľavy musí byť celé číslo od 1 do 30 (desatinné hodnoty nie sú prijímané).';

/**
 * Typový guard. `true` len pre skutočné celé číslo v rozsahu — takže `'15'`,
 * `12.5`, `0`, `31`, `NaN`, `Infinity` aj `null` prepadnú.
 */
export function isValidPercent(value: unknown): value is DiscountPercent {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= PERCENT_MIN &&
    value <= PERCENT_MAX
  );
}

/** Vráti percento alebo hodí `DomainError` s kódom `percent_invalid` (I9). */
export function assertPercent(value: unknown): DiscountPercent {
  if (!isValidPercent(value)) {
    throw new DomainError(DOMAIN_ERROR_CODES.percentInvalid, PERCENT_INVALID_MESSAGE, {
      value: typeof value === 'number' || typeof value === 'string' ? value : typeof value,
    });
  }
  return value;
}

/**
 * Zod schéma pre route vstupy (§5). Úmyselne bez `coerce`: `'15'` z JSON tela
 * je chyba klienta, nie hodnota na potichu opravenie (D11).
 */
export const percentSchema = z
  .number()
  .int(PERCENT_INVALID_MESSAGE)
  .min(PERCENT_MIN, PERCENT_INVALID_MESSAGE)
  .max(PERCENT_MAX, PERCENT_INVALID_MESSAGE);

/** Formát pre UI a auditné vety. */
export function formatPercentSk(value: DiscountPercent): string {
  return `${assertPercent(value)} %`;
}
