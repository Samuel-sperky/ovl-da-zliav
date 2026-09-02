'use client';

/**
 * Aura Zľavy — HLAVNÝ GRAF PREHĽADU: denný predaj (V1 → Recharts vo V6b).
 *
 * OTÁZKA: „koľko kusov sa predalo a hýbe sa to?" Nič viac. Jedna séria, jedna
 * os. Druhá os y je v tejto appke zakázaná — dve mierky v jednom ráme vyrobia
 * optický klam o vzťahu čísel, ktorý sa nedá odkliknúť.
 *
 * FORMA: ČIARA, teda VÝVOJ V ČASE (D126). Nie je to voľba vzhľadu — `CHART_KINDS`
 * je uzavretý zoznam troch foriem a každá odpovedá na inú otázku. Predaj po
 * dňoch je čas, takže čiara; porovnanie medzi produktmi je stĺpec a to je
 * rebríček vedľa, nie tento graf.
 *
 * ČO SA ZMENILO VO V6b (D135, D136) A ČO SA ZMENIŤ NESMELO
 * ───────────────────────────────────────────────────────
 * Rám, stavy, legendu, prepis pre čítačku a pätičku kreslí `ChartCard`; plochu
 * kreslí Recharts; farby dáva `useChartTheme()`. Zmizlo vlastné inline SVG
 * (viewBox 880 × 150), vlastná vrstva myši a vlastná legenda.
 *
 * NEZMIZLO ANI JEDNO PRIZNANIE (§4 kontraktu V6 — „krajšie áno, tichšie nie"):
 *
 *  · **Nie sú to eurá.** Os je v kusoch; zaplatená suma patrí objednávke, nie
 *    položke (I11, D117). Hovorí to podtitul, ktorý posiela obrazovka.
 *  · **Nie je to celý eshop.** Rad pokrýva len produkty vo výbere.
 *  · **Nemeraný deň nie je nula.** Deň, ktorý sa nestiahol, nedostane bod ani
 *    nulu: v dátach je `null`, čiara sa naň preruší (`GAP_SERIES_PROPS`,
 *    `connectNulls: false`), plocha dostane šrafovaný pás so slovom a bublina
 *    pomlčku s vetou. NULA JE FAKT, MEDZERA JE PRIZNANIE.
 *  · **Dva body nie sú priebeh.** Pri dvoch meraniach (`shape === 'pair'`) sa
 *    nekreslí ani spojnica, ani plocha, ani trend — len dva body.
 *  · **Neúplný deň je odhad.** Prerušovaný prstenec, `≈` pred číslom, `≥`
 *    v prepise (P7).
 *  · **Dnešok nie je celý deň.** Prázdny bod a do trendu nevstupuje.
 *  · **Okno zľavy je NÁŠ zápis, nie stav eshopu.** Podfarbenie hovorí, že sme
 *    zľavu na tie dni zapísali — nie že ju zákazník videl.
 *
 * KAŽDÝ STAV NESIE TRI KANÁLY: farbu, značku (tvar bodu, prerušenie,
 * šrafovanie) a SLOVO — v legende alebo v priznaní pod plochou. Marky legendy
 * `ChartCard` sú tri (plná, prerušovaná, šrafovaná), takže prázdny bod
 * a prerušovaný prstenec nemajú v legende marku a idú do priznaní VETOU. Dve
 * rovnaké marky s dvoma rôznymi slovami by boli horšie než veta.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **`connectNulls` sa prepne na `true`.** Vtedy Recharts natiahne čiaru
 *     cez šestnásť nesťahovaných dní a z priznania „toto sme nemerali" spraví
 *     tvrdenie „medzi 6. a 22. augustom to šlo takto". Preto sa neposiela
 *     ručne, ale rozprestrením `GAP_SERIES_PROPS` zo spoločného jazyka grafov.
 *
 *  2. **Bod sa nakreslí aj nad medzerou.** `SeriesDot` vracia pri `units ===
 *     null` `null`. Kruh na nule alebo v strede rámu by z medzery spravil
 *     hodnotu.
 *
 *  3. **Pás zľavy prekryje šrafovanie medzery.** Poradie kreslenia určujú
 *     DÁTA (`view.underlays` — najprv zľavy, potom medzery) a tento komponent
 *     ich mapuje v tom poradí jediným `map`. Keby si poradie vyberal sám,
 *     nemeraný deň so zľavou by vyzeral zmeraný a test by to nemal na čom
 *     zmerať: plocha Rechartsu je bez rozmerov (v teste vždy) neviditeľná.
 *
 *  4. **Trend sa „upratá" na tlmenú farbu.** Kreslí ho `.trendLine`
 *     v `sales-chart.module.css` zlatou `--gold2`; dôvod, čísla aj to, prečo
 *     je farba v CSS a nie v propse, sú v hlavičke toho súboru.
 *
 *  5. **Bublina nad medzerou ukáže hodnotu suseda.** `SalesTip` nečíta
 *     `payload` Rechartsu (ten pri `null` neprinesie riadok), ale hľadá deň
 *     z osi vo VLASTNÝCH riadkoch — takže nad nemeraným dňom ukáže pomlčku
 *     a vetu, nie číslo, ktoré tam nepatrí.
 *
 *  6. **Popis osi sa stane kľúčom osi.** `XAxis` má `dataKey="day"` (ISO deň)
 *     a popis kreslí `tickFormatter`. Keby kľúčom bol popis `7. 8.`, v okne
 *     dlhšom než rok by sa zopakoval a `ReferenceArea` by si našla iný deň.
 *
 * Geometriu a riadky počíta `sales-chart-view.ts` (čisté funkcie, testovateľné
 * bez prehliadača); tu nie je ani jeden výpočet, ktorý by sa nedal otestovať.
 *
 * Vlastník: V6b, hlavný graf Prehľadu.
 */
import type { ReactNode } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import ChartCard, {
  ChartSummaryTable,
  type ChartLegendEntry,
} from '@/components/charts/ChartCard';
import useChartTheme from '@/components/charts/useChartTheme';
import chartStyles from '@/components/charts/charts.module.css';
import styles from '@/components/dashboard/sales-chart.module.css';
import {
  salesChartView,
  salesPointNote,
  type SalesChartPoint,
  type SalesLegendKind,
} from '@/components/dashboard/sales-chart-view';
import { axisDay, type ChartGeometry, type DiscountBand } from '@/components/dashboard/sales-view';
import { ChartHatchPattern, useChartPatternId } from '@/components/ui/Charts';
import {
  AXIS_TICK,
  GAP_SERIES_PROPS,
  areaFill,
  chartVar,
} from '@/components/ui/chart-language';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface SalesChartProps {
  geometry: ChartGeometry;
  /** Popis pod nadpisom — obdobie a rozsah, ktoré graf naozaj pokrýva. */
  caption: string;
  /**
   * Veta pre čítačku obrazovky: aká je to forma a na akú otázku odpovedá.
   * Ide do `<caption>` prepisu, lebo plocha grafu je pre čítačku tichá.
   */
  label: string;
  /**
   * Podfarbené okná ZĽAV pod krivkou (V4, D113). Bez nich sa graf kreslí presne
   * ako predtým — pásy sú prídavok Prehľadu, nie súčasť merania.
   */
  bands?: readonly DiscountBand[];
  /** Nadpis karty. Predvolene „Denný predaj". */
  title?: ReactNode;
  /**
   * Stupeň nadpisu podľa osnovy STRÁNKY. Graf stojí v sekcii „Predaj", ktorej
   * popisok je `h2`, takže tu je `h3` (`nadpisy-osnova.spec.ts`).
   */
  as?: 'h2' | 'h3';
  /** Ovládanie v hlavičke karty (prepínač okna). Nie akcie zápisu. */
  actions?: ReactNode;
  /** Ďalšie priznania obrazovky pod plochu — pod tie, ktoré pridá graf sám. */
  footer?: ReactNode;
}

/**
 * Popis dňa na osi x.
 *
 * Medzera je NEZLOMITELNÁ (U+00A0) a nie je to ozdoba: `Text` Rechartsu láme
 * popisky po slovách, takže „5. 8." dokáže rozdeliť na dva riadky pod sebou —
 * čo z jedného dátumu spraví dva. Nezlomiteľná medzera je zároveň správna
 * slovenská typografia: deň a mesiac k sebe patria.
 */
function axisTick(day: string): string {
  return axisDay(day).replace(' ', '\u00a0');
}

function pieces(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'kus', 'kusy', 'kusov')}`;
}

/* ═══════════════════════════ 1. Značka bodu ═══════════════════════════════ */

/**
 * Bod radu. Recharts klonuje tento prvok pre každý riadok a dopĺňa `cx`, `cy`
 * a `payload`.
 *
 * Rozdiel medzi meraním, dolnou hranicou a dneškom nesie TVAR (plný bod,
 * prerušovaný prstenec, prázdny bod) — nie odtieň. Definície tvarov sú
 * v `charts.module.css` a sú tie isté, aké kreslil inline SVG graf; zlatá ani
 * stavová škála sa bodu nikdy nedotknú (do 19. 8. 2026 bol dnešok zlatý a bola
 * to chyba: značková farba nesmie kódovať dôveryhodnosť čísla).
 */
export function SeriesDot(props: {
  cx?: number;
  cy?: number;
  payload?: SalesChartPoint;
}): ReactNode {
  const { cx, cy, payload } = props;
  if (payload === undefined || cx === undefined || cy === undefined) return null;
  /* Medzera bod NEDOSTANE. Výslovné porovnanie — skrátený guard tu už raz
     Turbopack vyhodnotil ako compile-time falsy. */
  if (payload.units === null) return null;
  const shape =
    payload.kind === 'today'
      ? chartStyles.dotOpen
      : payload.kind === 'lower_bound'
        ? chartStyles.dotEstimate
        : chartStyles.dot;
  return <circle className={shape} cx={cx} cy={cy} r={4} />;
}

/* ═══════════════════════════ 2. Bublina ═══════════════════════════════════ */

/**
 * Hodnota dňa pod kurzorom. Číta VLASTNÉ riadky podľa dňa z osi, nie `payload`
 * Rechartsu: pri `units === null` žiadny riadok v `payload` nie je, a bublina
 * bez vety by nad nemeraným dňom mlčala.
 */
export function SalesTip(props: {
  active?: boolean;
  label?: string | number;
  points?: readonly SalesChartPoint[];
}): ReactNode {
  const { active, label, points } = props;
  if (active !== true || points === undefined) return null;
  const day = typeof label === 'string' ? label : null;
  if (day === null) return null;
  const point = points.find((row) => row.day === day);
  if (point === undefined) return null;
  const note = salesPointNote(point);

  return (
    <div className={styles.tip} data-testid="sales-chart-tip">
      <span className={styles.tipDay}>{point.label}</span>
      <span className={styles.tipValue}>
        {point.units === null ? '—' : `${point.lowerBound ? '≈ ' : ''}${pieces(point.units)}`}
      </span>
      {note === null ? null : <span className={styles.tipNote}>{note}</span>}
    </div>
  );
}

/* ═══════════════════════════ 3. Graf ══════════════════════════════════════ */

/** Marka legendy podľa druhu. Slovo dáva model, farbu paleta — nikdy hex. */
function legendMark(kind: SalesLegendKind, series: string): Omit<ChartLegendEntry, 'label'> {
  if (kind === 'gap') return { gap: true };
  /* Trend je prerušovaný; jeho zlatú kreslí CSS (pozri hlavičku
     `sales-chart.module.css`), takže farbu do marky neposielame. */
  if (kind === 'trend') return { dashed: true };
  if (kind === 'band') return { color: chartVar('--sel') };
  return { color: series };
}

export function SalesChart({
  geometry,
  caption,
  label,
  bands = [],
  title = 'Denný predaj',
  as = 'h3',
  actions,
  footer,
}: SalesChartProps) {
  const theme = useChartTheme();
  const hatchId = useChartPatternId('sales-hatch');
  const view = salesChartView(geometry, bands);

  const legend: ChartLegendEntry[] = view.legend.map((item) => ({
    label: item.label,
    ...legendMark(item.kind, theme.accent),
  }));

  return (
    <ChartCard
      title={title}
      subtitle={caption}
      as={as}
      actions={actions}
      legend={legend}
      testId="sales-chart"
      srSummary={
        <ChartSummaryTable
          caption={label}
          labelHead="Deň"
          valueHead="Kusy"
          rows={view.summaryRows}
          format={formatCountSk}
        />
      }
      footer={
        <>
          {view.notes.map((note) => (
            <span key={note} data-testid="sales-chart-note">
              {note}{' '}
            </span>
          ))}
          {footer}
        </>
      }
    >
      {/* Vzor „nevieme" musí byť v `<defs>` niektorého SVG v dokumente; plocha
          Rechartsu si vlastné `<defs>` vložiť nedá. */}
      <svg className={styles.hatchDefs} aria-hidden="true" focusable="false">
        <defs>
          <ChartHatchPattern id={hatchId} />
        </defs>
      </svg>

      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={view.points} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
          {/* Vodorovná mriežka ustúpi dátam (`--line`); zvislá by pri kalendári
              po dňoch vyrobila mreže, v ktorých krivka zapadne. */}
          <CartesianGrid stroke={theme.grid} vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={axisTick}
            tick={{ fill: theme.axis, ...AXIS_TICK }}
            stroke={theme.axis}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            /* Základňa je VŽDY nula a hranica je „pekné" číslo nad maximom —
               jedno pravidlo osi pre celú appku (`chartScaleMax`). Useknutá os
               je najsilnejšie skreslenie, aké sa dá urobiť. */
            domain={[0, view.scaleMax]}
            allowDecimals={false}
            tick={{ fill: theme.axis, ...AXIS_TICK }}
            stroke={theme.axis}
            width={46}
          />
          <Tooltip
            content={<SalesTip points={view.points} />}
            cursor={{ stroke: theme.gap, strokeDasharray: '2 3' }}
            isAnimationActive={false}
          />

          {/*
            JEDEN `map` v poradí, ktoré dalo DÁTA (bod 3 hlavičky): najprv okná
            zliav, potom šrafované medzery. V SVG kreslí neskorší uzol NAD
            skorším, takže medzera zostane medzerou aj pod pásom zľavy.
          */}
          {view.underlays.map((area) =>
            area.kind === 'discount' ? (
              <ReferenceArea
                key={area.key}
                x1={area.fromDay}
                x2={area.toDay}
                fill={chartVar('--sel')}
                fillOpacity={1}
                label={
                  area.label === null
                    ? undefined
                    : { value: area.label, position: 'insideBottom', fill: theme.axis, fontSize: 9 }
                }
              />
            ) : (
              <ReferenceArea
                key={area.key}
                x1={area.fromDay}
                x2={area.toDay}
                fill={`url(#${hatchId})`}
                fillOpacity={1}
                label={
                  area.label === null
                    ? undefined
                    : { value: area.label, position: 'insideTop', fill: theme.axis, fontSize: 10 }
                }
              />
            ),
          )}

          {/* Hrana sa kreslí LEN tam, kde okno zľavy naozaj začína a končí:
              odrezaná hrana čiaru nedostane, inak by orezanie vyzeralo ako
              koniec zľavy. Ktoré hrany to sú, rozhodol model — tu je len `map`. */}
          {view.edges.map((edge) => (
            <ReferenceLine key={edge.key} x={edge.day} stroke={theme.gap} />
          ))}

          {/*
            Rad. `GAP_SERIES_PROPS` je jadro I11 preložené do jazyka Rechartsu
            a posiela sa rozprestrením, nie ručne — pozri bod 1 hlavičky.
            V režime `pair` sa nekreslí ani čiara, ani plocha: dva body nie sú
            priebeh a plocha sa číta ako spojitá veličina v čase.
          */}
          <Area
            dataKey="units"
            {...GAP_SERIES_PROPS}
            isAnimationActive={false}
            stroke={view.drawLine ? theme.accent : 'none'}
            strokeWidth={2}
            fill={view.drawArea ? areaFill(theme.accent) : 'none'}
            fillOpacity={1}
            activeDot={false}
            dot={<SeriesDot />}
            /*
              Priamy popisok pri bode. Text si nesie RIADOK (`pointLabel`) a
              model ho vyrobí len v režime `pair` — inak je `null` a Recharts
              nemá čo napísať. Keby o tom rozhodoval komponent, pravidlo „dva
              body áno, dlhší rad nie" by sa nedalo zmerať bez prehliadača.
            */
            label={{
              dataKey: 'pointLabel',
              position: 'top',
              fill: theme.ink,
              fontSize: 11,
            }}
          />

          {!view.drawTrend ? null : (
            <Line
              dataKey="trend"
              className={styles.trendLine}
              {...GAP_SERIES_PROPS}
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export default SalesChart;
