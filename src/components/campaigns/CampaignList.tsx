'use client';

/**
 * Aura Zľavy — zoznam kampaní (D14, §8; KISS toolbar podľa plánu 33 §3).
 *
 * Toolbar predlohy: hľadanie (klient filtruje načítanú stranu podľa názvu
 * a #id) + filter stavu ako select. Tabuľka nesie stav s glyfom
 * (`StatusBadge`), %, okno, počet produktov a spustenie (`fireAt`).
 * Derivované pohľady „aktívna"/„expirovaná" (§4) filtruje klient nad
 * `status=done`. Prázdny stav v štýle predlohy s akciou otvárajúcou drawer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CampaignListRow, CampaignsPageData } from '@/components/campaigns/api';
import { getJson, todayDateOnly } from '@/components/campaigns/api';
import CampaignFilters, {
  filterToStatusQuery,
  type CampaignFilterValue,
} from '@/components/campaigns/CampaignFilters';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import Table, { type TableColumn } from '@/components/ui/Table';
import Toolbar from '@/components/ui/Toolbar';
import { formatDateSk, formatDateTimeSk, formatPercentSk } from '@/lib/ui/format';

/** Derivovaný UI pohľad z `done` + dátumov okna (§4, O1). */
export function deriveView(row: CampaignListRow): 'aktivna' | 'expirovana' | null {
  if (row.derived) return row.derived;
  if (row.status !== 'done') return null;
  const today = todayDateOnly();
  if (row.dateTo < today) return 'expirovana';
  if (row.dateFrom <= today) return 'aktivna';
  return null;
}

export interface CampaignListProps {
  /** Otvorenie drawera novej kampane (page-head aj prázdny stav). */
  onNewCampaign?: () => void;
  /** Zmena hodnoty vynúti refetch (napr. po vytvorení kampane v draweri). */
  refreshKey?: number;
}

export function CampaignList({ onNewCampaign, refreshKey = 0 }: CampaignListProps) {
  const [filter, setFilter] = useState<CampaignFilterValue>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CampaignsPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Sekvenčný token proti race: stará odpoveď NIKDY neprepíše novšiu
  // (rýchle prepínanie strán/filtrov).
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const status = filterToStatusQuery(filter);
    const qs = new URLSearchParams({ page: String(page), perPage: '20' });
    if (status) qs.set('status', status);
    const res = await getJson<CampaignsPageData>(`/api/campaigns?${qs.toString()}`);
    if (seq !== requestSeq.current) return; // medzitým odišla novšia požiadavka
    if (res.ok) {
      setData(res.data);
      setFailed(false);
    } else {
      setFailed(true);
    }
    setLoading(false);
    // `refreshKey` je zámerná závislosť — jeho zmena vynúti nový fetch.
  }, [filter, page, refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  let rows = data?.data ?? [];
  if (filter === 'aktivna') rows = rows.filter((r) => deriveView(r) === 'aktivna');
  if (filter === 'expirovana') rows = rows.filter((r) => deriveView(r) === 'expirovana');
  const needle = search.trim().toLowerCase();
  if (needle.length > 0) {
    rows = rows.filter(
      (r) => r.name.toLowerCase().includes(needle) || `#${r.id}`.includes(needle) || String(r.id) === needle,
    );
  }

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
      key: 'items',
      header: 'Produkty',
      numeric: true,
      render: (r) => (
        <span className="ovl-num">
          {r.itemsTotal}
          {r.itemsFailed > 0 ? (
            <span className="ovl-small ovl-muted"> ({r.itemsFailed} zlyh.)</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'fireAt',
      header: 'Spustenie',
      render: (r) =>
        r.fireAt ? (
          <span className="ovl-num ovl-small">{formatDateTimeSk(r.fireAt)}</span>
        ) : (
          <span className="ovl-muted ovl-small">
            {r.mode === 'eager' ? 'okamžitý zápis' : '—'}
          </span>
        ),
    },
  ];

  const filtersActive = needle.length > 0 || filter !== 'all';
  // Derivované pohľady (aktívna/expirovaná) filtruje KLIENT nad načítanou
  // stranou `status=done` — stránkovanie podľa serverového `total` by tu
  // ukazovalo prázdne strany a zlé počty, preto sa skrýva (poctivá verzia;
  // serverový filter je TODO pre vlastníka route `/api/campaigns`).
  const derivedFilter = filter === 'aktivna' || filter === 'expirovana';

  return (
    <div className="ovl-stack ovl-view-in" style={{ gap: '0.25rem' }} data-testid="campaign-list">
      <Toolbar
        ariaLabel="Hľadanie a filter kampaní"
        actions={
          filtersActive ? (
            <Button
              small
              onClick={() => {
                setSearch('');
                setFilter('all');
                setPage(1);
              }}
            >
              Vyčistiť filtre
            </Button>
          ) : undefined
        }
      >
        <span className="ovl-input-wrap">
          <span className="ovl-input-glyph" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            className="ovl-input--sm"
            placeholder="Hľadať kampaň…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="campaign-search"
          />
        </span>
        <CampaignFilters
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
        />
      </Toolbar>

      {loading && !data ? (
        <div className="ovl-card ovl-skeleton" style={{ minHeight: '8rem' }} aria-busy="true" />
      ) : failed && !data ? (
        <p className="ovl-error" role="alert">
          Kampane sa nepodarilo načítať. Skús obnoviť stránku.
        </p>
      ) : rows.length === 0 ? (
        <div className="ovl-card">
          <EmptyState
            title={filtersActive ? 'Žiadne kampane pre zvolený filter' : 'Zatiaľ žiadne kampane'}
            action={
              !filtersActive && onNewCampaign ? (
                <Button variant="primary" onClick={onNewCampaign}>
                  + Nová kampaň
                </Button>
              ) : undefined
            }
          >
            {filtersActive
              ? 'Skús zmeniť hľadanie alebo filter stavu.'
              : 'Prvá kampaň vzniká dvojkrokovo: výber a dry-run náhľad, až potom zápis.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            emptyLabel="Žiadne kampane pre zvolený filter."
          />
          {derivedFilter && data && data.total > data.perPage ? (
            <p className="ovl-small ovl-muted" style={{ marginTop: '0.75rem' }} data-testid="derived-filter-note">
              Filter aktívna/expirovaná sa vyhodnocuje len nad načítanými kampaňami — staršie
              zapísané kampane sa v tomto pohľade nemusia zobraziť.
            </p>
          ) : null}
          {!derivedFilter && data && data.total > data.perPage ? (
            <div className="ovl-row" style={{ gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
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
