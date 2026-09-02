'use client';

/**
 * Aura Zľavy — PREPÍNAČ ZOBRAZENIA (`Segmented`). Mení, AKO sú tie isté dáta
 * nakreslené, nie ČO je pod ním.
 *
 * Predloha: `aura-roadmap/src/components/ui/Segmented.tsx` (D133, D142).
 * Používa sa tam, kde dnes stojí `.seg` z `globals.css` — okno 7/30/90 dní
 * (`WindowSwitch`), filtre Produktov, riadkov na stránku, okno predaja
 * v sprievodcovi. Tých šesť miest má dnes tú istú geometriu a `Segmented` ich
 * má v V6b nahradiť; `.seg` odíde s poslednou obrazovkou (D139).
 *
 * PREČO `radiogroup` A NIE `tablist` (rozdiel proti predlohe)
 * ----------------------------------------------------------
 * Predloha dáva prepínaču `role="tablist"` a `aria-selected`. Tu to je
 * `role="radiogroup"` a `aria-checked`, a je to vedomá oprava: tablist bez
 * panelov je pre čítačku sľub, že niekde pod ním je `role="tabpanel"` — a ten
 * pri prepínači zobrazenia neexistuje. Skupina rádií hovorí presne to, čo sa
 * deje: **jedna z niekoľkých vzájomne sa vylučujúcich možností**.
 *
 * Dnešný `.seg` v tejto appke používa `role="group"` + `aria-pressed`. Aj to
 * je platné, ale slabšie: šesť samostatných zastavovacích bodov tabulátora
 * namiesto jedného a žiadny pohyb šípkami. `radiogroup` je jeden bod a šípky
 * v ňom vyberajú — pozri KLÁVESNICA nižšie.
 *
 * TRI KANÁLY VÝBERU
 * -----------------
 * Zvolený segment nie je označený len farbou (§4 bod 3):
 *
 *   FARBA  — `--ink` proti `--dim`,
 *   TVAR   — zdvihnutá plocha s vlastným okrajom, teda rozdiel viditeľný aj
 *            bez farby,
 *   ARIA   — `aria-checked="true"` na tom istom uzle.
 *
 * Vzhľad výberu VISÍ NA TOM ATRIBÚTE (`frame.module.css` selektuje
 * `.segment[aria-checked='true']`), takže sa zvolený segment nedá nakresliť
 * bez toho, aby to čítačka vedela.
 *
 * Glyf sa tu zámerne NEKRESLÍ: značka, ktorá pri prepnutí pribudne a zmizne,
 * mení šírku segmentu a celý prepínač pri každom kliknutí poskočí. Tú istú
 * otázku appka riešila pri `.seg` (nález P3, komentár v `NewDiscount.tsx`)
 * a rozhodla ju rovnako — kanál navyše je ARIA, nie glyf.
 *
 * KLÁVESNICA (ARIA APG, vzor „radio group")
 * -----------------------------------------
 * Celá skupina je JEDEN zastavovací bod tabulátora (roving `tabIndex`),
 * vnútri sa hýbe `←`/`→`, `↑`/`↓` a `Home`/`End`, a **výber ide s fokusom**.
 * `↑`/`↓` tu na rozdiel od `Tabs` fungujú, pretože skupina rádií nemá vlastný
 * posuv a APG jej ich predpisuje. `Medzerník` a `Enter` vyberá zaostrený
 * segment sám — je to `<button>`, takže to robí prehliadač.
 *
 * Po klávese sa fokus výslovne presúva na nový segment: keby zostal na
 * starom, ten by v tom istom okamihu prestal byť zastavovacím bodom a človek
 * by mal fokus na prvku, ktorý už nie je zvolený.
 *
 * Vlastník: V6a (rámec stránky).
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import styles from '@/components/ui/frame.module.css';
import { joinClasses, nextRadioIndex } from '@/components/ui/frame';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Viditeľný popis. Slovensky — je to UI text. */
  label: ReactNode;
  /** Značka pred popisom. Dekorácia, význam nesie popis (D146). */
  icon?: ReactNode;
  /**
   * Meno pre čítačku a bublina myši. Uveď LEN vtedy, keď je popis samotné
   * číslo alebo značka („7" nepovie nič, „7 dní" povie). Inak nechaj prázdne
   * — meno si segment vezme z popisu a čítačka nič neprečíta dvakrát.
   */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /**
   * Meno skupiny pre čítačku. Povinné: skupina rádií bez mena je „7, 30, 90"
   * bez toho, čo tie čísla znamenajú. Píš celú otázku, ktorú prepínač mení
   * („Za koľko dní sa počítajú predané kusy").
   */
  ariaLabel: string;
  /** Menší prepínač do hlavičky panela. */
  size?: 'sm' | 'md';
  className?: string;
  /** `data-testid` koreňa skupiny. */
  testId?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  className,
  testId,
}: SegmentedProps<T>) {
  /*
   * Uzly segmentov podľa hodnoty — aby sa po klávese dal fokus presunúť NA
   * NOVÝ segment (pozri hlavičku modulu).
   */
  const nodes = useRef(new Map<T, HTMLButtonElement>());

  const enabled = options.filter((option) => option.disabled !== true);

  /*
   * Keď je zvolená hodnota mimo zoznamu (alebo zakázaná), nemá roving
   * `tabIndex` komu dať nulu a celá skupina vypadne z tabulátora. Zastupuje
   * ju prvý povolený segment — skupina zostane dosiahnuteľná, výber sa
   * nemení.
   */
  const selectedIsEnabled = enabled.some((option) => option.value === value);
  const firstEnabled = enabled.length > 0 ? enabled[0]!.value : null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = enabled.findIndex((option) => option.value === value);
    const next = nextRadioIndex(event.key, enabled.length, at);
    /* Výslovné porovnanie: Turbopack tu už raz skrátený guard zahodil. */
    if (next === null) return;

    const target = enabled[next];
    if (target === undefined) return;

    event.preventDefault();
    if (target.value !== value) onChange(target.value);
    nodes.current.get(target.value)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={joinClasses(styles.segmented, size === 'sm' ? styles.segmentedSm : null, className)}
      data-testid={testId}
    >
      {options.map((option) => {
        const checked = option.value === value;
        const stopsTab = checked || (!selectedIsEnabled && option.value === firstEnabled);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={stopsTab ? 0 : -1}
            disabled={option.disabled === true}
            title={option.title}
            aria-label={option.title}
            onClick={() => onChange(option.value)}
            className={styles.segment}
            ref={(node) => {
              if (node === null) nodes.current.delete(option.value);
              else nodes.current.set(option.value, node);
            }}
          >
            {option.icon === undefined || option.icon === null ? null : option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
