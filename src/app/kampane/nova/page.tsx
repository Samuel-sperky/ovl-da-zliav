/**
 * Aura Zľavy — /kampane/nova: PRESMEROVANIE na drawer (KISS, plán 33 §3, §6).
 *
 * Samostatná stránka novej kampane sa ruší — nahrádza ju drawer na /kampane
 * (`?nova=1`). Dvojkrokový tok s dry-run potvrdením (I3) žije v draweri
 * bez zmeny; staré odkazy a záložky ďalej fungujú cez toto presmerovanie.
 */
import { redirect } from 'next/navigation';

export default function NewCampaignRedirect(): never {
  redirect('/kampane?nova=1');
}
