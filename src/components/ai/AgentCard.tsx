/**
 * Aura Zľavy — V3: karta „Agent" (plán 33 §4, sekcia C3 — mimo tohto sprintu).
 *
 * LLM agent zatiaľ neexistuje a karta to hovorí na rovinu: čo by robil, čo
 * vyžaduje jeho konfigurácia a čo NIKDY robiť nebude — zapisovať sám. Návrh
 * agenta by vždy skončil ako koncept a prešiel dry-run potvrdením (I3).
 */

export function AgentCard() {
  return (
    <section className="ovl-card ovl-view-in" data-testid="ai-agent-card" aria-disabled="true">
      <div className="ovl-spread" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Agent</h2>
        <span className="ovl-badge ovl-badge--idle">
          <span className="ovl-badge-glyph" aria-hidden="true">
            ○
          </span>
          vyžaduje konfiguráciu
        </span>
      </div>

      <p className="ovl-small" style={{ margin: '0.75rem 0 0.5rem' }}>
        Jazykový agent, ktorý by zistenia komentoval a navrhoval kampane v prirodzenom jazyku.
        Pred zapnutím treba rozhodnúť a nastaviť:
      </p>
      <ul className="ovl-small" style={{ margin: 0, paddingLeft: '1.25rem' }}>
        <li>model a poskytovateľa,</li>
        <li>API kľúč modelu — ďalší secret s vlastnou platnosťou, uložený ako doterajšie kľúče,</li>
        <li>čo smie čítať (vlastná DB a cache katalógu; nič zo shopu navyše).</li>
      </ul>
      <p className="ovl-small ovl-muted" style={{ margin: '0.75rem 0 0' }}>
        Agent NIKDY nebude zapisovať sám: každý jeho návrh končí ako koncept kampane a prechádza
        rovnakým dry-run náhľadom a potvrdením ako ručný zápis.
      </p>
    </section>
  );
}

export default AgentCard;
