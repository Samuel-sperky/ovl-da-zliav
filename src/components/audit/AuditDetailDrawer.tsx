'use client';

/**
 * Aura Zľavy — detail audit záznamu (A16, D18, D39c, I1, I11).
 *
 * Zobrazuje `before_snapshot` / `after_snapshot` tak, ako prišli zo servera
 * (už redigované, I1) a pri nezhode `price_at_preview` vs `price_at_write`
 * viditeľný príznak „rozhodoval si nad inou cenou" (odchýlka D39c).
 * KISS (plán 33): detail žije v draweri sprava (C1 `Drawer`), nie v modáli.
 */
import { useEffect, useState } from 'react';

import Button from '@/components/ui/Button';
import Drawer from '@/components/ui/Drawer';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { formatDateTimeSk } from '@/lib/ui/format';
import { getAuditDetail, type AuditDetail } from '@/components/audit/api';

function Snapshot({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="ovl-stack" style={{ gap: '0.2rem' }}>
      <strong className="ovl-small">{title}</strong>
      {value == null ? (
        <span className="ovl-small ovl-muted">bez snapshotu</span>
      ) : (
        <pre className="ovl-mono ovl-small" style={{ overflowX: 'auto' }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

export interface AuditDetailDrawerProps {
  auditId: number;
  onClose: () => void;
}

export function AuditDetailDrawer({ auditId, onClose }: AuditDetailDrawerProps) {
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getAuditDetail(auditId);
      if (cancelled) return;
      if (res.ok) {
        setDetail(res.data);
        setError(null);
      } else {
        setDetail(null);
        setError(res.error.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auditId]);

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Audit záznam #${auditId}`}
      subtitle="Append-only — záznam sa nedá upraviť ani zmazať."
      testId="audit-detail-drawer"
      footer={
        <Button small onClick={onClose} data-testid="audit-detail-close">
          Zavrieť
        </Button>
      }
    >
      <div className="ovl-stack">
        {error ? <ErrorMessage message={error} /> : null}
        {detail === null && error === null ? (
          <div className="ovl-skeleton" style={{ minHeight: '6rem' }} aria-busy="true" />
        ) : null}
        {detail ? (
          <div className="ovl-stack">
            {detail.priceMismatch ? (
              <p
                className="ovl-badge ovl-badge--warning"
                data-testid="audit-price-mismatch"
              >
                Rozhodoval si nad inou cenou — cena produktu sa medzi dry-runom
                a zápisom zmenila. Percento sa zapísalo správne, ale výsledná
                zľavnená cena je iná, než akú si videl pri potvrdení.
              </p>
            ) : null}
            <div className="ovl-small">
              <div>čas: {formatDateTimeSk(detail.ts)}</div>
              <div>
                typ: <code>{detail.eventType}</code> · aktér: {detail.actor} · výsledok:{' '}
                {detail.ok === null ? 'neurčené' : detail.ok ? 'OK' : 'chyba'}
              </div>
              <div>
                produkt: {detail.productId ?? '—'} · kampaň: {detail.campaignId ?? '—'} · HTTP:{' '}
                {detail.httpStatus ?? '—'}
              </div>
              <div>
                operationId: <code>{detail.operationId ?? '—'}</code> · requestId:{' '}
                <code>{detail.requestId ?? '—'}</code>
              </div>
              {detail.message ? <div>hláška: {detail.message}</div> : null}
            </div>
            <Snapshot title="Snapshot PRED operáciou" value={detail.beforeSnapshot} />
            <Snapshot title="Snapshot PO operácii" value={detail.afterSnapshot} />
            <p className="ovl-small ovl-muted">
              Snapshoty sú zápis toho, čo appka poslala a čo dostala. Nie sú
              dôkazom o aktuálnom stave zľavy v shope — ten appka nevie zistiť.
            </p>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

export default AuditDetailDrawer;
