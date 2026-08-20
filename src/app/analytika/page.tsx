/**
 * Aura Zľavy — `/analytika` → `/` (V13; kontrakt V3 K9).
 *
 * Analytika prestala byť samostatný tab. Jej obsah sa rozdelil medzi dva
 * z nových štyroch tabov: tržby a stav eshopu sú v Prehľade, výkon konkrétnej
 * zľavy je v jej detaile (tab Zľavy). Nič sa neschovalo — len prestalo mať
 * vlastnú adresu.
 *
 * Cesta zostáva, lebo odkazy v poznámkach a v histórii prehliadača sa nesmú
 * zlomiť. Vedie na Prehľad, ktorý je z dvoch nových domovov analytiky ten
 * všeobecnejší: odpovedá na „ako sa darí", nie na „ako dopadla tá jedna zľava".
 *
 * Kotva `#audit` sa sem už nesmeruje — audit má vlastnú starú cestu `/audit`,
 * ktorá vedie rovno do Nastavení. Prehliadač síce fragment zo starej adresy
 * prenesie aj na novú (`/analytika#audit` → `/#audit`), ale Prehľad taký prvok
 * nemá, takže sa nikam neposunie a nič sa nerozbije.
 *
 * Vlastník: V13.
 */
import { redirect } from 'next/navigation';

export default function AnalyticsRedirect(): never {
  redirect('/');
}
