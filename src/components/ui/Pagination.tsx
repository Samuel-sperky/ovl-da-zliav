/**
 * Aura Zľavy — STRÁNKOVANIE (D133).
 *
 * Predloha: `aura-roadmap/src/components/ui/Pagination.tsx` — dve šípky a
 * „3 / 12". Pri 41 348 riadkoch a 826 stránkach to nestačí, takže sa portuje
 * TVAR A PRAVIDLO (D142) a doplní sa to, čo obrazovka Produkty už dnes vie
 * a čo sa stratiť nesmie:
 *
 *  · **čísla strán s výpustkou** (`1 2 … 412 413 414 … 826`) — skákanie po
 *    jednej strane je pri 826 stránkach nepoužiteľné;
 *  · **skok na stranu** od zadaného počtu strán — stránkovač ponúka okolie
 *    aktuálnej strany a okraje, teda šesť strán z 826; toto je zvyšok;
 *  · **počet ako DOLNÁ HRANICA** (`≈`), keď zrkadlo katalógu nie je celé.
 *
 * POČET SMIE BYŤ PRIZNANIE (I11, §4 bod 1 kontraktu V6)
 * ─────────────────────────────────────────────────────
 * `total` je počet v zrkadle, nie v eshope. Kým zrkadlo nie je celé, je to
 * dolná hranica a pätka to hovorí znakom `≈` a bez tučného: **merané číslo
 * a odhad nesmú mať rovnaký štýl** (P7). Nula sa neoznačuje nikdy — „≈ 0" nie
 * je odhad, ale nezmysel; o prázdnom výsledku hovorí prázdny stav tabuľky,
 * nie pätka.
 *
 * „STRANA X Z Y" JE SLOVAMI, NIE ZLOMKOM
 * ──────────────────────────────────────
 * Predloha píše „3 / 12". Zlomok bez slova je pri troch číslach v jednom
 * riadku (zobrazené · z celkom · strana) nečitateľný a čítačka ho prečíta ako
 * delenie. Tu je to veta: `Strana 3 z 826`.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 *  A. **Čísla formátuje `formatCountSk()`.** Predloha si drží vlastný
 *     `Intl.NumberFormat`; to isté číslo by potom v pätke a v tabuľke vyšlo
 *     inak zapísané. Jedno miesto, jedno oddeľovanie tisícov.
 *  B. **Aktuálna strana NIE JE tlačidlo.** Nemá kam viesť; nesie ju
 *     `aria-current="page"`.
 *  C. **Skok mimo rozsahu nespraví nič.** Tichý skok inam, než človek
 *     napísal, je horší než žiadny skok. Preto sa nepadá na prvú stranu.
 *  D. **Bez `useState`.** Skok je nespravovaný `<form>` a číslo si berie
 *     z `FormData` — vďaka tomu zostáva celý modul server-safe a `Pagination`
 *     smie vykresliť aj serverová obrazovka.
 *
 * Vlastník: V6a, skupina „Tabuľka" (D133).
 */
import type { FormEvent, ReactNode } from 'react';

import Button from '@/components/ui/Button';
import styles from '@/components/ui/tables.module.css';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Čistý počet ═══════════════════════════════ */

/** Kde v poradí človek stojí. Čistá funkcia — overiteľná bez prehliadača. */
export interface PageRange {
  /** Počet strán; nikdy menej než 1, aj keď je zoznam prázdny. */
  readonly pages: number;
  /** Strana po zrezaní do rozsahu `1 … pages`. */
  readonly current: number;
  /** Prvý a posledný riadok na strane (1-based); `0` pri prázdnom zozname. */
  readonly from: number;
  readonly to: number;
}

export function pageRange(page: number, pageSize: number, total: number): PageRange {
  const size = Math.max(1, Math.trunc(Number.isFinite(pageSize) ? pageSize : 1));
  const count = Math.max(0, Math.trunc(Number.isFinite(total) ? total : 0));
  const pages = Math.max(1, Math.ceil(count / size));
  const asked = Number.isFinite(page) ? Math.trunc(page) : 1;
  const current = Math.min(Math.max(1, asked), pages);
  return {
    pages,
    current,
    from: count === 0 ? 0 : (current - 1) * size + 1,
    to: Math.min(count, current * size),
  };
}

/** Číslo strany, alebo výpustka. */
export type PageToken = number | 'gap';

/**
 * Zoznam čísel strán s výpustkami: `1 2 3 4 … 826`.
 *
 * Pri 826 stránkach sa nedá vypísať všetko a skákanie o desiatky strán nikto
 * nepoužíva — okolie aktuálnej strany a okraje stačia; na zvyšok je skok.
 *
 * POZOR: to isté pravidlo má dnes vlastnú kópiu v
 * `src/components/products/CatalogTable.tsx` (`pageTokens`). Toto je jeho
 * NOVÝ DOMOV; keď Produkty prejdú na `Table` + `Pagination` (V6b), tá kópia sa
 * MUSÍ zmazať, nie nechať dobehnúť. Dve kópie toho istého výpočtu sú presne
 * to, čo sa v tomto repe rozišlo pri strope zápisov.
 */
export function pageTokens(current: number, pages: number): readonly PageToken[] {
  if (pages <= 7) return Array.from({ length: Math.max(1, pages) }, (_, i) => i + 1);
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

/* ═══════════════════════════ 2. Komponent ════════════════════════════════ */

export interface PaginationProps {
  /** Strana od 1. */
  page: number;
  pageSize: number;
  /** Počet zhôd. Keď je to dolná hranica, povedz to cez `totalIsLowerBound`. */
  total: number;
  /** `true` ⇔ `total` je DOLNÁ HRANICA — v eshope ich môže byť viac (I11). */
  totalIsLowerBound?: boolean;
  /** Čo `≈` pri počte znamená. Ide do `title`; bez nej je značka hádanka. */
  lowerBoundNote?: string;
  onPageChange: (page: number) => void;
  /** Bez tejto funkcie sa voľba počtu riadkov nekreslí. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  /** Od koľkých strán sa ponúkne skok na stranu. `0` = nikdy. */
  jumpFromPages?: number;
  /** Ikona „predošlá"/„ďalšia" (D146: `ReactNode`, nie typ z knižnice).
   *  Bez nej nesie tlačidlo SLOVO — a to je predvolené aj správne. */
  prevIcon?: ReactNode;
  nextIcon?: ReactNode;
  /**
   * Predpona `id` pre polia s vlastným `<label>`. Dva stránkovače na jednej
   * obrazovke by inak mali rovnaké `id` a `<label for>` by ukazoval na to
   * prvé — teda na cudzie pole. `useId()` sem nesmie: bol by to hook a modul
   * má zostať server-safe (bod D hlavičky).
   */
  idPrefix?: string;
  className?: string;
  testId?: string;
}

const DEFAULT_PAGE_SIZES = [25, 50, 100, 200] as const;

const LOWER_BOUND_NOTE = 'Počet v načítaných riadkoch — v eshope ich môže byť viac.';

export function Pagination({
  page,
  pageSize,
  total,
  totalIsLowerBound = false,
  lowerBoundNote = LOWER_BOUND_NOTE,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  jumpFromPages = 0,
  prevIcon,
  nextIcon,
  idPrefix = 'ovl-pagination',
  className,
  testId,
}: PaginationProps) {
  const { pages, current, from, to } = pageRange(page, pageSize, total);
  const empty = total <= 0;
  /* Dolná hranica sa značí len pri nenulovom počte — pozri hlavičku modulu. */
  const approx = totalIsLowerBound && total > 0;
  const showJump = jumpFromPages > 0 && pages >= jumpFromPages;

  function jump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = new FormData(form).get('page');
    const wanted = Number.parseInt(typeof raw === 'string' ? raw.trim() : '', 10);
    // Bod C hlavičky — mimo rozsahu sa NIČ nedeje.
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > pages) return;
    onPageChange(wanted);
    form.reset();
  }

  return (
    <div className={[styles.foot, className].filter(Boolean).join(' ')} data-testid={testId}>
      <div className={styles.footInfo}>
        {empty ? (
          <span>Žiadne záznamy</span>
        ) : (
          <span>
            Zobrazené{' '}
            <span className={styles.footCount}>
              {formatCountSk(from)}–{formatCountSk(to)}
            </span>{' '}
            z{' '}
            {approx ? (
              <span
                className={styles.footApprox}
                title={lowerBoundNote}
                data-testid="pagination-total-approx"
              >
                ≈ {formatCountSk(total)}
              </span>
            ) : (
              <b className={styles.footCount}>{formatCountSk(total)}</b>
            )}
          </span>
        )}
        {/* Kde v poradí človek stojí. Pri 826 stránkach je „zobrazené 50"
            údaj bez orientácie — a je to veta, nie zlomok. */}
        {empty ? null : (
          <span className={styles.footCount} data-testid="pagination-page-of">
            Strana {formatCountSk(current)} z {formatCountSk(pages)}
          </span>
        )}
      </div>

      <div className={styles.footActions}>
        {onPageSizeChange === undefined ? null : (
          <span className={styles.perPage}>
            <label htmlFor={`${idPrefix}-page-size`}>Na stránku</label>
            <select
              id={`${idPrefix}-page-size`}
              className={styles.select}
              value={String(pageSize)}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              data-testid="pagination-page-size"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={String(size)}>
                  {formatCountSk(size)}
                </option>
              ))}
            </select>
          </span>
        )}

        <nav className={styles.pager} aria-label="Stránkovanie">
          <Button
            small
            variant="ghost"
            aria-label="Predchádzajúca stránka"
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
            data-testid="pagination-prev"
          >
            {prevIcon === undefined ? (
              'Predošlá'
            ) : (
              <>
                {prevIcon}
                <span className={styles.srOnly}>Predchádzajúca stránka</span>
              </>
            )}
          </Button>
          {pageTokens(current, pages).map((token, index) =>
            token === 'gap' ? (
              <span key={`gap-${index}`} className={styles.pageGap} aria-hidden="true">
                …
              </span>
            ) : token === current ? (
              // Bod B hlavičky — aktuálna strana nie je tlačidlo.
              <span key={token} className={styles.pageCurrent} aria-current="page">
                {formatCountSk(token)}
              </span>
            ) : (
              <button
                key={token}
                type="button"
                className={styles.pageBtn}
                aria-label={`Strana ${formatCountSk(token)}`}
                onClick={() => onPageChange(token)}
              >
                {formatCountSk(token)}
              </button>
            ),
          )}
          <Button
            small
            variant="ghost"
            aria-label="Ďalšia stránka"
            disabled={current >= pages}
            onClick={() => onPageChange(current + 1)}
            data-testid="pagination-next"
          >
            {nextIcon === undefined ? (
              'Ďalšia'
            ) : (
              <>
                {nextIcon}
                <span className={styles.srOnly}>Ďalšia stránka</span>
              </>
            )}
          </Button>
        </nav>

        {showJump ? (
          <form className={styles.jump} onSubmit={jump}>
            <label htmlFor={`${idPrefix}-page-jump`}>Strana</label>
            <input
              id={`${idPrefix}-page-jump`}
              name="page"
              className={styles.jumpInput}
              inputMode="numeric"
              placeholder={`1 – ${formatCountSk(pages)}`}
              /*
               * Meno pre čítačku ZAČÍNA viditeľným popiskom („Strana"), inak
               * by ho hlasové ovládanie nenašlo: kto povie „Strana", musí
               * trafiť to pole, ktoré je tak popísané. Rozsah je za ním,
               * pretože bez neho je políčko hádanka.
               */
              aria-label={`Strana, 1 až ${formatCountSk(pages)}`}
              data-testid="pagination-jump-input"
            />
            <Button small variant="ghost" type="submit" data-testid="pagination-jump-go">
              Prejsť
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export default Pagination;
