/**
 * Aura Zľavy — PLOCHA (`Panel`), jediné primitívum ohraničeného obsahu.
 *
 * Predloha: `aura-roadmap/src/components/ui/Panel.tsx` (D133, D142 — portuje
 * sa TVAR a PRAVIDLO, nie súbor). Rozdiely proti predlohe sú tri a všetky sú
 * vedomé:
 *
 *  1. **Vzhľad je v `frame.module.css`**, nie v `globals.css` (D143).
 *  2. **`icon` berie `ReactNode`**, nie `LucideIcon` (D146) — značky kreslí
 *     miestny `ui/Icon.tsx` a nová závislosť len pre typ propu sa nevyplatí.
 *  3. **Nadpis panela je POPISOK SEKCIE**, nie titulok. Predloha mu dáva
 *     `--text-lg`; táto appka už rozhodla, že dominantou karty je ČÍSLO
 *     (D2, tri roly popiskov), a port to rozhodnutie nesmie zrušiť.
 *
 * ŠTYRI KUSY, NIE JEDEN KOMPONENT S DVANÁSTIMI PROPMI
 * --------------------------------------------------
 * `Panel` je len plocha. Hlavička (`PanelHead`), telo (`PanelBody`) a pätička
 * (`PanelFoot`) sú samostatné a VŠETKY sú nepovinné — tým je splnená
 * „varianta s hlavičkou aj bez": panel bez `PanelHead` je plocha bez hlavičky,
 * žiadny príznak na to netreba. Keby hlavičku niesol prop, každá obrazovka by
 * musela vedieť, čo dostane, keď ho nepošle; takto vidí presne to, čo napíše.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **`as` volí STUPEŇ nadpisu, nie veľkosť.** Na obrazovke s `h1` v
 *     `PageHeader` je hlavička sekcie `h2`; na detaile zľavy, kde názov zľavy
 *     už `h2` je, musí byť `h3` — inak čítačka ohlási preskočený stupeň
 *     (`test/unit/nadpisy-osnova.spec.ts`). Vyzerajú rovnako zámerne.
 *
 *  B. **Panel nič nezalamuje ani neskracuje.** Keď obsah nemá byť taký dlhý,
 *     rozhoduje o tom obrazovka. Plocha, ktorá potichu odstrihne text, je
 *     najtichší spôsob, ako appka zamlčí, čo vie.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a (rámec stránky).
 */
import type { HTMLAttributes, ReactNode } from 'react';

import styles from '@/components/ui/frame.module.css';
import { joinClasses } from '@/components/ui/frame';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Vnorená plocha — panel vnútri panela. Bez tieňa a o odtieň inak, aby
   * bolo vidieť, ktorá plocha je v ktorej.
   */
  soft?: boolean;
}

/** Plocha. Všetko ohraničené na obrazovke je `Panel`. */
export function Panel({ soft = false, className, ...rest }: PanelProps) {
  return (
    <div {...rest} className={joinClasses(soft ? styles.panelSoft : styles.panel, className)} />
  );
}

export interface PanelHeadProps {
  /** Popisok sekcie — čo v tejto ploche je. */
  title?: ReactNode;
  /** Druhý riadok pod popiskom: kontext, obdobie, priznanie „nevieme". */
  subtitle?: ReactNode;
  /** Značka pred popiskom. Dekorácia — význam nesie slovo vedľa (D146). */
  icon?: ReactNode;
  /** Akcie zarovnané vpravo. */
  actions?: ReactNode;
  /** Stupeň nadpisu. Vyber podľa osnovy stránky — pozri bod A hlavičky. */
  as?: 'h2' | 'h3';
  /** Nahradí celý blok popisku, keď hlavička potrebuje vlastný obsah. */
  children?: ReactNode;
  className?: string;
}

export function PanelHead({
  title,
  subtitle,
  icon,
  actions,
  as = 'h2',
  children,
  className,
}: PanelHeadProps) {
  const Heading = as;
  /*
   * Turbopack v tomto repe už raz vyhodnotil skrátený guard ako compile-time
   * falsy, takže sa porovnáva výslovne. `children` sa nekreslí ako „aj popisok
   * aj obsah" — je to NÁHRADA bloku popisku (predloha to má rovnako).
   */
  const ownContent = children === undefined || children === null;

  return (
    <div className={joinClasses(styles.panelHead, className)}>
      {icon === undefined || icon === null ? null : (
        <span className={styles.panelHeadIcon}>{icon}</span>
      )}
      {ownContent ? (
        <div className={styles.panelHeadText}>
          {title === undefined || title === null ? null : <Heading>{title}</Heading>}
          {subtitle === undefined || subtitle === null ? null : (
            <p className={styles.panelHeadSub}>{subtitle}</p>
          )}
        </div>
      ) : (
        children
      )}
      {actions === undefined || actions === null ? null : (
        <div className={styles.panelHeadActions}>{actions}</div>
      )}
    </div>
  );
}

export interface PanelBodyProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Bez vnútorného odsadenia — pre telo, ktoré je celé tabuľka alebo graf.
   * Tie majú vlastné okraje a druhé odsadenie navrch im len ubere plochu,
   * na ktorej sa dá čítať.
   */
  flush?: boolean;
}

export function PanelBody({ flush = false, className, ...rest }: PanelBodyProps) {
  return (
    <div
      {...rest}
      className={joinClasses(styles.panelBody, flush ? styles.panelBodyFlush : null, className)}
    />
  );
}

/** Pätička s akciami. Akcie idú vpravo — tam ich oko hľadá po prečítaní tela. */
export function PanelFoot({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={joinClasses(styles.panelFoot, className)} />;
}

export default Panel;
