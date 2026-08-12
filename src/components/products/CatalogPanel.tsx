'use client';

/**
 * Aura Zľavy — tab Produkty (V10; `design/v3/produkty.html`, architektúra §1).
 *
 * Odpovedá na otázku „ktoré konkrétne kusy a aké majú čísla". Preto tu NIE SÚ
 * tržby eshopu — tie patria do Prehľadu a hranica medzi obrazovkami je tvrdá
 * (architektúra §1). Táto obrazovka nikdy nesčítava peniaze; sčítava kusy.
 *
 * Rozloženie: hore karta so stavom katalógu, pod ňou ľavý panel filtrov 260 px
 * (stále otvorený) a zvyšok tabuľka. Dominanta je TABUĽKA (P1) a skroluje
 * výhradne ona, vo vlastnom ráme (P4).
 *
 * Prečo je karta katalógu PRVÁ
 * ────────────────────────────
 * Appka má dnes načítaných okolo 2 900 zo 41 082 produktov a tabuľka vyzerá
 * rovnako, či je katalóg celý, alebo z neho videla tridsať stránok. Bez tej
 * karty si používateľ vyberie 150 kusov zo siedmich percent eshopu a nemá ako
 * to zistiť. Preto je stav katalógu prvá vec na obrazovke, nie posledná.
 *
 * Výber a jeho dve podoby
 * ───────────────────────
 * Naklikané riadky sa držia v množine čísel a prežijú prechod na ďalšiu
 * stránku. Hromadný výber („Vybrať všetkých 11 640") sa NEROZBAĽUJE do
 * zoznamu — je to príznak `allMatching` a do sprievodcu ide ako FILTER.
 * Zmena filtra výber zruší: ponechať výber z inej otázky by znamenalo
 * zlacniť niečo, na čo sa už používateľ nepozeral.
 *
 * Prekážky výberu sa počítajú TU a lokálne
 * ────────────────────────────────────────
 * `GET /api/status` vracia prekážky pre PRÁZDNY výber. Obrazovka si ich
 * prepočítava nad vlastným výberom cez `statusSnapshotFromPayload()` — je to
 * jediná podporovaná cesta a šetrí volanie servera pri každom kliknutí na
 * zaškrtávacie políčko. Strop rozsahu je preto vidieť skôr, než doň niekto
 * narazí, a nie až ako tiché odmietnutie v sprievodcovi.
 *
 * `missingProductIds` sa dopĺňa LEN keď sa dá overiť
 * ──────────────────────────────────────────────────
 * Payload stavu ich zámerne nenesie a `blockers.ts` je fail-closed: neoverené
 * nie je to isté ako overene v poriadku. Obrazovka si preto pamätá stav
 * v shope pri každom riadku, ktorý používateľ videl, a zoznam pošle len vtedy,
 * keď pozná KAŽDÝ vybraný kus. Pri hromadnom výbere podľa filtra ho neposiela
 * vôbec — desaťtisíce riadkov nikto neoveroval a tvrdiť opak by bola lož.
 *
 * Čerstvosť dát je jeden sivý riadok nad tabuľkou a nikde inde (architektúra
 * §0). Je to MERANÝ čas posledného načítania katalógu, preto bez značky `≈`
 * (P7); keď ho ešte niet, obrazovka to povie, nedopočíta. Karta stavu katalógu
 * hovorí o POKROKU načítania, nie o čase — sú to dve rôzne veci.
 *
 * Vlastník: V10.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import BlockerNotes from '@/components/products/BlockerNotes';
import CatalogFilters from '@/components/products/CatalogFilters';
import CatalogStatusPanel from '@/components/products/CatalogStatusPanel';
import CatalogTable from '@/components/products/CatalogTable';
import ProductDetailPanel from '@/components/products/ProductDetailPanel';
import SelectionBar from '@/components/products/SelectionBar';
import type { CatalogSearchView, ShopStatus } from '@/components/products/catalog-api';
import {
  appStatus,
  catalogSyncStatus,
  isAborted,
  runCatalogBatch,
  searchCatalog,
} from '@/components/products/catalog-api';
import type { CatalogFilterState, PerPage } from '@/components/products/catalog-filter';
import {
  catalogFilterKey,
  DEFAULT_CATALOG_FILTER,
  newDiscountHref,
  parseCatalogFilterQuery,
} from '@/components/products/catalog-filter';
import type { CatalogRunView, CatalogStatusView } from '@/components/products/catalog-status';
import {
  CATALOG_PANEL_BLOCKERS,
  catalogEmptyView,
  dropBlockers,
  filterIsNarrowed,
  pickBlockers,
  rowReason,
  SELECTION_BLOCKERS,
  toRunView,
} from '@/components/products/catalog-status';
import type { SavedFilter } from '@/components/products/saved-filters';
import { readSavedFilters, removeFilter, saveFilter } from '@/components/products/saved-filters';
import EmptyState from '@/components/ui/EmptyState';
import Note from '@/components/ui/Note';
import { LOGIC_TIME_ZONE } from '@/lib/domain/dates';
import type { Blocker } from '@/lib/status/blockers';
import { collectOperationBlockers, collectProductBlockers } from '@/lib/status/blockers';
import type { StatusPayload, StatusSnapshotOverlay } from '@/lib/status/snapshot';
import { blockerFromWire, statusSnapshotFromPayload } from '@/lib/status/snapshot';
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Vynúti nové načítanie po chybe bez toho, aby sa dotkol filtra. */
  const [reloadTick, setReloadTick] = useState(0);

  /* Stav appky (prekážky, strop rozsahu) a stav katalógu. Oba sú lacné GETy. */
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [catalog, setCatalog] = useState<CatalogStatusView | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [lastRun, setLastRun] = useState<CatalogRunView | null>(null);
  const [running, setRunning] = useState(false);
  /** Prepočíta stav po dávke, bez toho, aby sa dotkol filtra. */
  const [statusTick, setStatusTick] = useState(0);

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

  /* Uložené filtre — len raz, pri otvorení. */
  useEffect(() => {
    setSaved(readSavedFilters());
  }, []);

  /* Stav appky a stav katalógu. Ani jedno volanie nechodí na shop. */
  useEffect(() => {
    const controller = new AbortController();
    void appStatus(controller.signal).then((res) => {
      if (res.ok) {
        setStatus(res.data);
        setStatusFailed(false);
        return;
      }
      // Bez stavu appka nepozná stropy ani prekážky. Mlčať by znamenalo tváriť
      // sa, že nič neplatí — a to je presne ten druh ticha, kvôli ktorému
      // používateľ nevie, prečo sa niečo nestalo.
      if (!isAborted(res.error)) setStatusFailed(true);
    });
    void catalogSyncStatus(controller.signal).then((res) => {
      if (res.ok) {
        setCatalog(res.data.catalog);
        setCatalogFailed(false);
        return;
      }
      if (!isAborted(res.error)) setCatalogFailed(true);
    });
    return () => controller.abort();
  }, [statusTick]);

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

  const rows = useMemo(() => (view === null ? [] : view.data), [view]);
  const matching = view === null ? 0 : view.total;
  const catalogTotal = view === null ? 0 : view.catalogTotal;

  /**
   * Stav v shope pri každom riadku, ktorý používateľ počas tejto návštevy
   * videl. Bez toho sa výber naprieč stránkami nedá overiť — a neoverený výber
   * sa `blockers.ts` vyhodnotí prísnejšie, čo je správne, ale zbytočné.
   */
  const seenShopStatus = useRef(new Map<number, ShopStatus>());

  const pageSelected = useMemo(
    () => rows.filter((row) => selected.has(row.productId)).length,
    [rows, selected],
  );

  const detailRow = detailId === null ? undefined : rows.find((row) => row.productId === detailId);

  /* ─────────────────────── Prekážky nad vlastným výberom ─────────────────── */

  const selectedCount = allMatching ? matching : selected.size;

  /**
   * Ktoré z vybraných kusov shop nenašiel. `null` = nedá sa overiť a zoznam sa
   * NEPOSIELA — fail-closed je tu úmysel, nie opomenutie.
   */
  const verifiedMissing = useMemo<readonly number[] | null>(() => {
    // Mapa sa dopĺňa PRIAMO TU, nie vo `useEffect`: efekt beží až po vykreslení,
    // takže by tento prepočet vždy pracoval s predošlou stránkou. Zápis je
    // idempotentný — opakovaný beh memoizácie nič nepokazí.
    const seen = seenShopStatus.current;
    for (const row of rows) seen.set(row.productId, row.shopStatus);

    if (allMatching) return null;
    const ids = [...selected];
    if (!ids.every((id) => seen.has(id))) return null;
    return ids.filter((id) => seen.get(id) === 'not_found');
  }, [allMatching, selected, rows]);

  const selectionBlockers = useMemo<readonly Blocker[]>(() => {
    if (status === null) return [];
    const overlay: StatusSnapshotOverlay = {
      selection: { selectedCount },
      ...(verifiedMissing === null ? {} : { missingProductIds: verifiedMissing }),
    };
    const all = collectOperationBlockers(statusSnapshotFromPayload(status, overlay));
    return pickBlockers(all, SELECTION_BLOCKERS);
  }, [status, selectedCount, verifiedMissing]);

  const catalogBlockers = useMemo<readonly Blocker[]>(() => {
    if (status === null) return [];
    return pickBlockers(status.blockers.map(blockerFromWire), CATALOG_PANEL_BLOCKERS);
  }, [status]);

  const detailBlockers = useMemo<readonly Blocker[]>(() => {
    if (status === null || detailRow === undefined) return [];
    const snapshot = statusSnapshotFromPayload(status, {
      selection: { selectedCount: 1, productIds: [detailRow.productId] },
      missingProductIds: detailRow.shopStatus === 'not_found' ? [detailRow.productId] : [],
    });
    // Prekážky celého katalógu už stoja v karte nad tabuľkou — v paneli
    // o jednom kuse by to bola len druhá kópia tej istej vety.
    return dropBlockers(
      collectProductBlockers(detailRow.productId, snapshot),
      CATALOG_PANEL_BLOCKERS,
    );
  }, [status, detailRow]);

  /* ─────────────────────────── Ďalšia dávka katalógu ─────────────────────── */

  const loadBatch = useCallback(() => {
    if (running) return;
    setRunning(true);
    void runCatalogBatch().then((res) => {
      setRunning(false);
      if (!res.ok) {
        if (isAborted(res.error)) return;
        setCatalogFailed(true);
        setLastRun(null);
        return;
      }
      setCatalog(res.data.catalog);
      setCatalogFailed(false);
      setLastRun(toRunView(res.data));
      // Nové riadky aj nové prekážky — obe sa po dávke mohli zmeniť.
      setStatusTick((tick) => tick + 1);
      setReloadTick((tick) => tick + 1);
    });
  }, [running]);

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
  const maxProducts = status === null ? null : status.scope.maxProducts;
  const discountHref = allMatching
    ? newDiscountHref({ kind: 'filter', filter, total: matching })
    : newDiscountHref({ kind: 'products', productIds: [...selected] });

  const empty = catalogEmptyView({ narrowed: filterIsNarrowed(filter), status: catalog });

  return (
    <>
      <CatalogStatusPanel
        status={catalog}
        failed={catalogFailed}
        blockers={catalogBlockers}
        lastRun={lastRun}
        running={running}
        onLoadBatch={loadBatch}
      />

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
              {/* „z … načítaných", nie „z … produktov": kým je katalóg neúplný,
                  druhé číslo je počet riadkov, ktoré appka má — nie veľkosť
                  eshopu. Bez toho slova vyzerá neúplný katalóg ako celý. */}
              <small
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--dim)',
                  marginLeft: '6px',
                  letterSpacing: 0,
                }}
              >
                z {formatCountSk(catalogTotal)} načítaných
              </small>
            </span>
          </div>

          <div className="fresh" data-testid="catalog-data-as-of">
            {dataAsOfSentence(view === null ? null : view.dataAsOf)}
          </div>

          {/* Strop rozsahu a chýbajúce kusy — nad tabuľkou, teda tam, kde sa
              výber robí, a nie až v sprievodcovi ako tiché odmietnutie. */}
          <BlockerNotes
            blockers={selectionBlockers}
            here="/produkty"
            testId="selection-blockers"
          />

          {statusFailed ? (
            <div style={{ marginTop: '8px' }}>
              <Note variant="warn" testId="status-failed">
                Aké stropy a prekážky teraz platia, sa nepodarilo zistiť — obrazovka ich preto
                neukazuje.{' '}
                <span className="lvl-3" style={{ display: 'inline' }}>
                  Vyberať sa dá ďalej, ale koľko produktov naozaj prejde, potvrdí až náhľad zľavy.
                  Skúste obrazovku obnoviť.
                </span>
              </Note>
            </div>
          ) : null}

          {error === null ? (
            <div style={{ marginTop: '10px' }}>
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
                rowReason={rowReason}
                emptyState={
                  <EmptyState
                    title={empty.title}
                    description={empty.description}
                    action={
                      empty.offerLoad ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={loadBatch}
                          disabled={running}
                          data-testid="catalog-empty-load"
                        >
                          {running ? 'Načítavam ďalšiu dávku…' : 'Načítať ďalšiu dávku'}
                        </button>
                      ) : undefined
                    }
                    testId="catalog-empty"
                  />
                }
              />
            </div>
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
          blockers={detailBlockers}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  );
}

export default CatalogPanel;
