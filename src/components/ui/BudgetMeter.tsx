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
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1.
 */
import Icon from '@/components/ui/Icon';
import styles from '@/components/ui/primitives.module.css';
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
  const ariaText = budgetAriaText(label, spent, limit, resetsAt);
  // Pokojný stav sa nekomentuje — slovo „v rámci stropu" pri každom prúžku je
  // šum. Čítačka ho dostane vždy, cez `aria-valuetext`.
  const showState = level !== 'calm';

  return (
    <div className={styles.meter} data-tone={tone} data-level={level} data-testid={testId}>
      <div className={styles.meterRow}>
        <span className={styles.meterLabel}>{label}</span>
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
