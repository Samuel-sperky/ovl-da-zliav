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
 *    nesie GLYF tónu (`TONE_GLYPH` z `ToneBadge` — jeden slovník pre celú
 *    appku) a hneď vedľa nej stojí slovný názov stavu. Farba je až tretia.
 * 2. **Detail sa nikdy neskracuje trojbodkou.** Adresa sa zalomí (`break-all`
 *    v CSS), nezmizne. Skrátená doména je horšia než žiadna — vyzerá presne
 *    ako tá správna.
 * 3. **Do detailu nepatrí tajomstvo.** Sem ide doména alebo názov prostredia,
 *    NIKDY kľúč, token ani ich časť.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1.
 */
import styles from '@/components/ui/primitives.module.css';
import { TONE_GLYPH, type StatusTone } from '@/components/ui/ToneBadge';

export interface StatusPillProps {
  /** Tón stavu (§3.2). `idle` = nespojené, `good` = spojené, `attention` = náhrada. */
  tone: StatusTone;
  /** Názov stavu po slovensky — „Pripojené", „Nepripojené", „Ukážkové dáta". */
  label: string;
  /** Doména alebo prostredie pod stavom, monospacom. Nikdy nie kľúč. */
  detail?: string | null;
  /** Prebitie glyfu, keď tón sám nestačí. Predvolene glyf tónu. */
  glyph?: string;
  /**
   * Oznamovať zmenu stavu čítačke. Zapni len tam, kde sa pilulka počas
   * života stránky naozaj prepína (hlavička); v statickom výpise by z toho
   * bolo len zbytočné táranie.
   */
  live?: boolean;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function StatusPill({ tone, label, detail, glyph, live = false, testId }: StatusPillProps) {
  return (
    <div
      className={styles.pill}
      data-tone={tone}
      data-testid={testId}
      role={live ? 'status' : undefined}
    >
      <div className={styles.pillTop}>
        <span className={styles.pillMark} aria-hidden="true">
          {glyph ?? TONE_GLYPH[tone]}
        </span>
        <span className={styles.pillLabel}>{label}</span>
      </div>
      {detail ? <div className={styles.pillDetail}>{detail}</div> : null}
    </div>
  );
}

export default StatusPill;
