'use client';

/**
 * Aura Zľavy — NOVÁ ZĽAVA, panel ŠTART (V11; predloha `design/v3/nova-zlava.html`,
 * kontrakt V3 K2, K5, K6).
 *
 * Odpovedá na jedinú otázku: **kedy to bude zapísané a kedy má zľava nabehnúť.**
 * Zápis nie je akcia, je to fronta bežiaca týždne — 8 000 produktov pri
 * 200 zápisoch denne je 40 dní. Preto sa zľava zadáva s budúcim štartom
 * a appka ho navrhne tak, aby fronta stihla dobehnúť + 2 dni rezerva (K5).
 *
 * Dve veci, ktoré tento panel robí inak, než by bolo pohodlné:
 *
 *  · **Bez rozpočtu žiadny odhad.** Keď sa denný rozpočet nedá prečítať,
 *    panel povie „nevieme" a nedopočíta dátum (P7). Vymyslený dátum štartu je
 *    horší než priznaná medzera — plánuje sa podľa neho produkcia.
 *  · **Varovanie o kľúči nebráni zaradeniu** (K6). Keď kľúč vyprší skôr, než
 *    fronta dobehne, je to príznak a ponuka obnovy — nie brzda. Fronta po
 *    vložení nového kľúča pokračuje presne tam, kde skončila.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';

import styles from '@/components/campaigns/zlavy.module.css';
import { formatDateSk } from '@/lib/ui/format';
import { dayMonthSk, formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface QueueAheadName {
  readonly name: string;
  readonly pending: number;
}

export interface NewDiscountStartProps {
  /** Koľko produktov sa má zapísať. */
  itemsCount: number;
  /** Denný rozpočet zápisov; `null` = nepodarilo sa prečítať. */
  perDay: number | null;
  /** Koľko položiek je vo fronte PRED touto zľavou (rozpočet sa delí). */
  aheadPending: number;
  aheadNames: readonly QueueAheadName[];
  /** Odhadovaný deň dobehnutia fronty; `null` = bez rozpočtu sa nedopočíta. */
  finishDay: string | null;
  /** Navrhovaný štart (dobehnutie + 2 dni rezerva); `null` = nevieme. */
  proposedStart: string | null;
  /** Aktuálne zvolený štart okna. */
  from: string;
  /** Posunie okno na navrhovaný štart, dĺžku okna zachová. */
  onUseProposal: () => void;
  /** Kedy vyprší kľúč na zápis; `null` = nevieme alebo kľúč chýba. */
  keyExpiresAt: string | null;
  keyPresent: boolean;
}

export function NewDiscountStart({
  itemsCount,
  perDay,
  aheadPending,
  aheadNames,
  finishDay,
  proposedStart,
  from,
  onUseProposal,
  keyExpiresAt,
  keyPresent,
}: NewDiscountStartProps) {
  const keyDay = keyExpiresAt === null ? null : keyExpiresAt.slice(0, 10);
  // K6 — porovnávajú sa DNI, nie okamihy: fronta dobehne v priebehu dňa.
  const keyTooShort =
    finishDay !== null && (!keyPresent || (keyDay !== null && keyDay < finishDay));

  return (
    <section className="sec" data-testid="new-discount-start">
      <div className="sec-h">
        <h2>Štart</h2>
        <div className="act">
          <span className="state zapisuje">
            <span className="g" aria-hidden="true" />
            zapisuje sa dopredu
          </span>
        </div>
      </div>

      <dl className={styles.plan}>
        <dt>Na zápis</dt>
        <dd data-testid="start-items">
          {formatCountSk(itemsCount)} {pluralSk(itemsCount, 'produkt', 'produkty', 'produktov')}
        </dd>

        <dt>Denne stihnem</dt>
        <dd>{perDay === null ? 'nevieme' : `${formatCountSk(perDay)} zápisov`}</dd>

        <dt>Pred tebou vo fronte</dt>
        <dd>
          {formatCountSk(aheadPending)}
          {aheadNames.length === 0 ? null : (
            <>
              {' '}
              <span className="lvl-3">
                {aheadNames
                  .slice(0, 2)
                  .map((entry) => `${entry.name} ${formatCountSk(entry.pending)}`)
                  .join(' · ')}
              </span>
            </>
          )}
        </dd>

        <dt>Zapísané budú</dt>
        <dd>
          {finishDay === null ? (
            <span className="lvl-3">nevieme — chýba denný rozpočet</span>
          ) : (
            <span className="est" data-testid="start-finish">
              {formatDateSk(finishDay)}
            </span>
          )}
        </dd>
      </dl>

      <div className={styles.startline}>
        <div>
          <div className="lvl-3">Navrhujem štart</div>
          <div className={styles.day} data-testid="start-proposal">
            {proposedStart === null ? '—' : formatDateSk(proposedStart)}
          </div>
        </div>
        <div className="lvl-3" style={{ paddingBottom: '3px' }}>
          2 dni rezerva
          <br />
          Všetky produkty zlacnejú naraz
        </div>
        <button
          type="button"
          className="btn sm ghost"
          style={{ marginLeft: 'auto' }}
          disabled={proposedStart === null || proposedStart === from}
          onClick={onUseProposal}
          data-testid="start-use-proposal"
        >
          Posunúť
        </button>
      </div>

      {keyTooShort ? (
        <div className={`row wrapx gap-t ${styles.keyline}`} data-testid="key-warning">
          <span className="flag">
            {keyDay === null
              ? `Kľúč na zápis chýba — fronta dobehne ${dayMonthSk(finishDay ?? '')}`
              : `Kľúč na zápis platí do ${dayMonthSk(keyDay)} — fronta dobehne ${dayMonthSk(finishDay ?? '')}`}
          </span>
          <Link className="btn sm" href="/nastavenia#kluce" style={{ marginLeft: 'auto' }}>
            Obnoviť kľúč
          </Link>
        </div>
      ) : null}

      <details className="tech">
        <summary>Ako to počítam</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Denný rozpočet</td>
                <td>{perDay === null ? 'neznámy' : `${formatCountSk(perDay)} zápisov na deň`}</td>
              </tr>
              <tr>
                <td>Pred touto zľavou</td>
                <td>{formatCountSk(aheadPending)} položiek</td>
              </tr>
              <tr>
                <td>Spolu</td>
                <td>{formatCountSk(aheadPending + itemsCount)} zápisov</td>
              </tr>
              <tr>
                <td>Odhad dobehnutia</td>
                <td>{finishDay === null ? 'nevieme' : formatDateSk(finishDay)}</td>
              </tr>
              <tr>
                <td>Kľúč na zápis</td>
                <td>
                  {keyPresent
                    ? keyDay === null
                      ? 'platnosť neznáma'
                      : `platí do ${formatDateSk(keyDay)}`
                    : 'chýba'}
                </td>
              </tr>
              <tr>
                <td>Odhad nepočíta</td>
                <td>so zlyhaniami ani s vypnutým počítačom</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export default NewDiscountStart;
