'use client';

/**
 * Aura Zľavy — NOVÁ ZĽAVA, blok ČASU ZÁPISU (V11; predloha
 * `design/v3/nova-zlava.html`, kontrakt V3 K2, K5, K6; kontrakt UI, bod 24).
 *
 * Odpovedá na jedinú otázku: **kedy to bude zapísané a kedy má zľava nabehnúť.**
 * Zápis nie je akcia, je to fronta bežiaca dni — 150 produktov pri 200 zápisoch
 * na deň je jeden deň, 8 000 je štyridsať. Preto sa zľava zadáva s budúcim
 * štartom a appka ho navrhne tak, aby fronta stihla dobehnúť + 2 dni rezerva (K5).
 *
 * DVA DNI NA POVRCHU, VÝPOČET POD ROZKLIK (P6, kontrakt UI bod 24)
 * ---------------------------------------------------------------
 * Blok nie je vlastná sekcia — je to vnútro karty potvrdenia, a preto nesie len
 * dva dni: **kedy bude všetko zapísané** a **kedy zľava nabehne zákazníkom**.
 * Denný rozpočet, počet položiek pred nami a dĺžka fronty sú medzikroky toho
 * istého výpočtu; v šiestich riadkoch nad sebou tie dva dôležité dni zanikali,
 * tak sú medzikroky v rozkliku „Ako to počítam".
 *
 * Rozdiel medzi tými dvoma dňami je jediné, čo tu naozaj bolí: keď zľava
 * nabehne skôr, než sa všetko zapíše, produkty zlacnejú po častiach a na eshope
 * to vyzerá ako chyba. `judgeStart()` to preto povie vetou PRED potvrdením.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Bez rozpočtu žiadny dátum.** Keď sa denný rozpočet ani počet položiek
 *    pred nami nedá prečítať, na povrchu je pomlčka a dôvod je v rozkliku (P7).
 *    Vymyslený deň dobehnutia je horší než priznaná medzera — plánuje sa podľa
 *    neho produkcia.
 * 2. **Deň dobehnutia je odhad a musí to byť vidieť** — nesie triedu `est`,
 *    teda `≈` a tlmenejší odtieň. Deň nábehu zľavy je voľba človeka, nie
 *    odhad, a `≈` mať NESMIE; keby ho mal, prestal by byť rozoznateľný od
 *    dopočítaného čísla.
 * 3. **Varovanie o kľúči nebráni zaradeniu** (K6). Keď kľúč vyprší skôr, než
 *    fronta dobehne, je to príznak a ponuka obnovy — nie brzda. Fronta po
 *    vložení nového kľúča pokračuje presne tam, kde skončila.
 * 4. **`aheadPending` má dva zdroje** (presne z fronty, alebo odhadom z
 *    počítadiel zliav) a rozklik MUSÍ povedať, ktorý to je — inak sa dve
 *    obrazovky rozídu o stovky položiek a nikto nebude vedieť, ktorej veriť.
 *    Rozhoduje o tom `resolveAhead()` v `queue-model.ts`, nie tento súbor.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';

import styles from '@/components/campaigns/zlavy.module.css';
import { judgeStart, type AheadView } from '@/components/campaigns/queue-model';
import BudgetMeter from '@/components/ui/BudgetMeter';
import Note from '@/components/ui/Note';
import { formatDateSk } from '@/lib/ui/format';
import { dayMonthSk, formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface QueueAheadName {
  readonly name: string;
  readonly pending: number;
}

/** Denný rozpočet zápisov pre merací prúžok. */
export interface StartBudgetView {
  readonly spent: number;
  readonly limit: number;
  /** HOTOVÁ fráza aj s predložkou („o 02:00"); `null` = čas obnovy nepoznáme. */
  readonly resetsAt: string | null;
}

export interface NewDiscountStartProps {
  /** Koľko produktov sa má zapísať. */
  itemsCount: number;
  /** Denný rozpočet zápisov; `null` = nepodarilo sa prečítať. */
  perDay: number | null;
  /** Koľko položiek je vo fronte PRED touto zľavou (rozpočet sa delí). */
  aheadPending: number;
  aheadNames: readonly QueueAheadName[];
  /**
   * Odkiaľ číslo pred nami pochádza a či je presné. Keď chýba, panel počíta
   * s `aheadPending` ako so známym odhadom zo zoznamu zliav.
   */
  ahead?: AheadView;
  /** Odhadovaný deň dobehnutia fronty; `null` = bez rozpočtu sa nedopočíta. */
  finishDay: string | null;
  /** Koľko ĎALŠÍCH dní fronta pobeží; `0` = dobehne ešte dnes, `null` = nevieme. */
  queueDays?: number | null;
  /** Navrhovaný štart (dobehnutie + 2 dni rezerva); `null` = nevieme. */
  proposedStart: string | null;
  /** Aktuálne zvolený štart okna. */
  from: string;
  /** Posunie okno na navrhovaný štart, dĺžku okna zachová. */
  onUseProposal: () => void;
  /** Kedy vyprší kľúč na zápis; `null` = nevieme alebo kľúč chýba. */
  keyExpiresAt: string | null;
  keyPresent: boolean;
  /** Spotreba dnešného rozpočtu; `null` = nepodarilo sa prečítať. */
  budget?: StartBudgetView | null;
}

export function NewDiscountStart({
  itemsCount,
  perDay,
  aheadPending,
  aheadNames,
  ahead,
  finishDay,
  queueDays,
  proposedStart,
  from,
  onUseProposal,
  keyExpiresAt,
  keyPresent,
  budget,
}: NewDiscountStartProps) {
  const keyDay = keyExpiresAt === null ? null : keyExpiresAt.slice(0, 10);
  // K6 — porovnávajú sa DNI, nie okamihy: fronta dobehne v priebehu dňa.
  const keyTooShort =
    finishDay !== null && (!keyPresent || (keyDay !== null && keyDay < finishDay));

  const aheadKnown = ahead === undefined ? true : ahead.known;
  const aheadExact = ahead === undefined ? false : ahead.exact;
  const aheadCount = ahead === undefined ? aheadPending : ahead.pending;
  const verdict = judgeStart(from, finishDay);
  const totalToWrite = aheadCount + itemsCount;
  const proposalOffered = proposedStart !== null && proposedStart !== from;

  return (
    <div className={styles.when} data-testid="new-discount-start">
      <div className={styles.whenRow}>
        <span className={styles.whenLabel}>Zapísané budú</span>
        {finishDay === null ? (
          <span className="lvl-3" data-testid="start-finish">
            —
          </span>
        ) : (
          <b className="est" data-testid="start-finish">
            {formatDateSk(finishDay)}
          </b>
        )}
      </div>

      <div className={styles.whenRow}>
        <span className={styles.whenLabel}>Zľava nabehne</span>
        <b data-testid="start-live-from">{from === '' ? '—' : formatDateSk(from)}</b>
        {proposalOffered ? (
          <button
            type="button"
            className={`btn sm ghost ${styles.whenPush}`}
            onClick={onUseProposal}
            data-testid="start-use-proposal"
          >
            Posunúť na{' '}
            <span data-testid="start-proposal">{formatDateSk(proposedStart ?? '')}</span>
          </button>
        ) : null}
      </div>

      {verdict.code === 'late' || verdict.code === 'tight' ? (
        <div className={styles.startNote}>
          <Note variant="warn" testId="start-window-warning">
            {verdict.what} {verdict.nextStep}
          </Note>
        </div>
      ) : null}

      {keyTooShort ? (
        <div className="row wrapx" data-testid="key-warning">
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
          {budget === undefined || budget === null ? null : (
            <div className={styles.techMeter}>
              <BudgetMeter
                label="Zápisy dnes"
                spent={budget.spent}
                limit={budget.limit}
                resetsAt={budget.resetsAt}
                testId="start-budget-meter"
              />
            </div>
          )}
          <table>
            <tbody>
              <tr>
                <td>Na zápis</td>
                <td data-testid="start-items">
                  {formatCountSk(itemsCount)}{' '}
                  {pluralSk(itemsCount, 'produkt', 'produkty', 'produktov')}
                </td>
              </tr>
              <tr>
                <td>Denný rozpočet</td>
                <td>{perDay === null ? 'nevieme' : `${formatCountSk(perDay)} zápisov na deň`}</td>
              </tr>
              <tr>
                <td>Dnes už minuté</td>
                <td>
                  {budget === undefined || budget === null
                    ? 'nevieme'
                    : `${formatCountSk(budget.spent)} z ${formatCountSk(budget.limit)}`}
                </td>
              </tr>
              <tr>
                <td>Pred touto zľavou</td>
                <td data-testid="start-ahead">
                  {aheadKnown ? `${formatCountSk(aheadCount)} položiek` : 'nevieme'}
                  {aheadKnown ? (
                    <span className="lvl-3">
                      {aheadExact
                        ? ' — presný počet z fronty'
                        : ' — odhad z počítadiel zliav, presný počet sa nedal prečítať'}
                    </span>
                  ) : null}
                  {aheadNames.length === 0 ? null : (
                    <div className="lvl-3">
                      {aheadNames
                        .slice(0, 2)
                        .map((entry) => `${entry.name} ${formatCountSk(entry.pending)}`)
                        .join(' · ')}
                    </div>
                  )}
                </td>
              </tr>
              <tr>
                <td>Spolu</td>
                <td>
                  {aheadKnown
                    ? `${formatCountSk(totalToWrite)} zápisov`
                    : `aspoň ${formatCountSk(itemsCount)}`}
                </td>
              </tr>
              <tr>
                <td>Fronta pobeží</td>
                <td data-testid="start-days">
                  {queueDays === undefined || queueDays === null
                    ? 'nevieme'
                    : queueDays === 0
                      ? 'dobehne ešte dnes'
                      : `${formatCountSk(queueDays)} ${pluralSk(queueDays, 'deň', 'dni', 'dní')}`}
                </td>
              </tr>
              <tr>
                <td>Odhad dobehnutia</td>
                <td>{finishDay === null ? 'nevieme' : formatDateSk(finishDay)}</td>
              </tr>
              <tr>
                <td>Zľava nabehne</td>
                <td>{from === '' ? 'nevieme' : formatDateSk(from)}</td>
              </tr>
              <tr>
                <td>Rezerva pred štartom</td>
                <td>
                  {verdict.reserveDays === null
                    ? 'nevieme'
                    : verdict.reserveDays < 0
                      ? `chýba ${formatCountSk(Math.abs(verdict.reserveDays))} ${pluralSk(Math.abs(verdict.reserveDays), 'deň', 'dni', 'dní')}`
                      : `${formatCountSk(verdict.reserveDays)} ${pluralSk(verdict.reserveDays, 'deň', 'dni', 'dní')}`}
                </td>
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
    </div>
  );
}

export default NewDiscountStart;
