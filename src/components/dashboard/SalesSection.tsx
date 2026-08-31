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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import ChartTable from '@/components/charts/ChartTable';
import SalesChart from '@/components/dashboard/SalesChart';
import styles from '@/components/dashboard/overview.module.css';
import type { SalesDay, SalesSnapshot } from '@/components/dashboard/api';
import type { OverviewWindow } from '@/components/dashboard/overview-model';
import { DEFAULT_OVERVIEW_WINDOW } from '@/components/dashboard/overview-model';
import type { DiscountWindowInput, SeriesDay } from '@/components/dashboard/sales-view';
import {
  axisDay,
  chartGeometry,
  discountBands,
  revenueDays,
  salesNumbers,
  windowDayList,
} from '@/components/dashboard/sales-view';
import type { RevenueDailyView } from '@/components/dashboard/window-api';
import { fetchJson } from '@/components/layout/health';
import { useRefreshable } from '@/components/layout/refresh';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { formatDateTimeSk } from '@/lib/ui/format';
import { NEVIEME } from '@/lib/ui/product-label';

export interface SalesSectionProps {
  sales: SalesSnapshot | null;
  /**
   * Okno prepínača Prehľadu. Bez neho zostáva predvolených 30 dní — sekcia si
   * prepínač NEKRESLÍ, lebo ten patrí celej obrazovke (okno riadi aj rebríček).
   */
  windowDays?: OverviewWindow;
  /** Prepínač okna do hlavičky sekcie. Kreslí ho obrazovka, nie sekcia. */
  switcher?: ReactNode;
  /**
   * Okná zliav na podfarbenie POD krivku (V4, D113). Sú to VLASTNÉ zápisy
   * appky, nie stav eshopu — hovorí to popis nad grafom.
   */
  discountWindows?: readonly DiscountWindowInput[];
  /**
   * Denná tržba ESHOPU (D117). `null` = nedalo sa prečítať; `undefined` =
   * obrazovka o tržbu nežiadala. V oboch prípadoch sa nekreslí SUMA, len
   * priznanie — nikdy nula.
   */
  revenue?: RevenueDailyView | null;
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
function useDailySeries(windowDays: OverviewWindow): SeriesDay[] {
  const [days, setDays] = useState<SeriesDay[]>([]);

  const load = useCallback(async () => {
    const body = await fetchJson<{ days?: unknown }>(
      `/api/insights/sales-daily?window=${windowDays}`,
    );
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
  }, [windowDays]);

  useRefreshable(load);

  /*
   * Zmena okna je RUČNÁ akcia človeka (kliknutie do prepínača), takže načítanie
   * po nej nie je automatické obnovovanie zakázané bodom 4 kontraktu — je to tá
   * istá kategória ako stlačenie Obnoviť. Prvý beh sa preskočí, lebo ten už
   * urobil `useRefreshable` pri otvorení obrazovky; bez tej stráže by každé
   * otvorenie Prehľadu poslalo ten istý dotaz dvakrát.
   */
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    void load();
  }, [load]);

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

/* ═════════════ Denná tržba ESHOPU — jediné euro, ktoré appka má ═══════════ */

/**
 * TRŽBA ESHOPU, NIE TRŽBA ZA PRODUKT ANI ZA ZĽAVU (D117).
 *
 * Sonda 28. 8. 2026 zmerala, že objednávkové API ceny položiek nevracia. Euro
 * preto existuje VÝHRADNE ako denný súčet `total_paid` za celý eshop a tento
 * blok je jediné miesto Prehľadu, kde ho appka smie napísať. Menovka „celý
 * eshop" nie je slušnosť — bez nej si suma sadne vedľa grafu kusov povolených
 * produktov a prečíta sa ako ich obrat.
 *
 * ČO TU NIKDY NEBUDE: delenie sumy počtom kusov (v `total_paid` je poštovné,
 * kupóny aj zľavy), sčítanie dvoch mien do jedného čísla, a nula za deň, ktorý
 * appka nemá.
 *
 * ROZBEHNUTÝ DEŇ NIE JE POKLES. Deň s `dayComplete: false` je dolná hranica;
 * dostane `≈` a vetu, a NIKDY nestojí vedľa dočítaných dní ako rovnocenné
 * číslo. Bez toho vyzerá posledný deň okna vždy ako prudký pád tržby.
 */
function Revenue({
  revenue,
  windowDays,
}: {
  revenue: RevenueDailyView | null | undefined;
  windowDays: OverviewWindow;
}) {
  if (revenue === undefined) return null;
  if (revenue === null) {
    return (
      <div className="fresh" data-testid="overview-revenue" data-mode="unreadable">
        Tržbu celého eshopu sa nepodarilo prečítať, tak ju neuvádzame
      </div>
    );
  }

  const list = windowDayList(revenue.from, revenue.to);

  return (
    <div className={styles.revenueRow} data-testid="overview-revenue" data-mode="data">
      {revenue.series.length === 0 ? (
        <span className="lvl-3">
          {`Tržba celého eshopu za ${dayCount(windowDays)} — ${NEVIEME} · ani jeden deň okna zatiaľ nemáme`}
        </span>
      ) : (
        revenue.series.map((series) => {
          const days = revenueDays(list, series.days);
          const last = days[days.length - 1];
          /* Súčet je meranie LEN pri dočítanom okne; inak je to dolná hranica
             a musí to byť vidieť pred číslom, nie až v poznámke pod ním. */
          const sum =
            series.sum === null
              ? NEVIEME
              : `${series.sumState === 'measured' ? '' : '≈ '}${series.sum} ${series.currency}`;
          return (
            <span key={series.currency} className="lvl-3" data-testid="revenue-series">
              {`Tržba celého eshopu za ${dayCount(windowDays)}: ${sum}`}
              {series.sumState === 'lower_bound' ? ' · aspoň toľko, časť dní nemáme celú' : ''}
              {last !== undefined && last.state === 'lower_bound'
                ? ` · posledný deň sa ešte dopočítava (${last.text} ${series.currency}), nie je to pokles`
                : ''}
            </span>
          );
        })
      )}
      {/*
        Tri stavy, nie dva (I11): číslo je zmeraná medzera, nula znamená
        „nechýba ani jeden deň" a `null` znamená, že odpoveď zoznam chýbajúcich
        dní vôbec nenesie. Posledné dva sa nesmú zliať — mlčanie pri `null` by
        prečítalo ako „okno je celé".
      */}
      {revenue.missingDays === null ? (
        <span className="lvl-3" data-testid="revenue-gap" data-mode="unknown">
          {`Koľko dní okna appke chýba, nevieme (${NEVIEME}) — nie je to nula`}
        </span>
      ) : revenue.missingDays === 0 ? null : (
        <span className="lvl-3" data-testid="revenue-gap" data-mode="measured">
          {`${dayCount(revenue.missingDays)} okna appka nemá — tržbu za ne nepoznáme, nie je to nula`}
        </span>
      )}
    </div>
  );
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

export function SalesSection({
  sales,
  windowDays = DEFAULT_OVERVIEW_WINDOW,
  switcher,
  discountWindows = [],
  revenue,
}: SalesSectionProps) {
  // Hook stojí PRED prázdnymi stavmi — podmienené volanie hooku React zakazuje.
  const fetched = useDailySeries(windowDays);

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
  /* Pásy zliav sedia na TÚ ISTÚ os ako body — mierku dáva geometria, nie druhý
     výpočet. Pri poradovej osi vráti `discountBands()` prázdne pole. */
  const bands = geometry === null ? [] : discountBands(geometry, discountWindows);

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
          {switcher}
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
                bands={bands}
                /* Popis nesie OBDOBIE aj ROZSAH. Rad kusov bez uvedeného
                   rozsahu vyzerá ako obrat celého eshopu; sú to pritom len
                   povolené produkty. Pri pásoch zliav pribúda tretia vec:
                   podfarbenie hovorí o NAŠICH zápisoch, nie o tom, čo v tie dni
                   naozaj videl zákazník (I11). */
                caption={`${range ?? 'Denný predaj'} · ${dayCount(measured.length)} s údajmi · povolené produkty${
                  bands.length === 0 ? '' : ' · podfarbené sú okná našich zliav'
                }`}
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

      <Revenue revenue={revenue} windowDays={windowDays} />

      <div className="fresh">
        {sales.coverage.lastSyncedAt === null
          ? 'Predaj sa zatiaľ nesťahoval'
          : `Dáta k ${formatDateTimeSk(sales.coverage.lastSyncedAt)}`}{' '}
        {/* Od D117 je veta presnejšia: euro appka MÁ, ale len za celý eshop.
            Pôvodné „nie sumu v eurách" by teraz protirečilo bloku nad ním. */}
        · graf je v kusoch; euro appka pozná len ako tržbu celého eshopu
      </div>
    </section>
  );
}

export default SalesSection;
