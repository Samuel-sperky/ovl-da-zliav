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
 * Oba panely sú preto ZAMKNUTÉ a povedia prečo — rovnako ako zamknuté filtre
 * v Produktoch. Tretí panel ukazuje to, čo appka naozaj vie: kusy za okno
 * dlhé ako zľava, proti rovnako dlhému oknu tesne pred ním.
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

function LockedPanel({ title, reason }: { title: string; reason: string }) {
  return (
    <div className={`${styles.perfPanel} ${styles.perfLocked}`} data-testid="performance-locked">
      <div className={styles.perfTitle}>{title}</div>
      <p className="lvl-3">{reason}</p>
    </div>
  );
}

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

      <div className={styles.perfGrid}>
        <div className={styles.perfPanel} data-testid="performance-units">
          <div className={styles.perfTitle}>Pred zľavou a teraz</div>
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

        <LockedPanel
          title="Tržby"
          reason={view?.locked.revenue ?? 'Tržby v eurách shop cez API nevracia.'}
        />
        <LockedPanel
          title="Vlani rovnaké obdobie"
          reason={view?.locked.lastYear ?? 'Predaje zatiaľ rok dozadu nesiahajú.'}
        />
      </div>
    </section>
  );
}

export default DiscountPerformance;
