'use client';

/**
 * Aura Zľavy — tabuľka audit logu (A16, D18).
 *
 * Riadok = jeden append-only záznam: čas, aktér, typ, výsledok, produkt,
 * kampaň, HTTP status, `requestId` a slovenská hláška. Klik na riadok otvorí
 * detail drawer so snapshotmi.
 */
import Button from '@/components/ui/Button';
import Table, { type TableColumn } from '@/components/ui/Table';
import { formatDateTimeSk } from '@/lib/ui/format';
import type { AuditRow } from '@/components/audit/api';

const ACTOR_LABELS: Record<AuditRow['actor'], string> = {
  user: 'používateľ',
  scheduler: 'scheduler',
  system: 'systém',
};

export interface AuditTableProps {
  rows: readonly AuditRow[];
  onSelect: (id: number) => void;
}

export function AuditTable({ rows, onSelect }: AuditTableProps) {
  const columns: TableColumn<AuditRow>[] = [
    { key: 'ts', header: 'Čas', render: (r) => formatDateTimeSk(r.ts) },
    { key: 'actor', header: 'Aktér', render: (r) => ACTOR_LABELS[r.actor] ?? r.actor },
    { key: 'eventType', header: 'Typ operácie', render: (r) => <code>{r.eventType}</code> },
    {
      key: 'ok',
      header: 'Výsledok',
      render: (r) =>
        r.ok === null ? (
          <span className="ovl-badge ovl-badge--neutral">neurčené</span>
        ) : r.ok ? (
          <span className="ovl-badge ovl-badge--ok">OK</span>
        ) : (
          <span className="ovl-badge ovl-badge--danger">chyba</span>
        ),
    },
    { key: 'productId', header: 'Produkt', numeric: true, render: (r) => r.productId ?? '—' },
    { key: 'campaignId', header: 'Kampaň', numeric: true, render: (r) => r.campaignId ?? '—' },
    { key: 'httpStatus', header: 'HTTP', numeric: true, render: (r) => r.httpStatus ?? '—' },
    {
      key: 'message',
      header: 'Hláška',
      render: (r) => <span className="ovl-small">{r.message ?? '—'}</span>,
    },
    {
      key: 'detail',
      header: 'Detail',
      render: (r) => (
        <Button small onClick={() => onSelect(r.id)} data-testid={`audit-detail-${r.id}`}>
          Zobraziť
        </Button>
      ),
    },
  ];

  return (
    <div data-testid="audit-table">
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyLabel="Žiadne audit záznamy pre zvolené filtre."
      />
    </div>
  );
}

export default AuditTable;
