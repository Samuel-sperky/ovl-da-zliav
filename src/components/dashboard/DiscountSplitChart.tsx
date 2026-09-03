'use client';

/**
 * Aura Zľavy — HLAVNÝ GRAF PREHĽADU V7: DENNÝ PREDAJ V TROCH KRIVKÁCH
 * (D156, D157, D158, K5).
 *
 * OTÁZKA: „koľko kusov sa denne predalo — a bola v ten deň naša zľava?"
 * Os y sú PREDANÉ KUSY ZA DEŇ, os x je kalendár. Forma je ČIARA, teda vývoj
 * v čase (D126); `CHART_KINDS` je uzavretý zoznam troch foriem a žiadna iná
 * sem nepatrí. Druhá os y je v tejto appke zakázaná.
 *
 * TRI KRIVKY, PRETOŽE DVE BY LHALI (D156)
 * ───────────────────────────────────────
 * Appka vie o zľave len to, čo sama zapísala. Zľava nastavená ručne
 * v administrácii eshopu je pre ňu NEVIDITEĽNÁ, takže bez tretej krivky by
 * každý deň pred prvým zapísaným dňom zľavy spadol do „bez zľavy" — a to nie
 * je nepresnosť, to je nepravda. Hranicu poznania a zaradenie dní počíta
 * `discount-split-view.ts` (čisté funkcie, testovateľné bez prehliadača); tu
 * nie je ani jeden výpočet, ktorý by sa nedal otestovať.
 *
 * KAŽDÝ ROZDIEL NESIE TRI KANÁLY (§4 bod 3)
 * ─────────────────────────────────────────
 *  · **v zľave** — farba radu 1, plný kruh, slovo v legende,
 *  · **bez zľavy** — farba radu 2, plný štvorec, slovo v legende,
 *  · **nevieme, či bola** — farba radu 3, BODKOVANÁ čiara, kruh s prázdnym
 *    stredom, slovo v legende. Bodky, nie čiarky: prerušovaná čiara je v tejto
 *    appke trend.
 *  · **nesťahovaný deň** — MEDZERA v čiare (`connectNulls: false`) A šrafované
 *    pozadie A veta pod grafom. Dva vizuálne kanály sú povinné, pretože
 *    jednodenná medzera na dlhej osi je takmer nevidieť (D157).
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **`connectNulls` sa prepne na `true`.** Vtedy Recharts natiahne čiaru
 *     cez nesťahované dni aj cez dni, ktoré patria inej krivke, a z priznania
 *     „toto sme nemerali" spraví tvrdenie „šlo to takto". Preto sa neposiela
 *     ručne, ale rozprestrením `GAP_SERIES_PROPS` zo spoločného jazyka grafov.
 *
 *  2. **Bod sa nakreslí aj nad medzerou.** `SplitDot` vracia pri `value ===
 *     null` `null` — výslovné porovnanie, skrátený guard tu už raz Turbopack
 *     vyhodnotil ako compile-time falsy. Kruh na nule by z medzery spravil
 *     hodnotu.
 *
 *  3. **Bublina ukáže nulu tam, kde krivka deň nenesie.** `SplitTip` vypisuje
 *     všetky tri krivky pre ten istý deň (aby sa dali porovnať) a krivka bez
 *     hodnoty dostane POMLČKU. Nula je meraný fakt o eshope; pomlčka je
 *     priznanie. Text skladá `splitCellText()` v modeli — teda tá istá funkcia,
 *     ktorá píše prepis pre čítačku, takže sa nemajú ako rozísť.
 *
 *  4. **Bublina číta `payload` Rechartsu.** Nečíta: pri `null` v tom poli
 *     riadok nie je, takže by nad nesťahovaným dňom mlčala. Hľadá deň z osi vo
 *     VLASTNÝCH riadkoch.
 *
 *  5. **Popis osi sa stane kľúčom osi.** `XAxis` má `dataKey="day"` (ISO deň)
 *     a popis kreslí `tickFormatter`. Keby kľúčom bol popis `7. 8.`, v okne
 *     dlhšom než rok by sa zopakoval a `ReferenceArea` by si našla iný deň.
 *
 *  6. **Prepis pre čítačku sa dopočíta zvlášť.** Nedopočíta: `srSummary` číta
 *     `view.summaryRows`, teda tie isté riadky, z ktorých sa kreslia krivky.
 *     Druhá cesta k tým istým číslam je druhá verzia pravdy a človek
 *     s čítačkou by čítal práve tú.
 *
 * VÝŠKA je `--chart-h` (D158) a berie ju rám — pod grafom musí byť vidieť prvé
 * riadky tabuľky, takže `size="md"` sa tu na `auto` prepnúť nesmie.
 *
 * Vlastník: V7, krok 2/4 (graf troch kriviek).
 */
import { Fragment, type ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import ChartCard, {
  ChartSeriesSummaryTable,
  type ChartLegendEntry,
} from '@/components/charts/ChartCard';
import useChartTheme from '@/components/charts/useChartTheme';
import styles from '@/components/dashboard/discount-split.module.css';
import {
  SPLIT_STATES,
  SPLIT_WORDS,
  discountSplitView,
  splitCellText,
  splitPointNote,
  type DiscountSplitInput,
  type DiscountSplitPoint,
  type SplitState,
} from '@/components/dashboard/discount-split-view';
import type { SalesDailyView } from '@/components/dashboard/sales-daily-api';
import { axisDay } from '@/components/dashboard/sales-view';
import type { TimelineWindowRow } from '@/components/dashboard/window-api';
import { ChartHatchPattern, useChartPatternId } from '@/components/ui/Charts';
import { AXIS_TICK, GAP_SERIES_PROPS } from '@/components/ui/chart-language';
import type { ChartTheme } from '@/components/ui/chart-language';
import { describeActionFailure } from '@/lib/ui/action-failure';

/* ═══════════════════════════ 1. Farby a tvary ═════════════════════════════ */

/**
 * Krok série pre každý stav. Je to JEDNA mapa, nie index rozsypaný po
 * komponente: keby si farbu vyberalo každé miesto samo, prvý preklep by
 * nakreslil dve krivky tou istou farbou a nikde by nič nespadlo.
 */
const SERIES_INDEX: Readonly<Record<SplitState, number>> = {
  discounted: 0,
  plain: 1,
  unknown: 2,
};

/** Farba krivky z palety. Nikdy hex — napísaná farba zostane v druhej téme. */
export function splitColor(theme: ChartTheme, state: SplitState): string {
  return theme.series[SERIES_INDEX[state]] ?? theme.accent;
}

/**
 * Popis dňa na osi x.
 *
 * Medzera je NEZLOMITEĽNÁ (U+00A0): `Text` Rechartsu láme popisky po slovách,
 * takže „5. 8." dokáže rozdeliť na dva riadky pod sebou — čo z jedného dátumu
 * spraví dva. Je to zároveň správna slovenská typografia.
 */
function axisTick(day: string): string {
  return axisDay(day).replace(' ', '\u00a0');
}

/* ═══════════════════════════ 2. Značka bodu ═══════════════════════════════ */

/**
 * Bod krivky. Recharts klonuje tento prvok pre každý riadok a dopĺňa `cx`,
 * `cy` a `payload`.
 *
 * Rozdiel medzi krivkami nesie TVAR (kruh · štvorec · kruh s prázdnym
 * stredom), nie odtieň; dolná hranica dostane prerušovaný prstenec. Farba
 * prichádza z palety, vzhľad z modulu — zlatá ani stavová škála sa bodu nikdy
 * nedotknú.
 */
export function SplitDot(props: {
  cx?: number;
  cy?: number;
  payload?: DiscountSplitPoint;
  state?: SplitState;
  color?: string;
}): ReactNode {
  const { cx, cy, payload, state, color } = props;
  if (payload === undefined || state === undefined) return null;
  if (cx === undefined || cy === undefined) return null;
  /* Deň, ktorý táto krivka nenesie (alebo sa nesťahoval), bod NEDOSTANE.
     Výslovné porovnanie — skrátený guard tu Turbopack raz zahodil. */
  if (payload[state] === null) return null;

  const hollow = state === 'unknown' || payload.isToday;
  const shape = `${styles.mark}${hollow ? ` ${styles.markHollow}` : ''}${
    payload.lowerBound ? ` ${styles.markEstimate}` : ''
  }`;
  const stroke = color ?? 'currentColor';
  const fill = hollow ? undefined : stroke;

  if (state === 'plain') {
    return (
      <rect className={shape} x={cx - 3.5} y={cy - 3.5} width={7} height={7} stroke={stroke} fill={fill} />
    );
  }
  return <circle className={shape} cx={cx} cy={cy} r={3.5} stroke={stroke} fill={fill} />;
}

/* ═══════════════════════════ 3. Bublina ═══════════════════════════════════ */

/**
 * Hodnoty dňa pod kurzorom — VŠETKY TRI krivky naraz, aby sa dali porovnať
 * (D157). Krivka, ktorá deň nenesie, má pomlčku; nula sa dosadiť nesmie.
 */
export function SplitTip(props: {
  active?: boolean;
  label?: string | number;
  points?: readonly DiscountSplitPoint[];
}): ReactNode {
  const { active, label, points } = props;
  if (active !== true || points === undefined) return null;
  const day = typeof label === 'string' ? label : null;
  if (day === null) return null;
  const point = points.find((row) => row.day === day);
  if (point === undefined) return null;
  const note = splitPointNote(point);

  return (
    <div className={styles.tip} data-testid="discount-split-tip">
      <span className={styles.tipDay}>{point.label}</span>
      {/*
        Mriežka je JEDEN uzol a slová s hodnotami sú jej priame deti — vnorený
        obal na riadok by z dvoch stĺpcov spravil jeden a hodnoty troch kriviek
        by sa prestali dať porovnať pohľadom zhora dolu.
      */}
      <span className={styles.tipGrid}>
        {SPLIT_STATES.map((state) => (
          <Fragment key={state}>
            <span className={styles.tipWord}>{SPLIT_WORDS[state]}</span>
            <span className={styles.tipValue} data-state={state}>
              {splitCellText(point[state], point.lowerBound)}
            </span>
          </Fragment>
        ))}
      </span>
      {note === '' ? null : <span className={styles.tipNote}>{note}</span>}
    </div>
  );
}

/* ═══════════════════════════ 4. Graf ══════════════════════════════════════ */

export interface DiscountSplitChartProps {
  /**
   * Odpoveď `/api/insights/sales-daily`. `undefined` = ešte sme nežiadali
   * (kostra), `null` = odpoveď sa nedala prečítať (chybová veta). Zliať tie dve
   * veci znamená priznávať medzeru v dátach, ktoré sa práve ťahajú.
   */
  daily?: SalesDailyView | null;
  /** Okná vlastných zliav z `/api/insights/timeline`. */
  campaigns?: readonly TimelineWindowRow[];
  /** Okno prepínača GRAFU (7/30/90). Ide do podtitulu, nie do výpočtu. */
  windowDays: number;
  /** Prepínač okna do hlavičky karty (D155, druhý z dvoch). */
  switcher?: ReactNode;
  /** Stupeň nadpisu podľa osnovy STRÁNKY. Na Prehľade je graf sekcia pod `h1`. */
  as?: 'h2' | 'h3';
}

/** Marka legendy podľa druhu. Slovo dáva model, farbu paleta — nikdy hex. */
function legendEntry(
  kind: SplitState | 'gap',
  label: string,
  theme: ChartTheme,
): ChartLegendEntry {
  if (kind === 'gap') return { label, gap: true };
  if (kind === 'unknown') return { label, color: splitColor(theme, kind), dotted: true };
  return { label, color: splitColor(theme, kind) };
}

export function DiscountSplitChart({
  daily,
  campaigns = [],
  windowDays,
  switcher,
  as = 'h2',
}: DiscountSplitChartProps) {
  const theme = useChartTheme();
  const hatchId = useChartPatternId('split-hatch');

  const subtitle = `Kusy za deň za vybrané produkty, ${String(windowDays)} dní · zľava podľa vlastných zápisov`;
  const label = `Denný predaj po dňoch a stav našej zľavy — ${subtitle}`;

  /*
   * Bez odpovede sa NEPOČÍTA nič. Model by z prázdneho vstupu vyrobil os bez
   * dní a graf by vyzeral ako zmeraná pravda o prázdnom eshope.
   */
  if (daily === undefined || daily === null) {
    return (
      <ChartCard
        title="Denný predaj"
        subtitle={subtitle}
        as={as}
        actions={switcher}
        testId="discount-split"
        loading={daily === undefined}
        failure={
          daily === null
            ? describeActionFailure(null, { action: 'Načítanie denného predaja' })
            : null
        }
        failureTitle="Denný predaj sa nepodarilo načítať"
        srSummary={<p>{label}</p>}
      >
        <span />
      </ChartCard>
    );
  }

  const input: DiscountSplitInput = {
    from: daily.from,
    to: daily.to,
    today: daily.today,
    coverage: daily.coverage,
    days: daily.days,
    campaigns: campaigns.map((row) => ({
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      status: row.status,
    })),
  };
  const view = discountSplitView(input);

  /*
   * ANI JEDEN DEŇ OKNA SA NESŤAHOVAL → nie je to prázdny graf, je to NEMERANÁ
   * plocha (I11, piaty stav `ChartCard`). „Za obdobie nemáme ani jeden bod" by
   * bolo tvrdenie o predaji; toto je tvrdenie o appke.
   */
  if (view.measuredDays === 0) {
    return (
      <ChartCard
        title="Denný predaj"
        subtitle={subtitle}
        as={as}
        actions={switcher}
        testId="discount-split"
        unmeasuredReason={
          `Z tohto okna sa nesťahoval ani jeden deň, takže denný predaj ` +
          `nepoznáme. Kým sa objednávky nedočítajú, graf by kreslil nuly, ktoré ` +
          `nikto nezmeral.`
        }
        srSummary={<p>{label}</p>}
      >
        <span />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Denný predaj"
      subtitle={subtitle}
      as={as}
      actions={switcher}
      legend={view.legend.map((item) => legendEntry(item.kind, item.label, theme))}
      testId="discount-split"
      srSummary={
        /*
         * Prepis pre čítačku kreslí vrstva GRAFOV (`ChartSeriesSummaryTable`),
         * nie tento súbor. Dva dôvody a oba sú zapísané: pravidlá prepisu
         * (pomlčka namiesto nuly, `≥`, riadok pre KAŽDÝ deň osi) majú mať jedno
         * miesto (D142), a architektúra §1 zakazuje značku tabuľky
         * v komponentoch Prehľadu — `prehlad.spec.ts` to stráži čítaním zdroja.
         *
         * Čísla sú TIE ISTÉ, z ktorých sa kreslia krivky: `view.summaryRows`
         * vznikli v modeli z `view.points` a texty im napísala tá istá funkcia
         * (`splitCellText`), akú používa bublina.
         */
        <ChartSeriesSummaryTable
          caption={label}
          labelHead="Deň"
          valueHeads={SPLIT_STATES.map((state) => SPLIT_WORDS[state])}
          rows={view.summaryRows.map((row) => ({
            key: row.day,
            label: row.label,
            cells: row.cells,
            note: row.note,
          }))}
        />
      }
      footer={
        <>
          {view.notes.map((note) => (
            <span key={note} data-testid="discount-split-note">
              {note}{' '}
            </span>
          ))}
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
        <LineChart data={view.points} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
          {/* Mriežka LEN vodorovná a tlmená (D157): zvislá by pri kalendári po
              dňoch vyrobila mreže, v ktorých krivky zapadnú. */}
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
               jedno pravidlo osi pre celú appku (`chartScaleMax`, D157).
               Useknutá os je najsilnejšie skreslenie, aké sa dá urobiť. */
            domain={[0, view.scaleMax]}
            allowDecimals={false}
            tick={{ fill: theme.axis, ...AXIS_TICK }}
            stroke={theme.axis}
            width={46}
          />
          <Tooltip
            content={<SplitTip points={view.points} />}
            cursor={{ stroke: theme.gap, strokeDasharray: '2 3' }}
            isAnimationActive={false}
          />

          {/* Šrafované pásmo pod nesťahovanými dňami — DRUHÝ kanál k medzere
              v čiare (D157). Kreslí sa PRED krivkami, aby ich neprekrylo. */}
          {view.gaps.map((gap) => (
            <ReferenceArea
              key={gap.key}
              x1={gap.fromDay}
              x2={gap.toDay}
              fill={`url(#${hatchId})`}
              fillOpacity={1}
              label={
                gap.label === null
                  ? undefined
                  : { value: gap.label, position: 'insideTop', fill: theme.axis, fontSize: 10 }
              }
            />
          ))}

          {/*
            TRI KRIVKY v poradí `SPLIT_STATES` — jeden `map`, nie tri ručne
            napísané rady: poradie kreslenia aj kľúče tak nemôžu vypadnúť
            z jazyka modelu. `GAP_SERIES_PROPS` je jadro I11 preložené do reči
            Rechartsu (bod 1 hlavičky).
          */}
          {SPLIT_STATES.map((state) => (
            <Line
              key={state}
              dataKey={state}
              name={SPLIT_WORDS[state]}
              className={state === 'unknown' ? styles.curveUnknown : undefined}
              {...GAP_SERIES_PROPS}
              isAnimationActive={false}
              stroke={splitColor(theme, state)}
              strokeWidth={2}
              activeDot={false}
              dot={<SplitDot state={state} color={splitColor(theme, state)} />}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export default DiscountSplitChart;
