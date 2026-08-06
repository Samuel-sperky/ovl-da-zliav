'use client';

/**
 * Aura Zľavy — karta „Zistenia" AI agenta V1 (plán 33 §4, sekcia C3).
 *
 * Číta `GET /api/ai/insights` (read-only, deterministické pravidlá — žiadne
 * LLM). Každé zistenie: jedna veta + odkaz + odporúčaná akcia. Akcia
 * s predvyplnením otvára drawer novej kampane, kde platí plný dvojkrok
 * s dry-run potvrdením — analytik sám nikdy nič nezapisuje.
 */
import { useEffect, useState } from 'react';

import type { Finding } from '@/lib/ai/rules';

import { getJson } from '@/components/campaigns/api';
import EmptyState from '@/components/ui/EmptyState';
import ToneBadge from '@/components/ui/ToneBadge';
import { formatDateTimeSk } from '@/lib/ui/format';

interface InsightsResponse {
  engine: string;
  generatedAt: string;
  today: string;
  findings: Finding[];
}

export function InsightsCard() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void getJson<InsightsResponse>('/api/ai/insights').then((res) => {
      if (res.ok) setData(res.data);
      else setFailed(true);
    });
  }, []);

  return (
    <section className="ovl-card ovl-view-in" data-testid="ai-insights-card">
      <div className="ovl-spread" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Zistenia</h2>
        {data ? (
          <span className="ovl-small ovl-muted">
            vygenerované {formatDateTimeSk(data.generatedAt)} · pravidlový analytik, bez LLM
          </span>
        ) : null}
      </div>
      <p className="ovl-small ovl-muted" style={{ margin: '0.25rem 0 0.75rem' }}>
        Deterministické pravidlá nad vlastnými zápismi appky a cache katalógu — nič z toho nie je
        stav shopu ani predajnosť. Odporúčania len predvyplnia návrh; zápis vždy prejde dry-run
        náhľadom a potvrdením.
      </p>

      {failed ? (
        <p className="ovl-error" role="alert">
          Zistenia sa nepodarilo načítať. Skús obnoviť stránku.
        </p>
      ) : data == null ? (
        <div className="ovl-skeleton" style={{ minHeight: '6rem' }} aria-busy="true" />
      ) : data.findings.length === 0 ? (
        <EmptyState title="Žiadne zistenia">
          Kampane majú nadväznosť, nič nečaká na zásah a produkty allowlistu majú čerstvé vlastné
          zápisy.
        </EmptyState>
      ) : (
        <ul className="ovl-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: '0.6rem' }}>
          {data.findings.map((f) => (
            <li
              key={f.id}
              className="ovl-row"
              style={{ gap: '0.6rem', alignItems: 'flex-start', flexWrap: 'wrap' }}
              data-testid={`finding-${f.kind}`}
            >
              <ToneBadge tone={f.tone === 'attention' ? 'attention' : 'idle'}>
                {f.tone === 'attention' ? 'zásah' : 'návrh'}
              </ToneBadge>
              <span className="ovl-small" style={{ flex: '1 1 18rem' }}>
                {f.text} <a href={f.href}>Zobraziť</a>
              </span>
              {f.action ? (
                <a className="ovl-btn ovl-btn--small" href={f.action.href}>
                  {f.action.label}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default InsightsCard;
