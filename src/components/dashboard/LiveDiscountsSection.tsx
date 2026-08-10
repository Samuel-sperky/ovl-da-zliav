'use client';

/**
 * Aura Zľavy — SEKCIA 4 PREHĽADU: „Zľavy naživo" (V9, architektúra §1 TAB 1).
 *
 * Tri riadky, žiadna tabuľka, žiadna akcia okrem prekliku. Hore to, čo sa
 * hýbe (zapisuje sa → beží → pripravená → skončila).
 *
 * TVRDÁ HRANICA: toto NIE JE zoznam produktov a nikdy ním nebude. Prehľad
 * odpovedá na „čo sa práve deje", konkrétne kusy patria do Produktov.
 *
 * Vlastník: V9.
 */
import Link from 'next/link';

import StateLine from '@/components/dashboard/StateLine';
import styles from '@/components/dashboard/overview.module.css';
import type { LiveCampaign } from '@/components/dashboard/overview-model';
import { dayMonthSk, formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface LiveDiscountsSectionProps {
  campaigns: LiveCampaign[] | null;
}

/** Pravý stĺpec riadku — pri zapisovaní pruh, inak vlastné zápisy. */
function Trailing({ item }: { item: LiveCampaign }) {
  if (item.writing) {
    return (
      <span className="prog-sm">
        <span className="bar" aria-hidden="true">
          <i style={{ width: `${item.percent.toFixed(2)}%` }} />
        </span>
        <span className="n num">
          {formatCountSk(item.row.itemsTotal - item.row.itemsPending)}/
          {formatCountSk(item.row.itemsTotal)}
        </span>
      </span>
    );
  }
  if (item.row.itemsOk === 0) {
    return <span className="lvl-3">zatiaľ nezapísané</span>;
  }
  return (
    <span className="lvl-3">
      zlacnených <b>{formatCountSk(item.row.itemsOk)}</b>
    </span>
  );
}

export function LiveDiscountsSection({ campaigns }: LiveDiscountsSectionProps) {
  return (
    <section className={`sec ${styles.flush}`} data-testid="overview-live">
      <div className={`zlist ${styles.flushList}`}>
        <div className="zlist-h">Zľavy naživo</div>

        {campaigns === null ? (
          <div className="empty">
            <div className="t">Zoznam zliav sa nepodarilo načítať</div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="empty">
            <div className="t">Žiadna zľava</div>
            <div>Začnite tým, čo sa nepredáva.</div>
            <div className="a">
              <Link className="btn primary" href="/zlavy/nova">
                Nová zľava
              </Link>
            </div>
          </div>
        ) : (
          campaigns.map((item) => (
            <Link
              key={item.row.id}
              href={`/zlavy/${item.row.id}`}
              className={
                item.sentence.state === 'skončila'
                  ? `zrow dim ${styles.rowLink}`
                  : `zrow ${styles.rowLink}`
              }
              data-testid="live-row"
            >
              <span className="nm">{item.row.name}</span>
              <StateLine sentence={item.sentence} />
              <span className="lvl-3">
                {formatCountSk(item.row.itemsTotal)}{' '}
                {pluralSk(item.row.itemsTotal, 'produkt', 'produkty', 'produktov')}
              </span>
              <span className="lvl-2">{item.percentLabel}</span>
              <span className="lvl-3">
                {dayMonthSk(item.row.dateFrom)} – {dayMonthSk(item.row.dateTo)}
              </span>
              <Trailing item={item} />
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

export default LiveDiscountsSection;
