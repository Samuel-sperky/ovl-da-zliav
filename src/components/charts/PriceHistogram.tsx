/**
 * !!! TENTO GRAF ZATIAĽ ŽIADNA OBRAZOVKA NEKRESLÍ (19. 8. 2026) !!!
 *
 * Komponent aj jeho výpočet (price-bins.ts) sú hotové a otestované
 * (test/unit/grafy-ceny.spec.ts), ale chýba im dátový zdroj: rozdelenie cien
 * naprieč 41 220 produktmi sa nikde nepočíta. Treba dotaz do catalog_cache,
 * ktorý ceny nabinuje, a miesto na Produktoch — pod rozklikom, aby nepribudla
 * piata sekcia (P5).
 *
 * Je to tu napísané preto, že mŕtvy kód sa v tomto projekte už raz tváril ako
 * živý: oprava rol popiskov siahla na tri selektory, ktoré nikto nekreslil,
 * a test bol pritom zelený. Kým sa graf nezapojí, musí to byť vidieť na prvom
 * riadku súboru.
 */
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
  /** Ceny povolených produktov — referenčné značky, nie druhá séria. */
  selection: ReadonlyArray<{ productId: number; price: number }>;
  /** Koľko riadkov má miestna kópia katalógu spolu. */
  rows: number;
  /** Z toho bez ceny — do pásiem nevstupujú. */
  withoutPrice: number;
  maxPrice: number | null;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
}

function binLabel(from: number, to: number | null): string {
  if (to === null) return `${eurWhole(from)} a viac`;
  return `${eurWhole(from)} – ${eurWhole(to)}`;
}

function products(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'produkt', 'produkty', 'produktov')}`;
}

export function PriceHistogram({
  bins,
  selection,
  rows,
  withoutPrice,
  maxPrice,
  oldestFetchedAt,
  newestFetchedAt,
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
            <path className={styles.gapHatch} d="M0,6 L6,0" stroke="var(--accent)" />
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
        <span className={styles.legendItem}>
          <svg className={styles.legendMark} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <line className={styles.refMark} x1="6" y1="1" x2="6" y2="11" />
          </svg>
          ceny povolených produktov
        </span>
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
        {maxPrice === null ? null : ` · najvyššia cena ${formatEur(maxPrice)}`}
        {clamped === 0 ? null : ` · ${formatCountSk(clamped)} značiek pripnutých na okraj`}
      </div>
      <div className="fresh">
        {oldestFetchedAt === null || newestFetchedAt === null
          ? 'Ceny sú kópia, nie dnešný cenník'
          : `Ceny stiahnuté od ${formatDateTimeSk(oldestFetchedAt)} do ${formatDateTimeSk(newestFetchedAt)}`}
      </div>
    </div>
  );
}

export default PriceHistogram;
