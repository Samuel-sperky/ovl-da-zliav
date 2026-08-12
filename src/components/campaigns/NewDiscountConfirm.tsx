'use client';

/**
 * Aura Zľavy — NOVÁ ZĽAVA, panel POTVRDENIE (V11; predloha
 * `design/v3/nova-zlava.html`, kontrakt V3 K4, K8, K10, invariant I3).
 *
 * Toto je miesto, kde sa rozhoduje o zápise do PRODUKČNÉHO eshopu, takže je
 * postavené na dvoch poistkách, ktoré sa nedajú preklikať:
 *
 *  1. **Skúška naprázdno musí prebehnúť** a musí sedieť na PRÁVE ZOBRAZENÝ
 *     výber. Keď sa čokoľvek zmení (produkty, pásma, okno), potvrdenie sa
 *     zamkne a skúška sa musí zopakovať — jednorazový podpísaný token nesie
 *     presne tú sadu, ktorú používateľ videl (I3, K4).
 *  2. **Počet produktov sa píše ručne.** Klik sa dá urobiť omylom, číslo
 *     8 000 sa omylom nenapíše. Je to povrchová podoba I3 a zámerne to
 *     spomaľuje (odpoveď 38).
 *
 * A jedna vec, ktorá tu NIKDY nebude: **dopad na maržu ako číslo.** Shop
 * nákupné ceny nevracia, takže každý taký odhad by bol vymyslený (K8).
 * Namiesto neho je veta o tom, čo chýba.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';

import styles from '@/components/campaigns/zlavy.module.css';
import type { TierPlan } from '@/components/campaigns/discounts-model';
// Preklad blokátora zo skúšky naprázdno žije v `queue-model.ts` — používa ho aj
// panel opakovania a dve kópie toho istého prekladu by sa časom rozišli (K10).
import { previewBlockerText } from '@/components/campaigns/queue-model';
import type { CreateResult, PreviewData } from '@/components/campaigns/zlavy-api';
import { formatDateTimeSk, formatEur } from '@/lib/ui/format';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface NewDiscountConfirmProps {
  itemsCount: number;
  tiers: readonly TierPlan[];
  /** Priemer cien, ktoré naozaj prišli; `null` = ani jednu cenu nepoznáme. */
  averagePrice: number | null;
  typed: string;
  onTyped: (value: string) => void;
  /** Skúška naprázdno sedí na aktuálny výber a nemá blokátory. */
  previewFresh: boolean;
  preview: PreviewData | null;
  previewAt: string | null;
  busy: 'idle' | 'loading' | 'previewing' | 'creating';
  /** Prečo je zaradenie zamknuté; `null` = dá sa zaradiť. */
  blockedReason: string | null;
  error: string | null;
  created: CreateResult | null;
  onPreview: () => void;
  onQueue: () => void;
}

export function NewDiscountConfirm({
  itemsCount,
  tiers,
  averagePrice,
  typed,
  onTyped,
  previewFresh,
  preview,
  previewAt,
  busy,
  blockedReason,
  error,
  created,
  onPreview,
  onQueue,
}: NewDiscountConfirmProps) {
  const blockers = preview === null ? [] : preview.blockers;

  /* ── hotovo: zľava je vo fronte ── */
  if (created !== null) {
    return (
      <section className="sec" data-testid="new-discount-created">
        <div className="sec-h">
          <h2>Zaradené do fronty</h2>
        </div>
        <div className="lvl-1">
          <span className="big">{formatCountSk(created.itemsTotal)}</span>
          <span className="sub">
            {pluralSk(created.itemsTotal, 'produkt čaká', 'produkty čakajú', 'produktov čaká')} na
            zápis
          </span>
        </div>
        <div className="prog-meta">
          {created.estimate === null ? (
            <span className="lvl-3">Odhad dobehnutia zatiaľ nevieme</span>
          ) : (
            <span>
              Hotové <b className="est">{created.estimate.date}</b>
            </span>
          )}
          {created.keyExpiresBeforeFinish === true ? (
            <>
              <span className="sep-dot" aria-hidden="true">
                ·
              </span>
              <span className="flag">Kľúč na zápis vyprší skôr, než fronta dobehne</span>
            </>
          ) : null}
        </div>
        <div className="row gap-t">
          <Link className="btn primary" href={`/zlavy/${created.campaignId}`}>
            Otvoriť zľavu
          </Link>
          <Link className="btn" href="/zlavy">
            Zoznam zliav
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="sec" data-testid="new-discount-confirm">
      <div className="sec-h">
        <h2>Potvrdenie</h2>
      </div>

      <div className={`${styles.confirm} lvl-1`}>
        <span className="big" data-testid="confirm-count">
          {formatCountSk(itemsCount)}
        </span>
        <span className={styles.cap}>produktov dostane zľavu</span>
      </div>

      <div className={`prog-meta ${styles.center}`}>
        {tiers.map((tier) => (
          <span key={tier.ord}>
            {tier.letter} <b>{formatCountSk(tier.productIds.length)}</b> · {tier.percent} %
          </span>
        ))}
        {averagePrice === null ? (
          <span className="lvl-3">priemernú cenu nevieme</span>
        ) : (
          <span>
            Priemerná cena <b>{formatEur(averagePrice)}</b>
          </span>
        )}
      </div>

      {/* K8 — dopad na maržu sa NIKDY neukáže ako číslo, ani odhadom. */}
      <div className={styles.margin}>
        <span className="lvl-3">Dopad na maržu</span>
        <span className="lockline">odomkne sa po doplnení nákupných cien</span>
      </div>

      <div className={styles.typein}>
        <label className="lvl-3" htmlFor="confirm-count-input">
          Napíšte počet produktov
        </label>
        <input
          id="confirm-count-input"
          className="inp big"
          inputMode="numeric"
          autoComplete="off"
          placeholder={String(itemsCount)}
          value={typed}
          onChange={(event) => onTyped(event.target.value)}
          data-testid="confirm-count-input"
        />
      </div>

      <div className={styles.acts}>
        <button
          type="button"
          className={blockedReason === null ? 'btn primary lg' : 'btn primary lg off'}
          disabled={blockedReason !== null || busy === 'creating'}
          onClick={onQueue}
          data-testid="queue-discount"
        >
          {busy === 'creating' ? 'Zaraďujem…' : 'Zaradiť do fronty'}
        </button>
        <button
          type="button"
          className="btn lg"
          disabled={busy === 'previewing' || busy === 'loading' || itemsCount === 0}
          onClick={onPreview}
          data-testid="dry-run"
        >
          {busy === 'previewing' ? 'Počítam…' : 'Skúška naprázdno'}
        </button>
      </div>

      <div className="hint" style={{ textAlign: 'center' }}>
        Skúška nič nezapíše — prepočíta výber a ukáže, čo by sa stalo.
      </div>

      {blockedReason === null ? null : (
        <div className={styles.noteQuiet} data-testid="queue-blocked-reason">
          {blockedReason}
        </div>
      )}

      {error === null ? null : (
        <div className={styles.note} role="alert" data-testid="confirm-error">
          {error}
        </div>
      )}

      {blockers.length === 0 ? null : (
        <div className="gap-t" data-testid="preview-blockers">
          {blockers.map((blocker, index) => (
            <div key={`${blocker.code}-${index}`} className="row wrapx">
              <span className="flag">{previewBlockerText(blocker.code, blocker.message)}</span>
            </div>
          ))}
          <details className="tech">
            <summary>Technický detail</summary>
            <div className="body mono">
              {blockers.map((blocker, index) => (
                <div key={`raw-${blocker.code}-${index}`}>
                  {blocker.code}
                  {blocker.productId === undefined ? '' : ` · ${blocker.productId}`}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {preview === null ? null : (
        <details className="tech" data-testid="dry-run-result">
          <summary>
            Výsledok poslednej skúšky
            {previewAt === null ? '' : ` · ${formatDateTimeSk(previewAt)}`}
          </summary>
          <div className="body">
            <table>
              <tbody>
                <tr>
                  <td>Prepočítané u nás</td>
                  <td>
                    <b>
                      {formatCountSk(preview.itemsTotal)}{' '}
                      {pluralSk(preview.itemsTotal, 'produkt', 'produkty', 'produktov')}
                    </b>
                  </td>
                </tr>
                <tr>
                  <td>Zapísané pri skúške</td>
                  <td>
                    <b>nič — skúška do shopu nezapisuje</b>
                  </td>
                </tr>
                <tr>
                  <td>Ceny</td>
                  <td>
                    <b>
                      {preview.priceSource === 'shop'
                        ? 'čerstvé zo shopu'
                        : preview.priceSource === 'catalog'
                          ? 'z posledného načítania katalógu'
                          : 'nepodarilo sa načítať'}
                    </b>
                  </td>
                </tr>
                <tr>
                  <td>Platí pre výber</td>
                  <td>
                    <b>{previewFresh ? 'áno' : 'nie — výber sa medzitým zmenil'}</b>
                  </td>
                </tr>
                <tr>
                  <td>Produkty s variantmi</td>
                  <td>
                    <b>
                      {formatCountSk(preview.warnings.hasAttributes.length)} — ceny variantov
                      appka negarantuje
                    </b>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

export default NewDiscountConfirm;
