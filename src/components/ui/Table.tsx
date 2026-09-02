/**
 * Aura Zľavy — TABUĽKA NA 41 348 RIADKOV A 12 STĹPCOV (D133, D137).
 *
 * Predloha: `aura-roadmap/src/components/ui/Table.tsx`. Portuje sa TVAR
 * A PRAVIDLO, nie súbor (D142) — a tri veci sú tu inak, každá z dôvodu, ktorý
 * si tento repo zaplatil:
 *
 *  1. **Bunka nevracia uzol, vracia POPIS bunky** (`TableCell`). Predloha má
 *     `render: (row) => ReactNode`, čo je pre appku, ktorá má pri KAŽDOM čísle
 *     tretiu možnosť („nevieme"), o jeden údaj málo: tabuľka potom nevie
 *     rozoznať hodnotu od priznania a nemá čo stlmiť. Tvar `TableCell` je
 *     zámerne ten istý ako `ProductCellView` z `lib/ui/product-columns.ts`
 *     (`text` → `content`, `unknown`, `lowerBound`, `title`), takže jednotné
 *     stĺpce sa sem podávajú bez prekladu — a `?? 0` sa nemá kde vlúdiť.
 *  2. **Žiadny `lucide-react`** (D146). Smer triedenia kreslí miestny
 *     `Icon.tsx`; ikonové propy berú `ReactNode`.
 *  3. **Vzhľad je v CSS module vedľa komponentu** (D143), nie v `globals.css`.
 *
 * ČO TÁTO TABUĽKA MUSÍ ZVLÁDNUŤ (D137, voľba Samuela)
 * ───────────────────────────────────────────────────
 * Kompaktná hustota ~36 px, **prilepená hlavička** a **prilepené prvé dva
 * stĺpce** (referencia, názov). Pri 12 stĺpcoch a 41 348 riadkoch je to jediný
 * spôsob, ako sa v tabuľke neztratiť: kto dorolluje k marži, musí ešte vedieť,
 * o ktorý kus ide. Prepínač hustoty kontrakt zo rozsahu VYLÚČIL (§5) — jedna
 * hustota, žiadne nastavenie.
 *
 * VODOROVNE SA POSÚVA TABUĽKA, NIE STRÁNKA
 * ────────────────────────────────────────
 * Rám (`.frame`) je uzavretý: posuv v oboch osiach patrí `.scroll` vnútri
 * neho (P4). Telo stránky sa vodorovne posúvať NESMIE — hlavička appky,
 * lišta filtrov ani pätka so stránkovaním sa pri dvanástom stĺpci nesmú
 * odsunúť mimo obraz. Preto je pätka (`footer`) ZA posuvnou plochou, nie v nej.
 *
 * PRILEPENÝ STĹPEC POTREBUJE ČÍSLO, KTORÉ CSS NEVIE
 * ─────────────────────────────────────────────────
 * `position: sticky` na `<td>` potrebuje `left` — a druhý prilepený stĺpec ho
 * má až za šírkou prvého. CSS šírky stĺpcov nepozná, takže odsadenie počíta
 * `stickyOffsets()` z `width` deklarovaných stĺpcov a dodáva ho inline.
 * Stĺpec, pred ktorým niektorý `width` chýba, sa **neprilepí** (dostane
 * `null`) — radšej nech sa neprilepí, než aby sa prilepil na zlé miesto
 * a prekryl susedný stĺpec.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 *  A. **Priznanie sa stlmí, nezmizne** (I11, §4 bod 1 kontraktu V6). Tabuľka
 *     obsah bunky NIKDY neprepisuje: pomlčku (U+2014) aj znak `≥` dodáva
 *     volajúci a tabuľka ich len OZNAČÍ — `data-value="unknown"` /
 *     `"lower-bound"` / `"known"`. Vďaka tomu sa dá jedným selektorom overiť,
 *     že sa priznanie na obrazovku dostalo, a nie je to grep nad textom.
 *  B. **Pomlčka má aj slovo.** Čítačka pomlčku spravidla neprečíta, takže
 *     riadok by znel ako prázdny — a to je „tichšie", nie „krajšie". Bunka
 *     s priznaním preto nesie `TABLE_UNKNOWN_WORD` v texte len pre čítačku.
 *     VIDITEĽNE sa nemení nič.
 *  C. **Smer triedenia je pre čítačku na `<th aria-sort>`, nie v texte.**
 *     Ikona ho hovorí OKU; keby ho hovoril aj text, čítačka ho prečíta
 *     dvakrát. Text pre čítačku pomenúva AKCIU („zoradiť"), nikdy smer.
 *  D. **Riadok je klikateľný len na požiadanie** (`rowsClickable`). Tabuľka,
 *     ktorá vyzerá klikateľne a nič nerobí, je najhoršia UX pasca tejto
 *     rodiny; preto bez tohto príznaku riadok nemá ani kurzor, ani fokus.
 *  E. **Zvýraznený riadok nie je stav.** Pozadie je druhý kanál k skutočnému
 *     ovládaču v bunke (zaškrtávacie pole s vlastným menom). Kto by výber
 *     označil len farbou, porušil pravidlo troch kanálov.
 *  F. **`caption` je povinný.** Je to meno tabuľky pre čítačku a pri troch
 *     tabuľkách produktov na troch obrazovkách je „tabuľka" bez mena
 *     nepoužiteľná. Voliteľný `caption` by za mesiac chýbal všade.
 *  G. **`data-col` je členstvo v jednotnej sade, nie kľúč stĺpca** (D124).
 *     Prvá podoba tohto primitíva vypisovala `data-col={column.key}`, teda na
 *     KAŽDÝ stĺpec — a tým sa v tabuľke Produktov stratil rozdiel medzi
 *     stĺpcom sady a stĺpcom obrazovky (`Zľava teraz`, `Posledný predaj`).
 *     Členstvo sa potom nedalo prečítať z vykresleného `<thead>`, čo je jediná
 *     poistka proti rozídeniu troch tabuliek produktov. Vypisuje sa preto
 *     `colId`, ktorý stĺpec mimo sady nemá; menovku bunky nesie `data-l`
 *     (`cardLabel`) — pozri ich docbloky.
 *
 * Server-safe: žiadne hooky, žiadne `use client`. Obrazovka, ktorá podá
 * `onSortChange` alebo `onRowClick`, je klientská sama — tabuľka tú hranicu
 * neposúva (rovnako ako `Icon.tsx` a `primitives.ts`).
 *
 * Vlastník: V6a, skupina „Tabuľka" (D133).
 */
import type { ReactNode } from 'react';

import Icon from '@/components/ui/Icon';
import styles from '@/components/ui/tables.module.css';

/** Zlepenie tried. Rovnaký vzor ako `Icon.tsx` a `ToneBadge.tsx` — v repe
 *  nie je zdieľaný `cx()` a zavádzať ho popri tomto vzore by bol dvojník. */
const cls = (...parts: readonly (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

/* ═══════════════════════════ 1. Popis bunky ═══════════════════════════════ */

/**
 * Slovo, ktoré namiesto pomlčky prečíta čítačka (bod B hlavičky). Nie je to
 * viditeľný text — pomlčka zostáva pomlčkou.
 */
export const TABLE_UNKNOWN_WORD = 'nevieme';

/** Tri stavy jednej bunky, tak ako ich vidí DOM aj test. */
export type TableCellState = 'known' | 'unknown' | 'lower-bound';

/**
 * Jedna bunka: čo sa vykreslí a ČI JE TO HODNOTA.
 *
 * `unknown` a `lowerBound` sa navzájom vylučujú — priznanie „nevieme" je
 * silnejšie tvrdenie a vyhráva (hodnota, ktorú nemáme, nemôže byť ani dolnou
 * hranicou). Tvar je zámerne prekladom `ProductCellView`: `content` ← `text`,
 * ostatné polia sa menujú rovnako.
 */
export interface TableCell {
  /** Obsah bunky. Pomlčku ani `≥` tabuľka nevyrába — dodáva ich volajúci. */
  readonly content: ReactNode;
  /** `true` ⇔ toto je priznanie „nevieme", nie hodnota (I11). */
  readonly unknown?: boolean;
  /** `true` ⇔ hodnota JE, ale je to len dolná hranica (`≥`, chýbajú dni). */
  readonly lowerBound?: boolean;
  /** Čo tá hodnota (alebo medzera) znamená. Ide do `title` bunky. */
  readonly title?: string | null;
}

/** V akom z troch stavov bunka je. Jedna funkcia pre DOM aj pre testy. */
export function tableCellState(cell: TableCell): TableCellState {
  if (cell.unknown === true) return 'unknown';
  if (cell.lowerBound === true) return 'lower-bound';
  return 'known';
}

/* ═══════════════════════════ 2. Popis stĺpca ══════════════════════════════ */

export type SortDirection = 'asc' | 'desc';

export interface TableSort {
  /** `key` stĺpca, podľa ktorého sa triedi. */
  readonly key: string;
  readonly dir: SortDirection;
}

export interface TableColumn<T> {
  /** Stabilný kľúč; je to zároveň kľúč triedenia posielaný do `onSortChange`. */
  readonly key: string;
  /**
   * KTORÝ STĹPEC JEDNOTNEJ SADY to je (`data-col`) — a nič iné (D124).
   *
   * V tomto repe má `data-col` jeden význam a nesú ho všetky tri tabuľky
   * produktov: „táto bunka je stĺpec `reference` / `margin` / … jednotnej
   * sady". Stĺpec MIMO sady ho preto NEMÁ — presne tak, ako ho nemá „Pásmo"
   * v sprievodcovi novej zľavy ani „Zapísané" v položkách kampane. Podľa toho
   * sa dá z vykresleného `<thead>` prečítať, či je sada celá a v záväznom
   * poradí, čo je jediný spôsob, ako sa tie tri tabuľky nerozídu.
   *
   * Preto to NIE JE `key`: kľúč je vec tabuľky (React, triedenie) a keby ho
   * primitívum vypisovalo ako `data-col`, každý stĺpec by tvrdil, že je
   * v jednotnej sade — a členstvo v sade by prestalo byť merateľné.
   */
  readonly colId?: string;
  /**
   * Menovka BUNKY (`data-l`) — čo v tejto bunke stojí, povedané slovom.
   *
   * Je to strojové meno faktu v riadku: `data-col` hovorí „ktorý stĺpec sady",
   * `data-l` hovorí „ako sa tomu hovorí človeku". Nesú ju všetky ostatné
   * tabuľky appky (audit, nastavenia, položky kampane), takže bez nej by bola
   * tabuľka na primitíve jediná, ktorej bunky sa nedajú pomenovať — a v úzkom
   * kartovom rozložení (`globals.css`, `td[data-l]::before`) je to jediné
   * miesto, odkiaľ sa meno faktu berie.
   *
   * Nemusí to byť to isté, čo `header`: bunka smie obsahovať viac než jeden
   * údaj (meno + kód + príznaky) a vtedy sa menuje tým, čo v nej stojí.
   */
  readonly cardLabel?: string;
  /** Nadpis stĺpca — jediné meno, aké tento stĺpec na obrazovke má. */
  readonly header: ReactNode;
  /** Čo stĺpec znamená a čo NEznamená. Ide do `title` hlavičky. */
  readonly headerTitle?: string;
  /** `right` = doprava a tabulárne číslice. Pre KAŽDÝ číselný stĺpec. */
  readonly align?: 'left' | 'right';
  /**
   * Šírka stĺpca (`88px`, `22%`). Pri prilepených stĺpcoch NIE JE ozdoba:
   * bez nej sa nasledujúci prilepený stĺpec nemá o čo odsadiť — pozri
   * `stickyOffsets()`.
   */
  readonly width?: string;
  readonly sortable?: boolean;
  /**
   * Dlhý text sa smie skrátiť výpustkou. Referencia ju NEDOSTÁVA nikdy —
   * orezaný identifikátor je iný identifikátor (D122).
   */
  readonly truncate?: boolean;
  /** Bunka riadku vrátane všetkých troch stavov. */
  cell: (row: T, index: number) => TableCell;
}

/** Čo tabuľka vie o jednom riadku nad rámec jeho buniek. */
export interface TableRowMeta {
  /** Riadok je vo výbere. Pozadie je DRUHÝ kanál — pozri bod E hlavičky. */
  readonly selected?: boolean;
  /** Riadok je tlmený (napr. skončená zľava). Nie je to stav, len dôraz. */
  readonly muted?: boolean;
  readonly testId?: string;
}

/* ═══════════════════════════ 3. Prilepené stĺpce ══════════════════════════ */

/**
 * Odsadenie zľava pre prvých `stickyColumns` stĺpcov; `null` = neprilepiť.
 *
 * Prvý prilepený stĺpec stojí na `0px`. Každý ďalší stojí za súčtom šírok
 * predchádzajúcich, teda `calc(88px + 260px)`. Keď niektorá z tých šírok
 * chýba, súčet neexistuje — a namiesto odhadu sa stĺpec (a všetky ďalšie)
 * NEPRILEPÍ. Prilepený stĺpec na zlom mieste prekryje susedný a je to horšie
 * než stĺpec, ktorý sa posúva s ostatnými.
 *
 * Čistá funkcia mimo Reactu, aby sa dala overiť bez prehliadača.
 */
export function stickyOffsets(
  columns: readonly { readonly width?: string }[],
  stickyColumns: number,
): readonly (string | null)[] {
  const wanted = Number.isFinite(stickyColumns) ? Math.trunc(stickyColumns) : 0;
  const count = Math.max(0, Math.min(wanted, columns.length));
  const offsets: (string | null)[] = [];
  const widths: string[] = [];
  let unmeasured = false;

  for (let i = 0; i < columns.length; i += 1) {
    if (i >= count || unmeasured) {
      offsets.push(null);
      continue;
    }
    if (widths.length === 0) offsets.push('0px');
    else if (widths.length === 1) offsets.push(widths[0] as string);
    else offsets.push(`calc(${widths.join(' + ')})`);

    const width = columns[i]?.width;
    // Turbopack tu už raz zahodil skrátený guard — porovnáva sa explicitne.
    if (width === undefined || width === null || width.trim() === '') unmeasured = true;
    else widths.push(width.trim());
  }

  return offsets;
}

/* ═══════════════════════════ 4. Tabuľka ═══════════════════════════════════ */

export interface TableProps<T> {
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  /** Meno tabuľky pre čítačku. Povinné — pozri bod F hlavičky. */
  caption: string;
  rowMeta?: (row: T, index: number) => TableRowMeta;
  /**
   * Riadok sa dá kliknúť (a klávesou aktivovať). Bez tohto príznaku riadok
   * nemá kurzor ani fokus — bod D hlavičky.
   */
  rowsClickable?: boolean;
  onRowClick?: (row: T, index: number) => void;
  sort?: TableSort;
  /** Dostane `key` stĺpca; smer si cyklí volajúci (pozná svoje dáta). */
  onSortChange?: (key: string) => void;
  /** Koľko PRVÝCH stĺpcov sa prilepí vodorovne (D137: na Produktoch dva). */
  stickyColumns?: number;
  /** Čo sa vykreslí namiesto riadkov, keď žiadne nie sú (`EmptyState`). */
  empty?: ReactNode;
  loading?: boolean;
  loadingRows?: number;
  /** Pätka rámu — sem patrí `Pagination`. Neposúva sa s tabuľkou. */
  footer?: ReactNode;
  className?: string;
  testId?: string;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  rowMeta,
  rowsClickable = false,
  onRowClick,
  sort,
  onSortChange,
  stickyColumns = 0,
  empty,
  loading = false,
  loadingRows = 6,
  footer,
  className,
  testId,
}: TableProps<T>) {
  const clickable = rowsClickable && typeof onRowClick === 'function';
  const pins = stickyOffsets(columns, stickyColumns);
  /** Index poslednej naozaj prilepenej bunky — tá nesie hranu. */
  const lastPin = pins.reduce<number>((last, offset, i) => (offset === null ? last : i), -1);

  return (
    <div className={cls(styles.frame, className)} data-testid={testId}>
      <div className={styles.scroll}>
        <table className={styles.table} aria-busy={loading ? true : undefined}>
          <caption className={styles.srOnly}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column, i) => {
                const active = sort !== undefined && sort.key === column.key;
                const dir = active && sort !== undefined ? sort.dir : null;
                const offset = pins[i] ?? null;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    title={column.headerTitle}
                    data-col={column.colId}
                    className={cls(
                      styles.head,
                      column.align === 'right' && styles.num,
                      offset === null ? false : styles.pin,
                      offset === null ? false : styles.pinHead,
                      offset === null ? false : i === lastPin && styles.pinEdge,
                    )}
                    style={{
                      ...(column.width === undefined ? {} : { width: column.width }),
                      ...(offset === null ? {} : { left: offset }),
                    }}
                    aria-sort={
                      active && dir !== null
                        ? dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : column.sortable === true
                          ? 'none'
                          : undefined
                    }
                  >
                    {column.sortable === true && onSortChange !== undefined ? (
                      <button
                        type="button"
                        className={styles.sortBtn}
                        onClick={() => onSortChange(column.key)}
                        data-testid={`sort-${column.key}`}
                      >
                        {column.header}
                        {/* Smer hovorí OKU ikona a čítačke `aria-sort` na
                            `<th>` — v texte sa nezdvojuje (bod C hlavičky). */}
                        {dir === null ? null : (
                          <Icon name={dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={0.85} />
                        )}
                        <span className={styles.srOnly}>, zoradiť</span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: Math.max(1, loadingRows) }, (_, r) => (
                <tr key={`wait-${r}`} className={styles.row}>
                  {columns.map((column, i) => {
                    const offset = pins[i] ?? null;
                    return (
                      <td
                        key={column.key}
                        className={cls(
                          styles.cell,
                          offset === null ? false : styles.pin,
                          offset === null ? false : i === lastPin && styles.pinEdge,
                        )}
                        style={offset === null ? undefined : { left: offset }}
                      >
                        <span className={styles.wait} aria-hidden="true" />
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr className={styles.row}>
                <td className={cls(styles.cell, styles.emptyCell)} colSpan={columns.length}>
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const meta = rowMeta === undefined ? {} : rowMeta(row, index);
                return (
                  <tr
                    key={rowKey(row, index)}
                    className={cls(
                      styles.row,
                      clickable && styles.rowClickable,
                      meta.selected === true && styles.rowSelected,
                      meta.muted === true && styles.rowMuted,
                    )}
                    data-selected={meta.selected === true ? 'true' : undefined}
                    data-testid={meta.testId}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onRowClick?.(row, index) : undefined}
                    onKeyDown={
                      clickable
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onRowClick?.(row, index);
                            }
                          }
                        : undefined
                    }
                  >
                    {columns.map((column, i) => {
                      const cell = column.cell(row, index);
                      const state = tableCellState(cell);
                      const offset = pins[i] ?? null;
                      return (
                        <td
                          key={column.key}
                          className={cls(
                            styles.cell,
                            column.align === 'right' && styles.num,
                            column.truncate === true && styles.truncate,
                            state === 'unknown' && styles.unknown,
                            state === 'lower-bound' && styles.bound,
                            offset === null ? false : styles.pin,
                            offset === null ? false : i === lastPin && styles.pinEdge,
                          )}
                          style={offset === null ? undefined : { left: offset }}
                          title={cell.title ?? undefined}
                          data-l={column.cardLabel}
                          data-col={column.colId}
                          data-value={state}
                        >
                          {cell.content}
                          {/* Bod B hlavičky — pomlčka dostane slovo, ktoré
                              čítačka prečíta. Viditeľne sa nemení nič. */}
                          {state === 'unknown' ? (
                            <span className={styles.srOnly}>{TABLE_UNKNOWN_WORD}</span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {loading ? (
        <p className={styles.srOnly} role="status">
          Riadky tabuľky sa načítavajú.
        </p>
      ) : null}
      {footer}
    </div>
  );
}

export default Table;
