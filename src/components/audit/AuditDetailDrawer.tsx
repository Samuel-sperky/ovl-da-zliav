'use client';

/**
 * Aura Zľavy — detail jedného záznamu histórie (V12; pôvodne A16).
 *
 * Dve úrovne, presne podľa pravidla „technika ide pod rozklik":
 *
 *  1. **Hore, po ľudsky.** Kedy, čo sa stalo, kto, ako to dopadlo — a keď sa
 *     cena medzi potvrdením a zápisom zmenila, výslovné priznanie, že
 *     rozhodnutie padlo nad inou cenou. Percento sa zapísalo správne, ale
 *     výsledná cena je iná, než akú používateľ videl. Tento príznak sa NESMIE
 *     potichu zahodiť ani schovať medzi ostatné údaje.
 *  2. **Pod rozklikom „Technický detail".** Vnútorný kód udalosti, čísla
 *     produktu a zľavy, odpoveď eshopu, korelačné identifikátory a snímky
 *     pred/po. Sem technika patrí a smie tu byť surová.
 *
 * Záznam je append-only — drawer nemá ani jednu akciu, ktorá by ho menila.
 */
import { useEffect, useState } from 'react';

import Button from '@/components/ui/Button';
import Drawer from '@/components/ui/Drawer';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { formatDateTimeSk } from '@/lib/ui/format';
import {
  AUDIT_ACTOR_LABELS,
  auditEventLabel,
  getAuditDetail,
  type AuditDetail,
} from '@/components/audit/api';

function Snapshot({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="stack" style={{ gap: '0.2rem' }}>
      <strong className="lvl-3">{title}</strong>
      {value == null ? (
        <span className="lvl-3">nič sa neuložilo</span>
      ) : (
        <pre className="mono" style={{ overflowX: 'auto', fontSize: '11.5px' }}>
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
      title="Záznam histórie"
      subtitle="Zapísaný natrvalo — upraviť ani zmazať sa nedá."
      testId="audit-detail-drawer"
      footer={
        <Button small onClick={onClose} data-testid="audit-detail-close">
          Zavrieť
        </Button>
      }
    >
      <div className="stack">
        {error ? <ErrorMessage message={error} /> : null}
        {detail === null && error === null ? (
          <div className="ovl-skeleton" style={{ minHeight: '6rem' }} aria-busy="true" />
        ) : null}
        {detail ? (
          <div className="stack">
            {detail.priceMismatch ? (
              <p className="flag" data-testid="audit-price-mismatch">
                Rozhodoval si nad inou cenou — cena produktu sa medzi potvrdením
                a zápisom zmenila. Percento sa zapísalo správne, ale výsledná
                zľavnená cena je iná, než akú si videl pri potvrdení.
              </p>
            ) : null}

            <div className="kv">
              <span className="k">Kedy</span>
              <span className="v">{formatDateTimeSk(detail.ts)}</span>
              <span />
              <span className="k">Čo sa stalo</span>
              <span className="v">
                {detail.message === null || detail.message.trim() === ''
                  ? auditEventLabel(detail.eventType)
                  : detail.message}
              </span>
              <span />
              <span className="k">Kto</span>
              <span className="v">{AUDIT_ACTOR_LABELS[detail.actor] ?? 'appka'}</span>
              <span />
              <span className="k">Ako to dopadlo</span>
              <span className="v">
                {detail.ok === null
                  ? 'nevieme'
                  : detail.ok
                    ? 'podarilo sa'
                    : 'nepodarilo sa'}
              </span>
              <span />
            </div>

            <details className="tech">
              <summary>Technický detail</summary>
              <div className="body">
                <table>
                  <tbody>
                    <tr>
                      <td>Záznam</td>
                      <td className="mono">{`#${detail.id} · ${detail.eventType} · ${detail.actor}`}</td>
                    </tr>
                    <tr>
                      <td>Produkt a zľava</td>
                      <td className="mono">
                        {`${detail.productId ?? '—'} / ${detail.campaignId ?? '—'}`}
                      </td>
                    </tr>
                    <tr>
                      <td>Odpoveď eshopu</td>
                      <td className="mono">{detail.httpStatus ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>Korelácia</td>
                      <td className="mono">
                        {`${detail.operationId ?? '—'} / ${detail.requestId ?? '—'}`}
                      </td>
                    </tr>
                    <tr>
                      <td>Odkiaľ</td>
                      <td className="mono">{detail.ip ?? '—'}</td>
                    </tr>
                  </tbody>
                </table>
                <Snapshot title="Stav pred" value={detail.beforeSnapshot} />
                <Snapshot title="Stav po" value={detail.afterSnapshot} />
              </div>
            </details>

            <p className="set-note">
              Uložené je to, čo appka poslala a čo dostala. Nie je to dôkaz
              o tom, ako zľava vyzerá v eshope teraz — to appka zistiť nevie.
            </p>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

export default AuditDetailDrawer;
