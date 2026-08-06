/**
 * Aura Zľavy — `/audit` → presmerovanie na `/analytika#audit` (KISS,
 * plán 33 §3/§6, sekcia C2).
 *
 * Samostatný tab Audit sa KISS-om ruší; obsah (filtre, tabuľka, detail
 * drawer) žije ako sekcia Audit v Analytike. Staré odkazy a záložky preto
 * nekončia na 404 — vedú presne na tú sekciu.
 */
import { redirect } from 'next/navigation';

export default function AuditRedirectPage() {
  redirect('/analytika#audit');
}
