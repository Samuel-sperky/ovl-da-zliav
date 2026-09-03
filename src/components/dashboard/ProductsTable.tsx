'use client';

/**
 * Aura Zľavy — TABUĽKA PRODUKTOV NA PREHĽADE (V7, D159–D163).
 *
 * Tretia zo štyroch sekcií Prehľadu (D152) a ROZPIS TRETEJ KPI KARTY: stĺpce
 * „predané za okno" a „predané/sklad" sú tá istá veličina, akú nesie karta
 * „Predané na sklad", takže tabuľka ide s prepínačom KARIET, nie s prepínačom
 * grafu (D155). Vlastné okno preto NEDRŽÍ — dostáva ho propom a
 * `prehlad-kpi-okno.spec.ts` §B padne, keby si otvorila druhý stav.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 *  A. **RIADOK NIE JE KLIKATEĽNÝ** (D163). `rowsClickable` sa tejto tabuľke
 *     nepodáva a `onRowClick` neexistuje. Prehľad je na ČÍTANIE; detail,
 *     výber a obohacovanie strany zostávajú v Produktoch. Bočný panel ani
 *     výber sa tu nekreslia zámerne: druhá plná kópia tabuľky by sa o mesiac
 *     rozišla s prvou. Tabuľka bez tohto príznaku nemá ani kurzor, ani fokus
 *     na riadku (bod D hlavičky `ui/Table`), takže ani nevyzerá klikateľne.
 *
 *  B. **Zamknuté filtre sa kreslia VIDITEĽNE ZAMKNUTÉ, nie funkčne** (K7,
 *     D160, D125). Kategória, kov a typ šperku sú tri rozmery, na ktoré appka
 *     NEMÁ stĺpec v zrkadle katalógu. Samuel ich chce vidieť — takže sú na
 *     obrazovke ako `LockBadge` s dôvodom, NIE ako čipy, ktoré sa dajú
 *     stlačiť. Zoznam sa berie VÝHRADNE z `locked-dimensions.ts`; druhý
 *     zoznam vedľa neho by sa rozišiel a filter bez dátového zdroja je sľub,
 *     ktorý appka nedodrží.
 *
 *  C. **Triedenie má TRI stavy a `aria-sort`** (D162). Smer nesie
 *     `aria-sort` na `<th>` (kreslí ho primitívum), tretí stav je zrušené
 *     poradie — `sort=id`, teda pôvodné poradie zrkadla. Rozhoduje o tom
 *     `nextSortState()` v modeli, nie tento súbor.
 *
 *  D. **Priznanie sa stlmí, nezmizne** (I11). Text bunky vrátane pomlčky a
 *     znaku `≥` dodáva jednotný stĺpec (`lib/ui/product-columns.ts`); tabuľka
 *     ho NEPREPISUJE, len ho označí (`data-value`). `?? 0` sa preto nemá kde
 *     vlúdiť.
 *
 *  E. **Filtruje SERVER.** Riadky, ktoré prišli, sa tu nezužujú ani
 *     nepretriedia. Zúžiť naklikanú stránku by znamenalo tvrdiť o 41 348
 *     riadkoch niečo, čo appka overila na päťdesiatich.
 *
 *  F. **Na shop z tejto sekcie neodíde ani jeden request** (K8). Obe volania
 *     (`/api/catalog/search`, `/api/insights/product-kpi`) sú `SELECT`-y nad
 *     miestnou kópiou; `?lookup=1` ani `POST /api/catalog/enrich` sa odtiaľto
 *     nespúšťajú.
 *
 * KDE ČO ŽIJE: model a query v `products-table-view.ts`, čítanie
 * v `products-table-api.ts`, vzhľad v `products-table.module.css` (D143).
 *
 * Vlastník: V7, krok 3/4 (tabuľka s filtrami).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import styles from '@/components/dashboard/products-table.module.css';
import {
  getCatalogPage,
  getKpiPage,
  type OverviewCatalogPage,
  type OverviewKpiPage,
} from '@/components/dashboard/products-table-api';
import {
  DEFAULT_TABLE_QUERY,
  DISCOUNT_FILTERS,
  PER_PAGE_CHOICES,
  SOLD_BANDS,
  enrichedRowsNote,
  isDiscountFilter,
  isPerPage,
  isSortableColumn,
  lockedFilterViews,
  nextSortState,
  overviewRowValues,
  overviewTableColumns,
  overviewTableQueryString,
  sortActionTitle,
  unknownSoldNote,
  type DiscountFilterCode,
  type OverviewTableQuery,
  type SoldBandCode,
} from '@/components/dashboard/products-table-view';
import type { SoldWindow } from '@/components/dashboard/sold-window';
import { ErrorState, NoResultsState, RESET_FILTERS_LABEL } from '@/components/states';
import {
  Button,
  Chip,
  FilterToolbar,
  LockBadge,
  Note,
  Pagination,
  Panel,
  PanelBody,
  PanelHead,
  Segmented,
  Table,
  ToolbarSearch,
  type TableCell,
  type TableColumn,
} from '@/components/ui';
import { describeActionFailure } from '@/lib/ui/action-failure';
import { LOCKED_DIMENSION_REASON } from '@/lib/ui/locked-dimensions';
import type { ProductCellView } from '@/lib/ui/product-columns';
import { dayCount } from '@/components/campaigns/queue-model';

/** Meno sekcie. Jedna formulácia — dve by sa raz rozišli. */
export const TABLE_TITLE = 'Produkty';

/** Čo tabuľka je, povedané raz. Je to ROZPIS karty, nie druhá obrazovka. */
export const TABLE_SUBTITLE_LEAD = 'Rozpis karty „Predané na sklad" po produktoch';

/**
 * Bunka jednotného stĺpca → bunka primitíva.
 *
 * Text ani značky sa NEPREPISUJÚ (bod D hlavičky). `data-unknown` na samotnom
 * texte je druhá, strojová cesta k tomu istému faktu: primitívum hlási stav na
 * `<td data-value>` (to je zdroj VZHĽADU), kým značka na texte je to, čo sa dá
 * v teste adresovať v riadku o deviatich bunkách. Obe vznikajú z toho istého
 * objektu v tom istom volaní, takže sa nemajú ako rozísť.
 */
function unifiedCell(cell: ProductCellView, testId?: string): TableCell {
  return {
    content: (
      <span
        data-testid={testId}
        data-unknown={cell.unknown ? 'true' : undefined}
        data-lower-bound={cell.lowerBound ? 'true' : undefined}
      >
        {cell.text}
      </span>
    ),
    unknown: cell.unknown,
    lowerBound: cell.lowerBound,
    title: cell.title,
  };
}

/**
 * Šírky stĺpcov. Prilepené sú PRVÉ DVA (D159), a `position: sticky` na `<td>`
 * potrebuje `left` — to počíta `stickyOffsets()` zo šírok deklarovaných tu.
 * Stĺpec, pred ktorým šírka chýba, sa NEPRILEPÍ, takže referencia aj názov ju
 * mať MUSIA.
 */
const WIDTH: Readonly<Record<string, string>> = {
  reference: '128px',
  name: '300px',
  price: '104px',
  discountNow: '120px',
  soldWindow: '112px',
  soldPerStock: '120px',
  stock: '96px',
  margin: '136px',
  ean13: '148px',
};

/** Koľko PRVÝCH stĺpcov sa prilepí (D159: referencia a názov). */
const STICKY_COLUMNS = 2;

/** Pod týmto počtom strán stránkovač vypisuje čísla bez skoku na stranu. */
const JUMP_FROM_PAGES = 8;

export interface ProductsTableProps {
  /**
   * Okno prepínača KARIET (D155). Vlastný stav tabuľka nedrží — dostáva ho
   * z `Overview.tsx`, takže stĺpce hovoria o tom istom období ako tretia karta.
   */
  soldWindow: SoldWindow;
}

export function ProductsTable({ soldWindow }: ProductsTableProps) {
  const [query, setQuery] = useState<OverviewTableQuery>(DEFAULT_TABLE_QUERY);
  /** `undefined` = ešte sme nežiadali (kostra), `null` = nečitateľná odpoveď. */
  const [page, setPage] = useState<OverviewCatalogPage | null | undefined>(undefined);
  const [kpi, setKpi] = useState<OverviewKpiPage | null | undefined>(undefined);
  const [busy, setBusy] = useState<boolean>(false);

  /**
   * Poradové číslo načítania. Odpoveď staršieho dotazu sa NESMIE zapísať nad
   * novší: človek prepne filter dvakrát rýchlo za sebou a bez tohto by na
   * obrazovke skončili riadky prvej otázky pod hlavičkou druhej.
   */
  const runId = useRef(0);

  const load = useCallback(
    async (next: OverviewTableQuery, days: SoldWindow) => {
      const run = runId.current + 1;
      runId.current = run;
      setBusy(true);
      const rows = await getCatalogPage(overviewTableQueryString(next, days));
      if (runId.current !== run) return;
      setPage(rows);
      /*
       * KPI sa ťahajú AŽ PRE ZOBRAZENÉ ID (D123 to isté robí v Produktoch).
       * Nečitateľná stránka nemá ID, takže sa druhý dotaz nepošle vôbec —
       * `null` je vtedy „nevieme", nie prázdna mapa.
       */
      const ids = rows === null ? [] : rows.rows.map((row) => row.productId);
      const kpiPage = rows === null ? null : await getKpiPage(ids, days);
      if (runId.current !== run) return;
      setKpi(kpiPage);
      setBusy(false);
    },
    [],
  );

  /*
   * Načítanie pri otvorení a po každej RUČNEJ zmene (filter, poradie, strana,
   * okno kariet). Nič sa neobnovuje samo (kontrakt, bod 4) — zmena okna alebo
   * filtra je akcia človeka, takže načítanie po nej je tá istá kategória ako
   * stlačenie Obnoviť, nie automatické obnovovanie zadnými dverami.
   */
  useEffect(() => {
    void load(query, soldWindow);
  }, [load, query, soldWindow]);

  /** Zmena filtra vracia stránkovanie na prvú stranu — inak by sa ukázalo prázdno. */
  const change = useCallback((patch: Partial<OverviewTableQuery>) => {
    setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  }, []);

  const toggleBand = useCallback(
    (code: SoldBandCode) => {
      setQuery((current) => {
        const on = current.bands.includes(code);
        const bands = on
          ? current.bands.filter((entry) => entry !== code)
          : [...current.bands, code];
        return { ...current, bands, page: 1 };
      });
    },
    [],
  );

  const onSortChange = useCallback((key: string) => {
    // Fail-closed: kľúč, ktorý nie je triediteľný stĺpec, poradie NEZMENÍ.
    if (!isSortableColumn(key)) return;
    setQuery((current) => ({ ...current, sort: nextSortState(current.sort, key), page: 1 }));
  }, []);

  const filtered =
    query.search.trim() !== '' || query.discount !== 'all' || query.bands.length > 0;

  const resetAll = useCallback(() => {
    setQuery({ ...DEFAULT_TABLE_QUERY });
  }, []);

  /*
   * Dĺžka okna do nadpisu stĺpca. Berie sa z ODPOVEDE KPI, nie z prepínača:
   * nadpis „Predané 360 d" nad číslom za iné okno je presne ten druh tichého
   * rozchodu, ktorý `product-kpi` route vo svojej hlavičke menuje. Kým odpoveď
   * nie je, drží sa to, o čo obrazovka požiadala.
   */
  const windowDays = kpi === undefined || kpi === null ? soldWindow : kpi.windowDays;
  const columns = overviewTableColumns(windowDays);
  const rows = page === undefined || page === null ? [] : page.rows;
  const counts = page === undefined || page === null ? null : page.counts;

  const sort =
    query.sort === null ? undefined : { key: query.sort.key, dir: query.sort.dir };

  const tableColumns: readonly TableColumn<(typeof rows)[number]>[] = columns.map((column) => {
    const sortable = isSortableColumn(column.id);
    const width = WIDTH[column.id];
    return {
      key: column.id,
      /* Členstvo v jednotnej sade (D124). Tabuľka Prehľadu kreslí CELÚ sadu,
         takže `colId` má každý jej stĺpec — a z vykresleného `<thead>` sa dá
         prečítať, či je sada celá a v poradí. */
      colId: column.id,
      cardLabel: column.label,
      header: column.label,
      headerTitle: sortable
        ? `${column.headTitle} ${sortActionTitle(query.sort, column.id)}`
        : column.headTitle,
      ...(column.numeric ? { align: 'right' as const } : {}),
      ...(width === undefined ? {} : { width }),
      ...(sortable ? { sortable: true } : {}),
      /* Názov sa smie skrátiť výpustkou; referencia ani EAN NIKDY — orezaný
         identifikátor je iný identifikátor (D122, D150). */
      ...(column.id === 'name' ? { truncate: true } : {}),
      cell: (row) =>
        unifiedCell(
          column.cell(overviewRowValues(row, kpi === undefined || kpi === null ? undefined : kpi.byId.get(row.productId))),
          `prehlad-${column.id}-${row.productId}`,
        ),
    };
  });

  const unknownNote = unknownSoldNote(counts === null ? null : counts.soldUnknown, windowDays);
  const enrichedNote = enrichedRowsNote(
    counts === null ? null : counts.enrichedRows,
    counts === null ? null : counts.total,
  );

  return (
    <Panel data-testid="overview-products" className={styles.section}>
      <PanelHead
        title={TABLE_TITLE}
        subtitle={`${TABLE_SUBTITLE_LEAD} za ${dayCount(soldWindow)}.`}
      />
      <PanelBody>
        {/*
          LIŠTA FILTROV (D160). Hľadanie ide na server do `q` a hľadá v NÁZVE,
          REFERENCII a EAN-e naraz (`SEARCH_LIKE_COLUMNS` v repozitári) —
          referencia a EAN sú pritom vyplnené len pri obohatených riadkoch a
          veta pod tabuľkou to priznáva číslom.
        */}
        <FilterToolbar
          chips={
            filtered ? (
              <Chip label="Filter je zapnutý" active testId="prehlad-filter-on" />
            ) : null
          }
          onResetAll={filtered ? resetAll : undefined}
        >
          <ToolbarSearch
            value={query.search}
            onChange={(value) => change({ search: value })}
            placeholder="Názov, referencia alebo EAN"
            ariaLabel="Hľadať v názve, referencii a EAN-e"
            testId="prehlad-hladanie"
          />

          <Segmented<DiscountFilterCode>
            value={query.discount}
            onChange={(value) => {
              /* Fail-closed: hodnota mimo zoznamu filter NEMENÍ. Tichý pád na
                 „Všetky" by rozšíril otázku, na ktorú človek klikol. */
              if (!isDiscountFilter(value)) return;
              change({ discount: value });
            }}
            options={DISCOUNT_FILTERS.map((entry) => ({
              value: entry.code,
              label: entry.label,
              title: `Stav zľavy podľa vlastných zápisov appky: ${entry.label.toLowerCase()}`,
            }))}
            ariaLabel="Stav zľavy podľa vlastných zápisov appky"
            size="sm"
            testId="prehlad-stav-zlavy"
          />

          {/*
            PÁSMA PREDANÝCH (D160). Sú to čipy, nie prepínač: dajú sa
            kombinovať (server ich spája cez OR). Produkt s NEZNÁMYM predajom
            do žiadneho pásma nepatrí (D121) a povedať to musí veta pod
            tabuľkou — číslom, nie mlčaním.
          */}
          <div className={styles.bands} role="group" aria-label="Pásmo predaných za okno">
            <span className={styles.bandsLabel}>Predané</span>
            {SOLD_BANDS.map((band) => (
              <Chip
                key={band.code}
                label={band.label}
                active={query.bands.includes(band.code)}
                onClick={() => toggleBand(band.code)}
                title={`Produkty s ${band.label} predanými kusmi za ${dayCount(soldWindow)}`}
                testId={`prehlad-pasmo-${band.code}`}
              />
            ))}
          </div>
        </FilterToolbar>

        {/*
          TRI ZAMKNUTÉ ROZMERY (K7, D160). Samuel ich chce VIDIEŤ, appka na ne
          nemá stĺpec v zrkadle — takže sú tu ako zámky s dôvodom a NIE ako
          čipy. Zoznam je z `locked-dimensions.ts` (odvodený od typu
          v repozitári), dôvod je jedna veta pre všetky tri: druhá formulácia
          by sa s prvou rozišla.
        */}
        <div className={styles.locked} data-testid="prehlad-zamknute">
          {lockedFilterViews().map((dimension) => (
            <LockBadge
              key={dimension.code}
              label={dimension.label}
              reason={LOCKED_DIMENSION_REASON}
              testId={`prehlad-zamknute-${dimension.code}`}
            />
          ))}
        </div>

        <Table<(typeof rows)[number]>
          className={styles.table}
          testId="prehlad-tabulka"
          caption={`${TABLE_TITLE} — rozpis predaja za ${dayCount(soldWindow)}`}
          columns={tableColumns}
          rows={rows}
          rowKey={(row) => String(row.productId)}
          /* Bod A hlavičky — riadok NIE JE klikateľný (D163). `rowsClickable`
             a `onRowClick` sa tejto tabuľke nepodávajú vôbec. */
          stickyColumns={STICKY_COLUMNS}
          sort={sort}
          onSortChange={onSortChange}
          /* Čakacie prúžky sú LEN kým nie je čo ukázať. Pri prelistovaní
             zostávajú staré riadky — zablikať prázdnom pri každom kliku je
             horšie než chvíľu ukazovať to, čo appka ešte drží. */
          loading={(page === undefined || busy) && rows.length === 0}
          empty={
            page === null ? (
              <ErrorState
                failure={describeActionFailure(null, { action: 'Načítanie tabuľky produktov' })}
                title="Tabuľku produktov sa nepodarilo načítať"
                description="Riadky preto nedopĺňame — prázdna tabuľka by tvrdila, že také produkty nie sú."
                testId="prehlad-tabulka-chyba"
              />
            ) : filtered ? (
              <NoResultsState
                action={
                  <Button small variant="ghost" onClick={resetAll}>
                    {RESET_FILTERS_LABEL}
                  </Button>
                }
                note={
                  <Note variant="info">
                    Hľadá sa v zrkadle katalógu, nie v eshope — a referencia s EAN-om sú v ňom
                    vyplnené len pri obohatených riadkoch.
                  </Note>
                }
                testId="prehlad-tabulka-bez-zhody"
              />
            ) : (
              <NoResultsState
                title="Zrkadlo katalógu je prázdne"
                description="Kým sa katalóg nenačíta, tabuľka nemá čo ukázať."
                testId="prehlad-tabulka-prazdno"
              />
            )
          }
          footer={
            <Pagination
              page={query.page}
              pageSize={query.perPage}
              total={page === undefined || page === null ? 0 : page.total}
              /* P7 — počet je zo ZRKADLA, teda dolná hranica: v eshope ich
                 môže byť viac. Stránkovač to označí `≈` a povie prečo. */
              totalIsLowerBound
              lowerBoundNote="Počet v zrkadle katalógu — v eshope ich môže byť viac."
              onPageChange={(next) => change({ page: next })}
              onPageSizeChange={(size) => {
                /* Fail-closed: neznáma veľkosť stránky sa NEPRIJME. Nad 100 má
                   route KPI strop, takže širšia strana = riadky bez KPI (D161). */
                if (!isPerPage(size)) return;
                change({ perPage: size, page: 1 });
              }}
              pageSizeOptions={PER_PAGE_CHOICES}
              jumpFromPages={JUMP_FROM_PAGES}
              idPrefix="prehlad-tabulka"
              testId="prehlad-strankovac"
            />
          }
        />

        {/* Priznania POD tabuľkou. Sú to vety o tom, čo appka nemeria — a keď
            niet čo povedať, model vráti `null` a nekreslí sa nič (I11). */}
        {unknownNote === null ? null : (
          <Note variant="info" testId="prehlad-nezmerane">
            {unknownNote}
          </Note>
        )}
        {enrichedNote === null ? null : (
          <Note variant="info" testId="prehlad-obohatene">
            {enrichedNote}
          </Note>
        )}
      </PanelBody>
    </Panel>
  );
}

export default ProductsTable;
