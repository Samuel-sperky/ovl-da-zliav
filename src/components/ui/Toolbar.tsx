/**
 * Aura Zľavy — LIŠTA NAD TABUĽKOU (D133).
 *
 * Predloha: `aura-roadmap/src/components/ui/Toolbar.tsx`. Portuje sa TVAR
 * A PRAVIDLO (D142), nie súbor — a jedna vec je tu zámerne inak: **lišta
 * nekreslí značky filtrov.** Predloha má vlastný `FilterChip` s triedou
 * `.chip`; tu je značka samostatné primitívum (`Chip`, tá istá vlna V6a),
 * takže by tu vznikla druhá, takmer rovnaká sada — presne to, čo zakazuje
 * docblock v `primitives.module.css` aj rozhodnutie D142. Lišta preto vlastní
 * ROZLOŽENIE (riadok ovládačov + priehradka na značky) a značky dostáva ako
 * `ReactNode` od volajúceho.
 *
 * Prakticky sa to na obrazovke použije takto — počítanie zrušiteľných značiek
 * zostáva u volajúceho, lebo len on vie, ktorá značka sa dá zrušiť (značka
 * obdobia sa zrušiť nedá):
 *
 * ```tsx
 * <FilterToolbar
 *   chips={active.map((f) => <Chip key={f.key} … />)}
 *   onResetAll={removable.length >= 2 ? resetAll : undefined}
 * >
 *   <ToolbarSearch value={q} onChange={setQ} />
 *   <ToolbarSpacer />
 *   …
 * </FilterToolbar>
 * ```
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 *  A. **Žiadna `role="toolbar"`.** Tá rola sľubuje čítačke aj klávesnici, že
 *     sa po ovládačoch chodí šípkami. Túto obsluhu lišta nemá, takže by to
 *     bol sľub, ktorý appka nedodrží — a sľub bez krytia je v tomto repe
 *     zakázaný rovnako v UI ako v dátach.
 *  B. **`aria-label` na `<div>` bez roly čítačka ZAHODÍ.** Priehradka značiek
 *     má preto `role="group"` — to isté pravidlo, aké má výber riadkov na
 *     stránku a panel detailu.
 *  C. **Jedno pole hľadania na obrazovku.** Dve vyhľadávacie polia vedľa seba
 *     sú dva rôzne výsledky a nikto nevie, ktoré platí. Triedenie a stĺpce
 *     patria tabuľke, nie sem.
 *  D. **Vypnutá lišta musí povedať PREČO.** Zošednuté ovládače bez vety sú
 *     nerozlíšiteľné od poruchy; `disabledHint` je preto pri `disabled`
 *     jediný obsah, ktorý sa vykreslí.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a, skupina „Tabuľka" (D133).
 */
import { Children, type HTMLAttributes, type ReactNode } from 'react';

import Button from '@/components/ui/Button';
import styles from '@/components/ui/tables.module.css';

const cls = (...parts: readonly (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

/* ═══════════════════════════ 1. Riadok ovládačov ══════════════════════════ */

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Prilepí riadok pod chróm, kým obsah pod ním roluje. Odsadenie od hornej
   * hrany povie obrazovka premennou `--ovl-toolbar-top` (hlavička appky je
   * 56 px, obrazovka s vlastným `topbar`-om má pod ňou ešte 44 px).
   */
  sticky?: boolean;
}

/** Jeden riadok ovládačov. `<ToolbarSpacer/>` odtlačí zvyšok doprava. */
export function Toolbar({ sticky = false, className, ...rest }: ToolbarProps) {
  return (
    <div {...rest} className={cls(styles.toolbar, sticky && styles.toolbarSticky, className)} />
  );
}

/** Pružná medzera — všetko za ňou stojí vpravo. */
export function ToolbarSpacer() {
  return <span className={styles.spacer} />;
}

/* ═══════════════════════════ 2. Pole hľadania ═════════════════════════════ */

export interface ToolbarSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Meno pre čítačku; bez neho ho nesie `placeholder`. */
  ariaLabel?: string;
  /** Vedúca ikona (D146: `ReactNode`, nie typ z knižnice). Dekoratívna. */
  icon?: ReactNode;
  /** `id` pola — keď má vlastný `<label>` mimo lišty. */
  id?: string;
  className?: string;
  testId?: string;
}

/**
 * Fulltextové pole. Jedno na obrazovku (bod C hlavičky).
 *
 * `type="search"` je zámer: prehliadač k nemu pridá vlastné mazanie obsahu,
 * takže tu netreba druhé tlačidlo na to isté.
 */
export function ToolbarSearch({
  value,
  onChange,
  placeholder = 'Hľadať…',
  ariaLabel,
  icon,
  id,
  className,
  testId,
}: ToolbarSearchProps) {
  return (
    <div className={cls(styles.search, className)}>
      {icon === undefined ? null : <span aria-hidden="true">{icon}</span>}
      <input
        id={id}
        type="search"
        className={styles.searchInput}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      />
    </div>
  );
}

/* ═══════════════════════════ 3. Priehradka značiek ════════════════════════ */

export interface FilterTrayProps {
  /** Značky aktívnych filtrov. Kreslí ich volajúci (`Chip`), nie lišta. */
  children?: ReactNode;
  /** Popisok priehradky. Slovensky a krátko. */
  label?: string;
  /** Zruší všetky filtry naraz. Podaj ju, až keď to má zmysel — pozri
   *  hlavičku modulu (počítanie zrušiteľných značiek patrí volajúcemu). */
  onResetAll?: () => void;
  resetLabel?: string;
  className?: string;
}

export function FilterTray({
  children,
  label = 'Filtre',
  onResetAll,
  resetLabel = 'Zrušiť filtre',
  className,
}: FilterTrayProps) {
  return (
    // Bod B hlavičky — `aria-label` potrebuje rolu.
    <div className={cls(styles.tray, className)} role="group" aria-label="Aktívne filtre">
      <span className={styles.trayLabel}>{label}</span>
      {children}
      {onResetAll === undefined ? null : (
        <Button small variant="ghost" onClick={onResetAll} data-testid="filters-reset-all">
          {resetLabel}
        </Button>
      )}
    </div>
  );
}

/* ═══════════════════════════ 4. Celá lišta filtrov ════════════════════════ */

export interface FilterToolbarProps {
  /** Riadok ovládačov (hľadanie, výbery, prepínač zobrazenia). */
  children?: ReactNode;
  /** Značky aktívnych filtrov pod ovládačmi. Prázdno = priehradka sa nekreslí. */
  chips?: ReactNode;
  onResetAll?: () => void;
  sticky?: boolean;
  /** Ovládače sa nedajú použiť (napr. tab, ktorý nemá čo filtrovať). */
  disabled?: boolean;
  /** Prečo sa nedajú. Pri `disabled` je to jediný obsah — bod D hlavičky. */
  disabledHint?: ReactNode;
  className?: string;
}

/**
 * Hostiteľ filtrov pre dátové obrazovky: riadok ovládačov + priehradka
 * značiek. Fulltext, triedenie a stĺpce patria tabuľke — tu sa nezdvojujú.
 */
export function FilterToolbar({
  children,
  chips,
  onResetAll,
  sticky = false,
  disabled = false,
  disabledHint,
  className,
}: FilterToolbarProps) {
  /*
   * PRÁZDNA PRIEHRADKA SA NEKRESLÍ. `chips` je najčastejšie `list.map(…)`,
   * teda pri žiadnom filtre PRÁZDNE POLE — a to je v JS pravdivá hodnota,
   * takže obyčajná podmienka by nakreslila priehradku s popiskom „Filtre"
   * a ničím v nej. `Children.count([])` je nula; `null`/`undefined` sa musia
   * odfiltrovať zvlášť, lebo tie React počíta ako jedno dieťa.
   */
  const hasChips =
    chips === undefined || chips === null || chips === false
      ? false
      : Children.count(chips) > 0;
  return (
    <div className={cls(styles.filterToolbar, sticky && styles.toolbarSticky, className)}>
      {disabled ? (
        disabledHint === undefined ? null : (
          <p className={styles.trayHint} role="status">
            {disabledHint}
          </p>
        )
      ) : (
        <Toolbar>{children}</Toolbar>
      )}
      {hasChips ? <FilterTray onResetAll={onResetAll}>{chips}</FilterTray> : null}
    </div>
  );
}

export default Toolbar;
