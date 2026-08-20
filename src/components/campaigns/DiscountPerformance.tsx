'use client';

/**
 * Aura Zľavy — sekcia „Výkon výberu" v detaile zľavy
 * (architektúra §1 TAB 3 bod 3, odpoveď 86).
 *
 * Tri uhly vedľa seba, ako žiada návrh. Rozdiel oproti mockupu
 * `design/v3/zlava-detail.html` je vedomý a je to oprava, nie ústupok:
 *
 *   · mockup ukazuje TRŽBY v eurách — appka ich nemá. Zo shopu prichádzajú
 *     iba počty predaných kusov; cenu, za ktorú sa produkt naozaj predal,
 *     nikdy nevidela. Číslo v eurách by sa dalo „dopočítať" ako kusy krát
 *     dnešná cenníková cena, ale to by nebola tržba, len presvedčivo
 *     vyzerajúci výmysel (K8).
 *   · mockup ukazuje porovnanie s vlaňajškom — synchronizácia predajov si
 *     okno dopĺňa postupne a rok dozadu nesiaha.
 *
 * Oba uhly sú preto ZAMKNUTÉ a povedia prečo — rovnako ako zamknuté filtre
 * v Produktoch. Tretí ukazuje to, čo appka naozaj vie: kusy za okno dlhé ako
 * zľava, proti rovnako dlhému oknu tesne pred ním.
 *
 * TRI KARTY SÚ ODTERAZ JEDNA A DVA RIADKY (D17, 19. 8. 2026)
 * ---------------------------------------------------------
 * Do 19. 8. boli všetky tri uhly rovnako veľké orámované karty vedľa seba a
 * pri prázdnych dátach hovorili to isté trikrát: „dáta nie sú". Sekcia
 * zaberala tretinu obrazovky, aby oznámila, že nemá čo povedať. Odteraz sú to
 * dve rôzne veci: **čísla, ktoré appka má** (hore, bez vlastného rámu — nadpis
 * sekcie ich už pomenoval) a **dva tiché riadky o tom, čo nemá** (dole).
 * Nič sa neskrylo: zamknutý uhol naďalej povie svoj dôvod, len prestal
 * vyzerať ako karta s dátami. Keby sa niektorý uhol raz odomkol, vráti sa
 * hore k číslam — nie sem.
 *
 * Žiadny záver o príčine (P8): dve čísla vedľa seba, nikdy veta „zľava
 * priniesla +18 %". Sezónu od vplyvu zľavy appka oddeliť nevie.
 */
import { useEffect, useState } from 'react';

import styles from '@/components/campaigns/zlavy.module.css';
import { discountPerformance, type PerformanceView } from '@/components/campaigns/zlavy-api';
import { formatCountSk } from '@/lib/ui/vocabulary';
import { formatDateSk } from '@/lib/ui/format';

/** Pruh, ktorého dĺžka je pomer k väčšiemu z dvoch čísel. */
function Bar({ units, max, strong }: { units: number; max: number; strong?: boolean }) {
  const width = max <= 0 ? 0 : Math.round((units / max) * 100);
  return (
    <span className={strong === true ? `${styles.perfTrack} ${styles.perfStrong}` : styles.perfTrack}>
      <i style={{ width: `${width}%` }} />
    </span>
  );
}

/**
 * Uhol, ktorý appka nemá — jeden riadok: názov a dôvod. Nie karta: karta
 * sľubuje čísla a tu žiadne nie sú a ani nebudú, kým shop nedá viac (D17).
 */
function LockedAngle({ name, reason }: { name: string; reason: string }) {
  return (
    <div className={styles.perfLockedRow} data-testid="performance-locked">
      <span className={styles.perfLockedName}>{name}</span>
      <span className="lockline">{reason}</span>
    </div>
  );
}

export interface PerformanceCardProps {
  /** Načítané čísla; `null` = ešte sa načítavajú. */
  view: PerformanceView | null;
  /** Načítanie zlyhalo — vtedy sa nepredstiera ani pomlčka, povie sa to vetou. */
  failed: boolean;
}

/**
 * Sekcia bez načítavania — všetko, čo sa naozaj vykreslí.
 *
 * Oddelené od `DiscountPerformance` zámerne a kvôli testom (19. 8. 2026):
 * dovtedy sa sekcia testovala cez `renderToStaticMarkup(<DiscountPerformance/>)`,
 * lenže `renderToStaticMarkup` efekty nespúšťa, takže `view` ostávalo `null`
 * a všetky tvrdenia — „appka nikde nepredstiera eurá", „žiadny záver o príčine"
 * — merali stav „Načítavam…". Práve preto v nich prežil nález, že
 * `.perfStrong i` mal `background: var(--ink3)`, čiže neexistujúci token, a
 * porovnávací pruh sa kreslil ako prázdny žľab. Nad touto funkciou sa dá
 * vykresliť KTORÝKOĽVEK stav bez prehliadača a bez siete.
 */
export function PerformanceCard({ view, failed }: PerformanceCardProps) {
  const recent = view?.recent.units ?? null;
  const prior = view?.prior.units ?? null;
  const max = Math.max(recent ?? 0, prior ?? 0);

  return (
    <section className="sec" data-testid="detail-performance">
      <div className="sec-h">
        <h2>Výkon výberu</h2>
        <div className="act lvl-3">
          {view === null ? 'predané kusy' : `predané kusy za ${view.spanDays} dní`}
        </div>
      </div>

      {/* Čísla, ktoré appka naozaj má. Nadpis sekcie ich už pomenoval, takže
          vlastný nadpis ani rám nepotrebujú. */}
      <div data-testid="performance-units">
        {failed ? (
          <p className="lvl-3">Čísla sa nepodarilo načítať.</p>
        ) : view === null ? (
          <p className="lvl-3">Načítavam…</p>
        ) : recent === null ? (
          /* Nula by tvrdila „nepredalo sa nič". Pomlčka tvrdí „nevieme". */
          <p className="lvl-3">
            Za toto obdobie zatiaľ nemáme dáta o predaji
            {view.coverage.from === null ? '.' : ` — máme ich od ${formatDateSk(view.coverage.from)}.`}
          </p>
        ) : (
          <div className={styles.perfPair}>
            <span>
              {formatDateSk(view.recent.from)} – {formatDateSk(view.recent.to)}
            </span>
            <Bar units={recent} max={max} />
            <span className={styles.perfValue}>{formatCountSk(recent)} ks</span>

            <span>
              {formatDateSk(view.prior.from)} – {formatDateSk(view.prior.to)}
            </span>
            {prior === null ? <span /> : <Bar units={prior} max={max} strong />}
            <span className={styles.perfValue}>
              {prior === null ? '—' : `${formatCountSk(prior)} ks`}
            </span>
          </div>
        )}
      </div>

      {/* Čo appka nemá — dva tiché riadky, nie dve prázdne karty (D17). */}
      <div className={styles.perfLocked}>
        <LockedAngle
          name="Tržby"
          reason={view?.locked.revenue ?? 'shop ich cez API nevracia'}
        />
        {/* D18 — „Vlani rovnaké obdobie" bola príslovka nalepená na podstatné
            meno. Po slovensky sa to povie opačne. */}
        <LockedAngle
          name="Rovnaké obdobie vlani"
          reason={view?.locked.lastYear ?? 'dáta zatiaľ tak ďaleko nesiahajú'}
        />
      </div>
    </section>
  );
}

/** Sekcia aj s načítaním — to, čo do detailu zľavy naozaj vstupuje. */
export function DiscountPerformance({ id }: { id: number }) {
  const [view, setView] = useState<PerformanceView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void discountPerformance(id).then((res) => {
      if (!alive) return;
      if (res.ok) setView(res.data);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  return <PerformanceCard view={view} failed={failed} />;
}

export default DiscountPerformance;
