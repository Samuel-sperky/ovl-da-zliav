'use client';

/**
 * Aura Zľavy — G4: aktivita zápisov v čase (plán §4).
 *
 * Forma: stĺpce po dňoch, **dve série** — zapísané a zlyhané — na **jednej osi**.
 * Druhá y-škála ani „pomer úspešnosti ako druhá séria" tu neexistuje a ani
 * existovať nesmie (plán §4, zakázané formy).
 *
 * `neisté` a `preskočené` sa do stĺpcov nekreslia (boli by treťou a štvrtou
 * sériou), ale nezahadzujú sa: sú v tabuľkovej alternatíve pod grafom a graf
 * na ne upozorní vetou. `preskočený` NIE JE chyba (V20), takže sa nikdy
 * nezlučuje so „zlyhané".
 *
 * Zdroj: `audit_log` (append-only, I4 — tu sa len číta). Dni sú v logickom
 * pásme, nie v UTC: plánovaný zápis o 00:05 by inak spadol do včerajška.
 *
 * Vlastník: B2.
 */
import { useEffect, useState } from 'react';

import Table, { type TableColumn } from '@/components/ui/Table';
import { formatDateSk } from '@/lib/ui/format';
import {
  ChartEmpty,
  ChartFrame,
  ChartLegend,
  ChartSkeleton,
  useChartTooltip,
  type LegendItem,
} from '@/components/charts/ChartFrame';
import { addDaysTo, dayDiff, niceTicks, toneColor } from '@/components/charts/chart-utils';
import { getActivity, type ActivityData, type ActivityDay } from '@/components/charts/api';

const VB_WIDTH = 760;
const PLOT_X0 = 40;
const PLOT_X1 = 748;
const PLOT_Y0 = 14;
const PLOT_Y1 = 160;
const VB_HEIGHT = 190;
const SEGMENT_GAP = 2;

const LEGEND: LegendItem[] = [
  { key: 'ok', color: toneColor('good'), glyph: '✓', label: 'zapísané' },
  { key: 'failed', color: toneColor('critical'), glyph: '✕', label: 'zlyhané' },
];

const EMPTY_DAY = { ok: 0, failed: 0, uncertain: 0, skipped: 0 };

/** Doplní chýbajúce dni nulami — os musí byť spojitá, inak klame o tempe. */
export function fillDays(data: ActivityData): ActivityDay[] {
  const byDay = new Map(data.days.map((d) => [d.day, d]));
  const span = dayDiff(data.from, data.to);
  if (span < 0) return [];
  const out: ActivityDay[] = [];
  for (let i = 0; i <= span; i += 1) {
    const day = addDaysTo(data.from, i);
    out.push(byDay.get(day) ?? { day, ...EMPTY_DAY });
  }
  return out;
}

export interface AuditActivityProps {
  /** Dáta zvonku (server render, testy). Bez nich si komponent načíta vlastné. */
  data?: ActivityData;
  /** Dĺžka okna v dňoch pri vlastnom načítaní. */
  days?: number;
}

export function AuditActivity({ data: given, days = 30 }: AuditActivityProps) {
  const [data, setData] = useState<ActivityData | null>(given ?? null);
  const [error, setError] = useState<string | null>(null);
  const tooltip = useChartTooltip();

  useEffect(() => {
    if (given !== undefined) {
      setData(given);
      return;
    }
    let alive = true;
    void getActivity(days).then((res) => {
      if (!alive) return;
      if (res.ok) setData(res.data);
      else setError(res.error.message);
    });
    return () => {
      alive = false;
    };
  }, [given, days]);

  if (error !== null) {
    return (
      <p className="ovl-error" role="status">
        Aktivitu zápisov sa nepodarilo načítať. {error}
      </p>
    );
  }
  if (data === null) return <ChartSkeleton label="Načítavam aktivitu zápisov" height={180} />;

  const series = fillDays(data);
  const totals = series.reduce(
    (acc, d) => ({
      ok: acc.ok + d.ok,
      failed: acc.failed + d.failed,
      uncertain: acc.uncertain + d.uncertain,
      skipped: acc.skipped + d.skipped,
    }),
    { ...EMPTY_DAY },
  );

  const columns: TableColumn<ActivityDay>[] = [
    { key: 'day', header: 'Deň', kind: 'date', render: (r) => formatDateSk(r.day) },
    { key: 'ok', header: 'Zapísané', kind: 'num', render: (r) => r.ok },
    { key: 'failed', header: 'Zlyhané', kind: 'num', render: (r) => r.failed },
    { key: 'uncertain', header: 'Neisté', kind: 'num', render: (r) => r.uncertain },
    { key: 'skipped', header: 'Preskočené', kind: 'num', render: (r) => r.skipped },
  ];

  const table = (
    <Table
      columns={columns}
      rows={series.filter((d) => d.ok + d.failed + d.uncertain + d.skipped > 0)}
      rowKey={(r) => r.day}
      emptyLabel="V zvolenom období appka nezapisovala."
      caption="Neisté a preskočené pokusy graf nekreslí — nájdeš ich tu."
    />
  );

  const grandTotal = totals.ok + totals.failed + totals.uncertain + totals.skipped;
  if (grandTotal === 0) {
    return (
      <ChartFrame
        title="Aktivita zápisov"
        subtitle={`Zapísané a zlyhané pokusy po dňoch, ${formatDateSk(data.from)} – ${formatDateSk(data.to)}.`}
        table={table}
        testId="chart-audit-activity"
      >
        <ChartEmpty>
          V období {formatDateSk(data.from)} – {formatDateSk(data.to)} appka nezapisovala. To je
          normálny stav, keď nebeží žiadna kampaň.
        </ChartEmpty>
      </ChartFrame>
    );
  }

  const maxStack = Math.max(1, ...series.map((d) => d.ok + d.failed));
  const ticks = niceTicks(maxStack, 4);
  const top = ticks[ticks.length - 1] ?? 1;
  const slot = (PLOT_X1 - PLOT_X0) / Math.max(1, series.length);
  const barW = Math.max(3, Math.min(24, slot - 3));
  const yOf = (value: number) => PLOT_Y1 - ((PLOT_Y1 - PLOT_Y0) * value) / Math.max(1, top);

  return (
    <ChartFrame
      title="Aktivita zápisov"
      subtitle={`Zapísané a zlyhané pokusy po dňoch, ${formatDateSk(data.from)} – ${formatDateSk(data.to)}. Jedna os, dve série.`}
      legend={<ChartLegend items={LEGEND} />}
      table={table}
      tooltip={tooltip}
      testId="chart-audit-activity"
      note={
        <p className="ovl-small ovl-muted" style={{ margin: 0 }}>
          Spolu {totals.ok} zapísaných a {totals.failed} zlyhaných.
          {totals.uncertain + totals.skipped > 0
            ? ` Ďalej ${totals.uncertain} neistých a ${totals.skipped} preskočených — tie graf nekreslí, sú v tabuľke pod ním.`
            : ''}
          {data.truncated ? ' Obdobie je príliš husté, graf kreslí len jeho začiatok.' : ''}
        </p>
      }
    >
      <svg
        className="ovl-chart"
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        role="img"
        aria-label={`Aktivita zápisov po dňoch: ${totals.ok} zapísaných a ${totals.failed} zlyhaných medzi ${formatDateSk(data.from)} a ${formatDateSk(data.to)}.`}
        style={{ height: 'auto' }}
      >
        {ticks.map((tick) => (
          <g key={`t-${tick}`}>
            <line
              x1={PLOT_X0}
              y1={yOf(tick)}
              x2={PLOT_X1}
              y2={yOf(tick)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text x={PLOT_X0 - 6} y={yOf(tick) + 3} fontSize={10} fill="var(--dim)" textAnchor="end">
              {tick}
            </text>
          </g>
        ))}

        {series.map((day, index) => {
          const x = PLOT_X0 + index * slot + (slot - barW) / 2;
          const isToday = day.day === data.today;
          const okH = day.ok === 0 ? 0 : Math.max(2, PLOT_Y1 - yOf(day.ok));
          const failedRaw = day.failed === 0 ? 0 : Math.max(2, PLOT_Y1 - yOf(day.failed));
          // 2 px medzera v farbe plochy oddeľuje segmenty — nie obrys.
          const gap = okH > 0 && failedRaw > 0 ? SEGMENT_GAP : 0;
          const okY = PLOT_Y1 - okH;
          const failedY = okY - gap - failedRaw;
          const total = day.ok + day.failed + day.uncertain + day.skipped;
          const description = `${formatDateSk(day.day)}: ${day.ok} zapísaných, ${day.failed} zlyhaných, ${day.uncertain} neistých, ${day.skipped} preskočených.`;

          return (
            <g
              key={day.day}
              className="ovl-chart-mark"
              onMouseMove={(event) =>
                tooltip.show(
                  event,
                  <>
                    <strong>{formatDateSk(day.day)}</strong>
                    <br />
                    <span aria-hidden="true">✓ </span>
                    {day.ok} zapísaných
                    <br />
                    <span aria-hidden="true">✕ </span>
                    {day.failed} zlyhaných
                    {day.uncertain + day.skipped > 0 ? (
                      <>
                        <br />
                        {day.uncertain} neistých · {day.skipped} preskočených
                      </>
                    ) : null}
                  </>,
                )
              }
            >
              <title>{description}</title>
              {/* neviditeľný hit target cez celý slot — mark býva nízky */}
              <rect
                x={PLOT_X0 + index * slot}
                y={PLOT_Y0 - 8}
                width={slot}
                height={PLOT_Y1 - PLOT_Y0 + 8}
                fill="transparent"
              />
              {okH > 0 ? (
                <rect x={x} y={okY} width={barW} height={okH} rx={2} fill={toneColor('good')} />
              ) : null}
              {failedRaw > 0 ? (
                <rect
                  x={x}
                  y={failedY}
                  width={barW}
                  height={failedRaw}
                  rx={2}
                  fill={toneColor('critical')}
                />
              ) : null}
              {isToday && total > 0 ? (
                <text
                  x={x + barW / 2}
                  y={(failedRaw > 0 ? failedY : okY) - 5}
                  fontSize={10}
                  fill="var(--ink)"
                  textAnchor="middle"
                >
                  {day.ok}
                  {day.failed > 0 ? ` / ${day.failed}` : ''}
                </text>
              ) : null}
            </g>
          );
        })}

        <line
          x1={PLOT_X0}
          y1={PLOT_Y1}
          x2={PLOT_X1}
          y2={PLOT_Y1}
          stroke="var(--line-strong)"
          strokeWidth={1}
        />
        <text x={PLOT_X0} y={PLOT_Y1 + 16} fontSize={10} fill="var(--dim)">
          {formatDateSk(data.from)}
        </text>
        <text x={PLOT_X1} y={PLOT_Y1 + 16} fontSize={10} fill="var(--dim)" textAnchor="end">
          {formatDateSk(data.to)}
        </text>
      </svg>
    </ChartFrame>
  );
}

export default AuditActivity;
