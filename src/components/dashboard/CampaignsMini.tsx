'use client';

/**
 * Aura Zľavy — mini prehľad kampaní na dashboarde (D1, D14).
 */
import Link from 'next/link';

import StatusBadge from '@/components/ui/StatusBadge';
import Table, { type TableColumn } from '@/components/ui/Table';
import { formatDateSk } from '@/lib/ui/format';
import type { CampaignRow } from '@/components/dashboard/api';

export function CampaignsMini({ campaigns }: { campaigns: readonly CampaignRow[] }) {
  const columns: TableColumn<CampaignRow>[] = [
    {
      key: 'name',
      header: 'Kampaň',
      render: (c) => <Link href={`/kampane/${c.id}`}>{c.name}</Link>,
    },
    {
      key: 'status',
      header: 'Stav',
      render: (c) => <StatusBadge status={c.status} derived={c.derivedView ?? null} />,
    },
    { key: 'percent', header: 'Zľava', numeric: true, render: (c) => `−${c.percent} %` },
    {
      key: 'window',
      header: 'Okno',
      render: (c) => `${formatDateSk(c.dateFrom)} – ${formatDateSk(c.dateTo)}`,
    },
    {
      key: 'items',
      header: 'Produkty',
      numeric: true,
      render: (c) => `${c.itemsOk}/${c.itemsTotal}`,
    },
  ];

  return (
    <section className="ovl-card ovl-span-2" data-testid="campaigns-mini">
      <div className="ovl-spread">
        <h2>Posledné kampane</h2>
        <Link href="/kampane" className="ovl-small">
          všetky kampane →
        </Link>
      </div>
      <Table
        columns={columns}
        rows={campaigns}
        rowKey={(c) => c.id}
        emptyLabel="Zatiaľ žiadne kampane. Prvú vytvoríš v sekcii Kampane."
      />
    </section>
  );
}

export default CampaignsMini;
