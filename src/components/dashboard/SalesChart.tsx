'use client';

/**
 * Aura Zľavy — GRAF DENNÉHO PREDAJA (V1, prevzaté po V9; architektúra §1 TAB 1).
 *
 * OTÁZKA: „koľko kusov sa predalo a hýbe sa to?" Nič viac. Jedna séria, jedna
 * os. Druhá os y je v tejto appke zakázaná — dve mierky v jednom ráme vyrobia
 * optický klam o vzťahu čísel, ktorý sa nedá odkliknúť.
 *
 * ČO GRAF O SVOJICH DÁTACH PRIZNÁVA (a ako)
 * ─────────────────────────────────────────
 *
 *  · **Nie sú to eurá.** Appka pozná počty kusov na produkt a deň; zaplatená
 *    suma patrí objednávke, nie položke. Os je v kusoch a sekcia to hovorí
 *    vetou. Dopočítať tržbu z cenníkovej ceny by bol presvedčivo vyzerajúci
 *    výmysel.
 *  · **Nie je to celý eshop.** Rad pokrýva len produkty vo výbere, nie
 *    41 000 položiek katalógu. Hovorí to popis nad rámom.
 *  · **Nemeraný deň nie je nula.** Deň, ktorý sa nestiahol, nedostane bod ani
 *    nulu — dostane šrafovaný pás, v bubline pomlčku a v legende slovo.
 *    K 24. 8. 2026 sú merané dva dni a nemeraných šestnásť; keby tých
 *    šestnásť sadlo na nulu, graf by tvrdil prepad predaja, ktorý nikto
 *    nezmeral.
 *  · **Dva body nie sú priebeh.** Pri dvoch meraniach graf prepne do režimu
 *    `pair`: dva body a obe čísla pri nich, žiadna spojnica, žiadna plocha,
 *    žiadny trend. Čiara medzi dvoma bodmi je sklon, teda trend inou rukou.
 *  · **Neúplný deň je odhad.** Deň, ktorého sťahovanie spadlo v polovici, nesie
 *    dolnú hranicu: tlmená prerušovaná značka a `≈` pred číslom (P7).
 *  · **Dnešok nie je celý deň.** Kreslí sa PRÁZDNYM bodom a bodkovanou
 *    spojnicou a do trendu nevstupuje.
 *
 * KAŽDÝ STAV NESIE TRI KANÁLY: farbu, značku a slovo v legende. Ani jeden
 * z nich nie je ozdoba — šrafovanie bez slova je vzorka, ktorú si nikto
 * nespojí s výpadkom sťahovania.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Trendová čiara sa „upratá" na tlmenú farbu.** Kreslí ju `.line.trend`
 *     v `globals.css` zlatou `--gold2`. Vyzerá to ako značková ozdoba a láka
 *     to prepísať na `--dim` — ZMERANÉ je to naopak: `--accent` ↔ `--gold2` má
 *     naprieč všetkými typmi videnia odstup ΔE 34 až 43, kým `--accent` ↔
 *     `--dim` má pod protanopiou ΔE 4,9, teda je to pre časť ľudí tá istá
 *     farba. Zlatá je tu jediná dostupná druhá marka, ktorá obstojí.
 *     Prerušovanie a legenda sú druhý a tretí kanál — zlatá má vo svetlej téme
 *     proti karte len 3,45:1, čo pre tenkú čiaru stačí, ale rezervu nemá.
 *     Stráži to `test/unit/grafy-paleta.spec.ts`.
 *
 *  2. **Dnešok dostane vlastnú farbu.** Do 19. 8. 2026 bol zlatý (`--gold2`).
 *     Zlatá je značková farba a v tejto appke nesmie kódovať stav ani rozdiel
 *     v dôveryhodnosti čísla. Dnešok sa preto líši TVAROM (prázdny bod), nie
 *     odtieňom. To isté platí o odhade: tlmená prerušovaná značka, nie iný
 *     odtieň série.
 *
 *  3. **Priamy popisok pri každom bode.** Povolený je LEN v režime `pair`,
 *     kde sú body dva. Pri dlhšom rade sa čísla čítajú z bubliny alebo
 *     z dátovej tabuľky; číslo pri každom bode je hluk, nie informácia.
 *
 *  4. **Bublina nad pásmom neznáma ukáže číslo.** Kríž nájde najbližší deň OSI,
 *     nie najbližšie meranie — nad nemeraným dňom preto ukazuje pomlčku
 *     a vetu, nie hodnotu suseda.
 *
 *  5. **Bublina prežije opustenie rámu.** Kto zabudne na `onPointerLeave`,
 *     nechá na grafe visieť hodnotu dňa, nad ktorým kurzor už dávno nie je.
 *
 * Geometriu počíta `sales-view.ts`; tu nie je ani jeden výpočet, ktorý by sa
 * nedal otestovať bez prehliadača.
 *
 * Vlastník: V1.
 */
import { useCallback, useId, useRef, useState } from 'react';

import styles from '@/components/charts/charts.module.css';
/*
 * Podfarbené okná zliav sú prvok PREHĽADU, nie grafu ako takého — zľava je
 * pojem prístrojovej dosky a nie každý graf v appke ju má čo kresliť. Ich
 * geometria preto býva vypnutá (`bands` je voliteľné) a ich vzhľad žije v CSS
 * Prehľadu, nie v spoločnej palete grafov.
 */
import band from '@/components/dashboard/overview.module.css';
import type { ChartGeometry, DiscountBand } from '@/components/dashboard/sales-view';
import { CHART, axisDay } from '@/components/dashboard/sales-view';
import { nearestPoint, pointerToViewBoxX, tipLeftPercent } from '@/components/charts/chart-hover';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface SalesChartProps {
  geometry: ChartGeometry;
  /** Popis nad rámom — obdobie a rozsah, ktoré graf naozaj pokrýva. */
  caption: string;
  /** Text pre čítačku obrazovky; graf je obrázok, nie dekorácia. */
  label: string;
  /**
   * Podfarbené okná ZĽAV pod krivkou (V4, D113). Bez nich sa graf kreslí presne
   * ako predtým — pásy sú prídavok Prehľadu, nie súčasť merania.
   *
   * Sú to VLASTNÉ zápisy appky, nie stav eshopu (I11), a popis nad grafom to
   * musí povedať. Súradnice počíta `discountBands()` z tej istej osi ako body;
   * pri poradovej osi vráti prázdne pole a pás sa nekreslí.
   */
  bands?: readonly DiscountBand[];
}

type HotPoint = ChartGeometry['hover'][number];
type LegendKind = 'line' | 'dot' | 'trend' | 'today' | 'estimate' | 'gap' | 'band';

function pieces(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'kus', 'kusy', 'kusov')}`;
}

/** Marka legendy. Kreslí sa ako SVG, lebo prerušovanú čiaru bodka nezastúpi. */
function LegendMark({ kind, hatchId }: { kind: LegendKind; hatchId: string }) {
  return (
    <svg className={styles.legendMark} width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
      {kind === 'line' ? <line className="line" x1="0" y1="6" x2="16" y2="6" /> : null}
      {kind === 'dot' ? <circle className={styles.dot} cx="8" cy="6" r="4" /> : null}
      {kind === 'trend' ? <line className="line trend" x1="0" y1="6" x2="16" y2="6" /> : null}
      {kind === 'today' ? <circle className={styles.dotOpen} cx="8" cy="6" r="4" /> : null}
      {kind === 'estimate' ? <circle className={styles.dotEstimate} cx="8" cy="6" r="4" /> : null}
      {kind === 'gap' ? <rect x="0" y="1" width="16" height="10" fill={`url(#${hatchId})`} /> : null}
      {kind === 'band' ? <rect className={band.discountBand} x="0" y="1" width="16" height="10" /> : null}
    </svg>
  );
}

export function SalesChart({ geometry, caption, label, bands = [] }: SalesChartProps) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [hot, setHot] = useState<HotPoint | null>(null);

  // `useId()` vracia znaky, ktoré sa v odkaze `url(#…)` čítajú zle.
  const hatchId = `sales-hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const onMove = useCallback(
    (event: { clientX: number }) => {
      const element = frame.current;
      if (element === null) return;
      const rect = element.getBoundingClientRect();
      const x = pointerToViewBoxX(event.clientX, rect, CHART.width);
      if (x === null) return;
      setHot(nearestPoint(geometry.hover, x));
    },
    [geometry.hover],
  );

  const onLeave = useCallback(() => setHot(null), []);

  const lastClosed = geometry.points[geometry.points.length - 1] ?? null;
  const hasEstimate =
    geometry.points.some((point) => point.estimate) || geometry.todayPoint?.estimate === true;
  const showLegend =
    geometry.trendLine !== null ||
    geometry.todayPoint !== null ||
    geometry.gaps.length > 0 ||
    bands.length > 0 ||
    hasEstimate;

  /* Priamy popisok pri bode — len v režime `pair`, a nikdy nad nemeraným dňom. */
  const labelled = geometry.mode !== 'pair' ? [] : geometry.hover.filter((p) => p.units !== null);

  return (
    <div className={styles.frame} ref={frame}>
      <div className="ct">{caption}</div>

      {hot === null ? null : (
        <div
          className={styles.tip}
          style={{
            left: `${tipLeftPercent(hot.x, CHART.width)}%`,
            top: `${(hot.y / CHART.height) * 100}%`,
          }}
          data-testid="sales-chart-tip"
        >
          <span className={styles.tipDay}>{axisDay(hot.day)}</span>
          <span className={styles.tipValue}>
            {hot.units === null ? '—' : `${hot.estimate ? '≈ ' : ''}${pieces(hot.units)}`}
          </span>
          {hot.units === null ? <span className={styles.tipNote}>deň sa nesťahoval</span> : null}
          {hot.units !== null && hot.estimate ? (
            <span className={styles.tipNote}>neúplný deň, aspoň toľko</span>
          ) : null}
          {hot.units !== null && hot.isToday ? (
            <span className={styles.tipNote}>deň ešte beží</span>
          ) : null}
        </div>
      )}

      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={label}
        data-testid="sales-chart"
        data-mode={geometry.mode}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      >
        <defs>
          {/* Šrafovanie nesťahovaného obdobia — nikdy plná výplň. */}
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse">
            <path className={styles.gapHatch} d="M0,6 L6,0" />
          </pattern>
        </defs>

        {geometry.gridLines.map((grid, index) => (
          <g key={grid.label}>
            <line
              className="ax"
              x1={CHART.left}
              y1={grid.y}
              x2={CHART.right + 10}
              y2={grid.y}
              strokeDasharray={index === 0 ? undefined : '2 4'}
            />
            <text x="0" y={grid.y + 3}>
              {grid.label}
            </text>
          </g>
        ))}

        {/*
         * Okná zliav sú NAJNIŽŠIA vrstva — pod šrafovaním medzery aj pod
         * krivkou. Poradie nie je estetika: deň, ktorý sa nesťahoval a zároveň
         * v ňom bežala zľava, musí zostať čitateľný ako NESŤAHOVANÝ. Keby pás
         * zľavy ležal nad šrafovaním, vyzeral by ten deň ako zmeraný.
         */}
        {bands.map((entry) => (
          <g key={`zlava-${entry.id}-${entry.fromDay}`}>
            <rect
              className={band.discountBand}
              x={entry.x1}
              y={CHART.top}
              width={Math.max(0, entry.x2 - entry.x1)}
              height={CHART.baseline - CHART.top}
            />
            {/* Hrany sa kreslia len tam, kde okno naozaj začína a končí —
                odrezaná hrana čiaru NEDOSTANE, inak by orezanie vyzeralo ako
                koniec zľavy. */}
            {entry.clippedStart ? null : (
              <line
                className={band.discountEdge}
                x1={entry.x1}
                y1={CHART.top}
                x2={entry.x1}
                y2={CHART.baseline}
              />
            )}
            {entry.clippedEnd ? null : (
              <line
                className={band.discountEdge}
                x1={entry.x2}
                y1={CHART.top}
                x2={entry.x2}
                y2={CHART.baseline}
              />
            )}
            {entry.x2 - entry.x1 < 40 ? null : (
              <text
                className={band.discountLabel}
                x={(entry.x1 + entry.x2) / 2}
                y={CHART.baseline - 4}
                textAnchor="middle"
              >
                {`−${entry.percent} %`}
              </text>
            )}
          </g>
        ))}

        {/* Nesťahované obdobia sa kreslia POD dáta, aby ich neprekryli. */}
        {geometry.gaps.map((gap) => (
          <g key={`${gap.fromDay}-${gap.toDay}`}>
            <rect
              className={styles.gapFill}
              x={gap.x1}
              y={CHART.top}
              width={Math.max(0, gap.x2 - gap.x1)}
              height={CHART.baseline - CHART.top}
              fill={`url(#${hatchId})`}
            />
            {gap.x2 - gap.x1 < 70 ? null : (
              <text
                className={styles.gapLabel}
                x={(gap.x1 + gap.x2) / 2}
                y={CHART.top + 12}
                textAnchor="middle"
              >
                nesťahované
              </text>
            )}
          </g>
        ))}

        {geometry.areaPath === '' ? null : <path className="area" d={geometry.areaPath} />}

        {geometry.segments.map((segment) => (
          <polyline className="line" key={segment} points={segment} />
        ))}

        {geometry.trendLine === null ? null : (
          <line
            className="line trend"
            x1={geometry.trendLine.x1}
            y1={geometry.trendLine.y1}
            x2={geometry.trendLine.x2}
            y2={geometry.trendLine.y2}
          />
        )}

        {geometry.todayPoint === null || lastClosed === null || geometry.mode === 'pair' ? null : (
          <polyline
            className="line proj"
            points={`${lastClosed.x},${lastClosed.y} ${geometry.todayPoint.x},${geometry.todayPoint.y}`}
          />
        )}

        {/*
         * Body sa kreslia vždy, nielen v režime `pair`. Meranie je diskrétne —
         * jeden deň, jedno číslo — a bod to hovorí; čiara medzi nimi je len
         * pomôcka pre oko.
         */}
        {geometry.points.map((point) => (
          <circle
            className={point.estimate ? styles.dotEstimate : styles.dot}
            key={point.day}
            cx={point.x}
            cy={point.y}
            r="5"
          />
        ))}

        {geometry.todayPoint === null ? null : (
          <circle
            className={styles.dotOpen}
            cx={geometry.todayPoint.x}
            cy={geometry.todayPoint.y}
            r="5"
          />
        )}

        {labelled.map((point) => (
          <text
            className={point.estimate ? styles.pointLabelDim : styles.pointLabel}
            key={`hodnota-${point.day}`}
            x={point.x}
            y={point.y - 12}
            textAnchor="middle"
          >
            {`${point.estimate ? '≈ ' : ''}${formatCountSk(point.units ?? 0)}`}
          </text>
        ))}

        {hot === null ? null : (
          <g>
            <line
              className={styles.crosshair}
              x1={hot.x}
              y1={CHART.top}
              x2={hot.x}
              y2={CHART.baseline}
            />
            {hot.units === null ? null : (
              <circle className={styles.hotDot} cx={hot.x} cy={hot.y} r="6.5" />
            )}
          </g>
        )}

        {geometry.xLabels.map((tick) => (
          <text key={tick.label} x={tick.x} y={CHART.height - 4} textAnchor="middle">
            {tick.label}
          </text>
        ))}
      </svg>

      {/*
       * Legenda sa kreslí, len keď je v ráme viac než jedna vec. Pri jedinej
       * sérii by bola riadkom navyše, ktorý nič nerozlišuje.
       */}
      {!showLegend ? null : (
        <div className={styles.legend} data-testid="sales-chart-legend">
          <span className={styles.legendItem}>
            <LegendMark kind={geometry.mode === 'pair' ? 'dot' : 'line'} hatchId={hatchId} />
            predané kusy
          </span>
          {geometry.trendLine === null ? null : (
            <span className={styles.legendItem}>
              <LegendMark kind="trend" hatchId={hatchId} />
              trend cez uzavreté dni
            </span>
          )}
          {geometry.todayPoint === null ? null : (
            <span className={styles.legendItem}>
              <LegendMark kind="today" hatchId={hatchId} />
              dnešok, deň ešte beží
            </span>
          )}
          {!hasEstimate ? null : (
            <span className={styles.legendItem}>
              <LegendMark kind="estimate" hatchId={hatchId} />
              ≈ neúplný deň, aspoň toľko
            </span>
          )}
          {geometry.gaps.length === 0 ? null : (
            <span className={styles.legendItem}>
              <LegendMark kind="gap" hatchId={hatchId} />
              nesťahované dni, predaj nepoznáme
            </span>
          )}
          {bands.length === 0 ? null : (
            <span className={styles.legendItem}>
              <LegendMark kind="band" hatchId={hatchId} />
              okná zliav podľa našich zápisov
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default SalesChart;
