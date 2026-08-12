'use client';

/**
 * Aura Zľavy — NOVÁ ZĽAVA, panel ŠTART (V11; predloha `design/v3/nova-zlava.html`,
 * kontrakt V3 K2, K5, K6; kontrakt dokončenia B3, B5).
 *
 * Odpovedá na jedinú otázku: **kedy to bude zapísané a kedy má zľava nabehnúť.**
 * Zápis nie je akcia, je to fronta bežiaca dni — 150 produktov pri 200 zápisoch
 * na deň je jeden deň, 8 000 je štyridsať. Preto sa zľava zadáva s budúcim
 * štartom a appka ho navrhne tak, aby fronta stihla dobehnúť + 2 dni rezerva (K5).
 *
 * ŠTYRI ČÍSLA, KTORÉ SEM PATRIA (a bez ktorých je panel len ozdoba)
 * ----------------------------------------------------------------
 *  1. koľko produktov ide na zápis,
 *  2. koľko sa ich zmestí za jeden deň a koľko rozpočtu z dneška ostáva,
 *  3. koľko DNÍ bude fronta bežať a v ktorý deň dobehne,
 *  4. v ktorý deň zľava reálne nabehne zákazníkom — a či to je PO dobehnutí.
 *
 * Štvrtý bod je ten, ktorý sa najľahšie prehliadne a najviac bolí: keď zľava
 * nabehne skôr, než sa všetko zapíše, produkty zlacnejú po častiach a na eshope
 * to vyzerá ako chyba. `judgeStart()` to preto povie vetou PRED potvrdením.
 *
 * Dve veci, ktoré tento panel robí inak, než by bolo pohodlné:
 *
 *  · **Bez rozpočtu žiadny odhad.** Keď sa denný rozpočet ani počet položiek
 *    pred nami nedá prečítať, panel povie „nevieme" a nedopočíta dátum (P7).
 *    Vymyslený dátum štartu je horší než priznaná medzera — plánuje sa podľa
 *    neho produkcia.
 *  · **Varovanie o kľúči nebráni zaradeniu** (K6). Keď kľúč vyprší skôr, než
 *    fronta dobehne, je to príznak a ponuka obnovy — nie brzda. Fronta po
 *    vložení nového kľúča pokračuje presne tam, kde skončila.
 *
 * ČO SA TU NESMIE POKAZIŤ: `aheadPending` je počet položiek vo fronte PRED touto
 * zľavou a smie prísť z dvoch zdrojov (presne z fronty, alebo odhadom z počítadiel
 * zliav). Panel MUSÍ povedať, ktorý to je — inak sa dve obrazovky rozídu o stovky
 * položiek a nikto nebude vedieť, ktorej veriť. Rozhoduje o tom `resolveAhead()`
 * v `queue-model.ts`, nie tento súbor.
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

      {budget === undefined || budget === null ? null : (
        <div className={styles.startMeter}>
          <BudgetMeter
            label="Zápisy dnes"
            spent={budget.spent}
            limit={budget.limit}
            resetsAt={budget.resetsAt}
            testId="start-budget-meter"
          />
        </div>
      )}

      <dl className={styles.plan}>
        <dt>Na zápis</dt>
        <dd data-testid="start-items">
          {formatCountSk(itemsCount)} {pluralSk(itemsCount, 'produkt', 'produkty', 'produktov')}
        </dd>

        <dt>Denne stihnem</dt>
        <dd>{perDay === null ? 'nevieme' : `${formatCountSk(perDay)} zápisov`}</dd>

        <dt>Pred tebou vo fronte</dt>
        <dd data-testid="start-ahead">
          {aheadKnown ? formatCountSk(aheadCount) : <span className="lvl-3">nevieme</span>}
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

        <dt>Fronta pobeží</dt>
        <dd data-testid="start-days">
          {queueDays === undefined || queueDays === null ? (
            <span className="lvl-3">nevieme</span>
          ) : queueDays === 0 ? (
            'dobehne ešte dnes'
          ) : (
            `${formatCountSk(queueDays)} ${pluralSk(queueDays, 'deň', 'dni', 'dní')}`
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

        <dt>Zľava nabehne</dt>
        <dd data-testid="start-live-from">
          {from === '' ? <span className="lvl-3">doplňte okno</span> : formatDateSk(from)}
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

      {verdict.code === 'late' || verdict.code === 'tight' ? (
        <div className={styles.startNote}>
          <Note variant="warn" testId="start-window-warning">
            {verdict.what} {verdict.nextStep}
          </Note>
        </div>
      ) : null}

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
                <td>Dnes už minuté</td>
                <td>
                  {budget === undefined || budget === null
                    ? 'neznáme'
                    : `${formatCountSk(budget.spent)} z ${formatCountSk(budget.limit)}`}
                </td>
              </tr>
              <tr>
                <td>Pred touto zľavou</td>
                <td>
                  {aheadKnown ? `${formatCountSk(aheadCount)} položiek` : 'neznáme'}
                  {aheadKnown ? (
                    <span className="lvl-3">
                      {aheadExact
                        ? ' — presný počet z fronty'
                        : ' — odhad z počítadiel zliav, presný počet sa nedal prečítať'}
                    </span>
                  ) : null}
                </td>
              </tr>
              <tr>
                <td>Spolu</td>
                <td>
                  {aheadKnown ? `${formatCountSk(totalToWrite)} zápisov` : 'aspoň ' + formatCountSk(itemsCount)}
                </td>
              </tr>
              <tr>
                <td>Odhad dobehnutia</td>
                <td>{finishDay === null ? 'nevieme' : formatDateSk(finishDay)}</td>
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
    </section>
  );
}

export default NewDiscountStart;
