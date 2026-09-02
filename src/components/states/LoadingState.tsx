/**
 * Aura Zľavy — PRVÉ NAČÍTANIE (D134; predloha `aura-roadmap`, `LoadingState`).
 *
 * ČO ZJEDNOCUJE
 * -------------
 * Kostru prvého načítania kreslila appka na šiestich miestach ručne —
 * `<div className="ovl-skeleton" style={{ minHeight: '8rem' }} aria-busy>` na
 * Prehľade, v audite, v pod-stránkach Nastavení. Vzhľad z toho bol rovnaký
 * náhodou (výšky 44 / 160 / 190 / 212 px vedľa seba) a ani jedno z tých miest
 * nemalo pri sebe SLOVO. Miery sú odteraz v `states.module.css`, slovo tu.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Slovo je nosný kanál, nie ozdoba.** Shimmer je animácia a
 *    `prefers-reduced-motion` ju v `globals.css` vypína úplne; bez `label` by
 *    z načítavania zostali tri nehybné sivé obdĺžniky, ktoré sú od pokazenej
 *    obrazovky nerozlíšiteľné. Preto je text VIDITEĽNÝ, nie len `aria-label`.
 * 2. **`role="status"` musí byť na tom istom uzle ako meno.** `aria-label` na
 *    prvku bez roly čítačka zahodí (nález P5,
 *    `test/unit/klavesnica-a-citacka.spec.ts` bod A) — a `role="status"` navyše
 *    počká, kým dočíta vetu, namiesto toho, aby do nej skočil ako `alert`.
 *    Načítavanie nikoho nemá prerušovať.
 * 3. **Načítavanie NETVRDÍ, že je prázdno.** Kým odpoveď nedošla, appka
 *    o obsahu nevie nič — ani to, že tam nič nie je. Kto na prvé načítanie
 *    použije `EmptyState`, povie nepravdu ešte pred odpoveďou; kto naopak
 *    nechá kostru po odpovedi, zamlčí prázdno.
 * 4. **Len PRVÉ načítanie.** Opakované načítanie nad už zobrazenými dátami má
 *    dáta NECHAŤ na obrazovke a označiť ich `aria-busy` — výmena obsahu za
 *    kostru pri každom refetchi bliká a človek stratí miesto, kde čítal.
 * 5. **Kostra má mať tvar toho, čo príde.** Preto sa počet dlaždíc a blokov
 *    zadáva; keď sa nezhoduje, obsah po dopadnutí poskočí a to je vlastný druh
 *    chyby (rovnaký dôvod, prečo `.kpi` a karty držia jeden rytmus `--gap`).
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a (rodina stavov, D134).
 */
import styles from '@/components/states/states.module.css';
import { LOADING_LABEL } from '@/components/states/state-copy';

export interface LoadingStateProps {
  /** Viditeľné slovo pod kostrou. Predvolene „Načítavam…". */
  label?: string;
  /** Koľko dlaždíc KPI má riadok, ktorý príde. `0` = žiadny riadok dlaždíc. */
  tiles?: number;
  /** Koľko blokov obsahu príde. `0` = žiadny blok. */
  blocks?: number;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function LoadingState({
  label = LOADING_LABEL,
  tiles = 0,
  blocks = 2,
  testId,
}: LoadingStateProps) {
  /* Pokazený vstup nesmie vyrobiť zápornú dĺžku polí — kostra má v najhoršom
     prípade zmiznúť, nie zhodiť obrazovku. */
  const tileCount = Number.isFinite(tiles) ? Math.max(0, Math.trunc(tiles)) : 0;
  const blockCount = Number.isFinite(blocks) ? Math.max(0, Math.trunc(blocks)) : 0;

  return (
    <div
      className={styles.loading}
      role="status"
      aria-busy="true"
      data-story="nacitava"
      data-testid={testId}
    >
      {tileCount > 0 ? (
        <div className={styles.tiles}>
          {Array.from({ length: tileCount }, (_, i) => (
            <div className={`ovl-skeleton ${styles.tile}`} key={`tile-${i}`} />
          ))}
        </div>
      ) : null}
      {Array.from({ length: blockCount }, (_, i) => (
        <div className={`ovl-skeleton ${styles.block}`} key={`block-${i}`} />
      ))}
      {/* Slovo je pod kostrou a je súčasťou toho istého `status` uzla, takže ho
          čítačka prečíta raz a v poradí, v akom stojí na obrazovke. */}
      <p className={styles.caption}>{label}</p>
    </div>
  );
}

export default LoadingState;
