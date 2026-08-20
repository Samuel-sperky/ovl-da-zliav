'use client';

/**
 * Aura Zľavy — ROZDELENIE CIEN V MIESTNEJ KÓPII KATALÓGU (V1).
 *
 * OTÁZKA: „leží môj výber v tučnej časti cenníka, alebo v chvoste?" Je to
 * otázka PRED zľavou, nie po nej: zľava na desiatich kusoch z pásma, kde má
 * eshop tisíce položiek, znamená niečo iné než zľava na desiatich kusoch
 * z okraja.
 *
 * PREČO HISTOGRAM A NIE NIEČO INÉ
 * ───────────────────────────────
 *
 * Úlohou je ROZDELENIE spojitej veličiny — koľko produktov padá do ktorého
 * cenového pásma. To je jediná úloha, na ktorú je histogram správna forma,
 * a zároveň jediný dataset v tejto appke, ktorý je na rozdelenie dosť veľký:
 * všetko ostatné (jedna zľava, dvadsať položiek, desať povolených produktov)
 * je päť čísel, a päť čísel je tabuľka.
 *
 * Jedna séria, jedna os. Veľkosť nesie VÝŠKA stĺpca, takže farba nemá čo
 * kódovať a stĺpce sú jednofarebné — sekvenčná rampa by tú istú informáciu
 * povedala druhýkrát. Ceny výberu sú NEUTRÁLNE značky pod osou, nie druhá
 * séria: sú to jednotlivé body na tej istej osi, nie iná veličina.
 *
 * ČO GRAF O SVOJICH DÁTACH PRIZNÁVA
 * ─────────────────────────────────
 *
 *  · **Je to kópia, nie dnešný cenník.** Riadok sa obnovuje pri otvorení
 *    zápisového formulára a ručne, takže môže byť týždne starý. Pod grafom
 *    stojí najstarší aj najnovší čas stiahnutia.
 *  · **Produkt bez ceny v grafe nie je.** Počet takých riadkov je pod grafom,
 *    nie zamlčaný — a nespadol do najlacnejšieho pásma ako nula.
 *  · **Chvost je zhrnutý.** Posledný stĺpec je zberný a kreslí sa šrafovaním;
 *    pod grafom je najvyššia cena, aby bolo vidieť, kam siaha.
 *  · **Nie je to celý eshop.** Produkty, ktoré sa nikdy nestiahli, tu nie sú
 *    a z počtu riadkov sa to nedá zistiť. Preto „miestna kópia katalógu".
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Základňa osi y sa posunie od nuly.** Pri stĺpcoch je useknutá os
 *     najsilnejšie skreslenie, aké sa dá urobiť — pomer výšok prestane
 *     zodpovedať pomeru počtov a nikto si toho nevšimne.
 *  2. **Zberné pásmo dostane plnú výplň.** Vtedy začne graf tvrdiť, že
 *     drahšie produkty neexistujú.
 *  3. **Značka výberu stratí popis „pripnutá".** Cena nad hranicou osi sedí
 *     na okraji; bez slova o tom graf tvrdí, že produkt za 900 € stojí 200 €.
 *  4. **Riadok o úplnosti zrkadla vypadne.** `complete` je JEDINÝ kanál, ktorým
 *     graf priznáva, že tvar rozdelenia je tvar KÓPIE, nie eshopu. Chýbajúce
 *     produkty sa z počtu riadkov nedajú zistiť — histogram nad polovicou
 *     katalógu vyzerá presne ako histogram nad celým. Preto je `complete`
 *     zámerne NEPOVINNÝ a `undefined` znamená „nevieme": kto ho zabudne
 *     poslať, dostane opatrnejšie tvrdenie, nie tichý predpoklad úplnosti.
 *  5. **Farba stĺpca odíde z rampy.** Stĺpce aj šrafovanie zberného pásma sú
 *     výhradne zo sekvenčnej rampy `--seq-teal-*`. Stavová škála `--st-*` sú
 *     ZMERANÉ stavy, nie voľné odtiene — kto ňou vyplní stĺpec, začne cenovým
 *     pásmom tvrdiť „v poriadku" alebo „problém". Stráži to `grafy-paleta.spec.ts`.
 *
 * Vlastník: V1.
 */
import { useId } from 'react';

import ChartTable from '@/components/charts/ChartTable';
import styles from '@/components/charts/charts.module.css';
import {
  PRICE_CHART,
  eurWhole,
  priceHistogramGeometry,
  type PriceBinInput,
} from '@/components/charts/price-bins';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { formatDateTimeSk, formatEur } from '@/lib/ui/format';

export interface PriceHistogramProps {
  bins: readonly PriceBinInput[];
  /**
   * Ceny VYBRANÝCH produktov — referenčné značky pod osou, nie druhá séria.
   * Prázdne pole je legitímny stav: vtedy graf ukáže len rozdelenie a značky
   * ani ich legendu nekreslí.
   */
  selection: ReadonlyArray<{ productId: number; price: number }>;
  /** Koľko riadkov má miestna kópia katalógu spolu. */
  rows: number;
  /** Z toho bez ceny — do pásiem nevstupujú. */
  withoutPrice: number;
  maxPrice: number | null;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
  /**
   * Dočítalo posledné kolo zrkadlo katalógu po koniec (`catalog.complete`)?
   *
   * Sú to TRI stavy, nie dva, a graf ich rozlišuje: `true` = dočítalo,
   * `false` = zrkadlo celé nie je, `undefined` = stav katalógu sa nepodarilo
   * zistiť. Posledné dva sa nesmú zliať — „nie je celé" je meraný fakt,
   * „nevieme" je priznanie. Fail-closed: ani jeden z nich nedostane tvrdenie
   * „takto vyzerá cenník eshopu".
   */
  complete?: boolean;
}

function binLabel(from: number, to: number | null): string {
  if (to === null) return `${eurWhole(from)} a viac`;
  return `${eurWhole(from)} – ${eurWhole(to)}`;
}

function products(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'produkt', 'produkty', 'produktov')}`;
}

/**
 * Veta o úplnosti zrkadla. Tvar rozdelenia je tvar KÓPIE, nie eshopu, a je to
 * jediné miesto, kde to graf povie — z výšok stĺpcov sa to zistiť nedá.
 */
function mirrorSentence(complete: boolean | undefined): string {
  if (complete === true) {
    return 'Zrkadlo katalógu bolo pri poslednom prechode dočítané po koniec; eshop odvtedy mohol produkty pridať aj zmazať.';
  }
  if (complete === false) {
    return 'Zrkadlo katalógu nie je celé — produkty, ktoré sa ešte nestiahli, v grafe nie sú a z výšok stĺpcov sa to nedá zistiť.';
  }
  return 'Či je zrkadlo katalógu celé, sa nepodarilo zistiť — nestiahnuté produkty by v grafe chýbali bez toho, aby to bolo vidieť.';
}

export function PriceHistogram({
  bins,
  selection,
  rows,
  withoutPrice,
  maxPrice,
  oldestFetchedAt,
  newestFetchedAt,
  complete,
}: PriceHistogramProps) {
  const geometry = priceHistogramGeometry(bins, selection);
  const hatchId = `price-hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  if (geometry === null) {
    return (
      <div className="chart" data-testid="price-histogram" data-mode="empty">
        <div className="empty">
          <div className="t">Rozdelenie cien zatiaľ nemáme</div>
          <div>Graf sa objaví, keď bude v miestnej kópii katalógu aspoň jedna cena.</div>
        </div>
        {/* Priznanie patrí AJ sem: prázdny graf je práve ten stav, v ktorom je
            neúplné zrkadlo najpravdepodobnejšie vysvetlenie. */}
        <div className={styles.sourceNote} data-testid="price-histogram-mirror">
          {mirrorSentence(complete)}
        </div>
      </div>
    );
  }

  const clamped = geometry.marks.filter((mark) => mark.clamped).length;

  return (
    <div className="chart" data-testid="price-histogram" data-mode="data">
      <div className="ct">Ceny v miestnej kópii katalógu</div>

      <svg
        viewBox={`0 0 ${PRICE_CHART.width} ${PRICE_CHART.height}`}
        role="img"
        aria-label="Koľko produktov miestnej kópie katalógu padá do ktorého cenového pásma"
        data-testid="price-histogram-svg"
      >
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="none" />
            {/* Šrafovanie zberného pásma je O KROK SVETLEJŠIE než stĺpec — ten
                istý rad rampy, takže sa číta ako tá istá séria, len zhrnutá.
                Iná farba by z chvosta urobila druhú veličinu. */}
            <path className={styles.gapHatch} d="M0,6 L6,0" stroke="var(--seq-teal-3)" />
          </pattern>
        </defs>

        {geometry.gridLines.map((grid, index) => (
          <g key={grid.value}>
            <line
              className="ax"
              x1={PRICE_CHART.left}
              y1={grid.y}
              x2={PRICE_CHART.right}
              y2={grid.y}
              strokeDasharray={index === 0 ? undefined : '2 4'}
            />
            <text x="0" y={grid.y + 3}>
              {formatCountSk(grid.value)}
            </text>
          </g>
        ))}

        {geometry.bars.map((bar) => (
          <rect
            className={styles.bar}
            key={`${bar.from}`}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            fill={bar.open ? `url(#${hatchId})` : undefined}
          />
        ))}

        {/* Ceny výberu — neutrálne značky pod osou, nie druhá séria. */}
        {geometry.marks.map((mark) => (
          <line
            className={styles.refMark}
            key={mark.productId}
            x1={mark.x}
            y1={PRICE_CHART.baseline + 2}
            x2={mark.x}
            y2={PRICE_CHART.baseline + 10}
          />
        ))}

        {geometry.xLabels.map((tick) => (
          <text key={tick.value} x={tick.x} y={PRICE_CHART.height - 4} textAnchor="middle">
            {eurWhole(tick.value)}
          </text>
        ))}
      </svg>

      <div className={styles.legend} data-testid="price-histogram-legend">
        <span className={styles.legendItem}>
          <svg className={styles.legendMark} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect className={styles.bar} x="1" y="2" width="10" height="9" />
          </svg>
          počet produktov v pásme
        </span>
        <span className={styles.legendItem}>
          <svg className={styles.legendMark} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1" y="2" width="10" height="9" fill={`url(#${hatchId})`} />
          </svg>
          zberné pásmo, chvost je zhrnutý
        </span>
        {/* Legenda značiek stojí a padá s tým, či sa nejaká kreslí. Popis marky,
            ktorú v ráme nikto nevidí, je návod na hľadanie neexistujúcej veci. */}
        {geometry.marks.length === 0 ? null : (
          <span className={styles.legendItem}>
            <svg
              className={styles.legendMark}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <line className={styles.refMark} x1="6" y1="1" x2="6" y2="11" />
            </svg>
            ceny vybraných produktov
          </span>
        )}
      </div>

      <ChartTable
        caption="počet produktov v cenovom pásme"
        columns={[{ head: 'Cenové pásmo' }, { head: 'Produktov', numeric: true }]}
        rows={geometry.bars.map((bar) => ({
          cells: [binLabel(bar.from, bar.to), formatCountSk(bar.count)],
        }))}
        testId="price-histogram-table"
      />

      <div className="fresh" data-testid="price-histogram-note">
        {`${products(rows)} v miestnej kópii`}
        {withoutPrice === 0 ? null : `, z toho ${formatCountSk(withoutPrice)} bez ceny`}
        {/* Pomlčka, nikdy nula: „0 €" by tvrdilo, že najdrahší produkt je
            zadarmo, a vynechanie riadku by zamlčalo, že tá otázka existuje. */}
        {maxPrice === null ? ' · najvyššia cena —' : ` · najvyššia cena ${formatEur(maxPrice)}`}
        {clamped === 0 ? null : ` · ${formatCountSk(clamped)} značiek pripnutých na okraj`}
      </div>
      <div className="fresh">
        {oldestFetchedAt === null || newestFetchedAt === null
          ? 'Ceny sú kópia, nie dnešný cenník'
          : `Ceny stiahnuté od ${formatDateTimeSk(oldestFetchedAt)} do ${formatDateTimeSk(newestFetchedAt)}`}
      </div>
      <div className={styles.sourceNote} data-testid="price-histogram-mirror">
        {mirrorSentence(complete)}
      </div>
    </div>
  );
}

export default PriceHistogram;
