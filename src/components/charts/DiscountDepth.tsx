'use client';

/**
 * Aura Zľavy — G2: hĺbka zľavy na allowliste (plán §4).
 *
 * Forma: horizontálny bar chart, jeden riadok na produkt, hodnota = percento
 * POSLEDNÉHO VLASTNÉHO ZÁPISU (I11 — nie stav zľavy v shope; to appka nevie
 * a nikde to netvrdí).
 *
 * Farba: **sekvenčná teal** `--seq-teal-1…5`. Toto je jediný graf, kde je teal
 * správne — kóduje magnitúdu, nie stav. Stavová paleta sa tu preto nepoužíva
 * a legenda je škála, nie zoznam stavov.
 *
 * Os je 0–30 %, teda strop, ktorý dovolí shop API aj lokálna validácia (I9).
 * Produkt bez vlastného zápisu má prázdnu dráhu a text „bez zápisu“ — prázdno
 * je informácia, nie chýbajúce dáta.
 *
 * Vlastník: B2.
 */
import { useEffect, useState } from 'react';

import PriceHint, { PriceHintLegend } from '@/components/ui/PriceHint';
import SelfWriteBadge, { SelfWriteLegend } from '@/components/ui/SelfWriteBadge';
import Table, { type TableColumn } from '@/components/ui/Table';
import VariantWarning from '@/components/ui/VariantWarning';
import { formatDateSk, formatEur, formatPercentSk } from '@/lib/ui/format';
import {
  ChartEmpty,
  ChartFrame,
  ChartLegend,
  ChartSkeleton,
  useChartTooltip,
  type LegendItem,
} from '@/components/charts/ChartFrame';
import {
  PERCENT_CAP,
  barPathRightRounded,
  sequentialColor,
  truncateLabel,
} from '@/components/charts/chart-utils';
import { getDiscountDepth, type DepthData, type DepthProduct } from '@/components/charts/api';

const VB_WIDTH = 760;
const LABEL_W = 190;
const PLOT_X0 = 198;
const PLOT_X1 = 690;
const ROW_H = 26;
const BAR_H = 8;
const HEAD_H = 16;

/** Legenda sekvenčnej rampy — päť krokov, nie päť stavov. */
const RAMP_LEGEND: LegendItem[] = [1, 2, 3, 4, 5].map((step) => ({
  key: `seq-${step}`,
  color: `var(--seq-teal-${step})`,
  label: step === 1 ? 'plytká zľava' : step === 5 ? 'hlboká zľava' : '',
}));

export interface DiscountDepthProps {
  /** Dáta zvonku (server render, testy). Bez nich si komponent načíta vlastné. */
  data?: DepthData;
}

export function DiscountDepth({ data: given }: DiscountDepthProps) {
  const [data, setData] = useState<DepthData | null>(given ?? null);
  const [error, setError] = useState<string | null>(null);
  const tooltip = useChartTooltip();

  useEffect(() => {
    if (given !== undefined) {
      setData(given);
      return;
    }
    let alive = true;
    void getDiscountDepth().then((res) => {
      if (!alive) return;
      if (res.ok) setData(res.data);
      else setError(res.error.message);
    });
    return () => {
      alive = false;
    };
  }, [given]);

  if (error !== null) {
    return (
      <p className="ovl-error" role="status">
        Hĺbku zliav sa nepodarilo načítať. {error}
      </p>
    );
  }
  if (data === null) return <ChartSkeleton label="Načítavam hĺbku zliav" height={180} />;

  const rows = data.products;
  const plotH = HEAD_H + rows.length * ROW_H + 8;
  const scale = (percent: number) =>
    ((PLOT_X1 - PLOT_X0) * Math.max(0, Math.min(PERCENT_CAP, percent))) / PERCENT_CAP;

  const columns: TableColumn<DepthProduct>[] = [
    {
      key: 'product',
      header: 'Produkt',
      render: (r) => (
        <span>
          {r.name ?? r.label ?? 'bez názvu'} <span className="ovl-muted">#{r.productId}</span>{' '}
          <VariantWarning hasAttributes={r.hasAttributes} compact />
        </span>
      ),
    },
    { key: 'price', header: 'Cena', kind: 'money', render: (r) => formatEur(r.price) },
    {
      key: 'percent',
      header: 'Zľava',
      kind: 'num',
      render: (r) =>
        r.lastOwnWrite ? formatPercentSk(r.lastOwnWrite.percent) : <span className="ovl-muted">bez zápisu</span>,
    },
    {
      key: 'discounted',
      header: 'Orientačná cena',
      kind: 'money',
      render: (r) =>
        r.lastOwnWrite ? <PriceHint price={r.price} percent={r.lastOwnWrite.percent} /> : '—',
    },
    {
      key: 'window',
      header: 'Okno zápisu',
      kind: 'date',
      render: (r) =>
        r.lastOwnWrite
          ? `${formatDateSk(r.lastOwnWrite.from)} – ${formatDateSk(r.lastOwnWrite.to)}`
          : '—',
    },
    {
      key: 'selfwrite',
      header: 'Evidencia',
      render: (r) => <SelfWriteBadge writtenAt={r.lastOwnWrite?.at ?? null} />,
    },
  ];

  const table = (
    <div className="ovl-stack">
      <SelfWriteLegend />
      <PriceHintLegend />
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.productId}
        emptyLabel="Allowlist je prázdny — pridaj produkt v sekcii Produkty."
      />
    </div>
  );

  if (rows.length === 0) {
    return (
      <ChartFrame
        title="Hĺbka zľavy na allowliste"
        subtitle="Percento posledného vlastného zápisu appky pre každý produkt."
        table={table}
        testId="chart-discount-depth"
      >
        <ChartEmpty>
          Allowlist je prázdny. Pridaj produkt v sekcii Produkty — bez allowlistu appka nezapíše
          nič.
        </ChartEmpty>
      </ChartFrame>
    );
  }

  const written = rows.filter((r) => r.lastOwnWrite !== null).length;

  return (
    <ChartFrame
      title="Hĺbka zľavy na allowliste"
      subtitle="Percento posledného vlastného zápisu appky. Shop môže mať iný stav — appka pozná len to, čo sama zapísala."
      legend={<ChartLegend items={RAMP_LEGEND} />}
      table={table}
      tooltip={tooltip}
      testId="chart-discount-depth"
      note={
        <p className="ovl-small ovl-muted" style={{ margin: 0 }}>
          {written} z {rows.length} produktov má vlastný zápis. Os končí pri 30 % — to je strop,
          ktorý shop API dovolí.
        </p>
      }
    >
      <svg
        className="ovl-chart"
        viewBox={`0 0 ${VB_WIDTH} ${plotH}`}
        role="img"
        aria-label={`Hĺbka zľavy pre ${rows.length} produktov allowlistu, os 0 až 30 percent.`}
        style={{ height: 'auto' }}
      >
        {/* základňa 0 % a značka stropu 30 % */}
        <line x1={PLOT_X0} y1={HEAD_H - 8} x2={PLOT_X0} y2={plotH - 4} stroke="var(--line-strong)" strokeWidth={1} />
        <line x1={PLOT_X1} y1={HEAD_H - 8} x2={PLOT_X1} y2={plotH - 4} stroke="var(--line)" strokeWidth={1} />
        <text x={PLOT_X0} y={10} fontSize={10} fill="var(--dim)">
          0 %
        </text>
        <text x={PLOT_X1} y={10} fontSize={10} fill="var(--dim)" textAnchor="end">
          strop 30 %
        </text>

        {rows.map((product, index) => {
          const top = HEAD_H + index * ROW_H;
          const midY = top + ROW_H / 2;
          const barY = midY - BAR_H / 2;
          const percent = product.lastOwnWrite?.percent ?? 0;
          const width = scale(percent);
          const name = product.name ?? product.label ?? `Produkt #${product.productId}`;
          const description =
            product.lastOwnWrite === null
              ? `${name} (#${product.productId}) — appka na tento produkt nikdy nezapísala zľavu.`
              : `${name} (#${product.productId}) — ${formatPercentSk(percent)} podľa vlastného zápisu z ${formatDateSk(product.lastOwnWrite.at)}; okno ${formatDateSk(product.lastOwnWrite.from)} – ${formatDateSk(product.lastOwnWrite.to)}.`;

          return (
            <g
              key={product.productId}
              className="ovl-chart-mark"
              onMouseMove={(event) =>
                tooltip.show(
                  event,
                  <>
                    <strong>{name}</strong> <span className="ovl-muted">#{product.productId}</span>
                    <br />
                    {product.lastOwnWrite === null ? (
                      'bez vlastného zápisu'
                    ) : (
                      <>
                        {formatPercentSk(percent)} · {formatEur(product.price)}
                        <br />
                        okno {formatDateSk(product.lastOwnWrite.from)} –{' '}
                        {formatDateSk(product.lastOwnWrite.to)}
                        <br />
                        vlastný zápis {formatDateSk(product.lastOwnWrite.at)}
                      </>
                    )}
                  </>,
                )
              }
            >
              <title>{description}</title>
              <text x={LABEL_W} y={midY + 4} fontSize={11} fill="var(--ink)" textAnchor="end">
                {truncateLabel(name, 26)}
              </text>
              {product.lastOwnWrite === null ? (
                <>
                  <line
                    x1={PLOT_X0}
                    y1={midY}
                    x2={PLOT_X1}
                    y2={midY}
                    stroke="var(--line)"
                    strokeWidth={1}
                    strokeDasharray="3 4"
                  />
                  <text x={PLOT_X0 + 6} y={midY - 5} fontSize={10} fill="var(--dim)">
                    bez zápisu
                  </text>
                </>
              ) : (
                <>
                  <path
                    className="ovl-anim-grow"
                    d={barPathRightRounded(PLOT_X0, barY, width, BAR_H, 4)}
                    fill={sequentialColor(percent)}
                  />
                  <text x={PLOT_X0 + width + 6} y={midY + 4} fontSize={11} fill="var(--ink)">
                    {formatPercentSk(percent)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

export default DiscountDepth;
