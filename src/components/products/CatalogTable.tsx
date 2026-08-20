'use client';

/**
 * Aura Zľavy — tabuľka katalógu (V10; `design/v3/produkty.html`).
 *
 * Toto je DOMINANTA tabu Produkty (P1). Nie nadpis, nie filtre — tabuľka.
 * Skroluje výhradne ona, vo vlastnom ráme `.tbl-frame` (P4); stránka pod ňou
 * stojí, takže hlavička aj lišta výberu zostávajú na mieste.
 *
 * Stĺpce a čo v nich NIE JE
 * ─────────────────────────
 * `Názov · Predané za okno · Cena · Zľava teraz`. Číslo produktu hlavný stĺpec
 * NIE JE (P3) — žije v „Technickom detaile" bočného panela. Sklad, kategória,
 * kov ani marža sa nekreslia vôbec: appka na ne nemá dáta (K8) a stĺpec plný
 * pomlčiek cez 40 483 riadkov je šum, nie priznanie. Priznanie je v paneli
 * filtrov, kde sú tie isté veci viditeľné a sivé.
 *
 * `Zľava teraz` je VŽDY podľa vlastného zápisu appky, nikdy podľa shopu (I11).
 *
 * Vlastník: V10.
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

import type { CatalogRowView } from '@/components/products/catalog-api';
import type { PerPage } from '@/components/products/catalog-filter';
import { PER_PAGE_CHOICES } from '@/components/products/catalog-filter';
import { formatEur } from '@/lib/ui/format';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Pomôcky ═══════════════════════════════════ */

const NAME_BUTTON: CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const NARROW: CSSProperties = { width: '96px' };

type PageToken = number | 'gap';

/**
 * Zoznam čísel stránok s výpustkami: `1 2 3 4 … 233`. Pri 233 stranách sa
 * nedá vypísať všetko a skákanie o desiatky strán nikto nepoužíva — okolie
 * aktuálnej strany a okraje stačia.
 */
export function pageTokens(current: number, pages: number): PageToken[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const wanted = new Set<number>([1, 2, pages, current - 1, current, current + 1]);
  const sorted = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: PageToken[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous !== 0 && page - previous > 1) out.push('gap');
    out.push(page);
    previous = page;
  }
  return out;
}

/* ═══════════════════════════ 2. Tabuľka ═══════════════════════════════════ */

export interface CatalogTableProps {
  rows: readonly CatalogRowView[];
  /** Okno, za ktoré je stĺpec „Predané" — bez neho je číslo nečitateľné (P7). */
  soldWindowDays: number;
  total: number;
  page: number;
  perPage: PerPage;
  loading: boolean;
  selected: ReadonlySet<number>;
  /** `true` = vybrané je všetko, čo vyhovuje filtru, nielen táto stránka. */
  allMatchingSelected: boolean;
  onToggleRow: (productId: number, checked: boolean) => void;
  onTogglePage: (checked: boolean) => void;
  onOpenDetail: (productId: number) => void;
  onPage: (page: number) => void;
  onPerPage: (perPage: PerPage) => void;
}

export function CatalogTable({
  rows,
  soldWindowDays,
  total,
  page,
  perPage,
  loading,
  selected,
  allMatchingSelected,
  onToggleRow,
  onTogglePage,
  onOpenDetail,
  onPage,
  onPerPage,
}: CatalogTableProps) {
  const headBox = useRef<HTMLInputElement | null>(null);

  const onPageSelected = rows.filter((row) => selected.has(row.productId)).length;
  const pageAll = rows.length > 0 && onPageSelected === rows.length;
  const pageSome = onPageSelected > 0 && !pageAll;

  useEffect(() => {
    const node = headBox.current;
    if (node === null) return;
    node.indeterminate = pageSome && !allMatchingSelected;
  }, [pageSome, allMatchingSelected]);

  const pages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="tbl-frame" data-testid="catalog-table">
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th className="sel">
                <input
                  ref={headBox}
                  className="cb"
                  type="checkbox"
                  checked={allMatchingSelected || pageAll}
                  disabled={rows.length === 0}
                  aria-label="Označiť celú stránku"
                  onChange={(event) => onTogglePage(event.target.checked)}
                  data-testid="select-page"
                />
              </th>
              <th>Názov</th>
              <th className="n" style={NARROW}>
                Predané {soldWindowDays} d
              </th>
              <th className="n" style={NARROW}>
                Cena
              </th>
              <th className="n" style={NARROW} title="Podľa vlastných zápisov appky">
                Zľava teraz
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="lvl-3" style={{ padding: '18px 12px' }}>
                  {loading ? 'Načítavam…' : 'Filtru nevyhovuje ani jeden produkt.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const checked = allMatchingSelected || selected.has(row.productId);
                return (
                  <tr key={row.productId} className={checked ? 'on' : undefined}>
                    <td className="sel">
                      <input
                        className="cb"
                        type="checkbox"
                        checked={checked}
                        aria-label={`Označiť ${row.name ?? 'produkt bez názvu'}`}
                        onChange={(event) => onToggleRow(row.productId, event.target.checked)}
                        data-testid={`select-row-${row.productId}`}
                      />
                    </td>
                    <td className="name" data-l="Produkt">
                      <button
                        type="button"
                        style={NAME_BUTTON}
                        onClick={() => onOpenDetail(row.productId)}
                        data-testid={`open-detail-${row.productId}`}
                      >
                        {row.name ?? 'bez názvu'}
                      </button>
                    </td>
                    <td className="n" data-l="Predané">
                      {row.unitsSold === 0 ? <b>0</b> : formatCountSk(row.unitsSold)}
                    </td>
                    <td className="n" data-l="Cena">
                      {formatEur(row.price)}
                    </td>
                    <td className="n" data-l="Zľava teraz">
                      {row.discountedNow ? 'v zľave' : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="tbl-foot">
        <span>
          Zobrazených {formatCountSk(rows.length)} z <b className="num">{formatCountSk(total)}</b>
        </span>
        <div className="row" style={{ gap: '14px' }}>
          <div className="seg" aria-label="Riadkov na stránku">
            {PER_PAGE_CHOICES.map((size) => (
              <button
                key={size}
                type="button"
                className={size === perPage ? 'on' : undefined}
                aria-pressed={size === perPage}
                onClick={() => onPerPage(size)}
              >
                {size}
              </button>
            ))}
          </div>
          <nav className="pager" aria-label="Stránkovanie">
            {pageTokens(page, pages).map((token, index) =>
              token === 'gap' ? (
                <span key={`gap-${index}`}>…</span>
              ) : token === page ? (
                <span className="cur" key={token} aria-current="page">
                  {token}
                </span>
              ) : (
                <a
                  key={token}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    onPage(token);
                  }}
                >
                  {token}
                </a>
              ),
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}

export default CatalogTable;
