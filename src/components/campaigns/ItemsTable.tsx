'use client';

/**
 * Aura Zľavy — tabuľka položiek kampane (D15, D34, D36, D39c, I11).
 *
 * Per produkt ✓/✗/neistý so slovenskou hláškou a rozbaľovacím raw kódom.
 * Pri nezhode `price_at_preview` ↔ `price_at_write` zobrazuje príznak
 * „rozhodoval si nad inou cenou" (D39c) — a rovno DOPOČÍTA, aká cena z toho
 * vyšla (U7); dovtedy musel Samuel počítať ručne.
 *
 * Redizajn (V20): `preskočený` NIE JE chyba — je to potvrdený idempotentný
 * preskok (D36), takže sa kreslí neutrálnym tónom, nie ako červená chyba.
 * `nenájdený` a `prerušený` sú výstraha, nie zlyhanie shopu.
 */
import type { CampaignItemView } from '@/components/campaigns/api';
import ErrorMessage, { type ErrorTone } from '@/components/ui/ErrorMessage';
import PriceHint from '@/components/ui/PriceHint';
import StatusBadge from '@/components/ui/StatusBadge';
import Table, { type TableColumn } from '@/components/ui/Table';
import VariantWarning from '@/components/ui/VariantWarning';
import { formatEur } from '@/lib/ui/format';

/**
 * Stavy položky, ktoré akcia „Zopakovať zlyhané" zahrnie (D15, D16).
 *
 * Musí sedieť so serverom: `POST /api/campaigns/[id]/retry-failed` skladá sadu
 * ako `status !== 'ok' && status !== 'skipped'`. Kým tu bol `skipped` navyše,
 * klient poslal do dry-runu inú sadu, než akú server očakával — token potom
 * padol na `payload_mismatch`. `not_found` v zozname ZÁMERNE nie je (zapísať
 * sa nedá, D49) a UI to musí povedať vetou, nie mlčaním.
 */
export const RETRYABLE_ITEM_STATUSES = ['failed', 'uncertain', 'interrupted'] as const;

/** Stavy, ktoré opakovanie zámerne vynecháva a UI ich MUSÍ pomenovať (D34). */
export const RETRY_EXCLUDED_STATUSES = ['not_found'] as const;

export function retryableProductIds(items: CampaignItemView[]): number[] {
  return items
    .filter((it) => (RETRYABLE_ITEM_STATUSES as readonly string[]).includes(it.status))
    .map((it) => it.productId);
}

/** Položky, ktoré sa opakovať nedajú (nenájdené v shope) — pre vetu pod retry. */
export function retryExcludedItems(items: CampaignItemView[]): CampaignItemView[] {
  return items.filter((it) => (RETRY_EXCLUDED_STATUSES as readonly string[]).includes(it.status));
}

const TONE_BY_STATUS: Partial<Record<CampaignItemView['status'], ErrorTone>> = {
  skipped: 'info',
  pending: 'info',
  not_found: 'attention',
  uncertain: 'attention',
  interrupted: 'attention',
  blocked: 'attention',
};

export interface ItemsTableProps {
  items: CampaignItemView[];
  /** Percento kampane — dopočet ceny pri nezhode (D39c, U7). */
  percent?: number;
}

export function ItemsTable({ items, percent }: ItemsTableProps) {
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
      kind: 'money',
      render: (it) => (
        <div className="ovl-stack" style={{ gap: '0.15rem' }}>
          <span className="ovl-num">
            {formatEur(it.priceAtPreview)} → {formatEur(it.priceAtWrite)}
          </span>
          {it.priceMismatch ? (
            <span className="ovl-stack" style={{ gap: '0.1rem' }}>
              <span className="ovl-badge ovl-badge--attention" data-testid="price-mismatch">
                <span className="ovl-badge-glyph" aria-hidden="true">
                  ▲
                </span>
                rozhodoval si nad inou cenou
              </span>
              {percent != null ? (
                <span className="ovl-small ovl-muted">
                  potvrdené: <PriceHint price={it.priceAtPreview} percent={percent} /> · zapísané:{' '}
                  <PriceHint price={it.priceAtWrite} percent={percent} />
                </span>
              ) : null}
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
              Skutočný stav zľavy v shope sa cez API overiť nedá.
              {it.requestId ? (
                <>
                  {' '}
                  <span className="ovl-mono ovl-small">{it.requestId}</span>
                </>
              ) : null}
            </span>
          );
        }
        if (it.status === 'pending') return <span className="ovl-muted ovl-small">Čaká na zápis.</span>;
        return (
          <ErrorMessage
            message={it.errorMessage ?? itemStatusFallbackSk(it.status)}
            rawCode={it.errorCode}
            rawDetail={
              [
                it.httpStatus != null ? `HTTP ${it.httpStatus}` : null,
                it.requestId ? `request_id ${it.requestId}` : null,
              ]
                .filter(Boolean)
                .join('\n') || null
            }
            tone={TONE_BY_STATUS[it.status] ?? 'critical'}
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
      return 'Produkt sa v shope nenašiel — zapísať sa nedá, opakovanie ho vynechá.';
    case 'blocked':
      return 'Produkt bol zablokovaný pred zápisom (mimo allowlistu alebo fail-closed kontrola).';
    case 'skipped':
      return 'Preskočené — rovnaké parametre už mali potvrdený zápis, druhýkrát sa neposielali.';
    default:
      return 'Neznámy stav položky.';
  }
}

export default ItemsTable;
