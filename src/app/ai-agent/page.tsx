/**
 * Aura Zľavy — /ai-agent: tab AI agent (plán 33 §4, sekcia C3).
 *
 * Poctivý rozsah: V1 „Zistenia" (deterministické pravidlá nad vlastnými
 * dátami, bez LLM) + V2 zamknutá „Obrátkovosť" (presný zoznam chýbajúcich
 * dát) + V3 karta „Agent" (vyžaduje konfiguráciu). Nič na tejto stránke
 * nepredstiera dáta, ktoré appka nemá (I11), nič nezapisuje (I3) a nič
 * nesiaha na objednávky (I8).
 */
import type { Metadata } from 'next';

import AgentCard from '@/components/ai/AgentCard';
import InsightsCard from '@/components/ai/InsightsCard';
import TurnoverCard from '@/components/ai/TurnoverCard';
import Eyebrow from '@/components/ui/Eyebrow';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `AI agent — ${APP_DISPLAY_NAME}`,
};

export default function AiAgentPage() {
  return (
    <div className="ovl-w-wide">
      <div className="ovl-page-head ovl-view-in">
        <div>
          <Eyebrow>Riadenie zliav</Eyebrow>
          <h1>AI agent</h1>
          <p className="ovl-page-desc">
            Pravidlový analytik nad vlastnými dátami appky. Navrhuje — nikdy nezapisuje: každý
            návrh prechádza dry-run náhľadom a potvrdením.
          </p>
        </div>
      </div>

      <div className="ovl-stack" style={{ gap: '1rem' }}>
        <InsightsCard />
        {/* grid-halves predlohy — `.ovl-grid--halves` v B1 nie je, preto inline */}
        <div
          className="ovl-grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))' }}
        >
          <TurnoverCard />
          <AgentCard />
        </div>
      </div>
    </div>
  );
}
