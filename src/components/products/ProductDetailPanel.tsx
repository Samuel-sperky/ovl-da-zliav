'use client';

/**
 * Aura Zľavy — bočný panel s detailom produktu (V10; `design/v3/produkt-detail.html`).
 *
 * Panel sprava, nie nová stránka (odpoveď 91): používateľ neopúšťa filter ani
 * miesto v tabuľke. Dominantou panela je jedno číslo — koľko kusov sa za
 * zvolené okno predalo; presne kvôli nemu sa produkt otvára.
 *
 * Čo panel hovorí a čo NIE
 * ────────────────────────
 *  · „História zliav" je história VLASTNÝCH zápisov appky, nie stav shopu
 *    (I11). Nadpis to preto hovorí doslova.
 *  · Kategória, kov a marža sú `—` so sivou bunkou (K8, architektúra §5) —
 *    nie skryté, nie vymyslené.
 *  · Číslo produktu, stav v shope a čas posledného načítania sú pod rozklikom
 *    „Technický detail" (P6) — na povrchu nemajú čo robiť.
 *  · Riadok „Dáta k …" tu NIE JE: v Produktoch sa objaví práve raz, nad
 *    tabuľkou (architektúra §0).
 *
 * Vlastník: V10.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type { CatalogRowView, ProductWriteView } from '@/components/products/catalog-api';
import { catalogRow, isAborted, productWrites } from '@/components/products/catalog-api';
import { newDiscountHref } from '@/components/products/catalog-filter';
import { formatDateSk, formatDateTimeSk, formatEur, formatPercentSk } from '@/lib/ui/format';
import { formatCountSk, itemSentence, SURFACE_TERMS } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Pomôcky ═══════════════════════════════════ */

const SHOP_STATUS_TEXT: Readonly<Record<CatalogRowView['shopStatus'], string>> = {
  ok: 'shop ho pozná',
  not_found: 'shop ho nenašiel',
  unknown: 'stav nevieme',
};

/** Cena po zľave — obyčajná aritmetika nad známou cenou, nie odhad. */
function priceAfter(price: string | null, percent: number): string {
  if (price === null) return '—';
  const value = Number(price);
  if (!Number.isFinite(value)) return '—';
  return formatEur(value * (1 - percent / 100));
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '12px 0 4px' }}>
      <h3
        style={{
          fontSize: '10px',
          letterSpacing: '0.13em',
          textTransform: 'uppercase',
          color: 'var(--dim)',
          fontWeight: 650,
          marginBottom: '8px',
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function WriteRow({ write }: { write: ProductWriteView }) {
  const sentence = itemSentence(write.status);
  return (
    <div
      className="row"
      style={{
        alignItems: 'baseline',
        gap: '10px',
        fontSize: '13px',
        padding: '5px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <b style={{ fontWeight: 640, color: 'var(--ink)', minWidth: '44px' }}>
        {formatPercentSk(write.percent)}
      </b>
      <span style={{ color: 'var(--ink2)' }}>
        {formatDateSk(write.dateFrom)} – {formatDateSk(write.dateTo)}
      </span>
      <span className="lvl-3" style={{ marginLeft: 'auto' }}>
        {sentence.label}
      </span>
    </div>
  );
}

/* ═══════════════════════════ 2. Panel ═════════════════════════════════════ */

export interface ProductDetailPanelProps {
  row: CatalogRowView;
  /** Okno, v ktorom je `row.unitsSold` — to isté, aké má tabuľka. */
  soldWindowDays: number;
  onClose: () => void;
}

interface DetailState {
  writes: readonly ProductWriteView[] | null;
  soldLongTerm: number | null;
  failed: boolean;
}

const EMPTY: DetailState = { writes: null, soldLongTerm: null, failed: false };

/** Najdlhšie okno, ktoré API pozná — druhý uhol pohľadu na tie isté predaje. */
const LONG_WINDOW = 360;

export function ProductDetailPanel({ row, soldWindowDays, onClose }: ProductDetailPanelProps) {
  const [state, setState] = useState<DetailState>(EMPTY);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setState(EMPTY);

    void (async () => {
      const history = await productWrites(row.productId, controller.signal);
      if (!live) return;
      if (!history.ok) {
        if (!isAborted(history.error)) setState((s) => ({ ...s, failed: true }));
      } else {
        setState((s) => ({ ...s, writes: history.data.writes }));
      }

      if (soldWindowDays === LONG_WINDOW) {
        if (live) setState((s) => ({ ...s, soldLongTerm: row.unitsSold }));
        return;
      }
      const longTerm = await catalogRow(row.productId, LONG_WINDOW, controller.signal);
      if (!live) return;
      if (longTerm.ok) {
        const found = longTerm.data.data[0];
        setState((s) => ({ ...s, soldLongTerm: found === undefined ? null : found.unitsSold }));
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [row.productId, row.unitsSold, soldWindowDays]);

  const writes = state.writes ?? [];
  const planned = writes.find((write) => write.status === 'pending');

  return (
    <aside className="drawer" data-testid="product-detail" aria-label="Detail produktu">
      <div className="drawer-h">
        <div>
          <div className="t">{row.name ?? 'bez názvu'}</div>
          <div className="lvl-3" style={{ marginTop: '3px' }}>
            {formatEur(row.price)} · {row.discountedNow ? 'práve v zľave' : 'bez zľavy'}
          </div>
          {row.shopStatus === 'not_found' ? (
            <div className="flag" style={{ marginTop: '4px' }}>
              {SHOP_STATUS_TEXT.not_found}
            </div>
          ) : null}
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="Zavrieť detail">
          ✕
        </button>
      </div>

      <div className="lvl-1">
        <span className="big sm num">{formatCountSk(row.unitsSold)}</span>
        <span className="sub">
          predaných za posledných {soldWindowDays} dní
          {state.soldLongTerm === null
            ? ''
            : ` · za ${LONG_WINDOW} dní ${formatCountSk(state.soldLongTerm)}`}
        </span>
      </div>

      <DetailGroup title="História zliav">
        {state.failed ? (
          <div className="lvl-3">Históriu sa nepodarilo načítať.</div>
        ) : state.writes === null ? (
          <div className="lvl-3">Načítavam…</div>
        ) : writes.length === 0 ? (
          <div className="lvl-3">Tento produkt sme ešte nezlacňovali.</div>
        ) : (
          writes.map((write) => <WriteRow key={write.itemId} write={write} />)
        )}
        <div className="lvl-3" style={{ marginTop: '8px' }}>
          Sú to naše vlastné zápisy, nie stav shopu.
        </div>
      </DetailGroup>

      <DetailGroup title="Zaradenie">
        <dl className="dl">
          <dt>V pripravovanej zľave</dt>
          <dd>{planned === undefined ? '—' : planned.campaignName}</dd>
          <dt>Percento</dt>
          <dd>{planned === undefined ? '—' : formatPercentSk(planned.percent)}</dd>
          <dt>Cena po zľave</dt>
          <dd>{planned === undefined ? '—' : priceAfter(row.price, planned.percent)}</dd>
          <dt>Kategória a kov</dt>
          <dd className="lockcell" title={SURFACE_TERMS.lockedFeature}>
            —
          </dd>
          <dt>Marža</dt>
          <dd className="lockcell" title={SURFACE_TERMS.lockedFeature}>
            —
          </dd>
        </dl>
      </DetailGroup>

      <details className="tech">
        <summary>{SURFACE_TERMS.technicalDetail}</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Číslo produktu</td>
                <td>
                  <b>{row.productId}</b>
                </td>
              </tr>
              <tr>
                <td>Stav v shope</td>
                <td>
                  <b>{SHOP_STATUS_TEXT[row.shopStatus]}</b>
                </td>
              </tr>
              <tr>
                <td>Varianty</td>
                <td>
                  <b>{row.hasAttributes ? 'má varianty' : 'bez variantov'}</b>
                </td>
              </tr>
              <tr>
                <td>Posledné načítanie</td>
                <td>
                  <b>{formatDateTimeSk(row.fetchedAt)}</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <div className="row" style={{ marginTop: '14px' }}>
        <Link
          className="btn primary"
          href={newDiscountHref({ kind: 'products', productIds: [row.productId] })}
          data-testid="discount-single"
        >
          Zlacniť tento produkt
        </Link>
      </div>
    </aside>
  );
}

export default ProductDetailPanel;
