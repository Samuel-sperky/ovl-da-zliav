'use client';

/**
 * Aura Zľavy — G1: časová os okien kampaní (plán §4).
 *
 * Forma: horizontálne spany na 3-mesačnej osi. Os nesie ROZSAH, nie magnitúdu,
 * preto tu nie je ani jedna hodnotová škála a percento je len v popiskoch.
 *
 * Prečo graf existuje: dnes sa prekryv okien dá zistiť jedine čítaním dátumov
 * v tabuľke. Prekryv, ktorý je blokujúci (rovnaký PRODUKT v prekrývajúcom sa
 * čase, D28), je označený 2 px prstencom v farbe plochy — nie inou farbou,
 * pretože farba už kóduje stav.
 *
 * Farby: stavová paleta B1 (`--st-*`) + glyf na začiatku spanu. „Dnes" je 1 px
 * teal vertikála — `--brand` tu slúži ako ORIENTÁCIA, nie ako stav.
 *
 * I11: graf kreslí okná kampaní z NAŠEJ databázy. Netvrdí, čo má shop.
 *
 * Vlastník: B2.
 */
import { useEffect, useState } from 'react';

import Table, { type TableColumn } from '@/components/ui/Table';
import { formatDateSk, formatPercentSk } from '@/lib/ui/format';
import {
  ChartEmpty,
  ChartFrame,
  ChartLegend,
  ChartSkeleton,
  useChartTooltip,
  type LegendItem,
} from '@/components/charts/ChartFrame';
import {
  campaignVisual,
  dayToX,
  monthTicks,
  overlappingIds,
  spanGeometry,
  toneColor,
  truncateLabel,
  windowLengthDays,
  type Axis,
} from '@/components/charts/chart-utils';
import { getTimeline, type TimelineCampaign, type TimelineData } from '@/components/charts/api';

/* ── geometria viewBoxu ────────────────────────────────────────────────── */

const VB_WIDTH = 760;
const LABEL_W = 168;
const PLOT_X0 = 176;
const PLOT_X1 = 752;
const HEAD_H = 22;
const ROW_H = 22;
const SPAN_H = 10;
const MAX_ROWS = 24;

export interface CampaignTimelineProps {
  /** Dáta zvonku (server render, testy). Bez nich si komponent načíta vlastné. */
  data?: TimelineData;
  /** Skryť kartový rám — keď si ho kreslí hostiteľská stránka. */
  bare?: boolean;
}

export function CampaignTimeline({ data: given }: CampaignTimelineProps) {
  const [data, setData] = useState<TimelineData | null>(given ?? null);
  const [error, setError] = useState<string | null>(null);
  const tooltip = useChartTooltip();

  useEffect(() => {
    if (given !== undefined) {
      setData(given);
      return;
    }
    let alive = true;
    void getTimeline().then((res) => {
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
        Časovú os sa nepodarilo načítať. {error}
      </p>
    );
  }
  if (data === null) return <ChartSkeleton label="Načítavam časovú os kampaní" height={180} />;

  const axis: Axis = { from: data.from, to: data.to, x0: PLOT_X0, x1: PLOT_X1 };
  const rows = data.campaigns.slice(0, MAX_ROWS);
  const hidden = data.campaigns.length - rows.length;
  const overlaps = overlappingIds(
    data.campaigns.map((c) => ({
      id: c.id,
      dateFrom: c.dateFrom,
      dateTo: c.dateTo,
      productIds: c.productIds,
    })),
  );
  const ticks = monthTicks(data.from, data.to);
  const todayX = dayToX(data.today, axis);
  const plotH = HEAD_H + rows.length * ROW_H + 6;

  const usedTones = new Map<string, LegendItem>();
  for (const c of rows) {
    const v = campaignVisual(c.status);
    if (!usedTones.has(v.label)) {
      usedTones.set(v.label, {
        key: v.label,
        color: toneColor(v.tone),
        glyph: v.glyph,
        label: v.label,
      });
    }
  }

  const columns: TableColumn<TimelineCampaign>[] = [
    { key: 'name', header: 'Kampaň', render: (r) => r.name },
    {
      key: 'status',
      header: 'Stav',
      render: (r) => {
        const v = campaignVisual(r.status);
        return (
          <>
            <span aria-hidden="true">{v.glyph} </span>
            {v.label}
          </>
        );
      },
    },
    {
      key: 'percent',
      header: 'Zľava',
      kind: 'num',
      render: (r) => formatPercentSk(r.percent),
    },
    {
      key: 'window',
      header: 'Okno',
      kind: 'date',
      render: (r) => `${formatDateSk(r.dateFrom)} – ${formatDateSk(r.dateTo)}`,
    },
    {
      key: 'len',
      header: 'Dĺžka',
      kind: 'num',
      render: (r) => `${windowLengthDays(r.dateFrom, r.dateTo)} dní`,
    },
    { key: 'items', header: 'Produkty', kind: 'num', render: (r) => r.productIds.length },
    {
      key: 'overlap',
      header: 'Prekryv',
      render: (r) => (overlaps.has(r.id) ? 'áno — rovnaký produkt' : '—'),
    },
  ];

  const table = (
    <Table
      columns={columns}
      rows={data.campaigns}
      rowKey={(r) => r.id}
      emptyLabel="V tomto trojmesačnom okne nie je ani jedna kampaň."
    />
  );

  if (rows.length === 0) {
    return (
      <ChartFrame
        title="Okná kampaní"
        subtitle="Tri mesiace okolo dneška — čo appka naplánovala a zapísala."
        table={table}
        testId="chart-campaign-timeline"
      >
        <ChartEmpty>
          V tomto trojmesačnom okne nie je ani jedna kampaň. Novú založíš cez „+ Nová kampaň“.
        </ChartEmpty>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title="Okná kampaní"
      subtitle="Tri mesiace okolo dneška. Prstenec označuje kampane, ktoré si na tom istom produkte prekrývajú okno."
      legend={<ChartLegend items={[...usedTones.values()]} />}
      table={table}
      tooltip={tooltip}
      testId="chart-campaign-timeline"
      {...(hidden > 0
        ? {
            note: (
              <p className="ovl-small ovl-muted" style={{ margin: 0 }}>
                Graf kreslí prvých {rows.length} kampaní; ďalších {hidden} nájdeš v tabuľke pod
                grafom.
              </p>
            ),
          }
        : {})}
    >
      <svg
        className="ovl-chart"
        viewBox={`0 0 ${VB_WIDTH} ${plotH}`}
        role="img"
        aria-label={`Časová os ${rows.length} kampaní od ${formatDateSk(data.from)} do ${formatDateSk(data.to)}.`}
        style={{ height: 'auto' }}
      >
        {/* mesačná mriežka — hairline, nikdy prerušovaná */}
        {ticks.map((tick) => {
          const x = dayToX(tick.day, axis);
          return (
            <g key={tick.day}>
              <line
                x1={x}
                y1={HEAD_H - 6}
                x2={x}
                y2={plotH - 2}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <text x={x + 4} y={12} fontSize={10} fill="var(--dim)">
                {tick.label}
              </text>
            </g>
          );
        })}

        {/* „dnes" — teal ako orientácia, nie ako stav */}
        {todayX >= PLOT_X0 && todayX <= PLOT_X1 ? (
          <g>
            <line
              x1={todayX}
              y1={HEAD_H - 10}
              x2={todayX}
              y2={plotH - 2}
              stroke="var(--brand)"
              strokeWidth={1}
            />
            <text x={todayX + 3} y={HEAD_H - 12} fontSize={9} fill="var(--brand)">
              dnes
            </text>
          </g>
        ) : null}

        {rows.map((campaign, index) => {
          const visual = campaignVisual(campaign.status);
          const geo = spanGeometry(campaign.dateFrom, campaign.dateTo, axis);
          const rowTop = HEAD_H + index * ROW_H;
          const spanY = rowTop + (ROW_H - SPAN_H) / 2;
          const midY = rowTop + ROW_H / 2;
          const overlapping = overlaps.has(campaign.id);
          const glyphLeft = geo.x - 5 >= PLOT_X0 + 6;
          const description = `${campaign.name} · ${visual.label} · ${formatPercentSk(campaign.percent)} · ${formatDateSk(campaign.dateFrom)} – ${formatDateSk(campaign.dateTo)} (${windowLengthDays(campaign.dateFrom, campaign.dateTo)} dní) · ${campaign.productIds.length} produktov${overlapping ? ' · prekrýva sa s inou kampaňou na tom istom produkte' : ''}`;

          return (
            <a key={campaign.id} href={`/kampane/${campaign.id}`} aria-label={description}>
              <g
                className="ovl-chart-mark"
                onMouseMove={(event) =>
                  tooltip.show(
                    event,
                    <>
                      <strong>{campaign.name}</strong>
                      <br />
                      <span aria-hidden="true">{visual.glyph} </span>
                      {visual.label} · {formatPercentSk(campaign.percent)}
                      <br />
                      {formatDateSk(campaign.dateFrom)} – {formatDateSk(campaign.dateTo)} (
                      {windowLengthDays(campaign.dateFrom, campaign.dateTo)} dní)
                      <br />
                      {campaign.productIds.length} produktov
                      {overlapping ? (
                        <>
                          <br />
                          prekryv na tom istom produkte
                        </>
                      ) : null}
                    </>,
                  )
                }
              >
                <title>{description}</title>
                <text
                  x={LABEL_W}
                  y={midY + 3}
                  fontSize={11}
                  fill="var(--ink)"
                  textAnchor="end"
                >
                  {truncateLabel(campaign.name, 24)}
                </text>
                {geo.visible ? (
                  <>
                    <rect
                      className="ovl-anim-grow"
                      x={geo.x}
                      y={spanY}
                      width={geo.width}
                      height={SPAN_H}
                      rx={4}
                      fill={toneColor(visual.tone)}
                      {...(overlapping
                        ? {
                            stroke: 'var(--surface-solid)',
                            strokeWidth: 2,
                            paintOrder: 'stroke fill',
                          }
                        : {})}
                    />
                    <text
                      x={glyphLeft ? geo.x - 5 : geo.x + geo.width + 5}
                      y={midY + 4}
                      fontSize={11}
                      fill={toneColor(visual.tone)}
                      textAnchor={glyphLeft ? 'end' : 'start'}
                      aria-hidden="true"
                    >
                      {visual.glyph}
                    </text>
                    {geo.clippedStart ? (
                      <text
                        x={PLOT_X0 - 2}
                        y={midY + 4}
                        fontSize={10}
                        fill="var(--dim)"
                        textAnchor="end"
                        aria-hidden="true"
                      >
                        ‹
                      </text>
                    ) : null}
                    {geo.clippedEnd ? (
                      <text
                        x={PLOT_X1 + 2}
                        y={midY + 4}
                        fontSize={10}
                        fill="var(--dim)"
                        textAnchor="start"
                        aria-hidden="true"
                      >
                        ›
                      </text>
                    ) : null}
                  </>
                ) : (
                  <text x={PLOT_X0 + 4} y={midY + 4} fontSize={10} fill="var(--dim)">
                    mimo zobrazeného okna
                  </text>
                )}
              </g>
            </a>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

export default CampaignTimeline;
