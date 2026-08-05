'use client';

/**
 * Aura Zľavy — tabuľka položiek kampane (D15, D39c, I11).
 *
 * Per produkt ✓/✗/neistý so slovenskou hláškou a rozbaľovacím raw kódom
 * (`ErrorMessage`). Pri nezhode `price_at_preview` ↔ `price_at_write`
 * zobrazuje príznak „rozhodoval si nad inou cenou" (D39c).
 */
import type { CampaignItemView } from '@/components/campaigns/api';
import ErrorMessage from '@/components/ui/ErrorMessage';
import StatusBadge from '@/components/ui/StatusBadge';
import Table, { type TableColumn } from '@/components/ui/Table';
import VariantWarning from '@/components/ui/VariantWarning';
import { formatEur } from '@/lib/ui/format';

/** Stavy položky, ktoré akcia „Zopakovať zlyhané" zahrnie (D15, D16). */
export const RETRYABLE_ITEM_STATUSES = ['failed', 'uncertain', 'interrupted', 'skipped'] as const;

export function retryableProductIds(items: CampaignItemView[]): number[] {
  return items
    .filter((it) => (RETRYABLE_ITEM_STATUSES as readonly string[]).includes(it.status))
    .map((it) => it.productId);
}

export interface ItemsTableProps {
  items: CampaignItemView[];
}

export function ItemsTable({ items }: ItemsTableProps) {
  const columns: TableColumn<CampaignItemView>[] = [
    {
      key: 'product',
      header: 'Produkt',
      render: (it) => (
        <div className="ovl-stack" style={{ gap: '0.15rem' }}>
          <span>
            {it.nameAtWrite ?? <span className="ovl-muted">bez názvu</span>}{' '}
            <span className="ovl-muted ovl-small">#{it.productId}</span>
          </span>
          <VariantWarning hasAttributes={it.hasAttributes} />
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Výsledok',
      render: (it) => <StatusBadge itemStatus={it.status} />,
    },
    {
      key: 'price',
      header: 'Cena (náhľad → zápis)',
      render: (it) => (
        <div className="ovl-stack" style={{ gap: '0.15rem' }}>
          <span className="ovl-num">
            {formatEur(it.priceAtPreview)} → {formatEur(it.priceAtWrite)}
          </span>
          {it.priceMismatch ? (
            <span className="ovl-badge ovl-badge--warning" data-testid="price-mismatch">
              rozhodoval si nad inou cenou
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'detail',
      header: 'Detail',
      render: (it) => {
        if (it.status === 'ok') {
          return (
            <span className="ovl-small ovl-muted">
              Zápis potvrdený shopom{it.httpStatus != null ? ` (HTTP ${it.httpStatus})` : ''}.
              Skutočný stav zľavy v shope sa cez API nedá overiť (I11).
            </span>
          );
        }
        if (it.status === 'pending') return <span className="ovl-muted ovl-small">Čaká na zápis.</span>;
        return (
          <ErrorMessage
            message={it.errorMessage ?? itemStatusFallbackSk(it.status)}
            rawCode={it.errorCode}
            rawDetail={it.httpStatus != null ? `HTTP ${it.httpStatus}` : null}
          />
        );
      },
    },
  ];

  return (
    <Table
      columns={columns}
      rows={[...items].sort((a, b) => a.position - b.position)}
      rowKey={(it) => it.id}
      emptyLabel="Kampaň zatiaľ nemá položky."
    />
  );
}

/** Slovenská hláška, keď API neuložilo `errorMessage`. */
function itemStatusFallbackSk(status: CampaignItemView['status']): string {
  switch (status) {
    case 'failed':
      return 'Zápis zlyhal.';
    case 'uncertain':
      return 'Výsledok zápisu je neistý — shop mohol aj nemusel zľavu uložiť. Over v admine shopu.';
    case 'interrupted':
      return 'Zápis bol prerušený (reštart appky) — výsledok je neznámy.';
    case 'not_found':
      return 'Produkt sa v shope nenašiel.';
    case 'blocked':
      return 'Produkt bol zablokovaný pred zápisom (mimo allowlistu alebo fail-closed kontrola).';
    case 'skipped':
      return 'Položka bola preskočená (zápis sa zastavil skôr).';
    default:
      return 'Neznámy stav položky.';
  }
}

export default ItemsTable;
