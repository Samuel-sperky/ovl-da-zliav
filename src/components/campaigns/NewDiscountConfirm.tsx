'use client';

/**
 * Aura Zľavy — NOVÁ ZĽAVA, karta ROZHODNUTIA (V11; predloha
 * `design/v3/nova-zlava.html`, kontrakt V3 K4, K8, K10, invariant I3,
 * kontrakt UI, bod 24).
 *
 * Jedna karta, v ktorej sa rozhoduje o zápise do PRODUKČNÉHO eshopu. Nesie
 * dominantu celej obrazovky — **počet produktov, ktoré zlacnejú** — a pod ňou
 * v jednom slede: čím sú, kedy budú zapísané (slot `plan`), čo o marži appka
 * nevie, ručne vpísaný počet a dve tlačidlá. Do 18. 8. 2026 boli čas a
 * potvrdenie dve samostatné sekcie nad sebou; obrazovka sa preto nezmestila do
 * 1,5 obrazovky a dominanta stála až pod dvojicou dátumov, teda pod menej
 * dôležitým číslom.
 *
 * DVE POISTKY, KTORÉ SA NEDAJÚ PREKLIKAŤ
 * --------------------------------------
 *
 *  1. **Skúška naprázdno musí prebehnúť** a musí sedieť na PRÁVE ZOBRAZENÝ
 *     výber. Keď sa čokoľvek zmení (produkty, pásma, okno), potvrdenie sa
 *     zamkne a skúška sa musí zopakovať — jednorazový podpísaný token nesie
 *     presne tú sadu, ktorú používateľ videl (I3, K4).
 *  2. **Počet produktov sa píše ručne.** Klik sa dá urobiť omylom, číslo
 *     8 000 sa omylom nenapíše. Je to povrchová podoba I3 a zámerne to
 *     spomaľuje (odpoveď 38).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Dopad na maržu nikdy nebude číslo.** Shop nákupné ceny nevracia, takže
 *    každý taký odhad by bol vymyslený (K8). Na jeho mieste je veta o tom, čo
 *    chýba — a v tom bloku nesmie byť ani cifra, ani euro. Stráži to test.
 * 2. **Dominanta je počet produktov** (P1). Nič v tejto karte nesmie byť
 *    väčšie než `.big` — ani tlačidlo, ani dátum. Keď sa pridá nové číslo,
 *    patrí do riadku pod dominantu, nie vedľa nej.
 * 3. **Zamknuté tlačidlo hovorí dôvod.** `blockedReason` je jediná veta, ktorá
 *    vysvetlí, prečo sa nedá zaradiť; bez nej je zašedené tlačidlo hádanka.
 * 4. **Pomlčka sa do 64 px nekreslí** (D11, 19. 8. 2026). Pravidlo „keď appka
 *    nevie, je tam pomlčka, nikdy nula" (kontrakt UI, bod 5) platí ďalej, ale
 *    em pomlčka v rezoch dominanty prestáva byť interpunkciou a je z nej plný
 *    čierny obdĺžnik. Neznáme sa preto píše pomlčkou SO SLOVOM a v čitateľnej
 *    veľkosti. Nikdy nedávaj `'—'` do `.big`.
 * 5. **Dominanta zostáva dominantou aj vtedy, keď je hodnota neznáma**
 *    (P1, 19. 8. 2026). Pomlčka so slovom má 26 px, ručne vpísaný počet 28 px
 *    v ráme — v stave `catalogEmpty && itemsCount === 0` bolo teda najťažším
 *    prvkom karty pole, nie dominanta. Nespravilo sa to väčšou pomlčkou (to je
 *    presne defekt D11) ani ľahším poľom (to je presne defekt D12), ale tým, že
 *    krok bez obsahu prestal vyzerať ako krok, ktorý sa dá urobiť: pri
 *    `itemsCount === 0` je z poľa zamknutý riadok s dôvodom. Pri každom
 *    `itemsCount > 0` má pole plnú váhu z D12.
 *
 * PORADIE KROKOV = PORADIE ZÁVAŽNOSTI (D12, 19. 8. 2026)
 * ------------------------------------------------------
 * Do 19. 8. stálo pole na ručný počet nad dvojicou tlačidiel, v ktorej bolo
 * `Zaradiť do fronty` prvé, široké a plné, a `Skúška naprázdno` druhé — teda
 * opačne, než v akom poradí sa tie kroky robia a než akú váhu majú. Odteraz
 * idú pod sebou v poradí vykonávania: **skúška → ručne vpísaný počet →
 * zaradenie**, a ručný počet je v ráme a je najťažší prvok spodku karty.
 * Mení sa vzhľad a poradie potvrdenia, NIE jeho mechanika: `previewFresh`,
 * `typedCountMatches` ani `previewToken` sa tým nedotýkajú (I3).
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

import BlockerList from '@/components/campaigns/BlockerList';
import styles from '@/components/campaigns/zlavy.module.css';
import type { TierPlan } from '@/components/campaigns/discounts-model';
// Preklad blokátora zo skúšky naprázdno žije v `queue-model.ts` — používa ho aj
// panel opakovania a dve kópie toho istého prekladu by sa časom rozišli (K10).
import { previewBlockerText, type BlockerCard } from '@/components/campaigns/queue-model';
import type { CreateResult, PreviewData } from '@/components/campaigns/zlavy-api';
import { FlagMark } from '@/components/ui/StatusMark';
import { formatDateSk, formatDateTimeSk, formatEur } from '@/lib/ui/format';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface NewDiscountConfirmProps {
  itemsCount: number;
  /**
   * Vieme vôbec, koľko produktov to je? `false` = zrkadlo katalógu je prázdne,
   * takže nula by bola tvrdenie o niečom, čo sa nemeralo — dominanta je vtedy
   * pomlčka (kontrakt UI, bod 5). Predvolene `true`.
   */
  countKnown?: boolean;
  tiers: readonly TierPlan[];
  /** Priemer cien, ktoré naozaj prišli; `null` = ani jednu cenu nepoznáme. */
  averagePrice: number | null;
  /**
   * Kedy bude zapísané a kedy zľava nabehne (`NewDiscountStart`). Je to slot,
   * nie vlastná sekcia: oba dátumy patria k rozhodnutiu a samostatná karta ich
   * od neho odtrhla.
   */
  plan?: ReactNode;
  /**
   * Prekážky, ktoré teraz stoja v ceste zápisu (D13). Do 19. 8. mali vlastnú
   * kartu v pravom stĺpci a hovorili to isté, čo stavový pruh nad obrazovkou.
   * Kreslia sa TU, pri rozhodnutí, ktoré blokujú — a nikde inde na obrazovke.
   */
  obstacles?: readonly BlockerCard[];
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
  countKnown = true,
  tiers,
  averagePrice,
  plan,
  obstacles = [],
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
              Hotové <b className="est">{formatDateSk(created.estimate.date)}</b>
            </span>
          )}
          {created.keyExpiresBeforeFinish === true ? (
            <>
              <span className="sep-dot" aria-hidden="true">
                ·
              </span>
              <span className="flag">
                <FlagMark />
                Kľúč na zápis vyprší skôr, než fronta dobehne
              </span>
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
        <h2>Zápis a potvrdenie</h2>
      </div>

      <div className={`${styles.confirm} lvl-1`}>
        {countKnown ? (
          <span className="big" data-testid="confirm-count">
            {formatCountSk(itemsCount)}
          </span>
        ) : (
          /*
           * D11 — tu bola do 19. 8. 2026 em pomlčka v `.big`, teda v 64 px
           * a reze 660. V tej veľkosti pomlčka nie je znak, ale vyplnený
           * obdĺžnik: dominanta karty vyzerala ako chyba vykreslenia a
           * popisok pod ňou nemal nad sebou hodnotu. Pomlčka zostáva —
           * dostala len slovo a veľkosť, v ktorej sa dá prečítať.
           */
          <span className={styles.unknown} data-testid="confirm-count">
            — zatiaľ nevieme
          </span>
        )}
        <span className={styles.cap}>
          {countKnown ? 'produktov dostane zľavu' : 'koľko produktov dostane zľavu'}
        </span>
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

      {plan}

      {/* K8 — dopad na maržu sa NIKDY neukáže ako číslo, ani odhadom. */}
      <div className={styles.margin}>
        <span className="lvl-3">Dopad na maržu</span>
        <span className="lockline">zamknuté</span>
      </div>

      {/*
       * D13 — prekážky stoja tam, kde blokujú: pri rozhodnutí. Vlastnú kartu
       * v pravom stĺpci už nemajú, lebo tá hovorila to isté, čo stavový pruh.
       */}
      {obstacles.length === 0 ? null : (
        <div className={styles.confirmObstacles}>
          <BlockerList cards={obstacles} testId="confirm-obstacles" />
        </div>
      )}

      {/* Krok 1 — skúška naprázdno. Robí sa ako prvá, teda stojí ako prvá. */}
      <div className={styles.stepDry}>
        <button
          type="button"
          className={`btn lg ${styles.wide}`}
          disabled={busy === 'previewing' || busy === 'loading' || itemsCount === 0}
          onClick={onPreview}
          data-testid="dry-run"
        >
          {busy === 'previewing' ? 'Počítam…' : 'Skúška naprázdno'}
        </button>
        <div className="hint" style={{ textAlign: 'center' }}>
          Skúška nič nezapíše — prepočíta výber a ukáže, čo by sa stalo.
        </div>
      </div>

      {/*
       * Krok 2 — ručne vpísaný počet. Povrchová podoba I3 a najťažší prvok
       * spodku karty: pred ním sa nedá prekliknúť ďalej.
       *
       * P1, 19. 8. 2026 — keď vo výbere nie je ani jeden produkt, nie je čo
       * potvrdzovať: skúška naprázdno je z toho istého dôvodu vypnutá a
       * `blockedReason` hlási „Vyberte aspoň jeden produkt". Pole by v tom
       * stave bolo najťažším prvkom karty (28 px v ráme) nad dominantou, ktorá
       * je vtedy pomlčka so slovom v 26 px — dominanta by sa neohla, prevrátila
       * by sa. Krok preto z obrazovky nemizne, len sa kreslí ako zamknutý
       * riadok, ktorý povie dôvod. Mení sa vzhľad, NIE mechanika: `typed`
       * ostáva prázdny a `typedCountMatches` ani `previewToken` sa toho
       * netýkajú (I3).
       */}
      {itemsCount === 0 ? (
        <div className={`${styles.gate} ${styles.gateLocked}`} data-testid="confirm-count-locked">
          <span className={styles.gateLabel}>Napíšte počet produktov</span>
          <span className="lockline">odomkne sa, keď bude vo výbere aspoň jeden produkt</span>
        </div>
      ) : (
        <div className={styles.gate}>
          <label className={styles.gateLabel} htmlFor="confirm-count-input">
            Napíšte počet produktov
          </label>
          <input
            id="confirm-count-input"
            className={`inp ${styles.gateInput}`}
            inputMode="numeric"
            autoComplete="off"
            placeholder={countKnown ? String(itemsCount) : ''}
            value={typed}
            onChange={(event) => onTyped(event.target.value)}
            data-testid="confirm-count-input"
          />
        </div>
      )}

      {/* Krok 3 — zápis do ostrého eshopu. */}
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
              <span className="flag">
                <FlagMark />
                {previewBlockerText(blocker.code, blocker.message)}
              </span>
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
