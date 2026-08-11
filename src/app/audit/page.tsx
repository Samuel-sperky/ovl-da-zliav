/**
 * Aura Zľavy — `/audit` → `/nastavenia#historia` (V13; kontrakt V3 K9).
 *
 * Audit prestal byť samostatný tab už skôr; dovtedy viedla táto cesta do
 * Analytiky, ktorá medzitým zanikla tiež. Teraz vedie na svoje konečné
 * miesto: Nastavenia → „História a technický detail" (kotva `historia`).
 *
 * Audit sa presunom nezmenšil — má úplné filtre, stránkovanie aj detail
 * záznamu so snímkami. Zmenil sa iba rám, v ktorom žije.
 *
 * Presmerovanie nesie fragment priamo v cieľovej adrese, takže záložka na
 * `/audit` skončí presne pri histórii, nie na začiatku Nastavení.
 *
 * Vlastník: V13.
 */
import { redirect } from 'next/navigation';

export default function AuditRedirect(): never {
  redirect('/nastavenia#historia');
}
