/**
 * Aura Zľavy — SNÍMKOVAČ: dátumy fixtúr, počítané od dneška.
 *
 * Fixtúry sa nesmú viazať na pevný deň. Keby v nich stál napevno august 2026,
 * o mesiac by na každej snímke stálo „skončila" a snímky by ukazovali mŕtvu
 * appku namiesto živej. Všetko sa preto počíta od dňa, v ktorom snímkovač
 * beží.
 *
 * Vlastník: snímkovač (`scripts/snimky.ts`).
 */

/** `YYYY-MM-DD` posunuté o `dni` od dneška (lokálny čas). */
export function den(dni: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + dni);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** ISO okamih posunutý o `minut` od teraz. */
export function okamih(minut: number): string {
  return new Date(Date.now() + minut * 60_000).toISOString();
}

/** `Date` posunutý o `minut` od teraz. */
export function chvila(minut: number): Date {
  return new Date(Date.now() + minut * 60_000);
}

/** Dnešok ako `YYYY-MM-DD`. */
export const DNES = den(0);
