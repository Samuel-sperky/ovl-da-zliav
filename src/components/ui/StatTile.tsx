/**
 * Aura Zľavy — KPI DLAŽDICA (predloha `sperky-admin.html`, `.tile` = k/v/d).
 *
 * Popis / hodnota / detail — tri riadky, jedno číslo. Vzor z predlohy sedí
 * na to, čo appka meria (počet zliav, obrat, ušetrené volania) a v appke už
 * existuje ako trieda `.kpi` (`.k` / `.v` / `.s`) v `globals.css`, ktorú
 * používa Prehľad aj Nastavenia. Tento komponent ju **obaľuje**, nezavádza
 * druhú — inak by na jednej obrazovke boli dve dlaždice s odlišnou geometriou.
 *
 * ČO PRIDÁVA NAVYŠE: SMER ZMENY
 * -----------------------------
 * Predloha mala `.tile .d.up` zelené a `.d.down` červené. To je pasca:
 * **rast čísla nie je sám osebe dobrá správa.** Rastúci obrat áno, rastúci
 * počet neúspešných zápisov nie. Preto sa smer (`trend`) a jeho význam
 * (`trendMeaning`) zadávajú ZVLÁŠŤ a predvolený význam je `idle` — dlaždica
 * ukáže šípku, ale nefarbí ju, kým jej volajúci nepovie, či je to dobre.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Šípka nikdy nestojí sama.** Vedľa `↑` je vždy slovo („nárast",
 *    „pokles", „bez zmeny") — samotný smer aj samotná farba sú príliš málo.
 * 2. **Hodnota je už naformátovaná.** Dlaždica nič nezaokrúhľuje ani
 *    neprepočítava; formátovanie patrí do `lib/ui/format.ts`. Keby počítala,
 *    to isté číslo by na dvoch obrazovkách vyšlo inak.
 * 3. **Chýbajúce číslo je pomlčka, nie nula.** Nula je tvrdenie. Keď hodnota
 *    nie je známa, volajúci posiela `—`.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1.
 */
import type { ReactNode } from 'react';

import styles from '@/components/ui/primitives.module.css';
import {
  TREND_GLYPH,
  TREND_WORD,
  trendTone,
  type TrendDirection,
  type TrendMeaning,
} from '@/components/ui/primitives';

export type { TrendDirection, TrendMeaning };

export interface StatTileProps {
  /** Popis (`.k` v predlohe) — čo sa meria. */
  label: string;
  /** Hodnota (`.v`) — už naformátovaná, alebo `—` keď sa nevie. */
  value: ReactNode;
  /** Detail (`.d`) — kontext pod hodnotou („za posledných 30 dní"). */
  detail?: ReactNode;
  /** Smer zmeny oproti minulému obdobiu. Bez neho sa riadok smeru nekreslí. */
  trend?: TrendDirection;
  /** Doplnok k smeru — o koľko sa zmenil („o 12 %", „o 4 zľavy"). */
  trendDetail?: ReactNode;
  /**
   * Či je ten smer pre používateľa dobrá alebo zlá správa. Predvolene `idle`
   * — bez zafarbenia. Pozri hlavičku modulu.
   */
  trendMeaning?: TrendMeaning;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function StatTile({
  label,
  value,
  detail,
  trend,
  trendDetail,
  trendMeaning = 'idle',
  testId,
}: StatTileProps) {
  const tone = trendTone(trendMeaning);

  return (
    <div className="kpi" data-testid={testId}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {detail ? <div className="s">{detail}</div> : null}
      {trend ? (
        <div className={styles.tileTrend}>
          <span className={styles.trend} data-tone={tone} data-trend={trend}>
            <span className={styles.trendGlyph} aria-hidden="true">
              {TREND_GLYPH[trend]}
            </span>
            <span>
              {TREND_WORD[trend]}
              {trendDetail ? <> {trendDetail}</> : null}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default StatTile;
