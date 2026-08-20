/**
 * Aura Zľavy — `/ai-agent` → `/` (V13; kontrakt V3 K9).
 *
 * Samostatný tab AI agent zanikol. To, čo z neho reálne fungovalo — zistenia
 * z deterministických pravidiel nad vlastnými dátami (`/api/ai/insights`) —
 * sa rozpustilo do Prehľadu ako riadky „Návrhy": číslo, sloveso a jedno
 * tlačidlo. Nie karta, nie chatbot, nie vlastná obrazovka.
 *
 * Zamknutá obrátkovosť sa presťahovala do Nastavení → „Zamknuté funkcie",
 * kde je JEDINÉ miesto s vysvetlením, čo appke z eshopu chýba.
 *
 * Cesta zostáva ako presmerovanie, aby staré odkazy a záložky neskončili
 * na 404.
 *
 * Vlastník: V13.
 */
import { redirect } from 'next/navigation';

export default function AiAgentRedirect(): never {
  redirect('/');
}
