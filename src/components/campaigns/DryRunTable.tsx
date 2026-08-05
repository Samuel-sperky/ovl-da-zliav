'use client';

/**
 * Aura Zľavy — dry-run diff tabuľka (D3, D4, D60, I11).
 *
 * Per produkt: názov, aktuálna cena, percento, okno, orientačná zľavnená
 * cena (VŽDY s upozornením — `PriceHint`), posledný vlastný zápis
 * (`SelfWriteBadge`, nikdy nie „stav shopu") a varovanie pri variantoch.
 * Raw JSON payloady sa tu NEVYKRESĽUJÚ (D3) — patria do auditu.
 */
import type { PreviewBlockerView, PreviewItemView, PreviewWarningsView } from '@/components/campaigns/api';
import PriceHint from '@/components/ui/PriceHint';
import SelfWriteBadge from '@/components/ui/SelfWriteBadge';
import Table, { type TableColumn } from '@/components/ui/Table';
import VariantWarning from '@/components/ui/VariantWarning';
import { formatDateSk, formatEur, formatPercentSk } from '@/lib/ui/format';

export interface DryRunTableProps {
  items: PreviewItemView[];
  warnings: PreviewWarningsView;
  blockers: PreviewBlockerView[];
  percent: number;
  from: string;
  to: string;
}

export function DryRunTable({ items, warnings, blockers, percent, from, to }: DryRunTableProps) {
  const columns: TableColumn<PreviewItemView>[] = [
    {
      key: 'product',
      header: 'Produkt',
      render: (it) => (
        <div className="ovl-stack" style={{ gap: '0.15rem' }}>
          <span>
            {it.name ?? <span className="ovl-muted">bez názvu</span>}{' '}
            <span className="ovl-muted ovl-small">#{it.productId}</span>
          </span>
          <VariantWarning hasAttributes={it.hasAttributes} />
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Aktuálna cena',
      numeric: true,
      render: (it) => formatEur(it.price),
    },
    {
      key: 'percent',
      header: 'Zľava',
      numeric: true,
      render: () => formatPercentSk(percent),
    },
    {
      key: 'window',
      header: 'Okno',
      render: () => `${formatDateSk(from)} – ${formatDateSk(to)}`,
    },
    {
      key: 'discounted',
      header: 'Orientačná cena po zľave',
      render: (it) => <PriceHint price={it.price} percent={percent} />,
    },
    {
      key: 'lastOwnWrite',
      header: 'Posledný vlastný zápis',
      render: (it) => (
        <SelfWriteBadge
          writtenAt={it.lastOwnWrite?.at ?? null}
          detail={
            it.lastOwnWrite
              ? `${formatPercentSk(it.lastOwnWrite.percent)} · ${formatDateSk(it.lastOwnWrite.from)} – ${formatDateSk(it.lastOwnWrite.to)}`
              : undefined
          }
        />
      ),
    },
    {
      key: 'warnings',
      header: 'Upozornenia',
      render: (it) =>
        it.warnings.length === 0 ? (
          <span className="ovl-muted">—</span>
        ) : (
          <ul className="ovl-small" style={{ margin: 0, paddingLeft: '1rem' }}>
            {it.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ),
    },
  ];

  return (
    <div className="ovl-stack" data-testid="dry-run-table">
      {blockers.length > 0 ? (
        <div className="ovl-card ovl-card--danger" role="alert" data-testid="dry-run-blockers">
          <strong>Dry-run sa nedá potvrdiť:</strong>
          <ul className="ovl-small" style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
            {blockers.map((b, i) => (
              <li key={i}>
                {b.message}
                {b.productId != null ? ` (produkt #${b.productId})` : ''}{' '}
                <code className="ovl-small">{b.code}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.keyExpiresBeforeStart ? (
        <div className="ovl-card ovl-card--warning" role="note">
          API kľúč expiruje skôr, než sa kampaň spustí — pred spustením ho bude treba vložiť znova (D8).
        </div>
      ) : null}
      {warnings.overwrite.length > 0 ? (
        <div className="ovl-card ovl-card--warning" role="note" data-testid="overwrite-warning">
          Na produktoch {warnings.overwrite.map((p) => `#${p}`).join(', ')} podľa vlastnej DB zľava beží
          alebo je naplánovaná — potvrdenie bude explicitné <strong>prepísanie</strong> s diffom
          starý → nový (D28). Shop môže mať iný stav.
        </div>
      ) : null}
      {warnings.hasAttributes.length > 0 ? (
        <div className="ovl-card ovl-card--warning" role="note" data-testid="attributes-warning">
          Produkty {warnings.hasAttributes.map((p) => `#${p}`).join(', ')} majú varianty — % zľavu na ne
          uplatní logika shopu, appka výsledné ceny variantov negarantuje (D60).
        </div>
      ) : null}

      <Table columns={columns} rows={items} rowKey={(it) => it.productId} emptyLabel="Žiadne produkty v náhľade." />

      <p className="ovl-small ovl-muted">
        Ceny po zľave sú orientačný výpočet appky; skutočné zaokrúhlenie a stav zľavy určuje shop —
        appka ich cez API nevie overiť (I11).
      </p>
    </div>
  );
}

export default DryRunTable;
