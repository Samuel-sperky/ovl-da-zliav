/**
 * Aura Zľavy — ČIP (predloha `aura-roadmap`: `ui/Chip.tsx` + `FilterChip`
 * v `ui/Toolbar.tsx`; D133, D142).
 *
 * Jediný naozaj NOVÝ komponent signálnej skupiny. Ostatné tri (`ToneBadge`,
 * `StatusPill`, `BudgetMeter`) tu už boli a predloha ich len rozšírila —
 * čip nie, ten si každá obrazovka kreslila sama:
 *
 *  · `products/CatalogFilters.tsx` — `<span class="chip">` s DVOMA vnorenými
 *    tlačidlami a inline objektom `BARE_BUTTON`,
 *  · `campaigns/NewDiscount.tsx` — `<button class="chip on">` ako prepínač
 *    zdroja výberu a `<span class="chip on">` ako značka platného filtra,
 *  · `globals.css` — TRI rodiny na tú istú vec (`.chip`, `.ovl-chip`,
 *    `.ovl-variant-chip`).
 *
 * PREČO DVA KOMPONENTY A NIE JEDEN S PREPÍNAČOM
 * ---------------------------------------------
 * Prepínač je `<button>`; značka platného filtra musí obsahovať tlačidlo
 * („zrušiť"), takže `<button>` byť NEMÔŽE — vnorené interaktívne prvky sú
 * neplatné HTML a klávesnica sa v nich stratí. Predloha to má rozdelené
 * rovnako a je to jediný dôvod delenia: silueta, veľkosť aj rozostupy sú tie
 * isté (`signals.module.css`).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Zapnutý čip nie je len tealová výplň.** Toto je celý dôvod, prečo
 *    komponent vznikol. Predloha rozlišovala zapnuté od vypnutého VÝHRADNE
 *    výplňou a `aria-pressed`; vidiaci používateľ s deuteranopiou z toho
 *    nedostal ani jeden kanál, lebo `aria-pressed` sa nekreslí. Zapnutý čip
 *    preto nesie ZNAČKU (`CHIP_SELECTED_ICON`) ako prvé dieťa. Komentáre
 *    v `CatalogFilters.tsx` aj `NewDiscount.tsx` túto dieru samy priznávajú —
 *    boli napísané ako výhovorka („bez `aria-pressed` nie je čím prečítať"),
 *    nie ako oprava.
 * 2. **Značka je JEDNA a je značka VÝBERU.** Roadmap-ová prop `icon` sa
 *    zámerne NEPORTUJE: pri zapnutom čipe by v jednom uzle stáli dve značky
 *    a `test/helpers/znacky.ts` to meria ako „dva stavy pomiešané v jednom
 *    uzle" — a má pravdu, na obrazovke sa to tak aj číta. Kto potrebuje
 *    ikonu kategórie, potrebuje `ToneBadge`, nie čip.
 * 3. **Vypnutý čip značku NEMÁ.** Neprítomnosť značky je druhý kanál k
 *    neprítomnosti výplne; prázdny krúžok pri každom z dvanástich čipov by
 *    z riadku filtrov spravil šum. Je to ten istý úsudok, akým `BudgetMeter`
 *    mlčí pri úrovni `calm` — pokojný stav sa nekomentuje. Čítačka dostane
 *    stav vždy, cez `aria-pressed`.
 * 4. **Slovo je platba.** Prázdny popis nekreslí prázdny čip, ale náhradné
 *    slovo a príznak `data-signal-wordless` (`ui/signals.ts`). Čip bez slova
 *    je klikateľná farebná pilulka — pre časť používateľov nerozlíšiteľná od
 *    susednej.
 * 5. **Zámok nie je variant čipu.** „Rozmer čaká na dáta" kreslí `LockBadge`
 *    (prerušovaný rámik, zámok, POVINNÝ dôvod). Šiesty variant tu by bol
 *    dvojník s dobrovoľným dôvodom — a `chip lock` v `NewDiscount.tsx` dnes
 *    dôvod naozaj drží len v `title`, čo appka inde už raz opravovala (U17).
 *
 * Server-safe: žiadne hooky, žiadne `use client`. Handlery si dodá klientsky
 * volajúci; komponent sám žiadny stav nedrží.
 *
 * Vlastník: V6a, signálna skupina.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import Icon from '@/components/ui/Icon';
import styles from '@/components/ui/signals.module.css';
import {
  CHIP_REMOVE_ICON,
  CHIP_SELECTED_ICON,
  chipCountLabel,
  chipRemoveLabel,
  signalLabel,
  signalWord,
  wordlessAttrs,
} from '@/components/ui/signals';

/* ═══════════════════════ 1. Čip ako prepínač ══════════════════════════════ */

export interface ChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-pressed'> {
  /** Čo je na čipe napísané — hotový slovenský text („Z filtra", „Prebieha"). */
  label: ReactNode;
  /** Platí táto voľba? Kreslí výplň, značku a `aria-pressed`. */
  active?: boolean;
  /**
   * Počet za popisom. `null` je POMLČKA, nie nula (I11): počet, ktorý appka
   * nezmerala, sa nedopĺňa. Keď sa prop neuvedie, číslo sa nekreslí vôbec —
   * to je tretia, odlišná vec od „nezmerané".
   */
  count?: number | null;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

/**
 * Prepínač voľby. Jedno `<button>`, takže klávesnica aj čítačka fungujú bez
 * dodatočnej práce.
 *
 * `aria-pressed` je v propoch ZAKÁZANÉ (`Omit`): odvodzuje sa z `active`, aby
 * sa nemohlo stať, že čip vyzerá zapnuto a čítačke sa ohlási ako vypnutý.
 */
export function Chip({
  label,
  active = false,
  count,
  className,
  type = 'button',
  testId,
  ...rest
}: ChipProps) {
  const { word, wordless } = signalWord(label);
  const classes = [styles.chip, className ?? ''].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={classes}
      aria-pressed={active}
      data-testid={testId}
      {...rest}
      /* Až za `rest` — príznak chýbajúceho slova sa nesmie dať prepísať zvonku. */
      {...wordlessAttrs(wordless)}
    >
      {/* Značka PRED slovom: inak sa značky susedných čipov nezarovnajú na to
          isté x a rad sa rozskáče. */}
      {active ? (
        <Icon className={styles.chipMark} name={CHIP_SELECTED_ICON} size={0.85} />
      ) : null}
      <span className={wordless ? styles.wordless : undefined}>{word}</span>
      {count === undefined ? null : (
        <span className={styles.chipCount}>{chipCountLabel(count)}</span>
      )}
    </button>
  );
}

/* ═══════════════ 2. Čip ako značka platného filtra ════════════════════════ */

export interface FilterChipProps {
  /**
   * Hotový popis filtra — už zložený, napr. „Kov: striebro". Skladá ho
   * volajúci, pretože len on vie, ako sa jeho rozmer po slovensky pomenúva.
   */
  label: string;
  /**
   * Platí táto značka? Kreslí tintu, značku a — keď je `onApply` — aj
   * `aria-pressed` na vnútornom tlačidle. Značka sa kreslí AJ bez `onApply`:
   * inak by statická značka s `active` mala stav vyjadrený len tintou.
   */
  active?: boolean;
  /** Kliknutie na popis (napr. „použiť uložený filter"). Bez neho je popis text. */
  onApply?: () => void;
  /** Odstránenie značky. Bez neho sa krížik nekreslí (obdobie sa nezruší). */
  onRemove?: () => void;
  /**
   * Vlastné meno odstraňovacieho tlačidla pre čítačku. Predvolene „Zrušiť
   * filter …" — uložený filter sa ale ZABÚDA, nie ruší, a taký rozdiel si
   * volajúci musí vedieť vypýtať.
   */
  removeLabel?: string;
  /** `data-testid` koreňa; tlačidlá si k nemu pripoja `-apply` a `-remove`. */
  testId?: string;
}

/**
 * Značka platného filtra: `<span>` s tlačidlami vnútri.
 *
 * Editačná ceruzka z predlohy sa NEPORTUJE — sada `ui/Icon.tsx` ju nemá
 * (a pridať tvar znamená prekresliť ho na mriežku 16, nie ho doniesť
 * z knižnice, D146) a filter sa v tejto appke upravuje v paneli filtrov, nie
 * v značke. Keď taká potreba vznikne, je to nová ikona a nový prop, nie
 * zabudnuté miesto.
 */
export function FilterChip({
  label,
  active = false,
  onApply,
  onRemove,
  removeLabel,
  testId,
}: FilterChipProps) {
  /*
   * `signalLabel()` a nie `signalWord()`: ten istý text ide aj do `aria-label`
   * odstraňovacieho tlačidla, takže musí byť `string`. „Zrušiť filter " bez
   * predmetu je pre čítačku horšie než náhradné slovo.
   */
  const { label: word, wordless } = signalLabel(label);
  const wordClass = wordless ? styles.wordless : undefined;
  /*
   * Značka výberu sa skladá RAZ a použije sa v oboch vetvách. Keby ju mala
   * každá vetva vlastnú, vznikol by presne ten prípad, ktorý pravidlo troch
   * kanálov porušuje najtichšie: `active` bez `onApply` by nakreslilo tintu
   * (`.tray[data-selected='true']`) a nič viac.
   */
  const mark = active ? (
    <Icon className={styles.chipMark} name={CHIP_SELECTED_ICON} size={0.85} />
  ) : null;

  return (
    <span
      className={styles.tray}
      data-selected={active ? 'true' : 'false'}
      data-testid={testId}
      {...wordlessAttrs(wordless)}
    >
      {onApply === undefined ? (
        <>
          {mark}
          <span className={[styles.trayLabel, wordClass ?? ''].filter(Boolean).join(' ')}>
            {word}
          </span>
        </>
      ) : (
        <button
          type="button"
          className={styles.trayAction}
          aria-pressed={active}
          onClick={onApply}
          data-testid={testId === undefined ? undefined : `${testId}-apply`}
        >
          {/* Značka patrí k TLAČIDLU, nie k obalu: `aria-pressed` je tu a stav
              opisuje práve tento ovládač. */}
          {mark}
          <span className={wordClass}>{word}</span>
        </button>
      )}
      {onRemove === undefined ? null : (
        <button
          type="button"
          className={styles.trayRemove}
          aria-label={removeLabel ?? chipRemoveLabel(word)}
          onClick={onRemove}
          data-testid={testId === undefined ? undefined : `${testId}-remove`}
        >
          {/* Meno nesie `aria-label` TLAČIDLA, takže ikona zostáva `aria-hidden`
              — inak by čítačka prečítala to isté dvakrát (`Icon.tsx`, bod D). */}
          <Icon name={CHIP_REMOVE_ICON} size={0.85} />
        </button>
      )}
    </span>
  );
}

export default Chip;
