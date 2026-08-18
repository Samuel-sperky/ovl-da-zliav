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
 * PORADIE: NAJDRAHŠIE PRVÉ, A JE TO VIDIEŤ
 * ────────────────────────────────────────
 * Predvolené triedenie je najdrahšie prvé (kontrakt UI, bod 19). Keby o ňom
 * hlavička mlčala, bol by to neoveriteľný sľub — preto nesie šípku a klikom sa
 * dá prehodiť. Prvý klik na stĺpec je to, čo sa v ňom hľadá najčastejšie: pri
 * cene najdrahšie, pri predaných NAJMENEJ predané (appka je na zlacňovanie
 * ležiakov). Poradie sa nikdy nedotkne výberu — je to tá istá otázka.
 *
 * POČET ZHÔD JE DOLNÁ HRANICA, KÝM JE ZRKADLO NEÚPLNÉ
 * ───────────────────────────────────────────────────
 * `total` je počet v zrkadle katalógu, nie v eshope. Kým zrkadlo nie je celé,
 * pätka ho označí `≈` a tlmene (P7) — presné číslo by bolo tvrdenie, ktoré
 * appka nemá kryté.
 *
 * PREČO NEPREJDE — PRI RIADKU, NIE V PÄTKE
 * ────────────────────────────────────────
 * Riadok, na ktorý sa zľava nezapíše, dostane pod menom krátky príznak
 * („shop ho nenašiel"). Zámerne to NIE JE nový stĺpec: stĺpec by musel byť
 * vyplnený pri všetkých 40 483 riadkoch a 40 480 pomlčiek je šum, nie
 * informácia. Príznak sa objaví len tam, kde je čo povedať, a celá veta aj
 * s ďalším krokom čaká v bočnom paneli. Text príznaku sa TU nevyrába —
 * prichádza z `catalog-status.ts`, aby ho tabuľka a panel nemohli povedať inak.
 *
 * PRÁZDNA TABUĽKA NIE JE JEDEN PRÍBEH
 * ───────────────────────────────────
 * „Filtru nevyhovuje ani jeden produkt" je pravda len nad ÚPLNÝM katalógom.
 * Kým appka pozná 2 900 zo 41 082 produktov, hľadaný kus môže pokojne existovať
 * a len ešte nebyť načítaný — a to je úplne iná rada. Tabuľka preto o prázdnom
 * stave nerozhoduje: dostane hotový `emptyState` od obrazovky, ktorá stav
 * katalógu pozná.
 *
 * Vlastník: V10.
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { CatalogRowView } from '@/components/products/catalog-api';
import type { ProductReason } from '@/components/products/catalog-status';
import type { CatalogSort, PerPage } from '@/components/products/catalog-filter';
import { DEFAULT_CATALOG_FILTER, PER_PAGE_CHOICES } from '@/components/products/catalog-filter';
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

/** Hlavička sa klikom triedi, ale ostáva hlavičkou — preto dedí celý štýl. */
const SORT_BUTTON: CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  letterSpacing: 'inherit',
  textTransform: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
};

type PageToken = number | 'gap';

/* ─────────────────────────── Triedenie stĺpcov ────────────────────────────── */

/** Stĺpce, ktoré sa dajú triediť. „Zľava teraz" medzi nimi zámerne nie je. */
export type SortColumn = 'name' | 'sold' | 'price';

/**
 * Dve poradia na stĺpec a to, ktoré príde na prvý klik. Pri predaných je prvé
 * NAJMENEJ predané: obrazovka slúži na hľadanie ležiakov, nie bestsellerov.
 * Názov druhé poradie nemá — API triedi meno len vzostupne.
 */
const COLUMN_SORTS: Readonly<Record<SortColumn, readonly [CatalogSort, CatalogSort]>> = {
  name: ['name', 'name'],
  sold: ['sold_asc', 'sold_desc'],
  price: ['price_desc', 'price_asc'],
};

/** Vzostupné poradia — jediné miesto, kde sa smer pomenúva. */
const ASCENDING: readonly CatalogSort[] = ['name', 'sold_asc', 'price_asc'];

/** Čo klik urobí, povedané slovami — šípka sama o sebe je hádanka. */
const SORT_TITLES: Readonly<Record<CatalogSort, string>> = {
  price_desc: 'Najdrahšie prvé',
  price_asc: 'Najlacnejšie prvé',
  sold_desc: 'Najviac predané prvé',
  sold_asc: 'Najmenej predané prvé',
  name: 'Podľa názvu',
};

/** Kam prehodí klik na hlavičku: druhý klik na ten istý stĺpec otočí smer. */
export function nextSort(column: SortColumn, current: CatalogSort): CatalogSort {
  const [first, other] = COLUMN_SORTS[column];
  return current === first ? other : first;
}

/** Hodnota pre `aria-sort`; `none` = podľa tohto stĺpca sa netriedi. */
export function sortDirection(
  column: SortColumn,
  current: CatalogSort,
): 'ascending' | 'descending' | 'none' {
  const [first, other] = COLUMN_SORTS[column];
  if (current !== first && current !== other) return 'none';
  return ASCENDING.includes(current) ? 'ascending' : 'descending';
}

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
  /**
   * P7 — `total` je počet v ZRKADLE katalógu. Kým zrkadlo nie je úplné, je to
   * dolná hranica: v eshope môže byť viac. `true` → pätka číslo označí `≈`
   * a stlmí. Predvolene `false`, aby sa nedalo označiť merané číslo omylom.
   */
  totalIsLowerBound?: boolean;
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
  /** Platné poradie riadkov. Predvolene najdrahšie prvé (kontrakt UI, bod 19). */
  sort?: CatalogSort;
  /** Bez tejto funkcie sa hlavičky nedajú klikať a poradie len ukazujú. */
  onSort?: (sort: CatalogSort) => void;
  /**
   * Prečo sa na tento riadok zľava nezapíše. `null` = nič mu nevyčítame.
   * Rozhoduje o tom volajúci, nie tabuľka — pozri hlavičku modulu.
   */
  rowReason?: (row: CatalogRowView) => ProductReason | null;
  /**
   * Čo sa ukáže namiesto prázdnej tabuľky. Bez neho zostane holá veta o filtri,
   * ktorá je nad neúplným katalógom nepravdivá — preto ho obrazovka posiela.
   */
  emptyState?: ReactNode;
}

export function CatalogTable({
  rows,
  soldWindowDays,
  total,
  totalIsLowerBound = false,
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
  sort = DEFAULT_CATALOG_FILTER.sort,
  onSort,
  rowReason,
  emptyState,
}: CatalogTableProps) {
  const headBox = useRef<HTMLInputElement | null>(null);

  /**
   * Nadpis stĺpca. Bez `onSort` je to len text — hlavička, ktorá vyzerá
   * klikateľne a nič nerobí, je horšia než hlavička bez šípky.
   */
  function columnHead(column: SortColumn, label: string): ReactNode {
    const direction = sortDirection(column, sort);
    const glyph = direction === 'none' ? '' : direction === 'ascending' ? '↑' : '↓';
    if (onSort === undefined) return label;
    const next = nextSort(column, sort);
    return (
      <button
        type="button"
        style={SORT_BUTTON}
        title={SORT_TITLES[next]}
        onClick={() => onSort(next)}
        data-testid={`sort-${column}`}
      >
        {label}
        {glyph === '' ? null : <span aria-hidden="true">{glyph}</span>}
      </button>
    );
  }

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
              <th aria-sort={sortDirection('name', sort)}>{columnHead('name', 'Názov')}</th>
              <th className="n" style={NARROW} aria-sort={sortDirection('sold', sort)}>
                {columnHead('sold', `Predané ${soldWindowDays} d`)}
              </th>
              <th className="n" style={NARROW} aria-sort={sortDirection('price', sort)}>
                {columnHead('price', 'Cena')}
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
                  {loading ? (
                    'Načítavam…'
                  ) : emptyState !== undefined ? (
                    emptyState
                  ) : (
                    <>Filtru nevyhovuje ani jeden z načítaných produktov.</>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const checked = allMatchingSelected || selected.has(row.productId);
                const reason = rowReason?.(row) ?? null;
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
                      {reason === null ? null : (
                        // `.flag` nesie glyf aj farbu; text je tretí kanál —
                        // stav nikdy nie je len farba.
                        <div
                          className={reason.tone === 'attention' ? 'flag' : 'flag neutral'}
                          data-testid={`row-reason-${reason.id}`}
                        >
                          {reason.short}
                        </div>
                      )}
                      {/* I11 — riadok dohľadaný v eshope stojí na inej istote
                          než riadok zo zrkadla: zrkadlo je posledný prechod
                          synchronizácie, eshop je odpoveď z tejto chvíle.
                          Bez tohto by na obrazovke stáli vedľa seba dva rôzne
                          stupne istoty a vyzerali by rovnako. */}
                      {row.origin === 'shop' ? (
                        <div className="flag neutral" data-testid="row-origin-shop">
                          dohľadané v eshope
                        </div>
                      ) : null}
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
        {/* P7 — dolná hranica sa píše `≈` a BEZ tučného: merané číslo a odhad
            nesmú mať rovnaký štýl. Čo `≈` znamená, hovorí popis pri čísle.
            Nula sa neoznačuje: „≈ 0" nie je odhad, ale nezmysel — o prázdnom
            výsledku hovorí prázdny stav, nie pätka. */}
        <span>
          Zobrazených {formatCountSk(rows.length)} z{' '}
          {totalIsLowerBound && total > 0 ? (
            <span
              className="num"
              title="Počet v načítaných riadkoch — v eshope ich môže byť viac."
              data-testid="table-total-approx"
            >
              ≈ {formatCountSk(total)}
            </span>
          ) : (
            <b className="num">{formatCountSk(total)}</b>
          )}
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
