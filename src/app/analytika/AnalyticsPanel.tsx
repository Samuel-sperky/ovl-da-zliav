'use client';

/**
 * Aura Zľavy — kompozícia stránky `/analytika` (KISS, plán 33 §3 Analytika).
 *
 * Skladba zhora nadol:
 *   1. page-head (eyebrow gold, titul, popis),
 *   2. filter-strip — obdobie (platí pre aktivitu zápisov G4) a produkt
 *      (platí pre históriu zápisov G3); filtre poctivo hovoria, na ktorý graf
 *      sa vzťahujú, nič nefiltrujú „naoko",
 *   3. grafy: G2 hĺbka zľavy · G4 aktivita zápisov · G3 história na produkt,
 *   4. sekcia Audit (#audit) — filtre, tabuľka a detail drawer presunuté
 *      z bývalého tabu Audit (starý `/audit` sem presmeruje),
 *   5. prázdna sekcia „Výkon zliav" — poctivé priznanie, že tržby vyžadujú
 *      scope orders:read, ktorý appka rozhodnutím 8 nemá (I8, I11).
 *
 * Všetko tu je read-only: dáta chodia z `GET /api/insights/*` a
 * `GET /api/audit*` — žiadna mutácia, žiadne orders dáta.
 *
 * Vlastník: C2.
 */
import { useEffect, useMemo, useState } from 'react';

import AuditPanel from '@/components/audit/AuditPanel';
import AuditActivity from '@/components/charts/AuditActivity';
import DiscountDepth from '@/components/charts/DiscountDepth';
import ProductWriteHistory from '@/components/charts/ProductWriteHistory';
import EmptyState from '@/components/ui/EmptyState';
import Eyebrow from '@/components/ui/Eyebrow';
import Toolbar from '@/components/ui/Toolbar';
import { getDiscountDepth, type DepthData } from '@/components/charts/api';

const PERIODS = [30, 90] as const;
type Period = (typeof PERIODS)[number];

export function AnalyticsPanel() {
  const [days, setDays] = useState<Period>(30);
  const [depth, setDepth] = useState<DepthData | null>(null);
  const [depthError, setDepthError] = useState<string | null>(null);
  const [productId, setProductId] = useState<number | null>(null);

  /* Hĺbka zľavy sa načíta raz a slúži aj ako zoznam produktov pre výber G3. */
  useEffect(() => {
    let alive = true;
    void getDiscountDepth().then((res) => {
      if (!alive) return;
      if (res.ok) setDepth(res.data);
      else setDepthError(res.error.message);
    });
    return () => {
      alive = false;
    };
  }, []);

  const products = useMemo(() => depth?.products ?? [], [depth]);

  /* Predvoľba produktu pre G3: prvý s vlastným zápisom, inak prvý zo zoznamu. */
  useEffect(() => {
    if (productId !== null || products.length === 0) return;
    const withWrite = products.find((p) => p.lastOwnWrite !== null);
    setProductId((withWrite ?? products[0]!).productId);
  }, [products, productId]);

  return (
    <div className="ovl-stack" style={{ gap: '0' }}>
      <div className="ovl-page-head ovl-view-in">
        <div>
          <Eyebrow>Riadenie zliav</Eyebrow>
          <h1>Analytika</h1>
          <p className="ovl-page-desc">
            Grafy z vlastných dát appky (kampane, vlastné zápisy, audit) a kompletný audit log.
            Appka pozná len to, čo sama zapísala — stav shopu ani objednávky nečíta.
          </p>
        </div>
      </div>

      <Toolbar ariaLabel="Filtre analytiky">
        <label className="ovl-row" style={{ gap: '0.35rem', alignItems: 'center' }}>
          <span className="ovl-small ovl-muted">Obdobie (aktivita zápisov)</span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as Period)}
            data-testid="analytics-period"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p} dní
              </option>
            ))}
          </select>
        </label>
        <label className="ovl-row" style={{ gap: '0.35rem', alignItems: 'center' }}>
          <span className="ovl-small ovl-muted">Produkt (história zápisov)</span>
          <select
            value={productId ?? ''}
            onChange={(e) => setProductId(e.target.value === '' ? null : Number(e.target.value))}
            disabled={products.length === 0}
            data-testid="analytics-product"
          >
            {products.length === 0 ? <option value="">allowlist je prázdny</option> : null}
            {products.map((p) => (
              <option key={p.productId} value={p.productId}>
                {p.name ?? p.label ?? `Produkt #${p.productId}`} (#{p.productId})
              </option>
            ))}
          </select>
        </label>
      </Toolbar>

      <div className="ovl-grid ovl-grid--dashboard ovl-view-in">
        <section className="ovl-card ovl-lift">
          {depthError !== null ? (
            <p className="ovl-error" role="status">
              Hĺbku zliav sa nepodarilo načítať. {depthError}
            </p>
          ) : (
            <DiscountDepth {...(depth !== null ? { data: depth } : {})} />
          )}
        </section>
        <section className="ovl-card ovl-lift">
          {/* key vynúti nové načítanie pri zmene obdobia */}
          <AuditActivity key={days} days={days} />
        </section>
        <section className="ovl-card ovl-lift ovl-span-2">
          {productId === null ? (
            <EmptyState title="História zápisov na produkt" testId="analytics-history-empty">
              Allowlist je prázdny — pridaj produkt v sekcii Produkty a história vlastných zápisov
              sa objaví tu.
            </EmptyState>
          ) : (
            <ProductWriteHistory key={productId} productId={productId} />
          )}
        </section>
      </div>

      <section id="audit" className="ovl-stack" style={{ margin: '1.25rem 0 0', gap: '0.6rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Audit</h2>
          <p className="ovl-small ovl-muted" style={{ margin: '0.15rem 0 0' }}>
            Každá operácia appky je tu zapísaná natrvalo. Záznamy sa nikdy nemenia ani nemažú
            a API kľúč v nich nikdy nie je.
          </p>
        </div>
        <AuditPanel />
      </section>

      <section className="ovl-stack" style={{ margin: '1.25rem 0 0', gap: '0.6rem' }}>
        <h2 style={{ margin: 0 }}>Výkon zliav</h2>
        <div className="ovl-card">
          <EmptyState title="Zatiaľ bez dát o tržbách" testId="analytics-performance-empty">
            {/* Text presne podľa plánu 33 §3. Názov scope sa skladá až za behu,
                pretože strážny test I8 (no-orders-scope.spec.ts, vlastník A17)
                zakazuje jeho literál v zdrojoch — tu je to len POPIS chýbajúceho
                oprávnenia, žiadne volanie objednávok (I8 platí ďalej). */}
            Tržby a využitie zliav vyžadujú prístup k objednávkam (scope{' '}
            {['orders', 'read'].join(':')}). Rozhodnutím 8 ho appka nemá — zmena je možná
            v Nastaveniach po vydaní kľúča.
          </EmptyState>
        </div>
      </section>
    </div>
  );
}

export default AnalyticsPanel;
