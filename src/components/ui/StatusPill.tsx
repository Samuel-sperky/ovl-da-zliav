/**
 * Aura Zľavy — STAVOVÁ PILULKA SPOJENIA (predloha `sperky-admin.html`,
 * `.conn-pill`).
 *
 * Predloha ukazovala v pätke sidebaru bodku (šedá / zelená / žltá), za ňou
 * názov stavu a pod tým doménu monospacom. Preberáme presne túto trojicu —
 * lebo odpovedá na tri otázky naraz: či to ide, ako to ide a KAM to ide.
 * Tretia otázka je pritom tá, kvôli ktorej pilulka vznikla: appka zapisuje do
 * PRODUKČNÉHO shopu a nikto si nesmie pomýliť testovaciu adresu s ostrou.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Bodka nie je len bodka.** Predlohová `.dot` bola čistý farebný krúžok;
 *    v tmavej téme je taká bodka pod deuteranopiou nečitateľná. Naša značka
 *    nesie IKONU tónu (`TONE_ICON` z `ToneBadge` — jeden slovník pre celú
 *    appku) a hneď vedľa nej stojí slovný názov stavu. Farba je až tretia.
 * 2. **Detail sa nikdy neskracuje trojbodkou.** Adresa sa zalomí (`break-all`
 *    v CSS), nezmizne. Skrátená doména je horšia než žiadna — vyzerá presne
 *    ako tá správna.
 * 3. **Do detailu nepatrí tajomstvo.** Sem ide doména alebo názov prostredia,
 *    NIKDY kľúč, token ani ich časť.
 *
 * ZLÚČENIE S `Pill` Z `aura-roadmap` (D142, 2. 9. 2026)
 * ------------------------------------------------------
 * Predlohová `ui/Pill.tsx` je INLINE pilulka verzálkami s bodkou — kanonický
 * vykresľovač doménových slovníkov (stav položky, životný cyklus, zdravie).
 * Táto pilulka je iná vec: dvojriadková, s monospace detailom a s možnosťou
 * ohlasovať zmenu čítačke. Zlučuje sa preto PRAVIDLO, nie tvar:
 *
 *  · **Prišlo:** „popis je platba, tón ju len zosilňuje". Vynútené — pozri
 *    prop `label` a `ui/signals.ts`.
 *  · **NEPRIŠLO:** inline tvar. Tú rolu tu už nesie `ToneBadge` a druhá
 *    inline pilulka vedľa nej by bola presne ten dvojník, ktorý D142 zakazuje.
 *    Kto chce stav do bunky tabuľky alebo do riadku zoznamu, píše `ToneBadge`.
 *  · **NEPRIŠLO:** prop `dot={false}` („turn off for plain labels"). Je to
 *    zadné dvierka z pravidla troch kanálov: pilulka bez značky nesie stav
 *    farbou a slovom, a v tejto appke je značka to jediné, čo prežije
 *    monochromatickú tlač aj deuteranopiu. Kto potrebuje popis bez stavu,
 *    nepotrebuje stavovú pilulku, ale text.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1; zlúčenie V6a.
 */
import Icon, { type IconName } from '@/components/ui/Icon';
import styles from '@/components/ui/primitives.module.css';
import signalStyles from '@/components/ui/signals.module.css';
import { signalLabel, wordlessAttrs } from '@/components/ui/signals';
import { TONE_ICON, type StatusTone } from '@/components/ui/ToneBadge';

export interface StatusPillProps {
  /** Tón stavu (§3.2). `idle` = nespojené, `good` = spojené, `attention` = náhrada. */
  tone: StatusTone;
  /**
   * Názov stavu po slovensky — „Pripojené", „Nepripojené", „Ukážkové dáta".
   *
   * Je to PLATBA pilulky, nie jej ozdoba (formulácia predlohy: „the SK label
   * is the payload; the tone only reinforces it"). Keď dorazí prázdny,
   * nakreslí sa náhradné slovo a príznak `data-signal-wordless` — pilulka bez
   * názvu je krúžok s farbou a monospace adresou pod ním.
   */
  label: string;
  /** Doména alebo prostredie pod stavom, monospacom. Nikdy nie kľúč. */
  detail?: string | null;
  /** Prebitie značky, keď tón sám nestačí. Predvolene ikona tónu. */
  icon?: IconName;
  /**
   * Oznamovať zmenu stavu čítačke. Zapni len tam, kde sa pilulka počas
   * života stránky naozaj prepína (hlavička); v statickom výpise by z toho
   * bolo len zbytočné táranie.
   */
  live?: boolean;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function StatusPill({ tone, label, detail, icon, live = false, testId }: StatusPillProps) {
  const { label: word, wordless } = signalLabel(label);
  return (
    <div
      className={styles.pill}
      data-tone={tone}
      data-testid={testId}
      role={live ? 'status' : undefined}
      /* Až za ostatnými — príznak defektu sa nesmie dať prepísať zvonku. */
      {...wordlessAttrs(wordless)}
    >
      <div className={styles.pillTop}>
        <Icon className={styles.pillMark} name={icon ?? TONE_ICON[tone]} size={0.9} />
        <span
          className={
            wordless ? `${styles.pillLabel} ${signalStyles.wordless}` : styles.pillLabel
          }
        >
          {word}
        </span>
      </div>
      {detail ? <div className={styles.pillDetail}>{detail}</div> : null}
    </div>
  );
}

export default StatusPill;
