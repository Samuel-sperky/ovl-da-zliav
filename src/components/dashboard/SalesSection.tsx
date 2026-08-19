'use client';

/**
 * Aura Zľavy — SEKCIA PREHĽADU: predaj (V9, architektúra §1 TAB 1).
 *
 * Vľavo tri čísla, vpravo čiarový graf s trendovou čiarou, pod tým jeden
 * riadok o čerstvosti dát. Žiadna veta o príčine — čísla stoja vedľa seba
 * a záver si robí človek (P8).
 *
 * ── Prečo sa sekcia volá „Predaj" a nie „Tržby" ─────────────────────────────
 *
 * Tržba je suma v eurách a tú appka nemá odkiaľ vziať (viď nižšie). Nadpis
 * „Tržby" nad grafom kusov je tvrdenie, ktoré obsah nepodloží — a to je presne
 * to, čomu sa táto obrazovka vyhýba. Nadpis preto hovorí to, čo sekcia meria.
 *
 * ── Prečo tu nie sú eurá ─────────────────────────────────────────────────────
 *
 * Appka si z objednávok vedie POČTY KUSOV na produkt a deň. Zaplatená suma
 * patrí objednávke, nie položke, takže tržbu v eurách appka nemá odkiaľ vziať
 * a dopočítať ju z ceny by bolo klamstvo (cena v čase objednávky mohla byť iná,
 * doprava a kupóny do nej nepatria). Sekcia preto počíta kusy a hovorí to
 * v riadku o čerstvosti dát. Vymyslené euro na prístrojovej doske je horšie
 * než priznaná medzera (P7).
 *
 * Vlastník: V9.
 */
import Link from 'next/link';

import SalesChart from '@/components/dashboard/SalesChart';
import styles from '@/components/dashboard/overview.module.css';
import type { SalesSnapshot } from '@/components/dashboard/api';
import { axisDay, chartGeometry, salesNumbers } from '@/components/dashboard/sales-view';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { formatDateTimeSk } from '@/lib/ui/format';

export interface SalesSectionProps {
  sales: SalesSnapshot | null;
}

function pieces(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'kus', 'kusy', 'kusov')}`;
}

/** `+4 %` / `−7 %`; nula nedostane znamienko, aby nevyzerala ako pohyb. */
function signedPercent(value: number): string {
  if (value === 0) return '0 %';
  return value > 0 ? `+${value} %` : `−${Math.abs(value)} %`;
}

/**
 * Prázdny stav = JEDNA VETA a JEDNO TLAČIDLO (kontrakt UI, bod 11). Veta je
 * dôvod, nie „žiadne dáta": prázdny graf môže znamenať vypnuté sťahovanie
 * objednávok alebo prvý beh, a to sú dve rôzne veci.
 *
 * A NIE JE TO SEKCIA (oprava D7, 19. 8. 2026). Do tohto dátumu zaberala tá
 * jedna veta celú kartu — nadpis sekcie, 34 px vzduchu a vycentrované
 * tlačidlo, spolu okolo 180 px. Sekcia je prísľub obsahu; keď obsah nie je,
 * ostane na obrazovke prázdna škatuľa, ktorá si berie miesto štvrtej sekcie
 * (P5) aj kus hranice 1,5 obrazovky (P4). Veta a tlačidlo sa preto zmestia do
 * jedného riadku a slovo „Predaj" je jeho začiatkom, nie samostatnou
 * hlavičkou — obrazovka nemá dostať štvrtú veľkosť popisku.
 *
 * Len čo dáta prídu, „Predaj" sa sekciou znova stane. Vtedy má čo ukázať.
 */
function Empty({ reason }: { reason: string }) {
  return (
    <div className={styles.thin} data-testid="overview-sales" data-mode="empty">
      <span className="lvl-2">{`Predaj — ${reason}`}</span>
      <Link className="btn sm" href="/nastavenia">
        Otvoriť Nastavenia
      </Link>
    </div>
  );
}

export function SalesSection({ sales }: SalesSectionProps) {
  if (sales === null) {
    return <Empty reason="Údaje o predaji sa nepodarilo načítať." />;
  }
  if (!sales.coverage.hasData) {
    return (
      <Empty
        reason={
          sales.coverage.syncEnabled
            ? 'Prvé sťahovanie objednávok ešte nedobehlo.'
            : 'Sťahovanie objednávok je vypnuté v Nastaveniach.'
        }
      />
    );
  }

  const numbers = salesNumbers(sales);
  const geometry = chartGeometry(sales.days, sales.today);
  const from = sales.coverage.from;
  const to = sales.coverage.to;
  const range = from === null || to === null ? null : `${axisDay(from)} – ${axisDay(to)}`;

  return (
    <section className="sec" data-testid="overview-sales" data-mode="data">
      <div className="sec-h">
        <h2>Predaj</h2>
        <div className="act">
          <span className="lvl-3">
            {formatCountSk(sales.coverage.daysCovered)}{' '}
            {pluralSk(sales.coverage.daysCovered, 'deň', 'dni', 'dní')} · {pieces(numbers.windowUnits)}
          </span>
        </div>
      </div>

      <div className={styles.salesGrid}>
        <div className={`kpis ${styles.kpiCol}`} data-testid="sales-numbers">
          <div className="kpi">
            <div className="k">Dnes predané</div>
            <div className="v num">{numbers.today === null ? '—' : pieces(numbers.today)}</div>
            <div className="s">
              {numbers.today === null ? 'denný priebeh zatiaľ nemáme' : 'dnešok stále beží'}
            </div>
          </div>
          <div className="kpi">
            <div className="k">Priemer za deň</div>
            <div className="v num">{numbers.perDay === null ? '—' : pieces(numbers.perDay)}</div>
            <div className="s">
              {numbers.closedDays > 0
                ? `${formatCountSk(numbers.closedDays)} ${pluralSk(numbers.closedDays, 'uzavretý deň', 'uzavreté dni', 'uzavretých dní')}`
                : 'bez uzavretého dňa'}
            </div>
          </div>
          <div className="kpi">
            <div className="k">Trend</div>
            <div className="v num">
              {numbers.trendPercent === null ? '—' : signedPercent(numbers.trendPercent)}
            </div>
            <div className="s">{range ?? 'obdobie zatiaľ nevieme'}</div>
          </div>
        </div>

        <div className={`chart ${styles.chartPlain}`}>
          {geometry === null ? (
            <div className="empty">
              <div className="t">Denný priebeh zatiaľ nemáme</div>
              <div>Graf sa objaví, keď budú pokryté aspoň dva dni.</div>
            </div>
          ) : (
            <SalesChart
              geometry={geometry}
              caption={range === null ? 'Denný predaj' : `${range} · denný predaj`}
              label="Denný predaj v kusoch za pokryté obdobie"
            />
          )}
        </div>
      </div>

      <div className="fresh">
        {sales.coverage.lastSyncedAt === null
          ? 'Predaj sme zatiaľ nesťahovali'
          : `Dáta k ${formatDateTimeSk(sales.coverage.lastSyncedAt)}`}{' '}
        · appka pozná predané kusy, nie sumu v eurách
      </div>
    </section>
  );
}

export default SalesSection;
