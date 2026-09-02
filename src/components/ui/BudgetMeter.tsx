/**
 * Aura Zľavy — MERACÍ PRÚŽOK ROZPOČTU (predloha `sperky-admin.html`, `.meter`).
 *
 * Predloha mala v pätke sidebaru dva riadky — „minúta 0/18" a „dnes 0/200" —
 * a pod každým tenký prúžok, ktorý sčervenel pri naplnení. Vzor preberáme,
 * vzhľad nie: appka je tmavá, farby sú Aura teal + gold, a hlavne
 * **vyčerpaný rozpočet tu nie je červený** (K2 — pozri `primitives.ts`).
 *
 * PREČO TENTO KOMPONENT VZNIKOL
 * -----------------------------
 * Rozpočet volaní do shopu je jediný dôvod, prečo appka občas nič nerobí.
 * Kým to bolo napísané len v texte hlavičky, používateľ videl „appka stojí"
 * a nie „appka čaká na strop". Prúžok je tá istá informácia, ktorú vidno
 * skôr, než sa začne čítať.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Tri kanály, jeden zdroj.** Farba (`data-tone`), glyf a slovo pochádzajú
 *    z jednej úrovne (`budgetLevel`). Kto by chcel zafarbiť prúžok bez toho,
 *    aby sa zmenilo slovo, rozbije jediné pravidlo, ktoré tu platí bez výnimky:
 *    stav nikdy nie je len farba.
 * 2. **Prístupnosť nie je `title`.** Prúžok je `role="progressbar"` s
 *    `aria-valuenow` a `aria-valuetext` — čítačka prečíta ľudskú vetu, nie
 *    „62 percent". Vizuálny text je pritom ten istý; nič sa nikam neskrýva.
 * 3. **Nič sa nepočíta v JSX.** Percento aj úroveň prichádzajú z čistých
 *    funkcií v `primitives.ts`, ktoré má pod testom `ui-primitives.spec.ts`.
 *
 * ZLÚČENIE S `ProgressBar` Z `aura-roadmap` (D142, 2. 9. 2026)
 * ------------------------------------------------------------
 * Predloha má `ui/ProgressBar.tsx` s pásmami `healthTone()` (zelená ≥ 100 %,
 * jantár 60–99 %, červená < 60 %). Je to prúžok PRIPRAVENOSTI — viac je
 * lepšie. Tento je prúžok SPOTREBY — viac je horšie. Rovnaká geometria, opačný
 * zmysel, takže sa portovalo pravidlo, nie súbor:
 *
 *  · **Prišlo:** veta z predlohy „grey = no data → caller passes no bar at
 *    all, not a grey one". Tu má tvrdšiu podobu: neznámy strop nekreslí sivý
 *    prúžok ani prázdny prúžok, ale PLNÝ so slovom „strop vyčerpaný"
 *    (`budgetFillPercent`, bod 3 v hlavičke `ui/primitives.ts`). Appka radšej
 *    povie „nemám kam zapisovať", než by sľúbila kapacitu, o ktorej nevie.
 *  · **Prišlo:** poistka na popis. Predloha má `label` len ako prístupné meno
 *    a prázdne ho nechá byť; tu je popis viditeľný a prázdny by z prúžku
 *    urobil dva čísla a farbu bez predmetu (`ui/signals.ts`).
 *  · **NEPRIŠLI:** pásma `healthTone()`. Prah je tu 80 % a je to tá istá
 *    rezerva ako `RATE_SAFETY_FACTOR` (`lib/shop/rate-limits.ts`) — nie
 *    estetická voľba. Druhá škála prahov by sa s ňou rozišla.
 *  · **NEPRIŠOL:** `value` / `max` ako priame percento. Šírka výplne aj text
 *    `160/200` musia vychádzať z tej istej dvojice čísel (bod 4 v hlavičke
 *    `ui/primitives.ts`), inak sa raz rozídu.
 *  · **NEPRIŠIEL:** tón `ok` (zelený prúžok). Zelená by tvrdila, že spotreba
 *    je úspech; v tejto appke je spotreba len rýchlosť.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1; zlúčenie V6a.
 */
import Icon from '@/components/ui/Icon';
import styles from '@/components/ui/primitives.module.css';
import signalStyles from '@/components/ui/signals.module.css';
import { signalLabel, wordlessAttrs } from '@/components/ui/signals';
import {
  BUDGET_LEVEL_ICON,
  BUDGET_LEVEL_WORD,
  budgetAriaText,
  budgetCountLabel,
  budgetFillPercent,
  budgetLevel,
  budgetLevelTone,
} from '@/components/ui/primitives';
import type { StatusTone } from '@/components/ui/ToneBadge';

export interface BudgetMeterProps {
  /** Čo sa meria — slovensky, krátko („Zápisy dnes", „Volania za minútu"). */
  label: string;
  /** Koľko sa už minulo. */
  spent: number;
  /** Strop. Nekonečno ani nulu neriešime tichom — pozri `budgetFillPercent`. */
  limit: number;
  /**
   * Kedy sa strop obnoví — HOTOVÁ fráza aj s predložkou („o 02:00",
   * „zajtra o 02:00"). Keď sa neuvedie, riadok o obnove sa nekreslí.
   */
  resetsAt?: string | null;
  /**
   * Tón pri plnom stropu. Predvolene `attention`: vyčerpaný rozpočet nie je
   * chyba. `critical` si pýtaj len tam, kde plný strop naozaj znamená, že sa
   * niečo pokazilo.
   */
  fullTone?: StatusTone;
  /** Hrubší prúžok do karty, kde je rozpočet hlavnou informáciou. */
  large?: boolean;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function BudgetMeter({
  label,
  spent,
  limit,
  resetsAt,
  fullTone = 'attention',
  large = false,
  testId,
}: BudgetMeterProps) {
  const percent = budgetFillPercent(spent, limit);
  const level = budgetLevel(spent, limit);
  const tone = budgetLevelTone(level, fullTone);
  /*
   * Popis prechádza poistkou tretieho kanála a do vety pre čítačku ide UŽ
   * doplnený. Keby si `budgetAriaText()` bralo pôvodný `label`, čítačka by
   * prečítala „: 160/200, blíži sa strop" — teda dvojbodku bez predmetu.
   */
  const { label: word, wordless } = signalLabel(label);
  const ariaText = budgetAriaText(word, spent, limit, resetsAt);
  // Pokojný stav sa nekomentuje — slovo „v rámci stropu" pri každom prúžku je
  // šum. Čítačka ho dostane vždy, cez `aria-valuetext`.
  const showState = level !== 'calm';

  return (
    <div
      className={styles.meter}
      data-tone={tone}
      data-level={level}
      data-testid={testId}
      {...wordlessAttrs(wordless)}
    >
      <div className={styles.meterRow}>
        <span
          className={
            wordless ? `${styles.meterLabel} ${signalStyles.wordless}` : styles.meterLabel
          }
        >
          {word}
        </span>
        <span className={styles.meterCount}>{budgetCountLabel(spent, limit)}</span>
      </div>
      <div
        className={styles.meterTrack}
        style={large ? { height: 'var(--ovl-meter-h-lg)' } : undefined}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={ariaText}
      >
        <i className={styles.meterFill} style={{ width: `${percent}%` }} />
      </div>
      {showState ? (
        <span className={styles.meterState}>
          <Icon className={styles.meterGlyph} name={BUDGET_LEVEL_ICON[level]} size={0.9} />
          <span>
            {BUDGET_LEVEL_WORD[level]}
            {resetsAt ? <span className={styles.meterReset}> · obnoví sa {resetsAt}</span> : null}
          </span>
        </span>
      ) : null}
    </div>
  );
}

export default BudgetMeter;
