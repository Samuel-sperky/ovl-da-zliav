'use client';

/**
 * Aura Zľavy — JEDEN RÁM PRE KAŽDÝ GRAF (D135, D142, V6a).
 *
 * Portované z `aura-roadmap` (`src/components/charts/ChartCard.tsx`) a odteraz
 * vlastnené TU (D129). Čo sa pri prenose zmenilo a prečo:
 *
 *  1. **`srSummary` je POVINNÝ prop, nie voliteľný.** V predlohe bol
 *     voliteľný s vetou „pošli ho, keď graf nesie informáciu". V tejto appke
 *     nenesie informáciu žiadny graf: `ChartTable` má v docblocku napísané, že
 *     prepis je PODMIENKA, za ktorej sa graf vôbec smie nakresliť. Voliteľný
 *     prop by o mesiac polovica volajúcich vynechala — presne to isté
 *     rozhodnutie a z toho istého dôvodu má `EmptyState.description`.
 *  2. **Plocha grafu je `aria-hidden`.** Recharts vyrobí SVG s desiatkami
 *     `<path>`; čítačka z neho prečíta hluk alebo nič. Jediný prístupný zdroj
 *     čísel je preto prepis, a aby si ho človek s čítačkou naozaj prečítal,
 *     musí byť plocha ticho.
 *  3. **Legenda nesie TRI KANÁLY.** Predloha mala v položke legendy `label`
 *     a `color`. Farba sama v tejto appke nosičom rozdielu byť nesmie (§4
 *     bod 3 kontraktu V6), takže marka vie byť aj šrafovaná (`gap` —
 *     „nevieme"), prerušovaná (`dashed` — trend), s prerušovanou hranou
 *     (`open` — dolná hranica, zhrnutý chvost) alebo zvislá čiarka (`tick` —
 *     jednotlivá položka na osi), a slovo je povinné vždy. Zoznam mariek je
 *     uzavretý rovnako ako `CHART_KINDS`: nová marka je rozhodnutie o jazyku,
 *     nie o vzhľade jedného grafu.
 *  4. **Rám je `Panel`, nie vlastná karta.** Predloha to má rovnako a bolo by
 *     to jediné miesto, kde by v tejto appke stála druhá, takmer rovnaká
 *     ohraničená plocha (D142: dvojník je dlh). V `charts.module.css` zostáva
 *     len to, čo `Panel` nemá — výška plochy z tokenu a výrez pre čítačku.
 *  5. **PIATY STAV: „nemerali sme".** Predloha má `loading / error / empty`,
 *     lebo tam má každé číslo dve možnosti. Tu má tri (I11), takže rám vie
 *     nakresliť aj `UnmeasuredState`. Bez neho by mal celý nemeraný graf dva
 *     východy a oba by boli nepravda: „za obdobie nemáme ani jeden bod" je
 *     tvrdenie o predaji, a nulová čiara je to isté číslom.
 *  6. **Chybu a načítavanie kreslí rodina stavov**, nie vlastný panel:
 *     `ErrorState` (a v ňom `ErrorMessage` s jediným `role="alert"`) a
 *     `LoadingState`. Nová chybová plocha vedľa nich by bola tretí spôsob, ako
 *     povedať to isté.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  · **Prepis sa rozíde s grafom.** Najhoršia možnosť: dve čísla o produkčnom
 *    eshope, každé iné, obe dôveryhodné. Preto `ChartSummaryTable` berie TIE
 *    ISTÉ `ChartRow[]`, z ktorých sa kreslí rad — nie zvlášť dopočítané čísla.
 *  · **Stavy sa pomiešajú.** Poradie vetiev je nosné a nie je náhodné:
 *      chyba → nemerané → prázdno → dáta.
 *    Chyba prekrýva všetko, lebo pri spadnutom dopyte appka NEVIE, či dáta sú;
 *    „nič tam nie je" by bolo tvrdenie z neznalosti. Nemerané prekrýva prázdno,
 *    lebo plocha bez merania nie je plocha bez dát.
 *  · **Prázdno sa nakreslí ako nula.** Prázdny graf nesmie mať vykreslenú
 *    nulovú čiaru; keď dáta nie sú, kreslí sa VETA. Radu s medzerami sa to
 *    netýka — ten sa kreslí a medzery priznáva (I11, `GAP_SERIES_PROPS`).
 *
 * Vlastník: V6a-GRAFY.
 */
import type { ReactNode } from 'react';

import styles from '@/components/charts/charts.module.css';
import EmptyState from '@/components/states/EmptyState';
import ErrorState from '@/components/states/ErrorState';
import LoadingState from '@/components/states/LoadingState';
import UnmeasuredState from '@/components/states/UnmeasuredState';
import { ChartHatchPattern, useChartPatternId } from '@/components/ui/Charts';
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel';
import { chartRowText, type ChartRow } from '@/components/ui/chart-language';
import type { ActionFailure } from '@/lib/ui/action-failure';

/* ═══════════════════════════ 1. Legenda ═══════════════════════════════════ */

export interface ChartLegendEntry {
  /**
   * Slovo — TRETÍ KANÁL. Povinné: marka bez slova je obrázok a farba sama
   * v tejto appke nesmie niesť rozdiel (§4 bod 3).
   */
  label: string;
  /**
   * Farba marky. Vždy z `useChartTheme()` alebo `var(--chart-N)`, NIKDY hex —
   * napísaná farba zostane v druhej téme tá istá.
   */
  color?: string;
  /**
   * Marka „nevieme": šrafovanie namiesto plochy (I11). `color` sa ignoruje —
   * medzera nemá farbu, má vzor, a je to ten istý vzor ako v koláči a v čiare.
   */
  gap?: boolean;
  /** Prerušovaná marka (trend). Odlíšenie TVAROM, nie len farbou. */
  dashed?: boolean;
  /**
   * Marka DOLNEJ HRANICE: plná výplň s prerušovanou hranou.
   *
   * Pribudla vo V6b s histogramom cien a je to jazykové rozhodnutie, nie
   * ozdoba. Zberné pásmo („200 € a viac") je NAMERANÝ počet, ktorého rozsah na
   * osi je len ohraničený zdola — teda tá istá vec ako nedočítaný deň
   * (`.dotEstimate`), a NIE to isté ako `gap`. Kým sa kreslilo šrafovaním,
   * appka tvrdila „toto sme nemerali" nad 180 poctivo zmeranými produktmi.
   *
   * Farba zostáva farbou radu: chvost je ten istý rad, len zhrnutý. Rozdiel
   * nesie hrana (tvar) a slovo v legende, nie odtieň.
   */
  open?: boolean;
  /**
   * Marka JEDNOTLIVEJ POLOŽKY na osi — zvislá čiarka, nie rad.
   *
   * Ceny vybraných produktov v histograme sú body na tej istej osi, nie druhá
   * veličina. Plná plôška by z nich urobila sériu; preto majú tvar značky
   * a neutrálny textový token, nie krok rampy.
   */
  tick?: boolean;
}

/**
 * Marka jednej položky legendy. Malé SVG, nie zafarbený `<span>`: šrafovanie
 * ani prerušovanie sa pozadím nakresliť nedajú, a práve ony sú ten druhý kanál.
 */
function LegendMark({ entry, hatchId }: { entry: ChartLegendEntry; hatchId: string }) {
  if (entry.gap === true) {
    return (
      <svg
        className={styles.legendMark}
        width="16"
        height="12"
        viewBox="0 0 16 12"
        aria-hidden="true"
      >
        <defs>
          <ChartHatchPattern id={hatchId} />
        </defs>
        <rect x="1" y="2" width="14" height="9" fill={`url(#${hatchId})`} />
      </svg>
    );
  }
  if (entry.dashed === true) {
    return (
      <svg
        className={styles.legendMark}
        width="16"
        height="12"
        viewBox="0 0 16 12"
        aria-hidden="true"
      >
        <path
          d="M1 6.5 H15"
          fill="none"
          stroke={entry.color ?? 'currentColor'}
          strokeWidth="2"
          strokeDasharray="4 3"
        />
      </svg>
    );
  }
  if (entry.open === true) {
    /* Plná výplň radu + prerušovaná hrana — presne to, čo kreslí `.barOpen`.
       Marka, ktorá by sa od stĺpca líšila, je návod na inú vec. */
    return (
      <svg
        className={styles.legendMark}
        width="16"
        height="12"
        viewBox="0 0 16 12"
        aria-hidden="true"
      >
        <rect
          className={styles.legendOpenEdge}
          x="1.75"
          y="2.75"
          width="12.5"
          height="7.5"
          fill={entry.color ?? 'currentColor'}
        />
      </svg>
    );
  }
  if (entry.tick === true) {
    return (
      <svg
        className={styles.legendMark}
        width="16"
        height="12"
        viewBox="0 0 16 12"
        aria-hidden="true"
      >
        <path
          d="M8 1 V11"
          fill="none"
          stroke={entry.color ?? 'currentColor'}
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  return (
    <svg
      className={styles.legendMark}
      width="16"
      height="12"
      viewBox="0 0 16 12"
      aria-hidden="true"
    >
      <rect x="1" y="2" width="14" height="9" fill={entry.color ?? 'currentColor'} />
    </svg>
  );
}

/* ═══════════════════════ 2. Prepis grafu do tabuľky ═══════════════════════ */

export interface ChartSummaryTableProps {
  /** Čo tabuľka prepisuje. Ide do `<caption>`, teda do reči čítačky. */
  caption: string;
  /** Hlavička stĺpca hodnôt — slovensky, s jednotkou („Kusy", „Tržba (€)"). */
  valueHead: string;
  /** TIE ISTÉ riadky, z ktorých sa kreslí rad. Nikdy dopočítané zvlášť. */
  rows: readonly ChartRow[];
  /** Ako sa číslo píše. Pomlčku a `≥` dopĺňa `chartRowText()`, nie volajúci. */
  format: (value: number) => string;
  /** Hlavička stĺpca popisov. Predvolene „Bod" — pri čiare je to deň. */
  labelHead?: string;
}

/**
 * Prepis radu do tabuľky. Nekreslí sa sám — vkladá sa do `srSummary`, kde ho
 * `ChartCard` skryje pred okom a ponechá čítačke.
 *
 * Tri stavy hodnoty sú vidieť aj tu, lebo `chartRowText()` je pre graf aj pre
 * tabuľku jedna funkcia: číslo, `≥ číslo`, pomlčka. Kto by v tabuľke pomlčku
 * nahradil nulou, vyrobil by druhú, nepravdivú verziu tých istých dát —
 * a človek s čítačkou by ju čítal ako jedinú.
 */
export function ChartSummaryTable({
  caption,
  valueHead,
  rows,
  format,
  labelHead = 'Bod',
}: ChartSummaryTableProps) {
  return (
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{labelHead}</th>
          <th scope="col">{valueHead}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>{chartRowText(row, format)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ═══════════════════════════ 3. Rám grafu ═════════════════════════════════ */

export interface ChartCardProps {
  /** Popisok sekcie — slovensky, krátko. */
  title: ReactNode;
  /** Čo presne sa meria a na akom celku. Nie ozdoba, kontext. */
  subtitle?: ReactNode;
  /** Ovládanie v hlavičke (obdobie, režim). Nie akcie zápisu. */
  actions?: ReactNode;
  /**
   * Stupeň nadpisu podľa osnovy STRÁNKY, nie podľa veľkosti karty. Na
   * Prehľade je graf sekcia pod `h1`, teda `h2`; na detaile zľavy, kde je
   * `h2` už názov zľavy, musí byť `h3` (`nadpisy-osnova.spec.ts`).
   */
  as?: 'h2' | 'h3';
  /**
   * `md` = `--chart-h` (hlavný graf), `sm` = `--chart-h-sm` (druhotný),
   * `auto` = plocha si výšku určí sama.
   *
   * `auto` je VÝHRADNE pre plochu z INLINE SVG s `viewBox` (histogram cien,
   * koláč): tá si výšku odvodí z pomeru strán a pevná výška by ju len
   * zarámovala do prázdna, prípadne orezala. Pre Recharts sa `auto` použiť
   * NESMIE — `ResponsiveContainer` meria rodiča, takže by sa zbalil na nulu a
   * graf by zmizol bez jediného hlásenia. Stráži to `grafy-chartcard.spec.ts`.
   */
  size?: 'md' | 'sm' | 'auto';
  /** Vlastná legenda pod plochou. Legenda Rechartsu je hlučnejšia. */
  legend?: readonly ChartLegendEntry[];
  /** Načítava sa. Kostra v mieste plochy, nie skok obsahu. */
  loading?: boolean;
  /**
   * Zlyhalo ČÍTANIE plochy. Hláška z `describeActionFailure()` — druhý slovník
   * chýb tu nevzniká. `null` = nezlyhalo nič.
   */
  failure?: ActionFailure | null;
  /** Konkrétnejší nadpis zlyhania („Predaje sa nepodarilo načítať"). */
  failureTitle?: string;
  /**
   * Ďalší krok po zlyhaní — celý prvok, nie `onRetry`. Opakovanie často NIE JE
   * správny krok (zabanovaná IP, vyčerpaná kvóta, chýbajúci kľúč); rodina
   * stavov to má rovnako a dôvod je v hlavičke `ErrorState`.
   */
  failureAction?: ReactNode;
  /**
   * CELÁ plocha je nemeraná (I11) — veta o tom, PREČO. Prekrýva `empty`:
   * plocha bez merania nie je plocha bez dát. Jednu nemeranú hodnotu v inak
   * meranom rade sem NEPOSIELAJ — tá je medzera v grafe a pomlčka v prepise.
   */
  unmeasuredReason?: ReactNode;
  /** Dopyt prešiel a nevrátil ani jeden bod. NIE to isté ako zlyhanie. */
  empty?: boolean;
  emptyTitle?: string;
  /** Ako sa dáta na obrazovku dostanú. Jedna veta (`EmptyState`). */
  emptyDescription?: ReactNode;
  /**
   * Prepis tých istých čísel pre čítačku obrazovky — typicky
   * `<ChartSummaryTable …/>`. POVINNÝ; dôvod je v hlavičke modulu, bod 1.
   */
  srSummary: ReactNode;
  /** Priznania pod grafom: nesťahované dni, pôvod dát, dolné hranice. */
  footer?: ReactNode;
  /** Strom Rechartsu, obvykle `<ResponsiveContainer>`. */
  children: ReactNode;
  testId?: string;
}

/** Čo rám práve kreslí. Ide aj do `data-mode`, aby to preklik aj test videli. */
export type ChartCardMode = 'loading' | 'error' | 'unmeasured' | 'empty' | 'data';

/**
 * Rám každého grafu: plocha, pevná výška z tokenu, jedna rodina stavov,
 * legenda a prepis. Farby si graf berie z `useChartTheme()` — sem sa
 * NEPOSIELAJÚ, aby rám nemohol prekresliť to, čo kreslí rad.
 */
export function ChartCard({
  title,
  subtitle,
  actions,
  as = 'h2',
  size = 'md',
  legend,
  loading = false,
  failure = null,
  failureTitle,
  failureAction,
  unmeasuredReason,
  empty = false,
  emptyTitle = 'Za zvolené obdobie nemáme ani jeden bod',
  emptyDescription = 'Vyber dlhšie obdobie alebo počkaj na najbližšiu synchronizáciu predajov.',
  srSummary,
  footer,
  children,
  testId = 'chart-card',
}: ChartCardProps) {
  const hatchId = useChartPatternId('legend-hatch');
  const bodyClass =
    size === 'sm'
      ? `${styles.cardBody} ${styles.cardBodySm}`
      : size === 'auto'
        ? `${styles.cardBody} ${styles.cardBodyAuto}`
        : styles.cardBody;

  /* Porovnáva sa výslovne — Turbopack v tomto repe už raz vyhodnotil skrátený
     guard ako compile-time falsy. Poradie vetiev nesie význam; pozri hlavičku
     modulu, odsek „Stavy sa pomiešajú".

     `shownFailure` existuje preto, aby `data-mode` a vykreslená vetva nemohli
     povedať dve rôzne veci: je to JEDNA podmienka, nie dve zhodou okolností
     rovnaké. Zároveň z nej TypeScript vidí, že v chybovej vetve hláška naozaj
     je, takže tam nie je potrebné pretypovanie. */
  const shownFailure = loading === true ? null : (failure ?? null);
  const mode: ChartCardMode =
    loading === true
      ? 'loading'
      : shownFailure !== null
        ? 'error'
        : unmeasuredReason !== undefined && unmeasuredReason !== null
          ? 'unmeasured'
          : empty === true
            ? 'empty'
            : 'data';

  return (
    <Panel data-testid={testId} data-mode={mode}>
      <PanelHead title={title} subtitle={subtitle} actions={actions} as={as} />
      <PanelBody>
        {mode === 'loading' ? (
          /* Výšku drží rám, nie kostra: bez toho obsah po dočítaní skočí. */
          <div className={bodyClass} data-testid={`${testId}-loading`}>
            <LoadingState blocks={1} label="Načítavam graf…" />
          </div>
        ) : shownFailure !== null ? (
          <ErrorState
            title={failureTitle}
            failure={shownFailure}
            action={failureAction}
            testId={`${testId}-error`}
          />
        ) : mode === 'unmeasured' ? (
          <UnmeasuredState reason={unmeasuredReason} testId={`${testId}-unmeasured`} />
        ) : mode === 'empty' ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            testId={`${testId}-empty`}
          />
        ) : (
          <>
            {/*
              PLOCHA JE PRE ČÍTAČKU TICHÁ (bod 2 v hlavičke). Čísla nesie prepis
              pod ňou; keby plocha hovorila, čítačka by prečítala hluk z SVG
              a prepis by v ňom zapadol.
            */}
            <div className={bodyClass} aria-hidden="true" data-testid={`${testId}-plot`}>
              {children}
            </div>
            <div className={styles.srOnly} data-testid={`${testId}-summary`}>
              {srSummary}
            </div>
          </>
        )}

        {legend !== undefined && legend.length > 0 && mode === 'data' ? (
          <div className={styles.legend} data-testid={`${testId}-legend`}>
            {legend.map((entry, index) => (
              <span className={styles.legendItem} key={entry.label}>
                <LegendMark entry={entry} hatchId={`${hatchId}-${String(index)}`} />
                {entry.label}
              </span>
            ))}
          </div>
        ) : null}

        {footer === undefined ? null : (
          <div className={styles.sourceNote} data-testid={`${testId}-footer`}>
            {footer}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

export default ChartCard;
