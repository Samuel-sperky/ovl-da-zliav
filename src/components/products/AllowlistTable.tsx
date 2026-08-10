'use client';

/**
 * Aura Zľavy — tabuľka allowlistu (A16, D7, D38, D40, I2, I11).
 *
 * Per produkt: slot, ID, názov, cena, stav v shope, posledný VLASTNÝ zápis
 * (`SelfWriteBadge` — nikdy „stav shopu"), varovanie pri variantoch a akcie
 * „označiť stav ako neznámy" + „odobrať". Odobranie produktu s naplánovanou
 * kampaňou je blokované serverom (409 `campaign_planned`) a dôvod sa zobrazí
 * priamo v riadku (D40).
 */
import { useState } from 'react';

import MarkUnknownButton from '@/components/products/MarkUnknownButton';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import SelfWriteBadge from '@/components/ui/SelfWriteBadge';
import Table, { type TableColumn } from '@/components/ui/Table';
import VariantWarning from '@/components/ui/VariantWarning';
import { formatDateSk, formatEur, formatPercentSk } from '@/lib/ui/format';
import { removeProduct, type AllowlistRow } from '@/components/products/api';

const SHOP_STATUS: Record<AllowlistRow['shopStatus'], { label: string; tone: string } | null> = {
  ok: null,
  not_found: { label: 'v shope nenájdený', tone: 'danger' },
  unknown: { label: 'stav neznámy', tone: 'warning' },
};

export interface AllowlistTableProps {
  rows: readonly AllowlistRow[];
  onChanged: () => void;
}

export function AllowlistTable({ rows, onChanged }: AllowlistTableProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, { message: string; code: string }>>({});

  async function remove(productId: number) {
    if (busyId !== null) return;
    setBusyId(productId);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    const res = await removeProduct(productId);
    setBusyId(null);
    if (!res.ok) {
      const blocked = res.error.code === 'campaign_planned';
      setErrors((prev) => ({
        ...prev,
        [productId]: {
          message: blocked
            ? 'Produkt sa nedá odobrať: má naplánovanú alebo čakajúcu kampaň. Najprv zruš tú kampaň v sekcii Kampane. Už zapísaná zľava v shope dobehne sama — zrušiť ju appka nedokáže.'
            : res.error.message,
          code: res.error.code,
        },
      }));
      return;
    }
    onChanged();
  }

  const columns: TableColumn<AllowlistRow>[] = [
    { key: 'slot', header: 'Slot', numeric: true, render: (r) => r.slot ?? '—' },
    {
      key: 'product',
      header: 'Produkt',
      render: (r) => (
        <div className="ovl-stack" style={{ gap: '0.15rem' }}>
          <span>{r.name ?? r.label ?? <span className="ovl-muted">bez názvu</span>}</span>
          <span className="ovl-small ovl-muted">
            ID <code>{r.productId}</code>
            {r.label && r.name ? ` · ${r.label}` : ''}
          </span>
          <VariantWarning hasAttributes={r.hasAttributes} />
        </div>
      ),
    },
    { key: 'price', header: 'Cena', numeric: true, render: (r) => formatEur(r.price) },
    {
      key: 'shopStatus',
      header: 'Stav v shope',
      render: (r) => {
        const s = SHOP_STATUS[r.shopStatus];
        return s ? (
          <span className={`ovl-badge ovl-badge--${s.tone}`}>{s.label}</span>
        ) : (
          <span className="ovl-badge ovl-badge--ok">nájdený</span>
        );
      },
    },
    {
      key: 'lastOwnWrite',
      header: 'Posledný vlastný zápis',
      render: (r) => (
        <div className="ovl-stack" style={{ gap: '0.15rem' }}>
          {r.lastOwnWrite ? (
            <span className="ovl-small">
              {formatPercentSk(r.lastOwnWrite.percent)} · {formatDateSk(r.lastOwnWrite.from)} –{' '}
              {formatDateSk(r.lastOwnWrite.to)}
            </span>
          ) : (
            <span className="ovl-small ovl-muted">žiadny</span>
          )}
          <SelfWriteBadge writtenAt={r.lastOwnWrite?.at ?? null} />
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Akcie',
      render: (r) => (
        <div className="ovl-stack" style={{ gap: '0.3rem' }}>
          <MarkUnknownButton productId={r.productId} onMarked={onChanged} />
          <Button
            small
            variant="danger"
            onClick={() => void remove(r.productId)}
            disabled={busyId === r.productId}
            data-testid={`remove-product-${r.productId}`}
          >
            {busyId === r.productId ? 'Odoberám…' : 'Odobrať z povolených'}
          </Button>
          {errors[r.productId] ? (
            <ErrorMessage
              message={errors[r.productId]!.message}
              rawCode={errors[r.productId]!.code}
            />
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div data-testid="allowlist-table">
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.productId}
        emptyLabel="Zoznam povolených produktov je prázdny — pridaj prvý produkt nižšie. Bez neho appka nezapíše nič."
        caption="Stavy zliav sú „posledný vlastný zápis“, nie stav shopu."
      />
    </div>
  );
}

export default AllowlistTable;
