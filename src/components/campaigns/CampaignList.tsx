'use client';

/**
 * Aura Zľavy — zoznam kampaní s filtrom (D14, §8).
 *
 * Číta `GET /api/campaigns`; farebné badge cez `StatusBadge`, derivované
 * pohľady „aktívna"/„expirovaná" (§4) filtruje klient nad `status=done`.
 */
import { useCallback, useEffect, useState } from 'react';

import type { CampaignListRow, CampaignsPageData } from '@/components/campaigns/api';
import { getJson, todayDateOnly } from '@/components/campaigns/api';
import CampaignFilters, {
  filterToStatusQuery,
  type CampaignFilterValue,
} from '@/components/campaigns/CampaignFilters';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import Table, { type TableColumn } from '@/components/ui/Table';
import { formatDateSk, formatPercentSk } from '@/lib/ui/format';

/** Derivovaný UI pohľad z `done` + dátumov okna (§4, O1). */
export function deriveView(row: CampaignListRow): 'aktivna' | 'expirovana' | null {
  if (row.derivedView) return row.derivedView;
  if (row.status !== 'done') return null;
  const today = todayDateOnly();
  if (row.dateTo < today) return 'expirovana';
  if (row.dateFrom <= today) return 'aktivna';
  return null;
}

export function CampaignList() {
  const [filter, setFilter] = useState<CampaignFilterValue>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CampaignsPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const status = filterToStatusQuery(filter);
    const qs = new URLSearchParams({ page: String(page), perPage: '20' });
    if (status) qs.set('status', status);
    const res = await getJson<CampaignsPageData>(`/api/campaigns?${qs.toString()}`);
    if (res.ok) {
      setData(res.data);
      setFailed(false);
    } else {
      setFailed(true);
    }
    setLoading(false);
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  let rows = data?.data ?? [];
  if (filter === 'aktivna') rows = rows.filter((r) => deriveView(r) === 'aktivna');
  if (filter === 'expirovana') rows = rows.filter((r) => deriveView(r) === 'expirovana');

  const columns: TableColumn<CampaignListRow>[] = [
    {
      key: 'name',
      header: 'Kampaň',
      render: (r) => (
        <a href={`/kampane/${r.id}`}>
          {r.name} <span className="ovl-muted ovl-small">#{r.id}</span>
        </a>
      ),
    },
    {
      key: 'status',
      header: 'Stav',
      render: (r) => <StatusBadge status={r.status} derived={deriveView(r)} />,
    },
    { key: 'percent', header: 'Zľava', numeric: true, render: (r) => formatPercentSk(r.percent) },
    {
      key: 'window',
      header: 'Okno',
      render: (r) => `${formatDateSk(r.dateFrom)} – ${formatDateSk(r.dateTo)}`,
    },
    {
      key: 'mode',
      header: 'Režim',
      render: (r) => (r.mode === 'eager' ? 'okamžitý zápis' : 'plánovaný'),
    },
    {
      key: 'items',
      header: 'Položky (ok/zlyhané/spolu)',
      numeric: true,
      render: (r) => `${r.itemsOk}/${r.itemsFailed}/${r.itemsTotal}`,
    },
  ];

  return (
    <div className="ovl-stack" style={{ gap: '1rem' }} data-testid="campaign-list">
      <div className="ovl-spread">
        <CampaignFilters
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
        />
        <a className="ovl-btn ovl-btn--primary" href="/kampane/nova" data-testid="new-campaign-link">
          + Nová kampaň
        </a>
      </div>

      {loading && !data ? (
        <div className="ovl-card ovl-skeleton" style={{ minHeight: '8rem' }} aria-busy="true" />
      ) : failed && !data ? (
        <p className="ovl-error" role="alert">
          Kampane sa nepodarilo načítať. Skús obnoviť stránku.
        </p>
      ) : (
        <>
          <Table columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel="Žiadne kampane pre zvolený filter." />
          {data && data.total > data.perPage ? (
            <div className="ovl-row" style={{ gap: '0.5rem', alignItems: 'center' }}>
              <Button small disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← Predchádzajúca
              </Button>
              <span className="ovl-small ovl-muted">
                strana {data.page} / {Math.max(1, Math.ceil(data.total / data.perPage))}
              </span>
              <Button
                small
                disabled={data.page * data.perPage >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Ďalšia →
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default CampaignList;
