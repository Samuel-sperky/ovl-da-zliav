'use client';

/**
 * Aura Zľavy — audit stopa kampane (D18, §5).
 *
 * Čisto čítacie zobrazenie audit záznamov z `GET /api/campaigns/[id]`.
 * Snapshoty sem neprichádzajú — plný detail je v /audit (A16).
 */
import type { AuditTrailRow } from '@/components/campaigns/api';
import Table, { type TableColumn } from '@/components/ui/Table';
import { formatDateTimeSk } from '@/lib/ui/format';

export interface AuditTrailProps {
  rows: AuditTrailRow[];
}

export function AuditTrail({ rows }: AuditTrailProps) {
  const columns: TableColumn<AuditTrailRow>[] = [
    { key: 'ts', header: 'Čas', render: (r) => formatDateTimeSk(r.ts) },
    { key: 'actor', header: 'Aktér', render: (r) => r.actor },
    {
      key: 'event',
      header: 'Udalosť',
      render: (r) => <code className="ovl-small">{r.eventType}</code>,
    },
    {
      key: 'ok',
      header: 'Výsledok',
      render: (r) =>
        r.ok == null ? (
          <span className="ovl-muted">—</span>
        ) : r.ok ? (
          <span className="ovl-badge ovl-badge--ok">ok</span>
        ) : (
          <span className="ovl-badge ovl-badge--danger">chyba</span>
        ),
    },
    {
      key: 'product',
      header: 'Produkt',
      numeric: true,
      render: (r) => (r.productId != null ? `#${r.productId}` : '—'),
    },
    {
      key: 'message',
      header: 'Správa',
      render: (r) => (
        <span className="ovl-small">
          {r.message ?? '—'}
          {r.httpStatus != null ? <span className="ovl-muted"> (HTTP {r.httpStatus})</span> : null}
        </span>
      ),
    },
  ];

  return (
    <section data-testid="audit-trail">
      <h2>Audit stopa</h2>
      <Table columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel="Žiadne audit záznamy." />
    </section>
  );
}

export default AuditTrail;
