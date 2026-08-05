'use client';

/**
 * Aura Zľavy — G3: história vlastných zápisov na produkt (plán §4).
 *
 * Forma: malý časový bodový graf — kedy appka na TENTO produkt zapisovala
 * a s akým percentom. Odpovedá na otázku „prečo je tento produkt v akcii“,
 * ktorá dnes vyžaduje ručné filtrovanie auditu.
 *
 * Farba je stavová **a zároveň tvar**: kruh = zapísané, krížik = zlyhalo,
 * kosoštvorec = nezapísané z iného dôvodu (nenájdený, preskočený, prerušený).
 * Stav teda nikdy nestojí len na farbe (plán §3.3).
 *
 * I11: graf hovorí o tom, čo appka SAMA urobila. Nie je to história zliav
 * v shope a appka ju ani nepozná.
 *
 * Vlastník: B2.
 */
import { useEffect, useState } from 'react';

import Table, { type TableColumn } from '@/components/ui/Table';
import { formatDateSk, formatDateTimeSk, formatPercentSk } from '@/lib/ui/format';
import {
  ChartEmpty,
  ChartFrame,
  ChartLegend,
  ChartSkeleton,
  useChartTooltip,
  type LegendItem,
} from '@/components/charts/ChartFrame';
import {
  DAY_MS,
  PERCENT_CAP,
  itemVisual,
  markShape,
  toneColor,
} from '@/components/charts/chart-utils';
import {
  getProductWrites,
  type ProductWrite,
  type ProductWritesData,
} from '@/components/charts/api';

const VB_WIDTH = 760;
const VB_HEIGHT = 190;
const PLOT_X0 = 44;
const PLOT_X1 = 744;
const PLOT_Y0 = 18;
const PLOT_Y1 = 150;
const MARK_R = 4.5;

const LEGEND: LegendItem[] = [
  { key: 'ok', color: toneColor('good'), glyph: '●', label: 'zapísané' },
  { key: 'failed', color: toneColor('critical'), glyph: '✕', label: 'zlyhalo' },
  { key: 'other', color: toneColor('attention'), glyph: '◆', label: 'nezapísané' },
];

export interface ProductWriteHistoryProps {
  productId: number;
  /** Dáta zvonku (server render, testy). Bez nich si komponent načíta vlastné. */
  data?: ProductWritesData;
}

export function ProductWriteHistory({ productId, data: given }: ProductWriteHistoryProps) {
  const [data, setData] = useState<ProductWritesData | null>(given ?? null);
  const [error, setError] = useState<string | null>(null);
  const tooltip = useChartTooltip();

  useEffect(() => {
    if (given !== undefined) {
      setData(given);
      return;
    }
    let alive = true;
    void getProductWrites(productId).then((res) => {
      if (!alive) return;
      if (res.ok) setData(res.data);
      else setError(res.error.message);
    });
    return () => {
      alive = false;
    };
  }, [given, productId]);

  if (error !== null) {
    return (
      <p className="ovl-error" role="status">
        Históriu zápisov sa nepodarilo načítať. {error}
      </p>
    );
  }
  if (data === null) return <ChartSkeleton label="Načítavam históriu zápisov" height={150} />;

  const columns: TableColumn<ProductWrite>[] = [
    { key: 'at', header: 'Kedy', kind: 'date', render: (r) => formatDateTimeSk(r.at) },
    {
      key: 'status',
      header: 'Výsledok',
      render: (r) => {
        const v = itemVisual(r.status);
        return (
          <>
            <span aria-hidden="true">{v.glyph} </span>
            {v.label}
          </>
        );
      },
    },
    { key: 'percent', header: 'Zľava', kind: 'num', render: (r) => formatPercentSk(r.percent) },
    {
      key: 'window',
      header: 'Okno',
      kind: 'date',
      render: (r) => `${formatDateSk(r.dateFrom)} – ${formatDateSk(r.dateTo)}`,
    },
    { key: 'campaign', header: 'Kampaň', render: (r) => r.campaignName },
  ];

  const table = (
    <Table
      columns={columns}
      rows={data.writes}
      rowKey={(r) => r.itemId}
      emptyLabel="Appka na tento produkt zatiaľ nezapisovala."
      caption="Vlastné zápisy appky, nie stav zľavy v shope."
    />
  );

  const points = data.writes.filter((w) => w.at !== null);

  if (points.length === 0) {
    return (
      <ChartFrame
        title="Vlastné zápisy na tento produkt"
        subtitle="Kedy appka na produkt zapisovala a s akým percentom."
        table={table}
        testId="chart-product-writes"
      >
        <ChartEmpty>
          Appka na tento produkt zatiaľ nič nezapísala. Prípadnú zľavu v shope preto nepozná.
        </ChartEmpty>
      </ChartFrame>
    );
  }

  const times = points.map((w) => new Date(w.at as string).getTime());
  const todayMs = new Date(`${data.today}T12:00:00.000Z`).getTime();
  let minT = Math.min(...times);
  let maxT = Math.max(Math.max(...times), todayMs);
  if (maxT - minT < 3 * DAY_MS) {
    minT -= 2 * DAY_MS;
    maxT += 2 * DAY_MS;
  }
  const xOf = (ms: number) => PLOT_X0 + ((PLOT_X1 - PLOT_X0) * (ms - minT)) / Math.max(1, maxT - minT);
  const yOf = (percent: number) =>
    PLOT_Y1 - ((PLOT_Y1 - PLOT_Y0) * Math.max(0, Math.min(PERCENT_CAP, percent))) / PERCENT_CAP;

  const yTicks = [0, 10, 20, 30];
  const xTicks = [minT, (minT + maxT) / 2, maxT];

  return (
    <ChartFrame
      title="Vlastné zápisy na tento produkt"
      subtitle="Kedy appka na produkt zapisovala a s akým percentom. Shop môže mať iný stav — appka pozná len vlastné zápisy."
      legend={<ChartLegend items={LEGEND} />}
      table={table}
      tooltip={tooltip}
      testId="chart-product-writes"
    >
      <svg
        className="ovl-chart"
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        role="img"
        aria-label={`História ${points.length} vlastných zápisov na produkt ${data.productId}.`}
        style={{ height: 'auto' }}
      >
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={PLOT_X0}
              y1={yOf(tick)}
              x2={PLOT_X1}
              y2={yOf(tick)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text x={PLOT_X0 - 6} y={yOf(tick) + 3} fontSize={10} fill="var(--dim)" textAnchor="end">
              {tick} %
            </text>
          </g>
        ))}
        {xTicks.map((tick, i) => (
          <text
            key={`x-${i}`}
            x={xOf(tick)}
            y={PLOT_Y1 + 16}
            fontSize={10}
            fill="var(--dim)"
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {formatDateSk(new Date(tick))}
          </text>
        ))}
        {/* „dnes" — teal ako orientácia, nie ako stav */}
        <line
          x1={xOf(todayMs)}
          y1={PLOT_Y0 - 8}
          x2={xOf(todayMs)}
          y2={PLOT_Y1}
          stroke="var(--brand)"
          strokeWidth={1}
        />
        <text x={xOf(todayMs) - 3} y={PLOT_Y0 - 10} fontSize={9} fill="var(--brand)" textAnchor="end">
          dnes
        </text>

        {points.map((write) => {
          const visual = itemVisual(write.status);
          const shape = markShape(visual.tone);
          const color = toneColor(visual.tone);
          const x = xOf(new Date(write.at as string).getTime());
          const y = yOf(write.percent);
          const description = `${formatDateTimeSk(write.at)} · ${visual.label} · ${formatPercentSk(write.percent)} · kampaň ${write.campaignName}`;
          return (
            <g
              key={write.itemId}
              className="ovl-chart-mark"
              onMouseMove={(event) =>
                tooltip.show(
                  event,
                  <>
                    <strong>
                      <span aria-hidden="true">{visual.glyph} </span>
                      {visual.label}
                    </strong>
                    <br />
                    {formatPercentSk(write.percent)} · {formatDateTimeSk(write.at)}
                    <br />
                    okno {formatDateSk(write.dateFrom)} – {formatDateSk(write.dateTo)}
                    <br />
                    {write.campaignName}
                  </>,
                )
              }
            >
              <title>{description}</title>
              {shape === 'circle' ? (
                <circle
                  cx={x}
                  cy={y}
                  r={MARK_R}
                  fill={color}
                  stroke="var(--surface-solid)"
                  strokeWidth={2}
                  paintOrder="stroke fill"
                />
              ) : shape === 'cross' ? (
                <g stroke={color} strokeWidth={2.5} strokeLinecap="round">
                  <line x1={x - MARK_R} y1={y - MARK_R} x2={x + MARK_R} y2={y + MARK_R} />
                  <line x1={x - MARK_R} y1={y + MARK_R} x2={x + MARK_R} y2={y - MARK_R} />
                </g>
              ) : (
                <path
                  d={`M${x},${y - MARK_R - 0.5} L${x + MARK_R + 0.5},${y} L${x},${y + MARK_R + 0.5} L${x - MARK_R - 0.5},${y} Z`}
                  fill={color}
                  stroke="var(--surface-solid)"
                  strokeWidth={2}
                  paintOrder="stroke fill"
                />
              )}
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

export default ProductWriteHistory;
