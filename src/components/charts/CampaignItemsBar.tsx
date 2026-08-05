'use client';

/**
 * Aura Zľavy — G5: rozpad položiek kampane (plán §4).
 *
 * Forma: JEDEN segmentovaný pruh (`2 zapísané · 1 zlyhaný · 1 nenájdený ·
 * 1 preskočený`), **nie donut** — donut na viac než dve kategórie je zakázaná
 * forma (plán §4). Pod pruhom sú počítadlá ako text.
 *
 * Prečo graf existuje: rieši U6. Dnešný súhrn hovorí „2 ok · 1 zlyhané ·
 * 0 neisté · spolu 5" — chýbajúce dva stavy nemajú kolónku a súčet nesedí.
 * Tu má kolónku každý stav a súčet sedí vždy.
 *
 * Segmenty oddeľuje 2 px medzera v farbe plochy, nie obrys. Každý stav nesie
 * farbu + glyf + slovenský text (§3.3); `preskočený` je neutrál, nie chyba (V20).
 *
 * Vlastník: B2.
 */
import { useEffect, useState } from 'react';

import Table, { type TableColumn } from '@/components/ui/Table';
import {
  ChartEmpty,
  ChartFrame,
  ChartLegend,
  ChartSkeleton,
  useChartTooltip,
} from '@/components/charts/ChartFrame';
import { itemSegments, tallyTotal, toneColor, type Segment } from '@/components/charts/chart-utils';
import { getCampaignItems } from '@/components/charts/api';

const VB_WIDTH = 760;
const BAR_H = 14;
const SEGMENT_GAP = 2;

export interface CampaignItemsBarProps {
  /** Počty po stavoch. Keď sa nedodajú, komponent si ich načíta podľa `campaignId`. */
  tally?: Record<string, number>;
  /** ID kampane pre vlastné načítanie a pre popisky. */
  campaignId?: number;
}

export function CampaignItemsBar({ tally: given, campaignId }: CampaignItemsBarProps) {
  const [tally, setTally] = useState<Record<string, number> | null>(given ?? null);
  const [error, setError] = useState<string | null>(null);
  const tooltip = useChartTooltip();

  useEffect(() => {
    if (given !== undefined) {
      setTally(given);
      return;
    }
    if (campaignId === undefined) return;
    let alive = true;
    void getCampaignItems(campaignId).then((res) => {
      if (!alive) return;
      if (res.ok) setTally(res.data.tally);
      else setError(res.error.message);
    });
    return () => {
      alive = false;
    };
  }, [given, campaignId]);

  if (error !== null) {
    return (
      <p className="ovl-error" role="status">
        Rozpad položiek sa nepodarilo načítať. {error}
      </p>
    );
  }
  if (tally === null) return <ChartSkeleton label="Načítavam rozpad položiek" height={60} />;

  const segments = itemSegments(tally);
  const total = tallyTotal(tally);

  const columns: TableColumn<Segment>[] = [
    {
      key: 'status',
      header: 'Stav položky',
      render: (r) => (
        <>
          <span aria-hidden="true">{r.visual.glyph} </span>
          {r.visual.label}
        </>
      ),
    },
    { key: 'count', header: 'Počet', kind: 'num', render: (r) => r.count },
    {
      key: 'share',
      header: 'Podiel',
      kind: 'num',
      render: (r) => `${Math.round((r.count / Math.max(1, total)) * 100)} %`,
    },
  ];

  const table = (
    <Table
      columns={columns}
      rows={segments}
      rowKey={(r) => r.key}
      emptyLabel="Kampaň zatiaľ nemá ani jednu položku."
      caption={`Spolu ${total} položiek — súčet stavov sedí so „spolu“ vždy.`}
    />
  );

  if (total === 0 || segments.length === 0) {
    return (
      <ChartFrame
        title="Rozpad položiek kampane"
        subtitle="Koľko produktov appka zapísala a čo sa stalo so zvyškom."
        table={table}
        testId="chart-campaign-items"
      >
        <ChartEmpty>Kampaň zatiaľ nemá ani jednu položku.</ChartEmpty>
      </ChartFrame>
    );
  }

  const gaps = SEGMENT_GAP * Math.max(0, segments.length - 1);
  const usable = VB_WIDTH - gaps;
  let cursor = 0;

  return (
    <ChartFrame
      title="Rozpad položiek kampane"
      subtitle={`Spolu ${total} položiek${campaignId === undefined ? '' : ` v kampani #${campaignId}`}. Súčet stavov sedí so „spolu“.`}
      legend={
        <ChartLegend
          items={segments.map((segment) => ({
            key: segment.key,
            color: toneColor(segment.visual.tone),
            glyph: segment.visual.glyph,
            label: segment.visual.label,
            value: String(segment.count),
          }))}
        />
      }
      table={table}
      tooltip={tooltip}
      testId="chart-campaign-items"
      note={
        <p className="ovl-small ovl-muted" style={{ margin: 0 }}>
          {segments.map((s) => `${s.count} ${s.visual.label}`).join(' · ')} · spolu {total}
        </p>
      }
    >
      <svg
        className="ovl-chart"
        viewBox={`0 0 ${VB_WIDTH} ${BAR_H}`}
        role="img"
        aria-label={`Rozpad ${total} položiek: ${segments.map((s) => `${s.count} ${s.visual.label}`).join(', ')}.`}
        style={{ height: `${BAR_H * 1.6}px` }}
        preserveAspectRatio="none"
      >
        {segments.map((segment, index) => {
          const width = (usable * segment.count) / total;
          const x = cursor;
          cursor += width + SEGMENT_GAP;
          const first = index === 0;
          const last = index === segments.length - 1;
          const description = `${segment.count}× ${segment.visual.label}`;
          return (
            <g
              key={segment.key}
              className="ovl-chart-mark"
              onMouseMove={(event) =>
                tooltip.show(
                  event,
                  <>
                    <span aria-hidden="true">{segment.visual.glyph} </span>
                    <strong>{segment.visual.label}</strong>
                    <br />
                    {segment.count} z {total} položiek
                  </>,
                )
              }
            >
              <title>{description}</title>
              <rect
                className="ovl-anim-grow"
                x={x}
                y={0}
                width={Math.max(1, width)}
                height={BAR_H}
                rx={first || last ? 4 : 0}
                fill={toneColor(segment.visual.tone)}
              />
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

export default CampaignItemsBar;
