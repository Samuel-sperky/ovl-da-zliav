'use client';

/**
 * Aura Zľavy — bočný panel s detailom produktu
 * (KONTRAKT-PRODUKTY-2026-08-13 časť A2; `design/v3/produkt-detail.html`).
 *
 * Panel sprava, nie nová stránka (odpoveď 91): používateľ neopúšťa filter ani
 * miesto v tabuľke. Dominantou panela je jedno číslo — koľko kusov sa za
 * zvolené okno predalo; presne kvôli nemu sa produkt otvára.
 *
 * ČO PANEL VYPÍŠE A PREČO PRÁVE TAKTO
 * ───────────────────────────────────
 * Zadanie znie „všetky údaje vypísané". Panel preto vypisuje všetko, čo appka
 * o produkte vie, a údaje sú zoskupené podľa toho, ODKIAĽ sú — nie podľa toho,
 * ako pekne to vyzerá. Bez toho by vedľa seba stáli údaj z posledného prechodu
 * synchronizácie a údaj vypýtaný z eshopu pred sekundou a vyzerali by rovnako.
 *
 *  · **Údaje o produkte** — zrkadlo katalógu alebo dohľadanie v eshope.
 *    Skupina má na konci ČAS, kedy bol načítaný práve TENTO riadok
 *    (`fetchedAt`). Nie je to obrazovkové „Dáta k …" (to je práve raz nad
 *    tabuľkou, architektúra §0) — je to čerstvosť jedného riadku, a bez nej sa
 *    nedá povedať, či cena ešte platí. Preto sa aj volá inak.
 *  · **Predané kusy** — vlastný výpočet z objednávok. Okno je voliteľné priamo
 *    tu: tá istá položka vyzerá inak za 30 a inak za 360 dní a kvôli tomuto
 *    rozdielu sa panel otvára.
 *  · **Zľavy podľa vlastných zápisov** — výhradne to, čo appka sama zapísala.
 *  · **Zatiaľ nedostupné** — kód, sklad, nákupná cena, marža, kategórie a
 *    SKUTOČNÁ zľava v eshope. Prázdna hodnota a zámok, NIE vynechaný riadok:
 *    keby riadok chýbal, nedalo by sa zistiť, že tá informácia vôbec existuje.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 * 1. **„Zľava teraz" nie je stav eshopu.** Appka nevie, aká zľava na produkte
 *    naozaj beží — vie len, čo sama zapísala. Výhrada preto nie je poznámka
 *    pod čiarou: nesie ju nadpis skupiny aj značka v hlavičke panela, a keď sa
 *    raz doplní skutočný stav z eshopu, pribudne ako ĎALŠÍ riadok, nikdy nie
 *    prepísaním tohto.
 * 2. **Skupina „Prekážky" mieša dva zdroje a nesmie ich zliať.** `blockers`
 *    prichádzajú zo stavu appky a hovoria o OPERÁCII (vypnuté zápisy, chýbajúci
 *    kľúč, strop rozsahu); `productReasons()` hovoria o KUSE (eshop ho nenašiel,
 *    už je v zľave). Informatívne prekážky sa sem nedávajú — veta o pilotnom
 *    strope je pri jednom kuse šum a patrí nad tabuľku, k výberu.
 * 3. **Zamknuté sa NEVYSVETĽUJE tu.** Vysvetlenie má jedno miesto (Nastavenia →
 *    Zamknuté funkcie) a odtiaľto naň vedie odkaz. Druhé vysvetlenie tej istej
 *    veci by si po prvej zmene s prvým protirečilo.
 * 4. **Čo appka nevie, je pomlčka — nikdy nula.** Nula je tvrdenie o predaji,
 *    ktoré sa pri nenačítanom riadku nedá urobiť.
 * 5. **Časy sú konkrétne.** `12.05.2026 09:14`, nikdy „pred 3 minútami".
 * 6. **Pomlčka sa nekreslí do displejového rezu** (D11, 19. 8. 2026 — tu
 *    doriešené 19. 8. 2026). Bod 4 platí ďalej, ale em pomlčka je celoštvorcová
 *    vodorovná čiara: v 44 px a reze 660 (`.lvl-1 .big.sm`) prestáva byť
 *    interpunkciou a vykreslí sa ako vyplnený čierny obdĺžnik — dominanta
 *    panela potom vyzerá ako chyba vykreslenia. Neznáme sa preto píše pomlčkou
 *    SO SLOVOM a v čitateľnej veľkosti, presne v tom istom tvare, aký dostala
 *    karta potvrdenia novej zľavy (`.unknown`, 26 px, `--dim`). Nikdy nedávaj
 *    `'—'` do `.big` ani do `.big.sm`.
 *
 * Vlastník: V10 (rozšírenie na „všetky údaje": P2 kontraktu produktov).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/*
 * `.unknown` je TVAR „dominanta, ktorú appka nevie" (D11) a musí byť na oboch
 * miestach jeden a ten istý — dva tvary tej istej veci by sa po prvej úprave
 * rozišli. Býva v module zliav, lebo tam vznikol; jeho správne miesto je
 * `ui/primitives.module.css` a presun patrí integrátorovi (globals/primitives
 * nie sú v rozsahu tejto vlny).
 */
import styles from '@/components/campaigns/zlavy.module.css';
import BlockerNotes from '@/components/products/BlockerNotes';
import type { CatalogRowView, ProductWriteView } from '@/components/products/catalog-api';
import { catalogRow, isAborted, productWrites } from '@/components/products/catalog-api';
import type { SoldWindow } from '@/components/products/catalog-filter';
import { newDiscountHref, SOLD_WINDOWS } from '@/components/products/catalog-filter';
import { productReasons } from '@/components/products/catalog-status';
import Icon from '@/components/ui/Icon';
import type { Blocker } from '@/lib/status/blockers';
import { formatDateSk, formatDateTimeSk, formatEur, formatPercentSk } from '@/lib/ui/format';
import { formatCountSk, itemSentence, SURFACE_TERMS } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Pomôcky ═══════════════════════════════════ */

const SHOP_STATUS_TEXT: Readonly<Record<CatalogRowView['shopStatus'], string>> = {
  ok: 'eshop ho pozná',
  not_found: 'eshop ho nenašiel',
  unknown: 'stav nevieme',
};

/** Odkiaľ je riadok (I11). Dva rôzne stupne istoty, dve rôzne vety. */
const ORIGIN_TEXT: Readonly<Record<CatalogRowView['origin'], string>> = {
  mirror: 'z načítaného katalógu',
  shop: 'dohľadané v eshope',
};

/** Pomlčka namiesto čísla — appka o tomto riadku nič netvrdí. */
const DASH = '—';

/** Cena po zľave — obyčajná aritmetika nad známou cenou, nie odhad. */
function priceAfter(price: string | null, percent: number): string {
  if (price === null) return DASH;
  const value = Number(price);
  if (!Number.isFinite(value)) return DASH;
  return formatEur(value * (1 - percent / 100));
}

/** Okno zľavy ako jeden údaj: `12.05.2026 – 26.05.2026`. */
function windowText(write: ProductWriteView): string {
  return `${formatDateSk(write.dateFrom)} – ${formatDateSk(write.dateTo)}`;
}

/**
 * Zápis, ktorý podľa NÁŠHO záznamu práve platí.
 *
 * `today` prichádza z odpovede servera, nie z hodín prehliadača — inak by sa
 * o polnoci líšilo, čo vidí panel, od toho, čo si myslí fronta.
 */
export function runningWrite(
  writes: readonly ProductWriteView[],
  today: string | null,
): ProductWriteView | null {
  if (today === null) return null;
  const running = writes.filter(
    (write) => write.status === 'ok' && write.dateFrom <= today && today <= write.dateTo,
  );
  if (running.length === 0) return null;
  // Pri prekryve vyhráva ten, čo začal neskôr — to je zápis, ktorý prepísal ten
  // predošlý.
  return running.reduce((best, write) => (write.dateFrom > best.dateFrom ? write : best));
}

/**
 * Posledný ÚSPEŠNÝ zápis — „kedy naposledy zlacnené". Radí sa podľa času
 * zápisu; keď ho zápis nemá, podľa začiatku okna. Nepodarené a nepotvrdené
 * zápisy sa sem nepočítajú: o tých práve nevieme, že zlacnili.
 */
export function lastWrittenDiscount(
  writes: readonly ProductWriteView[],
): ProductWriteView | null {
  const done = writes.filter((write) => write.status === 'ok');
  if (done.length === 0) return null;
  const rank = (write: ProductWriteView): string => write.at ?? write.dateFrom;
  return done.reduce((best, write) => (rank(write) > rank(best) ? write : best));
}

/** Okno predajnosti z tabuľky; nezmysel spadne na najkratšie, nie na najdlhšie. */
function asSoldWindow(days: number): SoldWindow {
  return (SOLD_WINDOWS as readonly number[]).includes(days) ? (days as SoldWindow) : 30;
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '12px 0 4px' }}>
      <h3
        style={{
          fontSize: '10px',
          letterSpacing: '0.13em',
          textTransform: 'uppercase',
          color: 'var(--dim)',
          fontWeight: 650,
          marginBottom: '8px',
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * DOMINANTA PANELA — jedno číslo, alebo priznanie, že ho appka nemá.
 *
 * Vlastný komponent, nie kus JSX vnútri panela, a je to zámerné (19. 8. 2026):
 * `sold === null` je stav, do ktorého sa panel dostane až efektom (prepnutie
 * okna predajnosti, riadok, ktorý sa pre nové okno nevrátil). Vykreslený panel
 * sa v testoch renderuje `renderToStaticMarkup`, kde efekty nebežia — takže
 * práve tá vetva, v ktorej pomlčka stála v 44 px reze, sa cez panel odmerať
 * NEDÁ. Nad týmto komponentom sa dajú odmerať obe vetvy naraz.
 */
export function SoldDominant({ sold, windowDays }: { sold: number | null; windowDays: number }) {
  return (
    <div className="lvl-1">
      {sold === null ? (
        /*
         * D11 — tu bola do 19. 8. 2026 em pomlčka v `.big.sm`, teda v 44 px
         * a reze 660. V tej veľkosti pomlčka nie je znak, ale vyplnený
         * obdĺžnik: dominanta panela vyzerala ako chyba vykreslenia a popisok
         * pod ňou nemal nad sebou hodnotu. Pomlčka zostáva — dostala len slovo
         * a veľkosť, v ktorej sa dá prečítať. Je to TEN ISTÝ tvar, aký dostala
         * karta potvrdenia novej zľavy, nie druhý podobný.
         */
        <span className={styles.unknown} data-testid="detail-units-sold">
          {DASH} zatiaľ nevieme
        </span>
      ) : (
        <span className="big sm num" data-testid="detail-units-sold">
          {formatCountSk(sold)}
        </span>
      )}
      <span className="sub">
        {sold === null
          ? `koľko sa predalo za posledných ${windowDays} dní`
          : `predaných za posledných ${windowDays} dní`}
      </span>
    </div>
  );
}

/** Zamknutý riadok: názov, prázdna hodnota, zámok. Nikdy vynechaný riadok. */
function LockedRow({ label }: { label: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="lockcell" title={SURFACE_TERMS.lockedFeature}>
        {DASH}
      </dd>
    </>
  );
}

function WriteRow({ write }: { write: ProductWriteView }) {
  const sentence = itemSentence(write.status);
  return (
    <div
      className="row"
      style={{
        alignItems: 'baseline',
        gap: '10px',
        fontSize: '13px',
        padding: '5px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <b style={{ fontWeight: 640, color: 'var(--ink)', minWidth: '44px' }}>
        {formatPercentSk(write.percent)}
      </b>
      <span style={{ color: 'var(--ink2)' }}>{windowText(write)}</span>
      <span className="lvl-3" style={{ marginLeft: 'auto' }}>
        {sentence.label}
      </span>
    </div>
  );
}

/* ═══════════════════════════ 2. Panel ═════════════════════════════════════ */

export interface ProductDetailPanelProps {
  row: CatalogRowView;
  /** Okno, v ktorom je `row.unitsSold` — to isté, aké má tabuľka. */
  soldWindowDays: number;
  /**
   * Prekážky, ktoré by zápis na TENTO produkt zastavili
   * (`collectProductBlockers`). Informatívne riadky sem neposielajte —
   * odfiltruje ich panel sám, ale zbytočne.
   */
  blockers?: readonly Blocker[];
  onClose: () => void;
}

interface DetailState {
  writes: readonly ProductWriteView[] | null;
  /** Dnešok podľa servera — rozhoduje, ktorý zápis práve platí. */
  today: string | null;
  failed: boolean;
}

const EMPTY: DetailState = { writes: null, today: null, failed: false };

export function ProductDetailPanel({
  row,
  soldWindowDays,
  blockers,
  onClose,
}: ProductDetailPanelProps) {
  const [state, setState] = useState<DetailState>(EMPTY);
  /** Okno predajnosti PANELA. Začína na okne tabuľky, ďalej si ho volí človek. */
  const [windowDays, setWindowDays] = useState<SoldWindow>(asSoldWindow(soldWindowDays));
  /** Predané kusy za `windowDays`. `null` = nevieme, teda pomlčka (nie nula). */
  const [sold, setSold] = useState<number | null>(row.unitsSold);

  /* Vlastné zápisy appky — jediný zdroj všetkého, čo panel povie o zľavách. */
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setState(EMPTY);

    void (async () => {
      const history = await productWrites(row.productId, controller.signal);
      if (!live) return;
      if (history.ok) {
        setState({ writes: history.data.writes, today: history.data.today, failed: false });
      } else if (!isAborted(history.error)) {
        setState({ writes: null, today: null, failed: true });
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [row.productId]);

  /* Zmena riadku alebo okna tabuľky vráti panel na to isté okno ako tabuľka. */
  useEffect(() => {
    setWindowDays(asSoldWindow(soldWindowDays));
  }, [row.productId, soldWindowDays]);

  /* Predané kusy za okno panela. Okno tabuľky už máme v riadku — nedopytujeme
     sa naň druhýkrát. */
  useEffect(() => {
    if (windowDays === soldWindowDays) {
      setSold(row.unitsSold);
      return;
    }
    const controller = new AbortController();
    let live = true;
    setSold(null);

    void (async () => {
      const res = await catalogRow(row.productId, windowDays, controller.signal);
      if (!live || !res.ok) return;
      const found = res.data.data[0];
      // Riadok, ktorý sa nevrátil, NIE JE nula predaných — je to neznáme.
      setSold(found === undefined ? null : found.unitsSold);
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [row.productId, row.unitsSold, soldWindowDays, windowDays]);

  const writes = state.writes ?? [];
  const planned = writes.find((write) => write.status === 'pending');
  const running = runningWrite(writes, state.today);
  const last = lastWrittenDiscount(writes);

  // Informatívne prekážky sú o výbere, nie o kuse — pozri hlavičku modulu.
  const stopping = (blockers ?? []).filter((blocker) => blocker.severity !== 'informuje');
  const reasons = productReasons(row);
  const nothingInTheWay = stopping.length === 0 && reasons.length === 0;

  /**
   * „Zľava teraz" podľa VLASTNÝCH zápisov. Keď appka o zľave vie, ale zápis
   * k nej ešte nemá načítaný, je to pomlčka — percento by bolo vymyslené.
   */
  const discountNow = ((): string => {
    if (running !== null) return formatPercentSk(running.percent);
    if (!row.discountedNow) return 'bez zľavy';
    return state.writes === null ? DASH : 'v zľave';
  })();

  return (
    <aside className="drawer" data-testid="product-detail" aria-label="Detail produktu">
      <div className="drawer-h">
        <div>
          <div className="t">{row.name ?? 'bez názvu'}</div>
          <div className="lvl-3" style={{ marginTop: '3px' }}>
            {formatEur(row.price)}
          </div>
          {row.discountedNow ? (
            <div className="flag neutral" style={{ marginTop: '4px' }} data-testid="detail-own-write">
              v zľave podľa vlastného zápisu
            </div>
          ) : null}
          {row.shopStatus === 'not_found' ? (
            <div className="flag" style={{ marginTop: '4px' }}>
              {SHOP_STATUS_TEXT.not_found}
            </div>
          ) : null}
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="Zavrieť detail">
          {/* Meno nesie `aria-label` tlačidla; ikona je `aria-hidden`. */}
          <Icon name="x" />
        </button>
      </div>

      <SoldDominant sold={sold} windowDays={windowDays} />
      <div className="seg" aria-label="Za koľko dní sa počítajú predané kusy">
        {SOLD_WINDOWS.map((days: SoldWindow) => (
          <button
            key={days}
            type="button"
            className={days === windowDays ? 'on' : undefined}
            aria-pressed={days === windowDays}
            onClick={() => setWindowDays(days)}
            data-testid={`detail-window-${days}`}
          >
            {days}
          </button>
        ))}
      </div>
      <div className="lvl-3" style={{ marginTop: '4px' }}>
        Vlastný výpočet z objednávok.
      </div>

      <DetailGroup title="Prekážky">
        {nothingInTheWay ? (
          <div className="lvl-3" data-testid="product-no-blockers">
            Appka pri tomto produkte nevidí nič, čo by zápisu zľavy bránilo.
          </div>
        ) : (
          <>
            {reasons.map((reason) => (
              <div
                key={reason.id}
                style={{ padding: '4px 0' }}
                data-testid={`product-reason-${reason.id}`}
              >
                <div className={reason.tone === 'attention' ? 'flag' : 'flag neutral'}>
                  {reason.short}
                </div>
                <div className="lvl-2" style={{ marginTop: '3px' }}>
                  {reason.what}
                </div>
                <div className="lvl-3">{reason.nextStep}</div>
              </div>
            ))}
            <BlockerNotes blockers={stopping} here="/produkty" testId="product-blockers" />
          </>
        )}
      </DetailGroup>

      <DetailGroup title="Údaje o produkte">
        <dl className="dl" data-testid="detail-facts">
          <dt>Názov</dt>
          <dd>{row.name ?? DASH}</dd>
          <dt>Cena</dt>
          <dd>{formatEur(row.price)}</dd>
          <dt>Varianty</dt>
          <dd>{row.hasAttributes ? 'má varianty' : 'bez variantov'}</dd>
          <dt>Stav v eshope</dt>
          <dd>{SHOP_STATUS_TEXT[row.shopStatus]}</dd>
          <dt>Odkiaľ je tento riadok</dt>
          <dd>{ORIGIN_TEXT[row.origin]}</dd>
        </dl>
        <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="detail-row-fetched-at">
          Načítané {formatDateTimeSk(row.fetchedAt)}.
        </div>
      </DetailGroup>

      <DetailGroup title="Zľavy podľa vlastných zápisov">
        <dl className="dl" data-testid="detail-discounts">
          <dt>Zľava teraz</dt>
          <dd data-testid="detail-discount-now">{discountNow}</dd>
          <dt>Okno tejto zľavy</dt>
          <dd>{running === null ? DASH : windowText(running)}</dd>
          <dt>Naposledy zlacnené</dt>
          <dd>{last === null ? DASH : formatDateSk(last.at ?? last.dateFrom)}</dd>
          <dt>Vtedy o</dt>
          <dd>{last === null ? DASH : `${formatPercentSk(last.percent)} · ${windowText(last)}`}</dd>
          <dt>V pripravovanej zľave</dt>
          <dd>{planned === undefined ? DASH : planned.campaignName}</dd>
          <dt>Cena po nej</dt>
          <dd>{planned === undefined ? DASH : priceAfter(row.price, planned.percent)}</dd>
        </dl>

        {state.failed ? (
          <div className="lvl-3" style={{ marginTop: '8px' }}>
            Zápisy sa nepodarilo načítať.
          </div>
        ) : state.writes === null ? (
          <div className="lvl-3" style={{ marginTop: '8px' }}>
            Načítavam…
          </div>
        ) : writes.length === 0 ? (
          <div className="lvl-3" style={{ marginTop: '8px' }}>
            Tento produkt sme ešte nezlacňovali.
          </div>
        ) : (
          <div style={{ marginTop: '8px' }}>
            {writes.map((write) => (
              <WriteRow key={write.itemId} write={write} />
            ))}
          </div>
        )}

        <div className="lvl-3" style={{ marginTop: '8px' }}>
          Appka vidí len to, čo sama zapísala — nie stav eshopu.
        </div>
      </DetailGroup>

      <DetailGroup title="Zatiaľ nedostupné">
        <dl className="dl" data-testid="detail-locked">
          <LockedRow label="Kód produktu" />
          <LockedRow label="Sklad" />
          <LockedRow label="Nákupná cena" />
          <LockedRow label="Marža" />
          <LockedRow label="Kategórie" />
          <LockedRow label="Skutočná zľava v eshope" />
        </dl>
        <div className="lvl-3" style={{ marginTop: '6px' }}>
          {SURFACE_TERMS.lockedFeature} · <Link href="/nastavenia#zamknute">viac</Link>
        </div>
      </DetailGroup>

      <details className="tech">
        <summary>{SURFACE_TERMS.technicalDetail}</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Číslo produktu</td>
                <td>
                  <b>{row.productId}</b>
                </td>
              </tr>
              <tr>
                <td>Posledné načítanie</td>
                <td>
                  <b>{formatDateTimeSk(row.fetchedAt)}</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <div className="row" style={{ marginTop: '14px' }}>
        <Link
          className="btn primary"
          href={newDiscountHref({ kind: 'products', productIds: [row.productId] })}
          data-testid="discount-single"
        >
          Zlacniť tento produkt
        </Link>
      </div>
    </aside>
  );
}

export default ProductDetailPanel;
