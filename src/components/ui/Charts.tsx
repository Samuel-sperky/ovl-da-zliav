'use client';

/**
 * Aura Zľavy — KRESLENIE V JEDNOM JAZYKU GRAFOV (D126, 1. 9. 2026).
 *
 * Pravidlá a výpočty sú v `chart-language.ts`; tu je len to, čo sa bez DOM
 * nedá — značky, legendy a rámy. Rozdelenie je zámerné: geometriu koláča aj
 * mierku stĺpca sa dá overiť bez prehliadača, a presne to robí
 * `test/unit/grafy-jazyk.spec.ts`.
 *
 * ČO JE TU SPOLOČNÉ PRE VŠETKY TRI FORMY
 * ──────────────────────────────────────
 *
 *  · `ChartHatchPattern` — definícia značky „nevieme". Používa ju čiarový graf
 *    na nesťahovaný deň (`SalesChart`) aj koláč na diel, ktorý appka nikdy
 *    nečítala. Kto ju rozdvojí, dovolí, aby to isté šrafovanie znamenalo na
 *    dvoch obrazovkách dve rôzne veci.
 *
 *    DO 2. 9. 2026 TU STÁLO „JEDINÁ" A NEBOLA TO PRAVDA. Denná krivka
 *    v detaile produktu (`products/ProductDetailPanel.tsx` → `ProductCurveChart`)
 *    si kreslí VLASTNÝ `<pattern>`: 4 × 4 s `rotate(45)` namiesto 6 × 6
 *    s `M0,6 L6,0`. Farba je v oboch `--line2`, takže to nikto nenahlási —
 *    ale hustota šrafovania je iná, teda tá istá značka má v appke dva
 *    vzhľady. Histogram cien mal do V6b tretí (a k tomu nesprávny význam,
 *    pozri `PriceHistogram.tsx`); ten je zrušený. Zlúčenie krivky je práca
 *    v `products/`, teda mimo rozsahu agenta 27 — inventúru grafov
 *    a to, kto cez `ChartCard` ešte neide, drží `grafy-chartcard.spec.ts`
 *    (skupina D3).
 *  · `useChartPatternId` — id vzoru očistené o znaky, ktoré sa v `url(#…)`
 *    čítajú zle. Dva grafy na jednej obrazovke nesmú siahnuť na ten istý vzor.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Diel „nevieme" vypadne z koláča.** Vtedy koláč scíta 100 % z nepravdy
 *     a vyzerá dôveryhodnejšie než predtým. Preto ho `pieGeometry()` vracia
 *     VŽDY a legenda aj dátová tabuľka ho píšu aj vtedy, keď je nulový —
 *     nulový diel je odpoveď („nechýba nič"), chýbajúci diel je klamstvo.
 *  2. **Poradové číslo sa presunie na výsek.** Rampa má päť krokov od takmer
 *     bielej po tmavú; jedna farba textu by na jednom jej konci kontrast
 *     nesplnila a nikto by to okom neodhalil. Číslo patrí VEDĽA výseku.
 *  3. **Koláč sa nakreslí aj vtedy, keď diely nedávajú celok.** Podiely by
 *     boli z iného menovateľa než ten, ktorý je v odpovedi. `sumMatchesTotal`
 *     je fail-closed: radšej veta než kruh.
 *  4. **Stĺpec bez merania sa nakreslí ako nula.** Nula je meraný fakt, „nič
 *     sme nemerali" nie je — dostane šrafovaný pahýľ, nie prázdne miesto.
 *
 * Vlastník: V5-GRAFY.
 */
import { useId, type ReactNode } from 'react';

import ChartTable from '@/components/charts/ChartTable';
import styles from '@/components/charts/charts.module.css';
import {
  MIN_WEDGE_LABEL_DEGREES,
  PIE,
  UNKNOWN_WORD,
  chartPatternId,
  pieGeometry,
  piePercentText,
  type Bar,
  type PieInput,
  type PieSlice,
} from '@/components/ui/chart-language';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═════════════════════ 1. Spoločné značky všetkých foriem ═════════════════ */

/** Id vzoru pre `url(#…)`. Prefix je povinný — dva grafy, dva vzory. */
export function useChartPatternId(prefix: string): string {
  return chartPatternId(prefix, useId());
}

/**
 * Šrafovanie „nevieme". Patrí do `<defs>` toho SVG, ktoré ho kreslí.
 *
 * Nikdy plná výplň: plocha by sa čítala ako hodnota. Farba je `--line2`, teda
 * silnejšia než mriežka a slabšia než dáta — zmerané v `grafy-paleta.spec.ts`.
 */
export function ChartHatchPattern({ id }: { id: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
      <path className={styles.gapHatch} d="M0,6 L6,0" />
    </pattern>
  );
}

/* ═══════════════════════════ 2. Koláč ═════════════════════════════════════ */

/**
 * Kroky sekvenčnej rampy. Jediná škála, ktorou sa v tejto appke smie kresliť
 * veľkosť; stavová `--st-*` a značková zlatá sú zakázané (`grafy-paleta`).
 */
const RAMP_TOKENS = [
  'var(--seq-teal-1)',
  'var(--seq-teal-2)',
  'var(--seq-teal-3)',
  'var(--seq-teal-4)',
  'var(--seq-teal-5)',
] as const;

const RAMP_FALLBACK = 'var(--seq-teal-5)';

function sliceFill(slice: Pick<PieSlice, 'ramp'>, hatchId: string): string {
  if (slice.ramp === null) return `url(#${hatchId})`;
  const index = Math.min(RAMP_TOKENS.length, Math.max(1, slice.ramp)) - 1;
  return RAMP_TOKENS[index] ?? RAMP_FALLBACK;
}

function products(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'produkt', 'produkty', 'produktov')}`;
}

export interface SharePieProps {
  input: PieInput;
  /** Popis nad rámom — čo sa delí a na akom celku. */
  caption: string;
  /** Text pre čítačku obrazovky; koláč je obrázok, nie dekorácia. */
  label: string;
  /** Riadok pod grafom o pôvode dát. Nie je povinný, ale býva. */
  note?: ReactNode;
  testId?: string;
}

/**
 * Koláč = ROZDELENIE katalógu alebo výberu (D126). Nič iné; „podiel z celku"
 * je jediná otázka, na ktorú je kruh správna forma.
 *
 * PREČO KOLÁČ EŠTE NEIDE CEZ `ChartCard` (V6b, 2. 9. 2026)
 * ───────────────────────────────────────────────────────
 * Graf predaja aj histogram cien už rám grafov používajú; koláč nie, a nie je
 * to zabudnuté miesto. Dva dôvody, oba mimo rozsahu vzhľadu:
 *
 *  1. **Nie je to samostatná karta.** `TopFlopSection` ho kreslí VNÚTRI
 *     `Panel`-u rebríčka, takže `ChartCard` (ktorý `Panel` je) by vyrobil
 *     kartu v karte. Riešenie je bezrámová podoba `ChartCard`, alebo presun
 *     koláča z rebríčka — a to druhé je rozhodnutie o informačnej
 *     architektúre, ktorú kontrakt V6 §5 z rozsahu vylučuje.
 *  2. **Jeho legenda nesie ŠTVRTÝ kanál.** Poradové číslo dielu
 *     (`.legendOrder`) je to, čo spája výsek s riadkom legendy a s riadkom
 *     tabuľky. Slovník mariek rámu (farba · šrafovanie · prerušovaná čiara ·
 *     prerušovaná hrana · zvislá čiarka) číslo nepozná, a pridať ho tam len
 *     pre koláč by bola šiesta marka bez rozhodnutia.
 *
 * Kým to platí, drží tento stav zapísaný `grafy-chartcard.spec.ts` (skupina
 * D3): inventúra menuje všetkých päť súborov, ktoré v appke kreslia graf,
 * a hovorí, ktoré dva cez rám ešte neidú. Nový graf sa tam nepridá tichom.
 */
export function SharePie({ input, caption, label, note, testId = 'share-pie' }: SharePieProps) {
  const hatchId = useChartPatternId('pie-hatch');
  const result = pieGeometry(input);

  if (!result.ok) {
    return (
      <div className="chart" data-testid={testId} data-mode="empty" data-reason={result.reason}>
        <div className="empty">
          <div className="t">Rozdelenie zatiaľ nemáme</div>
          <div>
            {result.reason === 'nothing_to_split'
              ? 'V miestnej kópii katalógu nie je ani jeden riadok, ktorý by sa dal rozdeliť.'
              : 'Diely nedávajú dokopy celok, tak koláč nekreslíme — podiely by boli z iného menovateľa.'}
          </div>
        </div>
        {note === undefined ? null : <div className={styles.sourceNote}>{note}</div>}
      </div>
    );
  }

  const { slices, unknown, total } = result.geometry;

  return (
    <div className="chart" data-testid={testId} data-mode="data">
      <div className="ct">{caption}</div>

      <svg
        className={styles.pieFrame}
        viewBox={`0 0 ${String(PIE.size)} ${String(PIE.size)}`}
        role="img"
        aria-label={label}
        data-testid={`${testId}-svg`}
      >
        <defs>
          <ChartHatchPattern id={hatchId} />
        </defs>

        {slices.map((slice) =>
          slice.full ? (
            <circle
              className={styles.pieWedge}
              key={slice.bucket}
              cx={PIE.cx}
              cy={PIE.cy}
              r={PIE.r}
              fill={sliceFill(slice, hatchId)}
              data-slice={slice.bucket}
            />
          ) : slice.path === '' ? null : (
            <path
              className={styles.pieWedge}
              key={slice.bucket}
              d={slice.path}
              fill={sliceFill(slice, hatchId)}
              data-slice={slice.bucket}
            />
          ),
        )}

        {/* Poradové číslo je DRUHÝ kanál popri farbe. Na úzky výsek sa nezmestí
            čitateľne, tak tam nie je vôbec — v legende stojí pri každom. */}
        {slices.map((slice) =>
          slice.degrees < MIN_WEDGE_LABEL_DEGREES ? null : (
            <text
              className={styles.pieOrder}
              key={`c-${slice.bucket}`}
              x={slice.labelX}
              y={slice.labelY}
              textAnchor="middle"
            >
              {slice.order}
            </text>
          ),
        )}
      </svg>

      {/*
        Legenda nesie VŠETKY diely vrátane nulového „nevieme". Diel, ktorý sa
        nenakreslil, lebo je nulový, je odpoveď („nechýba nič") — vynechať ho
        by znamenalo, že otázka nikdy nezaznela.
      */}
      <div className={styles.legend} data-testid={`${testId}-legend`}>
        {slices.map((slice) => (
          <span className={styles.legendItem} key={`l-${slice.bucket}`} data-slice={slice.bucket}>
            <svg
              className={styles.legendMark}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <defs>{slice.ramp === null ? <ChartHatchPattern id={`${hatchId}-l`} /> : null}</defs>
              <rect
                x="1"
                y="2"
                width="10"
                height="9"
                fill={slice.ramp === null ? `url(#${hatchId}-l)` : sliceFill(slice, hatchId)}
              />
            </svg>
            <span className={styles.legendOrder}>{slice.order}</span>
            {`${slice.label} · ${piePercentText(slice)}`}
          </span>
        ))}
      </div>

      {/*
        Tabuľka je DOSLOVNÝ prepis koláča a berie si tie isté diely z tej istej
        geometrie — nikdy dopočítané čísla. Preto v nej stojí aj riadok „nevieme"
        a aj zlúčené „ostatné" s počtom položiek, ktoré sa doň zliali.
      */}
      <ChartTable
        caption="rozdelenie na diely"
        columns={[
          { head: 'Diel' },
          { head: 'Podiel', numeric: true },
          { head: 'Produktov', numeric: true },
          { head: 'Poznámka' },
        ]}
        rows={slices.map((slice) => ({
          cells: [
            `${String(slice.order)}. ${slice.label}`,
            piePercentText(slice),
            formatCountSk(slice.count),
            slice.unknown
              ? input.unknown.note
              : slice.merged > 0
                ? `zlúčené z ${String(slice.merged)} dielov`
                : '',
          ],
        }))}
        testId={`${testId}-table`}
      />

      <div className={styles.sourceNote} data-testid={`${testId}-unknown`}>
        {unknown.count === 0
          ? `Diel „${unknown.label}" je nulový — ${input.unknown.note}. Celok je ${products(total)}.`
          : `Diel „${unknown.label}" má ${products(unknown.count)} z ${products(total)}: ${input.unknown.note}. Bez neho by koláč scítal 100 % z nepravdy.`}
      </div>

      {note === undefined ? null : <div className={styles.sourceNote}>{note}</div>}
    </div>
  );
}

/* ═══════════════════════════ 3. Stĺpec v riadku ═══════════════════════════ */

export interface RowBarProps {
  bar: Bar;
  /**
   * Čo stĺpec meria — pre čítačku obrazovky.
   *
   * Bez neho je pás `aria-hidden`, a to je SPRÁVNE práve tam, kde číslo stojí
   * v riadku slovom: čítačka by ho inak prečítala dvakrát. Pri stĺpci
   * „nevieme" sa doplní sám, lebo tam žiadne číslo, ktoré by ho zastúpilo,
   * v riadku nie je.
   */
  label?: string;
}

/**
 * Stĺpec = POROVNANIE MEDZI POLOŽKAMI (D126), tu ako druhý kanál nad číslom,
 * ktoré v riadku už stojí.
 *
 * Preto pod ním NIE JE dátová tabuľka: tabuľkou je sám zoznam, v ktorom každý
 * riadok nesie svoje číslo slovom. Prilepiť pod zoznam ešte tabuľku by tie isté
 * čísla zdvojilo a na Prehľade by navyše prekročilo hranicu architektúry
 * („tabuľka produktov — Prehľad NIKDY").
 *
 * Mierka je spoločná pre celú skupinu a základňa je nula — obe rozhodnutia
 * robí `barLayout()`, nie tento komponent.
 */
export function RowBar({ bar, label }: RowBarProps) {
  const spoken = label ?? (bar.unknown ? `${UNKNOWN_WORD} — položka nemá meranie` : null);
  return (
    <span
      className={styles.rowBar}
      data-testid="row-bar"
      data-unknown={bar.unknown ? 'ano' : 'nie'}
      {...(spoken === null
        ? { 'aria-hidden': true }
        : { role: 'img' as const, 'aria-label': spoken })}
    >
      {bar.unknown ? (
        <span className={styles.rowBarUnknown} />
      ) : (
        <span className={styles.rowBarFill} style={{ width: `${String(bar.widthPercent)}%` }} />
      )}
    </span>
  );
}

export default SharePie;
