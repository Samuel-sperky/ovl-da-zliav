'use client';

/**
 * Aura Zľavy — tab Produkty (V10; `design/v3/produkty.html`, architektúra §1).
 *
 * Odpovedá na otázku „ktoré konkrétne kusy a aké majú čísla". Preto tu NIE SÚ
 * tržby eshopu — tie patria do Prehľadu a hranica medzi obrazovkami je tvrdá
 * (architektúra §1). Táto obrazovka nikdy nesčítava peniaze; sčítava kusy.
 *
 * Rozloženie: ľavý panel filtrov 260 px (stále otvorený), zvyšok tabuľka.
 * Dominanta je TABUĽKA (P1) a skroluje výhradne ona, vo vlastnom ráme (P4).
 *
 * Výber a jeho dve podoby
 * ───────────────────────
 * Naklikané riadky sa držia v množine čísel a prežijú prechod na ďalšiu
 * stránku. Hromadný výber („Vybrať všetkých 11 640") sa NEROZBAĽUJE do
 * zoznamu — je to príznak `allMatching` a do sprievodcu ide ako FILTER.
 * Zmena filtra výber zruší: ponechať výber z inej otázky by znamenalo
 * zlacniť niečo, na čo sa už používateľ nepozeral.
 *
 * Čerstvosť dát je jeden sivý riadok nad tabuľkou a nikde inde (architektúra
 * §0). Je to MERANÝ čas posledného načítania katalógu, preto bez značky `≈`
 * (P7); keď ho ešte niet, obrazovka to povie, nedopočíta.
 *
 * Vlastník: V10.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import CatalogFilters from '@/components/products/CatalogFilters';
import CatalogTable from '@/components/products/CatalogTable';
import ProductDetailPanel from '@/components/products/ProductDetailPanel';
import SelectionBar from '@/components/products/SelectionBar';
import type { CatalogSearchView } from '@/components/products/catalog-api';
import { isAborted, scopeLimits, searchCatalog } from '@/components/products/catalog-api';
import type { CatalogFilterState, PerPage } from '@/components/products/catalog-filter';
import {
  catalogFilterKey,
  DEFAULT_CATALOG_FILTER,
  newDiscountHref,
  parseCatalogFilterQuery,
} from '@/components/products/catalog-filter';
import type { SavedFilter } from '@/components/products/saved-filters';
import { readSavedFilters, removeFilter, saveFilter } from '@/components/products/saved-filters';
import { LOGIC_TIME_ZONE } from '@/lib/domain/dates';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Čerstvosť dát ═════════════════════════════ */

/**
 * `Dáta k 10. 8. 03:00`. Deň sa počíta cez `Intl` v doménovej zóne — v UTC by
 * sa medzi 22:00 a polnocou ukazoval včerajšok. Formátovač sa vyrába vo
 * funkcii, nie na module scope: `next build` volá modul pri kompilácii.
 */
function dataAsOfSentence(iso: string | null): string {
  if (iso === null) return 'Katalóg sa zatiaľ nenačítal.';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Katalóg sa zatiaľ nenačítal.';
  const day = new Intl.DateTimeFormat('sk-SK', {
    timeZone: LOGIC_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
  }).format(at);
  const time = new Intl.DateTimeFormat('sk-SK', {
    timeZone: LOGIC_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return `Dáta k ${day} ${time}`;
}

/* ═══════════════════════════ 2. Obrazovka ═════════════════════════════════ */

export interface CatalogPanelProps {
  /** Filter z adresy — odkaz z Prehľadu vedie presne na jeden výber. */
  initialFilter?: CatalogFilterState;
}

export function CatalogPanel({ initialFilter }: CatalogPanelProps) {
  const [filter, setFilter] = useState<CatalogFilterState>(
    initialFilter ?? DEFAULT_CATALOG_FILTER,
  );
  const [queryDraft, setQueryDraft] = useState(filter.query);
  const [view, setView] = useState<CatalogSearchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [saved, setSaved] = useState<readonly SavedFilter[]>([]);
  const [maxProducts, setMaxProducts] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Vynúti nové načítanie po chybe bez toho, aby sa dotkol filtra. */
  const [reloadTick, setReloadTick] = useState(0);

  /** Filter bez stránkovania — dve stránky tej istej otázky sú tá istá otázka. */
  const filterKey = catalogFilterKey(filter);

  /**
   * Úzka obrazovka. Trieda `.filters-toggle` z návrhového systému je dnes
   * prebitá neskorším `display:none` mimo media query, takže by tlačidlo
   * zostalo skryté aj na mobile a panel filtrov by sa nedal otvoriť. Kým sa
   * to v globálnom CSS neopraví, rozhoduje o ňom `matchMedia` — nie trieda.
   * Prvý render je zámerne „široký": server o šírke okna nevie a blikajúce
   * tlačidlo je menšie zlo než nesúlad hydratácie.
   */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 760px)');
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  /* Uložené filtre a strop na jednu zľavu — obe len raz, pri otvorení. */
  useEffect(() => {
    setSaved(readSavedFilters());
    const controller = new AbortController();
    void scopeLimits(controller.signal).then((res) => {
      if (res.ok) setMaxProducts(res.data.maxProducts);
    });
    return () => controller.abort();
  }, []);

  /* Hľadanie sa neodosiela po každom znaku. */
  useEffect(() => {
    if (queryDraft === filter.query) return;
    const timer = setTimeout(() => {
      setFilter((current) => ({ ...current, query: queryDraft, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [queryDraft, filter.query]);

  /* Zmena filtra ruší výber — výber z inej otázky nesmie prejsť do zľavy. */
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    setSelected(new Set());
    setAllMatching(false);
  }, [filterKey]);

  /* Načítanie stránky katalógu. Zrušený dotaz NIE JE chyba — používateľ len
     rýchlo preklikol ďalej a hneď za ním beží nový, takže sa nechá „Načítavam". */
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    void searchCatalog(filter, controller.signal).then((res) => {
      if (!live) return;
      if (res.ok) {
        setView(res.data);
        setError(null);
        setLoading(false);
        return;
      }
      if (isAborted(res.error)) return;
      setError(res.error.message);
      setLoading(false);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [filter, reloadTick]);

  const rows = view === null ? [] : view.data;
  const matching = view === null ? 0 : view.total;
  const catalogTotal = view === null ? 0 : view.catalogTotal;

  const pageSelected = useMemo(
    () => rows.filter((row) => selected.has(row.productId)).length,
    [rows, selected],
  );

  const detailRow = detailId === null ? undefined : rows.find((row) => row.productId === detailId);

  function change(patch: Partial<CatalogFilterState>) {
    // Detail patrí k riadku, ktorý je práve vidieť. Po zmene filtra alebo
    // stránky by visel nad iným zoznamom, tak sa zavrie.
    setDetailId(null);
    setFilter((current) => ({ ...current, ...patch }));
  }

  function toggleRow(productId: number, checked: boolean) {
    setSelected((current) => {
      // Hromadný výber sa pri prvom ručnom zásahu rozpadne na to, čo je vidieť —
      // inak by sa „všetkých 11 640 okrem jedného" tvárilo ako celý filter.
      const base = allMatching ? new Set(rows.map((row) => row.productId)) : new Set(current);
      if (checked) base.add(productId);
      else base.delete(productId);
      return base;
    });
    setAllMatching(false);
  }

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const base = allMatching ? new Set<number>() : new Set(current);
      for (const row of rows) {
        if (checked) base.add(row.productId);
        else base.delete(row.productId);
      }
      return base;
    });
    setAllMatching(false);
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  function applySaved(query: string) {
    const next = parseCatalogFilterQuery(query);
    setQueryDraft(next.query);
    setFilter({ ...next, page: 1, perPage: filter.perPage });
    setFiltersOpen(false);
  }

  const activeSaved = saved.find((row) => row.query === filterKey)?.name ?? null;
  const showBar = allMatching || selected.size > 0;
  const discountHref = allMatching
    ? newDiscountHref({ kind: 'filter', filter, total: matching })
    : newDiscountHref({ kind: 'products', productIds: [...selected] });

  return (
    <>
      <div className="layout-filters">
        <CatalogFilters
          filter={filter}
          counts={view === null ? null : view.counts}
          lockedFilters={view === null ? {} : view.lockedFilters}
          saved={saved}
          activeSaved={activeSaved}
          open={filtersOpen}
          onChange={change}
          onApplySaved={applySaved}
          onRemoveSaved={(name) => setSaved(removeFilter(name))}
        />

        {/* Nie `<main>`: hlavný orientačný bod stránky je `main.wrap` z rozloženia
            appky a dva naraz sú neplatné HTML aj mätúca navigácia pre čítačku. */}
        <div>
          <div className="row wrapx" style={{ marginBottom: '10px' }}>
            <input
              className="inp"
              style={{ width: '340px', maxWidth: '100%' }}
              type="search"
              value={queryDraft}
              placeholder="Hľadať názov alebo číslo produktu"
              aria-label="Hľadať v katalógu"
              onChange={(event) => setQueryDraft(event.target.value)}
              data-testid="catalog-search"
            />
            {narrow ? (
              <button
                type="button"
                className="btn sm ghost"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
                data-testid="toggle-filters"
              >
                Filtre
              </button>
            ) : null}
            <span
              className="num"
              style={{
                marginLeft: 'auto',
                fontSize: '22px',
                fontWeight: 660,
                letterSpacing: '-0.02em',
                lineHeight: 1.05,
                whiteSpace: 'nowrap',
              }}
              data-testid="catalog-matching"
            >
              {formatCountSk(matching)}
              <small
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--dim)',
                  marginLeft: '6px',
                  letterSpacing: 0,
                }}
              >
                z {formatCountSk(catalogTotal)} produktov
              </small>
            </span>
          </div>

          <div className="fresh" data-testid="catalog-data-as-of">
            {dataAsOfSentence(view === null ? null : view.dataAsOf)}
          </div>

          {error === null ? (
            <CatalogTable
              rows={rows}
              soldWindowDays={view === null ? filter.soldWindowDays : view.soldWindowDays}
              total={matching}
              page={filter.page}
              perPage={filter.perPage}
              loading={loading}
              selected={selected}
              allMatchingSelected={allMatching}
              onToggleRow={toggleRow}
              onTogglePage={togglePage}
              onOpenDetail={setDetailId}
              onPage={(page) => change({ page })}
              onPerPage={(perPage: PerPage) => change({ perPage, page: 1 })}
            />
          ) : (
            <section className="sec" data-testid="catalog-error">
              <div className="lvl-2">{error}</div>
              <div className="row gap-t">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setError(null);
                    setReloadTick((tick) => tick + 1);
                  }}
                >
                  Skúsiť znova
                </button>
              </div>
            </section>
          )}

          {showBar ? (
            <SelectionBar
              pageSelected={pageSelected}
              totalSelected={selected.size}
              matching={matching}
              maxProducts={maxProducts}
              allMatchingSelected={allMatching}
              discountHref={discountHref}
              onSelectAllMatching={() => setAllMatching(true)}
              onClear={clearSelection}
              onSaveFilter={(name) => setSaved(saveFilter(name, filterKey))}
            />
          ) : null}
        </div>
      </div>

      {detailRow === undefined ? null : (
        <ProductDetailPanel
          row={detailRow}
          soldWindowDays={view === null ? filter.soldWindowDays : view.soldWindowDays}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  );
}

export default CatalogPanel;
