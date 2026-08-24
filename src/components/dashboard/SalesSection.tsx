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
 * ── Odkiaľ berie graf denný priebeh (V1, 19. 8. 2026) ───────────────────────
 *
 * `/api/sales` vracia súčty na PRODUKT, nie rad po dňoch. Sekcia pritom celý
 * čas čítala `sales.days` — pole, ktoré tá odpoveď nikdy neposielala — takže
 * graf sa nenakreslil ANI RAZ a obrazovka namiesto neho pokojne hlásila
 * „denný priebeh zatiaľ nemáme". Nič nespadlo; prázdny stav vyzeral ako
 * pravda o dátach, hoci to bola pravda o odpovedi.
 *
 * Rad po dňoch preto prichádza z vlastného čítania `/api/insights/sales-daily`,
 * zaregistrovaného v spoločnom obnovovaní — nič sa neobnovuje samo (bod 4).
 * Keď `sales.days` raz predsa začne chodiť, má prednosť: dve čísla o tom istom
 * z dvoch zdrojov sú horšie než jedno.
 *
 * DÔLEŽITÉ: rad aj tri čísla nad ním počítajú z TOHO ISTÉHO poľa. Kto sem
 * vráti samostatný výpočet dlaždíc, vyrobí obrazovku, na ktorej graf a čísla
 * vedľa neho hovoria každý svoje — a obe budú vyzerať dôveryhodne.
 *
 * ── Nula verzus „nevieme" (24. 8. 2026) ──────────────────────────────────────
 *
 * Odpoveď nesie pri každom dni aj `status`. `complete` znamená, že deň sa
 * stiahol celý, a jeho `0` je meraný fakt o eshope. `partial` znamená, že
 * sťahovanie spadlo — a keď neprinieslo ani riadok, jeho `0` nie je fakt
 * o ničom. Taký deň tu dostane `units: null` a graf mu nekreslí bod, ale
 * šrafovaný pás; tri čísla nad grafom ho vôbec nevidia.
 *
 * K 24. 8. 2026 to nie je okrajový prípad: `sales_sync_state` má 5. a 6. 8.
 * ako `complete` a 7.–22. 8. ako `partial` po `forbidden` a `ip_banned`. Bez
 * tohto rozlíšenia by prehľad ukázal dva dni predaja a potom šestnásť dní
 * tvrdej nuly — teda prepad, ktorý sa nikdy nestal.
 *
 * Vlastník: V9, graf V1.
 */
import Link from 'next/link';
import { useState } from 'react';

import ChartTable from '@/components/charts/ChartTable';
import SalesChart from '@/components/dashboard/SalesChart';
import styles from '@/components/dashboard/overview.module.css';
import type { SalesDay, SalesSnapshot } from '@/components/dashboard/api';
import type { SeriesDay } from '@/components/dashboard/sales-view';
import { axisDay, chartGeometry, salesNumbers } from '@/components/dashboard/sales-view';
import { fetchJson } from '@/components/layout/health';
import { useRefreshable } from '@/components/layout/refresh';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { formatDateTimeSk } from '@/lib/ui/format';

export interface SalesSectionProps {
  sales: SalesSnapshot | null;
}

function pieces(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'kus', 'kusy', 'kusov')}`;
}

/**
 * Jeden riadok odpovede → jeden deň radu.
 *
 * Celé rozhodnutie „nula alebo nevieme" je tu, na troch riadkoch:
 *  · `complete` → číslo je meraný fakt, aj keď je to nula,
 *  · `partial` bez jediného kusu → sťahovanie nič neprinieslo, teda `null`,
 *  · `partial` s kusmi → dolná hranica, značí sa `≈` a do priemeru nejde.
 *
 * Deň bez `status` sa berie ako `complete` — staršia odpoveď ho neposielala
 * a tichý prepad na „nevieme" by z existujúcich meraní spravil dieru.
 */
export function toSeriesDay(row: { day: string; units: number; status: string | null }): SeriesDay {
  if (row.status !== 'partial') return { day: row.day, units: row.units };
  if (row.units <= 0) return { day: row.day, units: null };
  return { day: row.day, units: row.units, partial: true };
}

/**
 * Rad po dňoch z vlastného čítania.
 *
 * Nečitateľná odpoveď = prázdny rad, nie nuly. Prázdny rad znamená „graf
 * nekreslíme a povieme prečo"; nula by znamenala „v ten deň sa nepredalo nič",
 * čo je tvrdenie o produkčnom eshope.
 */
function useDailySeries(): SeriesDay[] {
  const [days, setDays] = useState<SeriesDay[]>([]);

  useRefreshable(async () => {
    const body = await fetchJson<{ days?: unknown }>('/api/insights/sales-daily');
    const raw = body === null ? null : body.days;
    if (!Array.isArray(raw)) {
      setDays([]);
      return;
    }
    const out: SeriesDay[] = [];
    for (const entry of raw) {
      if (entry === null || typeof entry !== 'object') continue;
      const row = entry as { day?: unknown; units?: unknown; status?: unknown };
      if (typeof row.day !== 'string' || typeof row.units !== 'number') continue;
      if (!Number.isFinite(row.units)) continue;
      out.push(
        toSeriesDay({
          day: row.day,
          units: row.units,
          status: typeof row.status === 'string' ? row.status : null,
        }),
      );
    }
    out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    setDays(out);
  });

  return days;
}

/** Dni, za ktoré appka STOJÍ. Odhad ani nemeraný deň medzi ne nepatrí. */
export function measuredOnly(days: readonly SeriesDay[]): SalesDay[] {
  return days.flatMap((day) =>
    day.units === null || day.partial === true ? [] : [{ day: day.day, units: day.units }],
  );
}

function dayCount(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'deň', 'dni', 'dní')}`;
}

/**
 * Doslovný prepis grafu do riadkov — vrátane toho, čo graf PRIZNÁVA.
 *
 * Pásmo bez merania má vlastný riadok a v stĺpci kusov POMLČKU, nikdy nulu:
 * `ChartTable` prázdnu bunku na pomlčku prepíše. Keby sa taký riadok vynechal,
 * tabuľka by tvrdila, že rad je súvislý, a bola by dôveryhodnejšia než graf,
 * ktorý dieru poctivo kreslí.
 */
export function tableRows(
  geometry: NonNullable<ReturnType<typeof chartGeometry>>,
  today: string,
): Array<{ cells: string[] }> {
  const rows: Array<{ key: string; cells: string[] }> = [];

  for (const point of geometry.hover) {
    if (point.units === null) continue;
    const note = point.estimate
      ? 'neúplný deň, aspoň toľko'
      : point.day === today
        ? 'dnešok, deň ešte beží'
        : point.units === 0
          ? 'deň stiahnutý, predaj žiadny'
          : '';
    const value = `${point.estimate ? '≈ ' : ''}${formatCountSk(point.units)}`;
    rows.push({ key: point.day, cells: [axisDay(point.day), value, note] });
  }

  for (const gap of geometry.gaps) {
    const label =
      gap.days === 1 ? axisDay(gap.fromDay) : `${axisDay(gap.fromDay)} – ${axisDay(gap.toDay)}`;
    rows.push({ key: gap.fromDay, cells: [label, '', `nesťahované, ${dayCount(gap.days)}`] });
  }

  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows.map((row) => ({ cells: row.cells }));
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
  // Hook stojí PRED prázdnymi stavmi — podmienené volanie hooku React zakazuje.
  const fetched = useDailySeries();

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

  /* Jeden rad pre graf, tabuľku aj tri čísla nad nimi. */
  const series: SeriesDay[] = sales.days.length > 0 ? sales.days : fetched;

  /*
   * Tri čísla stoja LEN na plne stiahnutých dňoch. Priemer, do ktorého by
   * vstúpil nemeraný deň ako nula, by klesal s každým dňom výpadku a vyzeral
   * by ako klesajúci predaj.
   */
  const measured = measuredOnly(series);
  const numbers = salesNumbers({ ...sales, days: measured } satisfies SalesSnapshot);
  const geometry = chartGeometry(series, sales.today);
  const from = sales.coverage.from;
  const to = sales.coverage.to;
  const range = from === null || to === null ? null : `${axisDay(from)} – ${axisDay(to)}`;
  const missing = geometry === null ? 0 : geometry.gaps.reduce((n, g) => n + g.days, 0);

  return (
    <section className="sec" data-testid="overview-sales" data-mode="data">
      <div className="sec-h">
        <h2>Predaj</h2>
        <div className="act">
          {/* Dní s ÚDAJOM, nie dní v `sales_sync_state`: „16 dní · 1 073 kusov"
              by z dvoch meraní spravilo dva týždne slabého predaja. */}
          <span className="lvl-3">
            {dayCount(measured.length)} s údajmi · {pieces(numbers.windowUnits)}
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
              <div>Graf sa objaví, keď budú stiahnuté aspoň dva dni.</div>
            </div>
          ) : (
            <>
              <SalesChart
                geometry={geometry}
                /* Popis nesie OBDOBIE aj ROZSAH. Rad kusov bez uvedeného
                   rozsahu vyzerá ako obrat celého eshopu; sú to pritom len
                   povolené produkty. */
                caption={`${range ?? 'Denný predaj'} · ${dayCount(measured.length)} s údajmi · povolené produkty`}
                label="Predané kusy povolených produktov po dňoch; nestiahnutý deň nie je nula"
              />
              <ChartTable
                caption="predané kusy po dňoch"
                columns={[{ head: 'Deň' }, { head: 'Kusy', numeric: true }, { head: 'Poznámka' }]}
                rows={tableRows(geometry, sales.today)}
                testId="sales-chart-table"
              />
            </>
          )}
        </div>
      </div>

      {missing === 0 ? null : (
        <div className="fresh" data-testid="sales-gap-note">
          {`V grafe chýba ${dayCount(missing)} — tie dni sa nesťahovali, predaj za ne nepoznáme`}
        </div>
      )}

      <div className="fresh">
        {sales.coverage.lastSyncedAt === null
          ? 'Predaj sa zatiaľ nesťahoval'
          : `Dáta k ${formatDateTimeSk(sales.coverage.lastSyncedAt)}`}{' '}
        · appka pozná predané kusy, nie sumu v eurách
      </div>
    </section>
  );
}

export default SalesSection;
