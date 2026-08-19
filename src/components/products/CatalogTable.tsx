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
 * pomlčiek cez 41 220 riadkov je šum, nie priznanie. Priznanie je v paneli
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
 * vyplnený pri všetkých 41 220 riadkoch a 41 217 pomlčiek je šum, nie
 * informácia. Príznak sa objaví len tam, kde je čo povedať, a celá veta aj
 * s ďalším krokom čaká v bočnom paneli. Text príznaku sa TU nevyrába —
 * prichádza z `catalog-status.ts`, aby ho tabuľka a panel nemohli povedať inak.
 *
 * PRÁZDNA TABUĽKA NIE JE JEDEN PRÍBEH
 * ───────────────────────────────────
 * „Filtru nevyhovuje ani jeden produkt" je pravda len nad ÚPLNÝM katalógom,
 * a ani tam nie celá: zrkadlo pozná z produktu len názov a číslo, takže hľadaný
 * kus môže existovať a len mať hľadané slovo v kóde či popise — a to je úplne
 * iná rada než „uvoľnite filter". Tabuľka preto o prázdnom stave nerozhoduje:
 * dostane hotový `emptyState` od obrazovky, ktorá stav katalógu pozná.
 *
 * HUSTOTA PRE 41 220 RIADKOV (D10, 19. 8. 2026)
 * ─────────────────────────────────────────────
 * Zmerané na reálnej databáze: 41 220 produktov, priemerný názov 64 znakov,
 * NAJDLHŠÍ 117 znakov, ceny 0,00 – 1 758,46 €.
 *
 * 1. **Mriežka stĺpcov je pevná** (`table-layout: fixed` + `<colgroup>`).
 *    S automatickým rozložením meria prehliadač VŠETKY názvy na stránke
 *    a najdlhší z nich rozhodne, kde začne stĺpec Cena — čísla sa teda pri
 *    každom preklikaní stránky posunú inam a oko ich hľadá odznova. Pri 825
 *    stránkach je to 825 rôznych mriežok. Pevná mriežka to zastaví: čísla
 *    stoja na tom istom mieste na každej stránke a na každom filtri.
 * 2. **Názov je JEDEN riadok s výpustkou; celý je v `title` aj v bočnom
 *    paneli.** Pri 1440 px má stĺpec názvu ≈ 745 px, teda ≈ 112 znakov —
 *    priemerný názov (64) sa doň zmestí aj s rezervou a oreže sa len chvost
 *    tých najdlhších. Zalamovanie sa zamietlo: rôzne vysoké riadky rozbijú
 *    zvislý rytmus, podľa ktorého sa stĺpec Cena skenuje, a stránku z 50
 *    riadkov predĺžia z ≈ 1 600 px na až 2 600 px. Pevné dvojriadkové bunky
 *    by rytmus udržali a zmestili by každý názov, ale platili by +50 % výšky
 *    na KAŽDOM riadku za chvost, ktorý je pri týchto názvoch ozdoba —
 *    rozlišovacia časť („Prevliekací strieborný náhrdelník 925 …") stojí na
 *    začiatku. Na úzkej obrazovke (≤ 640 px) sa riadky menia na karty a názov
 *    sa zalamuje celý; preto tu `white-space` DEDÍ z bunky a nediktuje sa.
 * 3. **Virtualizácia sa nepridáva.** V DOM nikdy nie je 41 220 riadkov —
 *    server stránkuje po 50/100/200. Chýbal spôsob, ako sa na riadok 30 000
 *    DOSTAŤ, nie ako ho vykresliť. Preto skok na stránku a poradie stĺpcov,
 *    nie knižnica navyše.
 * 4. **Skok na stránku sa kreslí až vtedy, keď stránkovač vypúšťa čísla**
 *    (viac než 7 strán). Pri troch stranách by bol políčkom, ktoré nahrádza
 *    kliknutie na číslo vedľa neho.
 *
 * Vlastník: V10; hustota O3.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { CatalogRowView } from '@/components/products/catalog-api';
import type { ProductReason } from '@/components/products/catalog-status';
import type { CatalogSort, PerPage } from '@/components/products/catalog-filter';
import { DEFAULT_CATALOG_FILTER, PER_PAGE_CHOICES } from '@/components/products/catalog-filter';
import { formatEur } from '@/lib/ui/format';
import Icon from '@/components/ui/Icon';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Pomôcky ═══════════════════════════════════ */

/**
 * Meno produktu ako tlačidlo. `display: block` + `width: 100%` je to, čo dá
 * výpustke rám, v ktorom má orezávať; `whiteSpace: 'inherit'` je zámerné —
 * v širokom rozložení dedí `nowrap` z bunky, v kartovom (≤ 640 px) `normal`,
 * takže sa názov na úzkej obrazovke zalomí celý bez jedinej media query.
 */
const NAME_BUTTON: CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  display: 'block',
  width: '100%',
  whiteSpace: 'inherit',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/**
 * Pevná mriežka stĺpcov (D10, bod 1 v hlavičke). Šírky sú ODMERANÉ v prehliadači
 * na najširšom obsahu, aký sa v stĺpci môže objaviť, plus 24 px odsadenia bunky
 * a 14 px na šípku triedenia:
 *  · `PREDANÉ 360 D` je najdlhší nadpis okna predajnosti — 92 px textu,
 *  · `1 758,46 €` je najdrahší produkt v katalógu — 59 px,
 *  · `ZĽAVA TERAZ` je nadpis širší než ktorákoľvek jeho hodnota — 78 px.
 * Šípka sa počíta aj tam, kde práve nie je: keď sa poradie prehodí, stĺpec sa
 * NESMIE zúžiť ani preliať. Názov dostáva celý zvyšok — pri 1440 px ≈ 725 px.
 */
const COLUMNS: CSSProperties = { tableLayout: 'fixed' };
const COL_SELECT: CSSProperties = { width: '34px' };
const COL_SOLD: CSSProperties = { width: '130px' };
const COL_PRICE: CSSProperties = { width: '100px' };
const COL_DISCOUNT: CSSProperties = { width: '104px' };

/** Pod týmto počtom strán stránkovač vypisuje všetky čísla — skok netreba. */
const JUMP_FROM_PAGES = 8;

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
        {/* Smer je pre čítačku na `<th aria-sort>`, nie tu — ikona by ho
            prečítala druhýkrát. Slovami ho hovorí `title` (SORT_TITLES). */}
        {direction === 'none' ? null : (
          <Icon name={direction === 'ascending' ? 'chevronUp' : 'chevronDown'} size={0.85} />
        )}
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
        <table className="tbl" style={COLUMNS}>
          {/* Pevná mriežka — pozri bod 1 v hlavičke modulu. V kartovom
              rozložení (≤ 640 px) sa tabuľka kreslí ako bloky a `col` sa
              neuplatní, čo je správne: karta má jeden stĺpec. */}
          <colgroup>
            <col style={COL_SELECT} />
            <col />
            <col style={COL_SOLD} />
            <col style={COL_PRICE} />
            <col style={COL_DISCOUNT} />
          </colgroup>
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
              <th className="n" aria-sort={sortDirection('sold', sort)}>
                {columnHead('sold', `Predané ${soldWindowDays} d`)}
              </th>
              <th className="n" aria-sort={sortDirection('price', sort)}>
                {columnHead('price', 'Cena')}
              </th>
              <th className="n" title="Podľa vlastných zápisov appky">
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
                      {/* `title` je celý názov — orezaný chvost sa dá prečítať
                          bez otvorenia panela (D10, bod 2 v hlavičke). */}
                      <button
                        type="button"
                        style={NAME_BUTTON}
                        title={row.name ?? undefined}
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
          {/* Kde v poradí človek stojí. Pri 41 220 riadkoch a 825 stránkach je
              samotné „zobrazených 50" údaj bez orientácie (D10). */}
          {pages > 1 ? (
            <span className="num" data-testid="table-page-of">
              {' · strana '}
              {formatCountSk(page)} z {formatCountSk(pages)}
            </span>
          ) : null}
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
          {pages >= JUMP_FROM_PAGES ? <PageJump pages={pages} onPage={onPage} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ 3. Skok na stránku ═══════════════════════════ */

/**
 * Rýchly skok (D10). Stránkovač ponúka okolie aktuálnej strany a okraje —
 * z 825 strán je tak dosiahnuteľných šesť. Toto je zvyšok: napíš číslo, choď.
 *
 * Prečo formulár a nie skok pri písaní: každá zmena strany je dotaz na server
 * a písanie „412" by poslalo tri (4, 41, 412). Potvrdenie je jeden dotaz.
 * Mimo rozsahu sa nič nedeje — tabuľka nespadne na prvú stranu, lebo tichý
 * skok inam, než človek napísal, je horší než žiadny skok.
 */
export function PageJump({ pages, onPage }: { pages: number; onPage: (page: number) => void }) {
  const [draft, setDraft] = useState('');

  function jump(event: { preventDefault: () => void }) {
    event.preventDefault();
    const wanted = Number.parseInt(draft.trim(), 10);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > pages) return;
    onPage(wanted);
    setDraft('');
  }

  return (
    <form className="row" style={{ gap: '6px' }} onSubmit={jump}>
      <label className="lvl-3" htmlFor="catalog-page-jump">
        Strana
      </label>
      <input
        id="catalog-page-jump"
        className="inp"
        style={{ width: '72px', padding: '3px 7px', fontSize: '12px' }}
        inputMode="numeric"
        value={draft}
        placeholder={`1 – ${pages}`}
        aria-label={`Prejsť na stranu, 1 až ${pages}`}
        onChange={(event) => setDraft(event.target.value)}
        data-testid="page-jump-input"
      />
      <button type="submit" className="btn sm ghost" data-testid="page-jump-go">
        Prejsť
      </button>
    </form>
  );
}

export default CatalogTable;
